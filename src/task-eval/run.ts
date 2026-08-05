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
  onEvent?: (event: TaskEvalEvent) => void;
}

async function prepareWorkspace(root: string, variant: TaskVariant, fixturePath?: string): Promise<string> {
  const target = path.join(root, variant);
  await mkdir(target, { recursive: true });
  if (fixturePath) await cp(fixturePath, target, { recursive: true, force: false });
  return target;
}

function metrics(results: TaskCaseResult[]): TaskEvalMetrics {
  const count = results.length || 1;
  return {
    averageBaselineScore: results.reduce((sum, entry) => sum + entry.baseline.score, 0) / count,
    averageSkillScore: results.reduce((sum, entry) => sum + entry.skill.score, 0) / count,
    averageDelta: results.reduce((sum, entry) => sum + entry.delta, 0) / count,
    improved: results.filter((entry) => entry.delta > 0).length,
    unchanged: results.filter((entry) => entry.delta === 0).length,
    regressed: results.filter((entry) => entry.delta < 0).length,
  };
}

export async function runTaskEvals(
  suite: TaskEvalSuite,
  runner: TaskRunner,
  options: RunTaskEvalsOptions = {},
): Promise<TaskEvalReport> {
  const started = performance.now();
  const cases = suite.cases.slice(0, options.limit);
  const results = new Array<TaskCaseResult | undefined>(cases.length);
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, cases.length));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      const evalCase = cases[index];
      if (!evalCase) return;
      options.onEvent?.({ type: "case-start", index, evalCase });
      const root = await mkdtemp(path.join(os.tmpdir(), `skillbench-task-${evalCase.id}-`));
      let baselineWorkspace = "";
      let skillWorkspace = "";
      try {
        baselineWorkspace = await prepareWorkspace(root, "baseline", evalCase.fixturePath);
        skillWorkspace = await prepareWorkspace(root, "skill", evalCase.fixturePath);

        const variantResults = {} as Record<TaskVariant, TaskVariantResult>;
        for (const variant of ["baseline", "skill"] as const) {
          options.onEvent?.({ type: "variant-start", index, caseId: evalCase.id, variant });
          const workspacePath = variant === "baseline" ? baselineWorkspace : skillWorkspace;
          const execution = await runner.execute({
            variant,
            prompt: evalCase.prompt,
            workspacePath,
            skillName: variant === "skill" ? suite.skillName : undefined,
            skillMarkdown: variant === "skill" ? suite.skillMarkdown : undefined,
          });
          const result = await scoreTaskVariant(variant, evalCase.rubric, workspacePath, execution);
          variantResults[variant] = result;
          options.onEvent?.({ type: "variant-complete", index, caseId: evalCase.id, result });
        }

        const delta = variantResults.skill.score - variantResults.baseline.score;
        const result: TaskCaseResult = {
          caseId: evalCase.id,
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
  return {
    version: 1,
    kind: "task-ab",
    skill: suite.skillName,
    runner: runner.name,
    model: runner.model,
    passed: completeResults.length === cases.length && completeResults.every((entry) => entry.passed),
    durationMs: Math.round(performance.now() - started),
    thresholds: suite.thresholds,
    metrics: metrics(completeResults),
    results: completeResults,
  };
}
