export type TaskVariant = "baseline" | "skill";

interface TaskRubricBase {
  id: string;
  description: string;
  weight: number;
}

export interface FileExistsRubric extends TaskRubricBase {
  type: "file-exists";
  path: string;
}

export interface FileNotExistsRubric extends TaskRubricBase {
  type: "file-not-exists";
  path: string;
}

export interface FileContainsRubric extends TaskRubricBase {
  type: "file-contains";
  path: string;
  value: string;
  caseSensitive: boolean;
}

export interface FileNotContainsRubric extends TaskRubricBase {
  type: "file-not-contains";
  path: string;
  value: string;
  caseSensitive: boolean;
}

export interface JsonEqualsRubric extends TaskRubricBase {
  type: "json-equals";
  path: string;
  property?: string;
  expected: unknown;
}

export interface FinalContainsRubric extends TaskRubricBase {
  type: "final-contains";
  value: string;
  caseSensitive: boolean;
}

export interface FinalNotContainsRubric extends TaskRubricBase {
  type: "final-not-contains";
  value: string;
  caseSensitive: boolean;
}

export interface CommandContainsRubric extends TaskRubricBase {
  type: "command-ran" | "command-not-ran";
  value: string;
  caseSensitive: boolean;
}

export interface CommandExitCodeRubric extends TaskRubricBase {
  type: "command-exit-code";
  value: string;
  caseSensitive: boolean;
  expected: number;
}

export type TaskRubric =
  | FileExistsRubric
  | FileNotExistsRubric
  | FileContainsRubric
  | FileNotContainsRubric
  | JsonEqualsRubric
  | FinalContainsRubric
  | FinalNotContainsRubric
  | CommandContainsRubric
  | CommandExitCodeRubric;

export interface TaskEvalCase {
  id: string;
  prompt: string;
  fixturePath?: string;
  rubric: TaskRubric[];
}

export interface TaskEvalThresholds {
  minSkillScore: number;
  minDelta: number;
}

export interface TaskEvalSuite {
  skillPath: string;
  skillName: string;
  skillMarkdown: string;
  cases: TaskEvalCase[];
  thresholds: TaskEvalThresholds;
}

export interface TaskRunInput {
  variant: TaskVariant;
  prompt: string;
  workspacePath: string;
  skillName?: string;
  skillMarkdown?: string;
  skillPath?: string;
}

export interface TaskExecution {
  finalOutput: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  commands?: Array<{ command: string; exitCode?: number }>;
}

export interface TaskRunner {
  readonly name: string;
  readonly model?: string;
  execute(input: TaskRunInput): Promise<TaskExecution>;
}

export interface TaskRubricResult {
  id: string;
  description: string;
  type: TaskRubric["type"];
  passed: boolean;
  weight: number;
  diagnostic: string;
}

export interface TaskVariantResult {
  variant: TaskVariant;
  execution: TaskExecution;
  score: number;
  earnedWeight: number;
  totalWeight: number;
  rubric: TaskRubricResult[];
}

export interface TaskCaseResult {
  caseId: string;
  run: number;
  order: TaskVariant[];
  prompt: string;
  baseline: TaskVariantResult;
  skill: TaskVariantResult;
  delta: number;
  passed: boolean;
  keptWorkspaces?: {
    baseline: string;
    skill: string;
  };
}

export interface TaskEvalMetrics {
  runs: number;
  averageBaselineScore: number;
  averageSkillScore: number;
  averageDelta: number;
  deltaStdDev: number;
  averageBaselineDurationMs: number;
  averageSkillDurationMs: number;
  durationDeltaPercent?: number;
  averageBaselineTokens?: number;
  averageSkillTokens?: number;
  tokenDeltaPercent?: number;
  improved: number;
  unchanged: number;
  regressed: number;
}

export type TaskEvalVerdict = "proven" | "efficient" | "redundant" | "harmful" | "inconclusive";

export interface TaskEvalReport {
  version: 1;
  kind: "task-ab";
  skill: string;
  runner: string;
  model?: string;
  passed: boolean;
  verdict: TaskEvalVerdict;
  durationMs: number;
  thresholds: TaskEvalThresholds;
  metrics: TaskEvalMetrics;
  results: TaskCaseResult[];
}

export type TaskEvalEvent =
  | { type: "case-start"; index: number; evalCase: TaskEvalCase }
  | { type: "variant-start"; index: number; caseId: string; variant: TaskVariant }
  | { type: "variant-complete"; index: number; caseId: string; result: TaskVariantResult }
  | { type: "case-complete"; index: number; result: TaskCaseResult };
