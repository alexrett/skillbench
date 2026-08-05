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

export interface FileContainsRubric extends TaskRubricBase {
  type: "file-contains";
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

export type TaskRubric =
  | FileExistsRubric
  | FileContainsRubric
  | JsonEqualsRubric
  | FinalContainsRubric;

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
}

export interface TaskExecution {
  finalOutput: string;
  durationMs: number;
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
  averageBaselineScore: number;
  averageSkillScore: number;
  averageDelta: number;
  improved: number;
  unchanged: number;
  regressed: number;
}

export interface TaskEvalReport {
  version: 1;
  kind: "task-ab";
  skill: string;
  runner: string;
  model?: string;
  passed: boolean;
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
