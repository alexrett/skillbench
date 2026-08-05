import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { TriggerEvalCase, TriggerEvalSuite } from "./types.ts";

function parseFrontmatter(source: string): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping");
  }
  return parsed as Record<string, unknown>;
}

export async function loadTriggerEvalSuite(inputPath: string): Promise<TriggerEvalSuite> {
  const skillPath = path.resolve(inputPath);
  const skillSource = await readFile(path.join(skillPath, "SKILL.md"), "utf8");
  const frontmatter = parseFrontmatter(skillSource);
  const skillName = typeof frontmatter.name === "string" ? frontmatter.name : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  if (!skillName || !description) throw new Error("SKILL.md needs name and description");

  const evalSource = await readFile(path.join(skillPath, "evals", "cases.yaml"), "utf8");
  const parsed = YAML.parse(evalSource);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.cases)) {
    throw new Error("evals/cases.yaml must contain a cases array");
  }
  if (parsed.skill !== skillName) {
    throw new Error(`evals/cases.yaml targets ${String(parsed.skill)}, expected ${skillName}`);
  }

  const cases: TriggerEvalCase[] = parsed.cases.map((entry: unknown, index: number) => {
    if (!entry || typeof entry !== "object") throw new Error(`Eval case ${index + 1} must be a mapping`);
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.prompt !== "string" || typeof value.should_trigger !== "boolean") {
      throw new Error(`Eval case ${index + 1} needs id, prompt, and should_trigger`);
    }
    return {
      id: value.id,
      prompt: value.prompt,
      shouldTrigger: value.should_trigger,
    };
  });

  if (cases.length === 0) throw new Error("evals/cases.yaml has no cases");
  return { skillPath, skillName, description, cases };
}
