import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { scoreTaskVariant } from "./score.ts";
import type {
  TaskCaseResult,
  TaskEvalEvent,
  TaskEvalMetrics,
  TaskEvalReport,
  TaskEvalSuite,
  TaskRunner,
  TaskVariant,
  TaskVariantResult,
} from "./types.ts";

export interface RunTaskEvalsOptions {
  concurrency?: number;
  limit?: number;
  keepWorkspaces?: boolean;
  runs?: number;
  order?: "fixed" | "counterbalanced";
  seed?: number;
  onEvent?: (event: TaskEvalEvent) => void;
}

async function prepareWorkspace(root: string, variant: TaskVariant, fixturePath?: string): Promise<string> {
  const target = path.join(root, variant);
  await mkdir(target, { recursive: true });
  if (fixturePath) await cp(fixturePath, target, { recursive: true, force: false });
  return target;
}

async function installRuntimeSkill(skillPath: string, skillName: string, workspacePath: string): Promise<string> {
  const target = path.join(workspacePath, ".skillbench", "skills", skillName);
  const evalsRoot = path.join(path.resolve(skillPath), "evals");
  await mkdir(path.dirname(target), { recursive: true });
  await cp(skillPath, target, {
    recursive: true,
    force: false,
    filter(source) {
      const resolved = path.resolve(source);
      if (resolved === evalsRoot || resolved.startsWith(`${evalsRoot}${path.sep}`)) return false;
      const relative = path.relative(path.resolve(skillPath), resolved);
      const topLevel = relative.split(path.sep)[0];
      return topLevel !== ".git" && topLevel !== "node_modules";
    },
  });
  return target;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function relativeDelta(baseline: number, skill: number): number | undefined {
  return baseline === 0 ? undefined : (skill - baseline) / baseline;
}

function totalTokens(result: TaskVariantResult): number | undefined {
  const { inputTokens, outputTokens } = result.execution;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return (inputTokens ?? 0) + (outputTokens ?? 0);
}

function metrics(results: TaskCaseResult[]): TaskEvalMetrics {
  const count = results.length || 1;
  const baselineDurations = results.map((entry) => entry.baseline.execution.durationMs);
  const skillDurations = results.map((entry) => entry.skill.execution.durationMs);
  const baselineTokens = results.map((entry) => totalTokens(entry.baseline)).filter((value): value is number => value !== undefined);
  const skillTokens = results.map((entry) => totalTokens(entry.skill)).filter((value): value is number => value !== undefined);
  const averageBaselineDurationMs = average(baselineDurations);
  const averageSkillDurationMs = average(skillDurations);
  const averageBaselineTokens = baselineTokens.length === results.length ? average(baselineTokens) : undefined;
  const averageSkillTokens = skillTokens.length === results.length ? average(skillTokens) : undefined;
  return {
    runs: count,
    averageBaselineScore: results.reduce((sum, entry) => sum + entry.baseline.score, 0) / count,
    averageSkillScore: results.reduce((sum, entry) => sum + entry.skill.score, 0) / count,
    averageDelta: results.reduce((sum, entry) => sum + entry.delta, 0) / count,
    deltaStdDev: standardDeviation(results.map((entry) => entry.delta)),
    averageBaselineDurationMs,
    averageSkillDurationMs,
    durationDeltaPercent: relativeDelta(averageBaselineDurationMs, averageSkillDurationMs),
    averageBaselineTokens,
    averageSkillTokens,
    tokenDeltaPercent: averageBaselineTokens === undefined || averageSkillTokens === undefined
      ? undefined
      : relativeDelta(averageBaselineTokens, averageSkillTokens),
    improved: results.filter((entry) => entry.delta > 0).length,
    unchanged: results.filter((entry) => entry.delta === 0).length,
    regressed: results.filter((entry) => entry.delta < 0).length,
  };
}

function verdict(taskMetrics: TaskEvalMetrics, thresholds: TaskEvalSuite["thresholds"]): TaskEvalReport["verdict"] {
  const epsilon = 0.000_001;
  if (taskMetrics.averageDelta < -epsilon) return "harmful";
  if (taskMetrics.averageSkillScore >= thresholds.minSkillScore && taskMetrics.averageDelta > epsilon) return "proven";
  const efficientByDuration = taskMetrics.durationDeltaPercent !== undefined && taskMetrics.durationDeltaPercent <= -0.15;
  const efficientByTokens = taskMetrics.tokenDeltaPercent !== undefined && taskMetrics.tokenDeltaPercent <= -0.1;
  if (taskMetrics.averageSkillScore + epsilon >= taskMetrics.averageBaselineScore && (efficientByDuration || efficientByTokens)) {
    return "efficient";
  }
  if (Math.abs(taskMetrics.averageDelta) <= epsilon && taskMetrics.runs >= 2) return "redundant";
  return "inconclusive";
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

function variantOrder(caseId: string, run: number, options: RunTaskEvalsOptions): TaskVariant[] {
  if (options.order !== "counterbalanced") return ["baseline", "skill"];
  const skillFirstOnEvenRun = (hash(`${options.seed ?? 1}:${caseId}`) & 1) === 1;
  const skillFirst = run % 2 === 0 ? skillFirstOnEvenRun : !skillFirstOnEvenRun;
  return skillFirst ? ["skill", "baseline"] : ["baseline", "skill"];
}

export async function runTaskEvals(
  suite: TaskEvalSuite,
  runner: TaskRunner,
  options: RunTaskEvalsOptions = {},
): Promise<TaskEvalReport> {
  const started = performance.now();
  const cases = suite.cases.slice(0, options.limit);
  const runs = Math.max(1, Math.floor(options.runs ?? 1));
  const work = cases.flatMap((evalCase) => Array.from({ length: runs }, (_, run) => ({ evalCase, run })));
  const results = new Array<TaskCaseResult | undefined>(work.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, work.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const item = work[index];
      if (!item) return;
      const { evalCase, run } = item;
      options.onEvent?.({ type: "case-start", index, evalCase });
      const root = await mkdtemp(path.join(os.tmpdir(), `skillbench-task-${evalCase.id}-${run + 1}-`));
      let baselineWorkspace = "";
      let skillWorkspace = "";
      try {
        baselineWorkspace = await prepareWorkspace(root, "baseline", evalCase.fixturePath);
        skillWorkspace = await prepareWorkspace(root, "skill", evalCase.fixturePath);
        const installedSkillPath = await installRuntimeSkill(suite.skillPath, suite.skillName, skillWorkspace);

        const variantResults = {} as Record<TaskVariant, TaskVariantResult>;
        const order = variantOrder(evalCase.id, run, options);
        for (const variant of order) {
          options.onEvent?.({ type: "variant-start", index, caseId: evalCase.id, variant });
          const workspacePath = variant === "baseline" ? baselineWorkspace : skillWorkspace;
          const execution = await runner.execute({
            variant,
            prompt: evalCase.prompt,
            workspacePath,
            skillName: variant === "skill" ? suite.skillName : undefined,
            skillMarkdown: variant === "skill" ? suite.skillMarkdown : undefined,
            skillPath: variant === "skill" ? installedSkillPath : undefined,
          });
          const result = await scoreTaskVariant(variant, evalCase.rubric, workspacePath, execution);
          variantResults[variant] = result;
          options.onEvent?.({ type: "variant-complete", index, caseId: evalCase.id, result });
        }

        const delta = variantResults.skill.score - variantResults.baseline.score;
        const result: TaskCaseResult = {
          caseId: evalCase.id,
          run: run + 1,
          order,
          prompt: evalCase.prompt,
          baseline: variantResults.baseline,
          skill: variantResults.skill,
          delta,
          passed: variantResults.skill.score >= suite.thresholds.minSkillScore && delta >= suite.thresholds.minDelta,
          keptWorkspaces: options.keepWorkspaces ? { baseline: baselineWorkspace, skill: skillWorkspace } : undefined,
        };
        results[index] = result;
        options.onEvent?.({ type: "case-complete", index, result });
      } finally {
        if (!options.keepWorkspaces) await rm(root, { recursive: true, force: true });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const completeResults = results.filter((entry): entry is TaskCaseResult => Boolean(entry));
  const taskMetrics = metrics(completeResults);
  return {
    version: 1,
    kind: "task-ab",
    skill: suite.skillName,
    runner: runner.name,
    model: runner.model,
    passed: completeResults.length === work.length && completeResults.every((entry) => entry.passed),
    verdict: verdict(taskMetrics, suite.thresholds),
    durationMs: Math.round(performance.now() - started),
    thresholds: suite.thresholds,
    metrics: taskMetrics,
    results: completeResults,
  };
}
