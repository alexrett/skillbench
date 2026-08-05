import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { TaskExecution, TaskRunInput, TaskRunner } from "./types.ts";

export interface CodexTaskRunnerOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
}

async function resolveCodexBinary(explicit?: string): Promise<string> {
  const candidate = explicit ?? Bun.which("codex");
  if (!candidate) throw new Error("Codex CLI was not found. Install it or pass --codex-bin <path>.");
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

function taskPrompt(input: TaskRunInput): string {
  const skill = input.skillMarkdown && input.skillName
    ? `\nAn installed skill named ${input.skillName} is available for this task. Follow it when applicable. Its complete read-only package, including scripts and references, is available at ${input.skillPath}. Resolve relative resource paths from that directory.\n\n<skill_root>${input.skillPath}</skill_root>\n<skill_instructions>\n${input.skillMarkdown}\n</skill_instructions>\n`
    : "";
  return `Complete the user's task in the current isolated workspace. Work on the files directly, run proportionate local checks, and report the concrete result. Do not merely describe what you would do.${skill}\n<user_request>\n${input.prompt}\n</user_request>`;
}

function numericProperty(value: unknown, ...keys: string[]): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
  }
  return undefined;
}

function metadataFromJsonLines(source: string): {
  inputTokens?: number;
  outputTokens?: number;
  commands?: Array<{ command: string; exitCode?: number }>;
} {
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const commands: Array<{ command: string; exitCode?: number }> = [];
  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const usage = event.usage ?? (event.data as Record<string, unknown> | undefined)?.usage;
      inputTokens = numericProperty(usage, "input_tokens", "inputTokens") ?? inputTokens;
      outputTokens = numericProperty(usage, "output_tokens", "outputTokens") ?? outputTokens;
      const item = event.item;
      if (event.type === "item.completed" && item && typeof item === "object" && !Array.isArray(item)) {
        const record = item as Record<string, unknown>;
        if (record.type === "command_execution" && typeof record.command === "string") {
          commands.push({
            command: record.command,
            exitCode: typeof record.exit_code === "number" ? record.exit_code : undefined,
          });
        }
      }
    } catch {
      // Diagnostics can contain non-JSON lines on older Codex versions.
    }
  }
  return { inputTokens, outputTokens, commands: commands.length > 0 ? commands : undefined };
}

export class CodexTaskRunner implements TaskRunner {
  readonly name = "codex";
  readonly model?: string;
  private readonly binary?: string;
  private readonly timeoutMs: number;

  constructor(options: CodexTaskRunnerOptions = {}) {
    this.binary = options.binary;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async execute(input: TaskRunInput): Promise<TaskExecution> {
    const started = performance.now();
    const binary = await resolveCodexBinary(this.binary);
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-task-output-"));
    const outputPath = path.join(temp, "last-message.txt");
    const command = [
      binary,
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--config",
      "sandbox_workspace_write.network_access=false",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--color",
      "never",
      "--json",
      "--output-last-message",
      outputPath,
      "-C",
      input.workspacePath,
    ];
    if (this.model) command.push("--model", this.model);
    command.push("-");

    const subprocess = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    subprocess.stdin.write(taskPrompt(input));
    subprocess.stdin.end();
    const timeout = setTimeout(() => subprocess.kill(), this.timeoutMs);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);
      if (exitCode !== 0) {
        const diagnostic = (stderr || stdout).trim().split("\n").slice(-6).join("\n");
        throw new Error(`Codex task runner exited with ${exitCode}${diagnostic ? `:\n${diagnostic}` : ""}`);
      }
      const metadata = metadataFromJsonLines(stdout);
      return {
        finalOutput: await readFile(outputPath, "utf8"),
        durationMs: Math.round(performance.now() - started),
        ...metadata,
      };
    } finally {
      clearTimeout(timeout);
      await rm(temp, { recursive: true, force: true });
    }
  }
}
