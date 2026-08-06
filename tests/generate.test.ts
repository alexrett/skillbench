import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { generatePackage, writeSkillPackage } from "../src/generate.ts";
import type { SkillDraft } from "../src/model.ts";

export const TEST_DRAFT: SkillDraft = {
  name: "verify-real-outcome",
  displayName: "Verify Real Outcome",
  description: "Verify the real user-facing outcome. Use when implementation needs runtime acceptance evidence.",
  sourceKind: "failure",
  scenario: "The agent stops after a successful build.",
  desiredOutcome: "Prove the user-visible workflow succeeds",
  verification: "Run the real flow and record the observable result",
  positiveTriggers: ["Verify the release", "Check the browser flow", "Prove the artifact works"],
  negativeTriggers: ["Explain releases", "Review this plan", "Define acceptance testing"],
  processSteps: ["Identify the acceptance path", "Run the path", "Record evidence"],
  doneCriteria: ["The real path succeeds", "Evidence is recorded"],
  outputPath: "",
};

describe("generatePackage", () => {
  test("creates a portable skill with optional Codex metadata and eval cases", () => {
    const generated = generatePackage(TEST_DRAFT);
    expect(generated.skillMarkdown).toContain("name: verify-real-outcome");
    expect(generated.skillMarkdown).toContain("## Done");
    expect(YAML.parse(generated.openaiYaml).interface.default_prompt).toContain("$verify-real-outcome");
    expect(YAML.parse(generated.evalsYaml).cases).toHaveLength(6);
  });

  test("writes the expected package layout", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-test-"));
    const target = path.join(temp, TEST_DRAFT.name);
    try {
      await writeSkillPackage(TEST_DRAFT, target);
      expect(await readFile(path.join(target, "SKILL.md"), "utf8")).toContain("# Verify Real Outcome");
      expect(await readFile(path.join(target, "agents", "openai.yaml"), "utf8")).toContain("interface:");
      expect(await readFile(path.join(target, "evals", "cases.yaml"), "utf8")).toContain("should_trigger");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
