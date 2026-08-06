import { ClaudeTriggerRunner } from "./eval/claude-runner.ts";
import { CodexTriggerRunner } from "./eval/codex-runner.ts";
import type { TriggerRunner } from "./eval/types.ts";
import { ClaudeTaskRunner } from "./task-eval/claude-runner.ts";
import { CodexTaskRunner } from "./task-eval/codex-runner.ts";
import type { TaskRunner } from "./task-eval/types.ts";

export type AgentRunnerName = "codex" | "claude";

export interface AgentRunnerOptions {
  binary?: string;
  model?: string;
  timeoutMs?: number;
}

export function parseAgentRunner(value?: string): AgentRunnerName {
  const runner = value ?? "codex";
  if (runner !== "codex" && runner !== "claude") {
    throw new Error("--runner must be codex or claude");
  }
  return runner;
}

export function createTriggerRunner(name: AgentRunnerName, options: AgentRunnerOptions = {}): TriggerRunner {
  return name === "claude" ? new ClaudeTriggerRunner(options) : new CodexTriggerRunner(options);
}

export function createTaskRunner(name: AgentRunnerName, options: AgentRunnerOptions = {}): TaskRunner {
  return name === "claude" ? new ClaudeTaskRunner(options) : new CodexTaskRunner(options);
}
