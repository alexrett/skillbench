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
  execution: TaskExecution,
): Promise<TaskRubricResult> {
  try {
    if (rubric.type === "file-exists" || rubric.type === "file-not-exists") {
      const passed = await exists(safeWorkspaceFile(workspacePath, rubric.path));
      const expected = rubric.type === "file-exists";
      return {
        ...rubric,
        passed: passed === expected,
        diagnostic: passed === expected
          ? expected ? `Found ${rubric.path}` : `${rubric.path} is absent`
          : expected ? `Missing ${rubric.path}` : `Unexpectedly found ${rubric.path}`,
      };
    }
    if (rubric.type === "file-contains" || rubric.type === "file-not-contains") {
      const source = await readFile(safeWorkspaceFile(workspacePath, rubric.path), "utf8");
      const found = contains(source, rubric.value, rubric.caseSensitive);
      const expected = rubric.type === "file-contains";
      return {
        ...rubric,
        passed: found === expected,
        diagnostic: found === expected
          ? expected ? `${rubric.path} contains expected text` : `${rubric.path} excludes forbidden text`
          : expected ? `${rubric.path} does not contain expected text` : `${rubric.path} contains forbidden text`,
      };
    }
    if (rubric.type === "json-equals") {
      const parsed = JSON.parse(await readFile(safeWorkspaceFile(workspacePath, rubric.path), "utf8"));
      const actual = propertyValue(parsed, rubric.property);
      const passed = JSON.stringify(actual) === JSON.stringify(rubric.expected);
      return { ...rubric, passed, diagnostic: passed ? `${rubric.path}${rubric.property ? `:${rubric.property}` : ""} matches` : `Expected ${JSON.stringify(rubric.expected)}, received ${JSON.stringify(actual)}` };
    }
    if (rubric.type === "command-ran" || rubric.type === "command-not-ran") {
      const found = execution.commands?.some((entry) => contains(entry.command, rubric.value, rubric.caseSensitive)) ?? false;
      const expected = rubric.type === "command-ran";
      return {
        ...rubric,
        passed: found === expected,
        diagnostic: found === expected
          ? expected ? "Expected command was observed" : "Forbidden command was not observed"
          : expected ? "Expected command was not observed" : "Forbidden command was observed",
      };
    }
    if (rubric.type === "command-exit-code") {
      const command = execution.commands
        ?.filter((entry) => contains(entry.command, rubric.value, rubric.caseSensitive))
        .at(-1);
      const passed = command?.exitCode === rubric.expected;
      return {
        ...rubric,
        passed,
        diagnostic: !command
          ? "Matching command was not observed"
          : passed ? `Command exited ${rubric.expected}` : `Expected exit ${rubric.expected}, received ${command.exitCode ?? "unknown"}`,
      };
    }
    const found = contains(execution.finalOutput, rubric.value, rubric.caseSensitive);
    const expected = rubric.type === "final-contains";
    return {
      ...rubric,
      passed: found === expected,
      diagnostic: found === expected
        ? expected ? "Final output contains expected text" : "Final output excludes forbidden text"
        : expected ? "Final output does not contain expected text" : "Final output contains forbidden text",
    };
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
  const results = await Promise.all(rubric.map((entry) => evaluateRubric(entry, workspacePath, execution)));
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
