import { performance } from "node:perf_hooks";
import { scoreTriggerResults } from "./score.ts";
import type {
  TriggerCaseResult,
  TriggerEvalEvent,
  TriggerEvalReport,
  TriggerEvalSuite,
  TriggerRunner,
} from "./types.ts";

export interface RunTriggerEvalsOptions {
  concurrency?: number;
  limit?: number;
  onEvent?: (event: TriggerEvalEvent) => void;
}

export async function runTriggerEvals(
  suite: TriggerEvalSuite,
  runner: TriggerRunner,
  options: RunTriggerEvalsOptions = {},
): Promise<TriggerEvalReport> {
  const started = performance.now();
  const cases = suite.cases.slice(0, options.limit);
  const results = new Array<TriggerCaseResult | undefined>(cases.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 2, cases.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const evalCase = cases[index];
      if (!evalCase) return;
      options.onEvent?.({ type: "case-start", index, evalCase });
      const decision = await runner.decide({
        skillName: suite.skillName,
        description: suite.description,
        prompt: evalCase.prompt,
      });
      const result: TriggerCaseResult = {
        case: evalCase,
        decision,
        passed: decision.trigger === evalCase.shouldTrigger,
      };
      results[index] = result;
      options.onEvent?.({ type: "case-complete", index, result });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const completeResults = results.filter((entry): entry is TriggerCaseResult => Boolean(entry));
  const metrics = scoreTriggerResults(completeResults);

  return {
    version: 1,
    skill: suite.skillName,
    runner: runner.name,
    model: runner.model,
    passed: completeResults.length === cases.length && completeResults.every((entry) => entry.passed),
    durationMs: Math.round(performance.now() - started),
    metrics,
    results: completeResults,
  };
}
