import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTaskEvals } from "../src/task-eval/run.ts";
import { scoreTaskVariant } from "../src/task-eval/score.ts";
import type { TaskEvalSuite, TaskRunInput, TaskRunner } from "../src/task-eval/types.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("task evals", () => {
  test("scores deterministic workspace and final-output rubrics", async () => {
    const workspace = await temporaryDirectory("skillbench-score-");
    await writeFile(path.join(workspace, "result.json"), JSON.stringify({ ready: true }), "utf8");
    await writeFile(path.join(workspace, "notes.md"), "Observed READY in the runtime", "utf8");

    const result = await scoreTaskVariant("skill", [
      { id: "exists", description: "Result exists", type: "file-exists", path: "result.json", weight: 1 },
      { id: "json", description: "Runtime is ready", type: "json-equals", path: "result.json", property: "ready", expected: true, weight: 2 },
      { id: "notes", description: "Evidence recorded", type: "file-contains", path: "notes.md", value: "ready", caseSensitive: false, weight: 1 },
      { id: "final", description: "Final is concrete", type: "final-contains", value: "verified", caseSensitive: false, weight: 1 },
    ], workspace, { finalOutput: "Verified the runtime", durationMs: 10 });

    expect(result.score).toBe(1);
    expect(result.earnedWeight).toBe(5);
    expect(result.rubric.every((entry) => entry.passed)).toBe(true);
  });

  test("keeps rubric and baseline output out of agent inputs", async () => {
    const root = await temporaryDirectory("skillbench-ab-");
    const fixture = path.join(root, "fixture");
    await mkdir(fixture);
    await writeFile(path.join(fixture, "input.txt"), "release candidate", "utf8");
    const inputs: TaskRunInput[] = [];
    const runner: TaskRunner = {
      name: "fake",
      async execute(input) {
        inputs.push({ ...input });
        if (input.variant === "skill") {
          await writeFile(path.join(input.workspacePath, "verification.json"), JSON.stringify({ verified: true }), "utf8");
        }
        return { finalOutput: input.variant, durationMs: 1 };
      },
    };
    const suite: TaskEvalSuite = {
      skillPath: root,
      skillName: "verify-real-outcome",
      skillMarkdown: "# Verify real outcome\nSecret workflow only.",
      thresholds: { minSkillScore: 1, minDelta: 1 },
      cases: [{
        id: "release",
        prompt: "Finish the release",
        fixturePath: fixture,
        rubric: [{ id: "proof", description: "HIDDEN RUBRIC SENTINEL", type: "file-exists", path: "verification.json", weight: 1 }],
      }],
    };

    const report = await runTaskEvals(suite, runner);

    expect(report.passed).toBe(true);
    expect(report.results[0]?.baseline.score).toBe(0);
    expect(report.results[0]?.skill.score).toBe(1);
    expect(inputs).toHaveLength(2);
    expect(inputs[0]?.skillMarkdown).toBeUndefined();
    expect(inputs[1]?.skillMarkdown).toContain("Secret workflow only");
    expect(JSON.stringify(inputs)).not.toContain("HIDDEN RUBRIC SENTINEL");
    expect(inputs[1]?.prompt).toBe("Finish the release");
  });
});
