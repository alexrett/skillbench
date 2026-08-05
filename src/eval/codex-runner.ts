import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { TriggerDecision, TriggerDecisionInput, TriggerRunner } from "./types.ts";

const OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  properties: {
    trigger: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", minLength: 1, maxLength: 400 },
  },
  required: ["trigger", "confidence", "rationale"],
} as const;

export interface CodexTriggerRunnerOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
}

async function resolveCodexBinary(explicit?: string): Promise<string> {
  const candidate = explicit ?? Bun.which("codex");
  if (!candidate) {
    throw new Error("Codex CLI was not found. Install it or pass --codex-bin <path>.");
  }
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

function evaluatorPrompt(input: TriggerDecisionInput): string {
  return `You are evaluating skill discovery, not performing the user's task.

An agent has exactly this installed skill metadata:

Skill name: ${input.skillName}
Skill description: ${input.description}

The user sends this request:

<user_request>
${input.prompt}
</user_request>

Decide whether an agent should load this skill before answering the request. Judge only from the name, description, and request. Do not execute the task, call tools, inspect files, or assume additional skill contents. Return the required JSON object.`;
}

export class CodexTriggerRunner implements TriggerRunner {
  readonly name = "codex";
  readonly model?: string;
  private readonly binary?: string;
  private readonly timeoutMs: number;

  constructor(options: CodexTriggerRunnerOptions = {}) {
    this.binary = options.binary;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async decide(input: TriggerDecisionInput): Promise<TriggerDecision> {
    const started = performance.now();
    const binary = await resolveCodexBinary(this.binary);
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-codex-"));
    const schemaPath = path.join(temp, "decision.schema.json");
    const outputPath = path.join(temp, "decision.json");
    await writeFile(schemaPath, `${JSON.stringify(OUTPUT_SCHEMA, null, 2)}\n`, "utf8");

    const command = [
      binary,
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-C",
      temp,
    ];
    if (this.model) command.push("--model", this.model);
    command.push("-");

    const subprocess = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    subprocess.stdin.write(evaluatorPrompt(input));
    subprocess.stdin.end();

    const timeout = setTimeout(() => subprocess.kill(), this.timeoutMs);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text(),
      ]);
      if (exitCode !== 0) {
        const diagnostic = (stderr || stdout).trim().split("\n").slice(-4).join("\n");
        throw new Error(`Codex runner exited with ${exitCode}${diagnostic ? `:\n${diagnostic}` : ""}`);
      }
      const parsed = JSON.parse(await readFile(outputPath, "utf8")) as Partial<TriggerDecision>;
      if (typeof parsed.trigger !== "boolean" || typeof parsed.confidence !== "number" || typeof parsed.rationale !== "string") {
        throw new Error("Codex runner returned an invalid trigger decision");
      }
      return {
        trigger: parsed.trigger,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        durationMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timeout);
      await rm(temp, { recursive: true, force: true });
    }
  }
}
