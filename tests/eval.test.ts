import { describe, expect, test } from "bun:test";
import { loadTriggerEvalSuite } from "../src/eval/load.ts";
import { runTriggerEvals } from "../src/eval/run.ts";
import { scoreTriggerResults } from "../src/eval/score.ts";
import type { TriggerDecisionInput, TriggerRunner } from "../src/eval/types.ts";

class FixtureRunner implements TriggerRunner {
  readonly name = "fixture";
  readonly inputs: TriggerDecisionInput[] = [];

  async decide(input: TriggerDecisionInput) {
    this.inputs.push(input);
    return {
      trigger: input.prompt.startsWith("yes"),
      confidence: 0.9,
      rationale: "fixture decision",
      durationMs: 1,
    };
  }
}

describe("trigger evals", () => {
  test("scores the confusion matrix", () => {
    const metrics = scoreTriggerResults([
      { case: { id: "tp", prompt: "", shouldTrigger: true }, decision: { trigger: true, confidence: 1, rationale: "", durationMs: 1 }, passed: true },
      { case: { id: "fn", prompt: "", shouldTrigger: true }, decision: { trigger: false, confidence: 1, rationale: "", durationMs: 1 }, passed: false },
      { case: { id: "tn", prompt: "", shouldTrigger: false }, decision: { trigger: false, confidence: 1, rationale: "", durationMs: 1 }, passed: true },
      { case: { id: "fp", prompt: "", shouldTrigger: false }, decision: { trigger: true, confidence: 1, rationale: "", durationMs: 1 }, passed: false },
    ]);
    expect(metrics).toEqual({
      truePositive: 1,
      falsePositive: 1,
      trueNegative: 1,
      falseNegative: 1,
      precision: 0.5,
      recall: 0.5,
      specificity: 0.5,
      accuracy: 0.5,
    });
  });

  test("keeps expected labels out of runner inputs", async () => {
    const runner = new FixtureRunner();
    const report = await runTriggerEvals({
      skillPath: "/tmp/example",
      skillName: "example",
      description: "Example skill. Use when a prompt begins with yes.",
      cases: [
        { id: "one", prompt: "yes please", shouldTrigger: true },
        { id: "two", prompt: "no thanks", shouldTrigger: false },
      ],
    }, runner, { concurrency: 2 });

    expect(report.passed).toBe(true);
    expect(report.metrics.accuracy).toBe(1);
    expect(runner.inputs).toEqual([
      { skillName: "example", description: "Example skill. Use when a prompt begins with yes.", prompt: "yes please" },
      { skillName: "example", description: "Example skill. Use when a prompt begins with yes.", prompt: "no thanks" },
    ]);
    expect("shouldTrigger" in runner.inputs[0]!).toBe(false);
  });

  test("loads the generated dogfood suite", async () => {
    const suite = await loadTriggerEvalSuite("examples/generated/verify-real-outcome");
    expect(suite.skillName).toBe("verify-real-outcome");
    expect(suite.cases).toHaveLength(6);
  });
});
