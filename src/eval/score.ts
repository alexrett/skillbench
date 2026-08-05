import type { TriggerCaseResult, TriggerMetrics } from "./types.ts";

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 1 : numerator / denominator;
}

export function scoreTriggerResults(results: TriggerCaseResult[]): TriggerMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const result of results) {
    if (result.case.shouldTrigger && result.decision.trigger) truePositive += 1;
    if (!result.case.shouldTrigger && result.decision.trigger) falsePositive += 1;
    if (!result.case.shouldTrigger && !result.decision.trigger) trueNegative += 1;
    if (result.case.shouldTrigger && !result.decision.trigger) falseNegative += 1;
  }

  return {
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: ratio(truePositive, truePositive + falsePositive),
    recall: ratio(truePositive, truePositive + falseNegative),
    specificity: ratio(trueNegative, trueNegative + falsePositive),
    accuracy: ratio(truePositive + trueNegative, results.length),
  };
}
