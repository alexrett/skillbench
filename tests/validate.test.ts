import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeSkillPackage } from "../src/generate.ts";
import { lintSkillDirectory } from "../src/lint.ts";
import { validateSkillDirectory } from "../src/validate.ts";
import { TEST_DRAFT } from "./generate.test.ts";

describe("validateSkillDirectory", () => {
  test("accepts a generated package", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-validate-"));
    const target = path.join(temp, TEST_DRAFT.name);
    try {
      await writeSkillPackage(TEST_DRAFT, target);
      const result = await validateSkillDirectory(target);
      expect(result.valid).toBe(true);
      expect(result.issues).toEqual([]);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("keeps portable validation separate from opinionated authoring lint", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-invalid-"));
    const target = path.join(temp, "sample-skill");
    try {
      await mkdir(target);
      await writeFile(path.join(target, "SKILL.md"), "---\nname: sample-skill\ndescription: Use when testing a sample.\n---\n\n# Sample\n", "utf8");
      const validation = await validateSkillDirectory(target);
      const lint = await lintSkillDirectory(target);

      expect(validation.valid).toBe(true);
      expect(validation.issues.map((entry) => entry.code)).not.toContain("missing-done");
      expect(lint.valid).toBe(false);
      expect(lint.issues.map((entry) => entry.code)).toContain("missing-done");
      expect(lint.issues.map((entry) => entry.code)).toContain("missing-process");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("portable validation still rejects structural incompatibility", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-invalid-"));
    const target = path.join(temp, "wrong-folder");
    try {
      await mkdir(target);
      await writeFile(path.join(target, "SKILL.md"), "---\nname: sample-skill\ndescription: Use when testing a sample.\n---\n\n# Sample\n", "utf8");
      const result = await validateSkillDirectory(target);
      expect(result.valid).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain("directory-name-mismatch");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  test("warns when a task prompt leaks a hidden rubric literal", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-leak-"));
    const target = path.join(temp, TEST_DRAFT.name);
    try {
      await writeSkillPackage(TEST_DRAFT, target);
      await writeFile(path.join(target, "evals", "tasks.yaml"), `version: 1
skill: verify-real-outcome
cases:
  - id: leaked
    prompt: Write the exact marker HIDDEN-RUBRIC-SENTINEL
    rubric:
      - id: marker
        description: Marker exists
        type: final-contains
        value: HIDDEN-RUBRIC-SENTINEL
`, "utf8");

      const result = await validateSkillDirectory(target);

      expect(result.valid).toBe(true);
      expect(result.issues.map((entry) => entry.code)).toContain("task-rubric-leak");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
