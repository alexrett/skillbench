import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeSkillPackage } from "../src/generate.ts";
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

  test("rejects a missing done section and directory mismatch", async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), "skillbench-invalid-"));
    const target = path.join(temp, "wrong-folder");
    try {
      await mkdir(target);
      await writeFile(path.join(target, "SKILL.md"), "---\nname: sample-skill\ndescription: Use when testing a sample.\n---\n\n# Sample\n", "utf8");
      const result = await validateSkillDirectory(target);
      expect(result.valid).toBe(false);
      expect(result.issues.map((entry) => entry.code)).toContain("directory-name-mismatch");
      expect(result.issues.map((entry) => entry.code)).toContain("missing-done");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
