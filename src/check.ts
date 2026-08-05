import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { lintSkillDirectory } from "./lint.ts";
import { auditSkillDirectory } from "./security/audit.ts";
import type { SecuritySeverity, SkillSecurityReport } from "./security/types.ts";
import { validateSkillDirectory, type ValidationResult } from "./validate.ts";

const CONVENTIONAL_SKILL_ROOTS = [".agents/skills", ".claude/skills", ".codex/skills"];
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "release"]);

export interface CheckedSkill {
  path: string;
  validation: ValidationResult;
  lint?: ValidationResult;
  security: SkillSecurityReport;
  passed: boolean;
}

export interface CheckSkillsOptions {
  cwd?: string;
  strict?: boolean;
  failOn?: SecuritySeverity;
}

export interface CheckSkillsReport {
  version: 1;
  passed: boolean;
  root: string;
  skills: CheckedSkill[];
  summary: {
    skills: number;
    validationErrors: number;
    lintErrors: number;
    securityFindings: number;
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function discoverWithin(directory: string, output: Set<string>): Promise<void> {
  if (await exists(path.join(directory, "SKILL.md"))) {
    output.add(path.resolve(directory));
    return;
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || SKIPPED_DIRECTORIES.has(entry.name)) continue;
    await discoverWithin(path.join(directory, entry.name), output);
  }
}

export async function discoverSkillDirectories(inputs: string[], cwd = process.cwd()): Promise<string[]> {
  const roots: string[] = [];
  if (inputs.length > 0) {
    roots.push(...inputs.map((input) => path.resolve(cwd, input)));
  } else {
    for (const conventional of CONVENTIONAL_SKILL_ROOTS) {
      const candidate = path.resolve(cwd, conventional);
      if (await exists(candidate)) roots.push(candidate);
    }
    if (roots.length === 0 && await exists(path.resolve(cwd, "SKILL.md"))) roots.push(path.resolve(cwd));
  }

  const output = new Set<string>();
  for (const root of roots) {
    if (!(await exists(root))) throw new Error(`Skill check path does not exist: ${root}`);
    const details = await stat(root);
    if (details.isFile()) {
      if (path.basename(root) !== "SKILL.md") throw new Error(`Expected a skill directory or SKILL.md: ${root}`);
      output.add(path.dirname(root));
    } else {
      await discoverWithin(root, output);
    }
  }
  return [...output].sort();
}

export async function checkSkills(inputs: string[], options: CheckSkillsOptions = {}): Promise<CheckSkillsReport> {
  const root = path.resolve(options.cwd ?? process.cwd());
  const directories = await discoverSkillDirectories(inputs, root);
  const skills: CheckedSkill[] = [];

  for (const skillPath of directories) {
    const validation = await validateSkillDirectory(skillPath);
    const lint = options.strict ? await lintSkillDirectory(skillPath) : undefined;
    const security = await auditSkillDirectory(skillPath, { failOn: options.failOn });
    skills.push({
      path: skillPath,
      validation,
      lint,
      security,
      passed: validation.valid && security.passed && (lint?.valid ?? true),
    });
  }

  return {
    version: 1,
    passed: skills.length > 0 && skills.every((skill) => skill.passed),
    root,
    skills,
    summary: {
      skills: skills.length,
      validationErrors: skills.reduce((sum, skill) => sum + skill.validation.issues.filter((issue) => issue.severity === "error").length, 0),
      lintErrors: skills.reduce((sum, skill) => sum + (skill.lint?.issues.filter((issue) => issue.severity === "error").length ?? 0), 0),
      securityFindings: skills.reduce((sum, skill) => sum + skill.security.findings.length, 0),
    },
  };
}
