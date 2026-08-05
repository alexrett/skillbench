export interface TriggerEvalCase {
  id: string;
  prompt: string;
  shouldTrigger: boolean;
}

export interface TriggerEvalSuite {
  skillPath: string;
  skillName: string;
  description: string;
  cases: TriggerEvalCase[];
}

export interface TriggerDecisionInput {
  skillName: string;
  description: string;
  prompt: string;
}

export interface TriggerDecision {
  trigger: boolean;
  confidence: number;
  rationale: string;
  durationMs: number;
}

export interface TriggerCaseResult {
  case: TriggerEvalCase;
  decision: TriggerDecision;
  passed: boolean;
}

export interface TriggerMetrics {
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  specificity: number;
  accuracy: number;
}

export interface TriggerEvalReport {
  version: 1;
  skill: string;
  runner: string;
  model?: string;
  passed: boolean;
  durationMs: number;
  metrics: TriggerMetrics;
  results: TriggerCaseResult[];
}

export interface TriggerRunner {
  readonly name: string;
  readonly model?: string;
  decide(input: TriggerDecisionInput): Promise<TriggerDecision>;
}

export type TriggerEvalEvent =
  | { type: "case-start"; index: number; evalCase: TriggerEvalCase }
  | { type: "case-complete"; index: number; result: TriggerCaseResult };
