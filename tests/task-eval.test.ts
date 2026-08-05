import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
      { id: "absent", description: "No unsafe marker", type: "file-not-exists", path: "unsafe.txt", weight: 1 },
      { id: "clean", description: "No secret in notes", type: "file-not-contains", path: "notes.md", value: "password", caseSensitive: false, weight: 1 },
      { id: "final-clean", description: "No hand-wave", type: "final-not-contains", value: "probably", caseSensitive: false, weight: 1 },
      { id: "tested", description: "Tests ran", type: "command-ran", value: "bun test", caseSensitive: false, weight: 1 },
      { id: "safe", description: "No destructive command", type: "command-not-ran", value: "rm -rf", caseSensitive: false, weight: 1 },
      { id: "green", description: "Tests exited cleanly", type: "command-exit-code", value: "bun test", caseSensitive: false, expected: 0, weight: 1 },
    ], workspace, {
      finalOutput: "Verified the runtime",
      durationMs: 10,
      commands: [
        { command: "/bin/zsh -lc bun test", exitCode: 1 },
        { command: "/bin/zsh -lc bun test", exitCode: 0 },
      ],
    });

    expect(result.score).toBe(1);
    expect(result.earnedWeight).toBe(11);
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

  test("copies runtime resources without leaking evals and counterbalances repeated runs", async () => {
    const root = await temporaryDirectory("skillbench-package-");
    const fixture = path.join(root, "evals", "fixtures", "case");
    await mkdir(path.join(root, "scripts"), { recursive: true });
    await mkdir(fixture, { recursive: true });
    await writeFile(path.join(root, "scripts", "verify.ts"), "export const ready = true;\n", "utf8");
    await writeFile(path.join(root, "evals", "tasks.yaml"), "HIDDEN RUBRIC SENTINEL\n", "utf8");
    const orders: string[][] = [];
    let currentOrder: string[] = [];
    const runner: TaskRunner = {
      name: "fake",
      async execute(input) {
        currentOrder.push(input.variant);
        if (currentOrder.length === 2) {
          orders.push(currentOrder);
          currentOrder = [];
        }
        if (input.variant === "skill") {
          expect(input.skillPath).toBeDefined();
          await access(path.join(input.skillPath as string, "scripts", "verify.ts"));
          await expect(access(path.join(input.skillPath as string, "evals", "tasks.yaml"))).rejects.toThrow();
        }
        return { finalOutput: "done", durationMs: input.variant === "skill" ? 5 : 10, inputTokens: 20, outputTokens: 5 };
      },
    };
    const suite: TaskEvalSuite = {
      skillPath: root,
      skillName: "sample-skill",
      skillMarkdown: "# Sample skill",
      thresholds: { minSkillScore: 0, minDelta: 0 },
      cases: [{
        id: "case",
        prompt: "Do the work",
        fixturePath: fixture,
        rubric: [{ id: "done", description: "Done", type: "final-contains", value: "done", caseSensitive: false, weight: 1 }],
      }],
    };

    const report = await runTaskEvals(suite, runner, { runs: 4, order: "counterbalanced", seed: 7 });

    expect(report.results).toHaveLength(4);
    expect(orders[0] as string[]).not.toEqual(orders[1] as string[]);
    expect(orders[0] as string[]).toEqual(orders[2] as string[]);
    expect(report.metrics.runs).toBe(4);
    expect(report.metrics.durationDeltaPercent).toBe(-0.5);
    expect(report.metrics.tokenDeltaPercent).toBe(0);
    expect(report.verdict).toBe("efficient");
  });
});
