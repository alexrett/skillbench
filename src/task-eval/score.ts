import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  TaskExecution,
  TaskRubric,
  TaskRubricResult,
  TaskVariant,
  TaskVariantResult,
} from "./types.ts";

function safeWorkspaceFile(workspacePath: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error(`Rubric path must be relative: ${relativePath}`);
  const root = path.resolve(workspacePath);
  const resolved = path.resolve(root, relativePath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Rubric path escapes the workspace: ${relativePath}`);
  }
  return resolved;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function contains(source: string, expected: string, caseSensitive: boolean): boolean {
  return caseSensitive
    ? source.includes(expected)
    : source.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
}

function propertyValue(value: unknown, property?: string): unknown {
  if (!property) return value;
  let current = value;
  for (const segment of property.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

async function evaluateRubric(
  rubric: TaskRubric,
  workspacePath: string,
  finalOutput: string,
): Promise<TaskRubricResult> {
  try {
    if (rubric.type === "file-exists") {
      const passed = await exists(safeWorkspaceFile(workspacePath, rubric.path));
      return { ...rubric, passed, diagnostic: passed ? `Found ${rubric.path}` : `Missing ${rubric.path}` };
    }
    if (rubric.type === "file-contains") {
      const source = await readFile(safeWorkspaceFile(workspacePath, rubric.path), "utf8");
      const passed = contains(source, rubric.value, rubric.caseSensitive);
      return { ...rubric, passed, diagnostic: passed ? `${rubric.path} contains expected text` : `${rubric.path} does not contain expected text` };
    }
    if (rubric.type === "json-equals") {
      const parsed = JSON.parse(await readFile(safeWorkspaceFile(workspacePath, rubric.path), "utf8"));
      const actual = propertyValue(parsed, rubric.property);
      const passed = JSON.stringify(actual) === JSON.stringify(rubric.expected);
      return { ...rubric, passed, diagnostic: passed ? `${rubric.path}${rubric.property ? `:${rubric.property}` : ""} matches` : `Expected ${JSON.stringify(rubric.expected)}, received ${JSON.stringify(actual)}` };
    }
    const passed = contains(finalOutput, rubric.value, rubric.caseSensitive);
    return { ...rubric, passed, diagnostic: passed ? "Final output contains expected text" : "Final output does not contain expected text" };
  } catch (error) {
    return { ...rubric, passed: false, diagnostic: (error as Error).message };
  }
}

export async function scoreTaskVariant(
  variant: TaskVariant,
  rubric: TaskRubric[],
  workspacePath: string,
  execution: TaskExecution,
): Promise<TaskVariantResult> {
  const results = await Promise.all(rubric.map((entry) => evaluateRubric(entry, workspacePath, execution.finalOutput)));
  const totalWeight = results.reduce((sum, entry) => sum + entry.weight, 0);
  const earnedWeight = results.reduce((sum, entry) => sum + (entry.passed ? entry.weight : 0), 0);
  return {
    variant,
    execution,
    score: totalWeight === 0 ? 0 : earnedWeight / totalWeight,
    earnedWeight,
    totalWeight,
    rubric: results,
  };
}
