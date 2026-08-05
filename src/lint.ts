import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseSkillMarkdown,
  validateSkillDirectory,
  type ValidationIssue,
  type ValidationResult,
} from "./validate.ts";

function issue(severity: "error" | "warning", code: string, message: string): ValidationIssue {
  return { severity, code, message };
}

export async function lintSkillDirectory(inputPath: string): Promise<ValidationResult> {
  const root = path.resolve(inputPath);
  const validation = await validateSkillDirectory(root);
  const issues = [...validation.issues];
  let name = validation.name;

  try {
    const parsed = parseSkillMarkdown(await readFile(path.join(root, "SKILL.md"), "utf8"));
    name = typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : name;
    if (!/^## Process\s*$/m.test(parsed.body)) {
      issues.push(issue("error", "missing-process", "Add a ## Process section"));
    }
    if (!/^## Done\s*$/m.test(parsed.body)) {
      issues.push(issue("error", "missing-done", "Add a checkable ## Done section"));
    }
    if (parsed.body.split(/\r?\n/).length > 500) {
      issues.push(issue("warning", "long-skill", "Keep SKILL.md under 500 lines and disclose references progressively"));
    }
  } catch {
    // Portable validation already reports malformed or missing SKILL.md files.
  }

  return {
    valid: !issues.some((entry) => entry.severity === "error"),
    path: root,
    name,
    issues,
  };
}
