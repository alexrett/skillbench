import { performance } from "node:perf_hooks";
import { claudeDiagnostic, numericProperty, resolveClaudeBinary } from "../claude.ts";
import type { TaskExecution, TaskRunInput, TaskRunner } from "./types.ts";

export interface ClaudeTaskRunnerOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
}

interface CommandRecord {
  command: string;
  exitCode?: number;
}

interface StreamMetadata {
  finalOutput?: string;
  failedMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  commands?: CommandRecord[];
}

function taskPrompt(input: TaskRunInput): string {
  const skill = input.skillMarkdown && input.skillName
    ? `\nAn installed skill named ${input.skillName} is available for this task. Follow it when applicable. Its complete read-only package, including scripts and references, is available at ${input.skillPath}. Resolve relative resource paths from that directory.\n\n<skill_root>${input.skillPath}</skill_root>\n<skill_instructions>\n${input.skillMarkdown}\n</skill_instructions>\n`
    : "";
  return `Complete the user's task in the current disposable workspace. Work on the files directly, run proportionate local checks, and report the concrete result. Do not merely describe what you would do.${skill}\n<user_request>\n${input.prompt}\n</user_request>`;
}

function contentBlocks(event: Record<string, unknown>): Array<Record<string, unknown>> {
  const message = event.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return [];
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) return [];
  return content.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
}

function commandExitCode(block: Record<string, unknown>): number | undefined {
  const content = typeof block.content === "string" ? block.content : "";
  const explicit = content.match(/(?:^|\n)Exit code (\d+)(?:\n|$)/i);
  if (explicit) return Number(explicit[1]);
  if (block.is_error === true) return 1;
  if (block.is_error === false) return 0;
  return undefined;
}

export function metadataFromClaudeJsonLines(source: string): StreamMetadata {
  let finalOutput: string | undefined;
  let failedMessage: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const commands: CommandRecord[] = [];
  const commandByToolUse = new Map<string, number>();

  for (const line of source.split(/\r?\n/).filter(Boolean)) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    if (event.type === "assistant") {
      const message = event.message;
      const usage = message && typeof message === "object" && !Array.isArray(message)
        ? (message as Record<string, unknown>).usage
        : undefined;
      inputTokens = numericProperty(usage, "input_tokens", "inputTokens") ?? inputTokens;
      outputTokens = numericProperty(usage, "output_tokens", "outputTokens") ?? outputTokens;
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_use" || block.name !== "Bash") continue;
        const commandInput = block.input;
        if (!commandInput || typeof commandInput !== "object" || Array.isArray(commandInput)) continue;
        const command = (commandInput as Record<string, unknown>).command;
        if (typeof command !== "string") continue;
        const index = commands.push({ command }) - 1;
        if (typeof block.id === "string") commandByToolUse.set(block.id, index);
      }
    }

    if (event.type === "user") {
      for (const block of contentBlocks(event)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        const index = commandByToolUse.get(block.tool_use_id);
        if (index === undefined || !commands[index]) continue;
        commands[index].exitCode = commandExitCode(block);
      }
    }

    if (event.type === "result") {
      const usage = event.usage;
      inputTokens = numericProperty(usage, "input_tokens", "inputTokens") ?? inputTokens;
      outputTokens = numericProperty(usage, "output_tokens", "outputTokens") ?? outputTokens;
      if (typeof event.result === "string") finalOutput = event.result;
      if (event.is_error === true) failedMessage = typeof event.result === "string" ? event.result : "Claude reported an error";
    }
  }

  return {
    finalOutput,
    failedMessage,
    inputTokens,
    outputTokens,
    commands: commands.length > 0 ? commands : undefined,
  };
}

export class ClaudeTaskRunner implements TaskRunner {
  readonly name = "claude";
  readonly model?: string;
  private readonly binary?: string;
  private readonly timeoutMs: number;

  constructor(options: ClaudeTaskRunnerOptions = {}) {
    this.binary = options.binary;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async execute(input: TaskRunInput): Promise<TaskExecution> {
    const started = performance.now();
    const binary = await resolveClaudeBinary(this.binary);
    const command = [
      binary,
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--no-session-persistence",
      "--safe-mode",
      "--permission-mode",
      "bypassPermissions",
    ];
    if (this.model) command.push("--model", this.model);
    command.push("--disallowedTools", "WebFetch", "WebSearch");

    const subprocess = Bun.spawn(command, {
      cwd: input.workspacePath,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    subprocess.stdin.write(taskPrompt(input));
    subprocess.stdin.end();

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      subprocess.kill();
    }, this.timeoutMs);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);
      if (timedOut) throw new Error(`Claude task runner timed out after ${this.timeoutMs}ms`);
      const metadata = metadataFromClaudeJsonLines(stdout);
      if (exitCode !== 0 || metadata.failedMessage) {
        const diagnostic = metadata.failedMessage ?? claudeDiagnostic(stdout, stderr);
        throw new Error(`Claude task runner exited with ${exitCode}${diagnostic ? `:\n${diagnostic}` : ""}`);
      }
      if (metadata.finalOutput === undefined) {
        throw new Error("Claude task runner returned no result event");
      }
      return {
        finalOutput: metadata.finalOutput,
        durationMs: Math.round(performance.now() - started),
        inputTokens: metadata.inputTokens,
        outputTokens: metadata.outputTokens,
        commands: metadata.commands,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
