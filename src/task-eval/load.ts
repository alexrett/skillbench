import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type {
  TaskEvalCase,
  TaskEvalSuite,
  TaskEvalThresholds,
  TaskRubric,
} from "./types.ts";

function parseFrontmatter(source: string): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  }
  return parsed as Record<string, unknown>;
}

function boundedRatio(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || value < -1 || value > 1) {
    throw new Error(`${label} must be a number between -1 and 1`);
  }
  return value;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function safeFixturePath(skillPath: string, raw: unknown, caseId: string): string | undefined {
  if (raw === undefined) return undefined;
  const fixture = nonEmptyString(raw, `Task case ${caseId} fixture`);
  const resolved = path.resolve(skillPath, "evals", fixture);
  const allowedRoot = `${path.resolve(skillPath)}${path.sep}`;
  if (!resolved.startsWith(allowedRoot)) {
    throw new Error(`Task case ${caseId} fixture must stay inside the skill directory`);
  }
  return resolved;
}

function parseRubric(raw: unknown, caseId: string, index: number): TaskRubric {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Task case ${caseId} rubric ${index + 1} must be a mapping`);
  }
  const value = raw as Record<string, unknown>;
  const id = nonEmptyString(value.id, `Task case ${caseId} rubric ${index + 1} id`);
  const description = nonEmptyString(value.description, `Task case ${caseId} rubric ${id} description`);
  const weight = value.weight === undefined ? 1 : Number(value.weight);
  if (!Number.isFinite(weight) || weight <= 0) throw new Error(`Task case ${caseId} rubric ${id} weight must be positive`);
  const type = nonEmptyString(value.type, `Task case ${caseId} rubric ${id} type`);

  if (type === "file-exists" || type === "file-not-exists") {
    return { id, description, weight, type, path: nonEmptyString(value.path, `Task case ${caseId} rubric ${id} path`) };
  }
  if (type === "file-contains" || type === "file-not-contains") {
    return {
      id,
      description,
      weight,
      type,
      path: nonEmptyString(value.path, `Task case ${caseId} rubric ${id} path`),
      value: nonEmptyString(value.value, `Task case ${caseId} rubric ${id} value`),
      caseSensitive: value.case_sensitive === true,
    };
  }
  if (type === "json-equals") {
    if (!("expected" in value)) throw new Error(`Task case ${caseId} rubric ${id} needs expected`);
    return {
      id,
      description,
      weight,
      type,
      path: nonEmptyString(value.path, `Task case ${caseId} rubric ${id} path`),
      property: value.property === undefined ? undefined : nonEmptyString(value.property, `Task case ${caseId} rubric ${id} property`),
      expected: value.expected,
    };
  }
  if (type === "final-contains" || type === "final-not-contains") {
    return {
      id,
      description,
      weight,
      type,
      value: nonEmptyString(value.value, `Task case ${caseId} rubric ${id} value`),
      caseSensitive: value.case_sensitive === true,
    };
  }
  if (type === "command-ran" || type === "command-not-ran") {
    return {
      id,
      description,
      weight,
      type,
      value: nonEmptyString(value.value, `Task case ${caseId} rubric ${id} value`),
      caseSensitive: value.case_sensitive === true,
    };
  }
  if (type === "command-exit-code") {
    const expected = Number(value.expected);
    if (!Number.isInteger(expected)) throw new Error(`Task case ${caseId} rubric ${id} expected must be an integer exit code`);
    return {
      id,
      description,
      weight,
      type,
      value: nonEmptyString(value.value, `Task case ${caseId} rubric ${id} value`),
      caseSensitive: value.case_sensitive === true,
      expected,
    };
  }
  throw new Error(`Task case ${caseId} rubric ${id} has unsupported type ${type}`);
}

function parseCase(raw: unknown, index: number, skillPath: string): TaskEvalCase {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Task case ${index + 1} must be a mapping`);
  }
  const value = raw as Record<string, unknown>;
  const id = nonEmptyString(value.id, `Task case ${index + 1} id`);
  const rubricValues = Array.isArray(value.rubric) ? value.rubric : [];
  if (rubricValues.length === 0) throw new Error(`Task case ${id} needs at least one rubric check`);
  return {
    id,
    prompt: nonEmptyString(value.prompt, `Task case ${id} prompt`),
    fixturePath: safeFixturePath(skillPath, value.fixture, id),
    rubric: rubricValues.map((entry, rubricIndex) => parseRubric(entry, id, rubricIndex)),
  };
}

export async function loadTaskEvalSuite(inputPath: string): Promise<TaskEvalSuite> {
  const skillPath = path.resolve(inputPath);
  const skillMarkdown = await readFile(path.join(skillPath, "SKILL.md"), "utf8");
  const frontmatter = parseFrontmatter(skillMarkdown);
  const skillName = nonEmptyString(frontmatter.name, "SKILL.md name");
  const source = await readFile(path.join(skillPath, "evals", "tasks.yaml"), "utf8");
  const parsed = YAML.parse(source);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("evals/tasks.yaml must be a YAML mapping");
  }
  if (parsed.skill !== skillName) {
    throw new Error(`evals/tasks.yaml targets ${String(parsed.skill)}, expected ${skillName}`);
  }
  if (!Array.isArray(parsed.cases) || parsed.cases.length === 0) {
    throw new Error("evals/tasks.yaml needs at least one case");
  }
  const thresholds: TaskEvalThresholds = {
    minSkillScore: boundedRatio(parsed.thresholds?.min_skill_score, 1, "thresholds.min_skill_score"),
    minDelta: boundedRatio(parsed.thresholds?.min_delta, 0, "thresholds.min_delta"),
  };
  if (thresholds.minSkillScore < 0) throw new Error("thresholds.min_skill_score cannot be negative");

  return {
    skillPath,
    skillName,
    skillMarkdown,
    thresholds,
    cases: parsed.cases.map((entry: unknown, index: number) => parseCase(entry, index, skillPath)),
  };
}
