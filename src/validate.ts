import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { loadTaskEvalSuite } from "./task-eval/load.ts";

export type Severity = "error" | "warning";

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  path: string;
  name?: string;
  issues: ValidationIssue[];
}

function issue(severity: Severity, code: string, message: string): ValidationIssue {
  return { severity, code, message };
}

export function parseSkillMarkdown(source: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  }
  return { frontmatter: parsed as Record<string, unknown>, body: match[2] ?? "" };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateLinkedFiles(
  root: string,
  body: string,
  issues: ValidationIssue[],
): Promise<void> {
  const links = [...body.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1] ?? "");
  for (const link of links) {
    if (!link || /^(https?:|mailto:|#)/.test(link)) continue;
    const clean = link.split("#")[0];
    if (!clean) continue;
    if (!(await fileExists(path.resolve(root, clean)))) {
      issues.push(issue("error", "missing-reference", `Referenced file does not exist: ${link}`));
    }
  }
}

async function validateOpenaiYaml(
  root: string,
  name: string,
  issues: ValidationIssue[],
): Promise<void> {
  const filePath = path.join(root, "agents", "openai.yaml");
  if (!(await fileExists(filePath))) return;

  try {
    const value = YAML.parse(await readFile(filePath, "utf8"));
    const ui = value?.interface;
    if (!ui?.display_name) issues.push(issue("error", "missing-display-name", "interface.display_name is required"));
    if (typeof ui?.short_description !== "string" || ui.short_description.length < 25 || ui.short_description.length > 64) {
      issues.push(issue("error", "invalid-short-description", "interface.short_description must be 25-64 characters"));
    }
    if (typeof ui?.default_prompt !== "string" || !ui.default_prompt.includes(`$${name}`)) {
      issues.push(issue("error", "invalid-default-prompt", `interface.default_prompt must mention $${name}`));
    }
  } catch (error) {
    issues.push(issue("error", "invalid-openai-yaml", `Cannot parse agents/openai.yaml: ${(error as Error).message}`));
  }
}

async function validateEvals(root: string, name: string, issues: ValidationIssue[]): Promise<void> {
  const filePath = path.join(root, "evals", "cases.yaml");
  if (!(await fileExists(filePath))) {
    issues.push(issue("warning", "missing-evals", "evals/cases.yaml is missing; behavioral regression testing is not ready"));
    return;
  }

  try {
    const value = YAML.parse(await readFile(filePath, "utf8"));
    const cases = Array.isArray(value?.cases) ? value.cases : [];
    const positives = cases.filter((entry: { should_trigger?: boolean }) => entry?.should_trigger === true);
    const negatives = cases.filter((entry: { should_trigger?: boolean }) => entry?.should_trigger === false);
    if (value?.skill !== name) issues.push(issue("error", "eval-skill-mismatch", `evals skill must equal ${name}`));
    if (positives.length < 3) issues.push(issue("warning", "few-positive-cases", "Add at least 3 positive trigger cases"));
    if (negatives.length < 3) issues.push(issue("warning", "few-negative-cases", "Add at least 3 near-miss cases"));
    if (!value?.rubric?.outcome || !value?.rubric?.verification) {
      issues.push(issue("error", "incomplete-rubric", "Evals rubric needs outcome and verification"));
    }
  } catch (error) {
    issues.push(issue("error", "invalid-evals-yaml", `Cannot parse evals/cases.yaml: ${(error as Error).message}`));
  }
}

async function validateTaskEvals(root: string, issues: ValidationIssue[]): Promise<void> {
  const filePath = path.join(root, "evals", "tasks.yaml");
  if (!(await fileExists(filePath))) return;
  try {
    const suite = await loadTaskEvalSuite(root);
    const caseIds = new Set<string>();
    for (const evalCase of suite.cases) {
      if (caseIds.has(evalCase.id)) issues.push(issue("error", "duplicate-task-case", `Duplicate task eval case id: ${evalCase.id}`));
      caseIds.add(evalCase.id);
      const rubricIds = new Set<string>();
      for (const rubric of evalCase.rubric) {
        if (rubricIds.has(rubric.id)) issues.push(issue("error", "duplicate-task-rubric", `Task case ${evalCase.id} repeats rubric id ${rubric.id}`));
        rubricIds.add(rubric.id);
        if ("value" in rubric && typeof rubric.value === "string" && rubric.value.length >= 8
          && evalCase.prompt.toLocaleLowerCase().includes(rubric.value.toLocaleLowerCase())) {
          issues.push(issue(
            "warning",
            "task-rubric-leak",
            `Task case ${evalCase.id} prompt contains the hidden literal used by rubric ${rubric.id}`,
          ));
        }
      }
      if (evalCase.fixturePath && !(await fileExists(evalCase.fixturePath))) {
        issues.push(issue("error", "missing-task-fixture", `Task case ${evalCase.id} fixture does not exist`));
      }
    }
  } catch (error) {
    issues.push(issue("error", "invalid-task-evals", `Cannot load evals/tasks.yaml: ${(error as Error).message}`));
  }
}

export async function validateSkillDirectory(
  inputPath: string,
  options: { enforceDirectoryName?: boolean } = {},
): Promise<ValidationResult> {
  const root = path.resolve(inputPath);
  const issues: ValidationIssue[] = [];
  const skillPath = path.join(root, "SKILL.md");

  if (!(await fileExists(skillPath))) {
    return {
      valid: false,
      path: root,
      issues: [issue("error", "missing-skill", "SKILL.md is missing")],
    };
  }

  let name = "";
  let body = "";
  try {
    const parsed = parseSkillMarkdown(await readFile(skillPath, "utf8"));
    body = parsed.body;
    name = typeof parsed.frontmatter.name === "string" ? parsed.frontmatter.name : "";
    const description = typeof parsed.frontmatter.description === "string" ? parsed.frontmatter.description : "";

    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      issues.push(issue("error", "invalid-name", "name must be 1-64 lowercase letters, digits, and single hyphens"));
    }
    if (name && options.enforceDirectoryName !== false && path.basename(root) !== name) {
      issues.push(issue("error", "directory-name-mismatch", `Directory must be named ${name}`));
    }
    if (!description || description.length > 1024) {
      issues.push(issue("error", "invalid-description", "description must be 1-1024 characters"));
    } else if (!/\buse(?:d)?\s+when\b|использ/i.test(description)) {
      issues.push(issue("warning", "weak-trigger-description", "description should say what the skill does and when to use it"));
    }
    await validateLinkedFiles(root, body, issues);
    if (name) {
      await validateOpenaiYaml(root, name, issues);
      await validateEvals(root, name, issues);
      await validateTaskEvals(root, issues);
    }
  } catch (error) {
    issues.push(issue("error", "invalid-skill", (error as Error).message));
  }

  return {
    valid: !issues.some((entry) => entry.severity === "error"),
    path: root,
    name: name || undefined,
    issues,
  };
}
