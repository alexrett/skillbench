import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { claudeDiagnostic, resolveClaudeBinary } from "../claude.ts";
import type { TriggerDecision, TriggerDecisionInput, TriggerRunner } from "./types.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    trigger: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", minLength: 1, maxLength: 400 },
  },
  required: ["trigger", "confidence", "rationale"],
} as const;

interface ClaudeResultEnvelope {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
}

export interface ClaudeTriggerRunnerOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
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

function decisionFromEnvelope(envelope: ClaudeResultEnvelope): Partial<TriggerDecision> {
  if (envelope.structured_output && typeof envelope.structured_output === "object") {
    return envelope.structured_output as Partial<TriggerDecision>;
  }
  if (typeof envelope.result === "string") {
    try {
      return JSON.parse(envelope.result) as Partial<TriggerDecision>;
    } catch {
      return {};
    }
  }
  return {};
}

export class ClaudeTriggerRunner implements TriggerRunner {
  readonly name = "claude";
  readonly model?: string;
  private readonly binary?: string;
  private readonly timeoutMs: number;

  constructor(options: ClaudeTriggerRunnerOptions = {}) {
    this.binary = options.binary;
    this.model = options.model;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async decide(input: TriggerDecisionInput): Promise<TriggerDecision> {
    const started = performance.now();
    const binary = await resolveClaudeBinary(this.binary);
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-claude-trigger-"));
    const command = [
      binary,
      "--print",
      "--output-format",
      "json",
      "--json-schema",
      JSON.stringify(OUTPUT_SCHEMA),
      "--no-session-persistence",
      "--safe-mode",
      "--permission-mode",
      "dontAsk",
    ];
    if (this.model) command.push("--model", this.model);
    command.push("--tools", "");

    const subprocess = Bun.spawn(command, {
      cwd: temp,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    subprocess.stdin.write(evaluatorPrompt(input));
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
      if (timedOut) throw new Error(`Claude trigger runner timed out after ${this.timeoutMs}ms`);
      if (exitCode !== 0) {
        const diagnostic = claudeDiagnostic(stdout, stderr);
        throw new Error(`Claude trigger runner exited with ${exitCode}${diagnostic ? `:\n${diagnostic}` : ""}`);
      }

      let envelope: ClaudeResultEnvelope;
      try {
        envelope = JSON.parse(stdout) as ClaudeResultEnvelope;
      } catch {
        throw new Error("Claude trigger runner returned invalid JSON");
      }
      if (envelope.is_error) {
        throw new Error(`Claude trigger runner failed${envelope.result ? `:\n${envelope.result}` : ""}`);
      }
      const parsed = decisionFromEnvelope(envelope);
      if (
        typeof parsed.trigger !== "boolean"
        || typeof parsed.confidence !== "number"
        || parsed.confidence < 0
        || parsed.confidence > 1
        || typeof parsed.rationale !== "string"
        || parsed.rationale.length === 0
      ) {
        throw new Error("Claude trigger runner returned an invalid trigger decision");
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
