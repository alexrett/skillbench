import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {
  compactDescription,
  normalizeSkillName,
  titleFromName,
  type SkillDraft,
} from "./model.ts";

export interface GeneratedPackage {
  skillMarkdown: string;
  openaiYaml: string;
  evalsYaml: string;
}

function yamlScalar(value: string): string {
  return JSON.stringify(value.replace(/\s+/g, " ").trim());
}

function numbered(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
}

function bullets(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export function generateSkillMarkdown(draft: SkillDraft): string {
  const name = normalizeSkillName(draft.name);
  const title = draft.displayName.trim() || titleFromName(name);
  const process = draft.processSteps.length > 0
    ? numbered(draft.processSteps)
    : "1. Inspect the task and its available evidence.\n2. Perform the smallest reliable workflow that reaches the stated outcome.\n3. Verify the result against the completion criteria.";
  const done = draft.doneCriteria.length > 0
    ? bullets(draft.doneCriteria)
    : `- Verify the result using: ${draft.verification.trim() || "an observable check"}.`;

  return `---
name: ${name}
description: ${yamlScalar(draft.description)}
---

# ${title}

Use this workflow to reach the stated outcome consistently. Keep the procedure proportional to the task and preserve explicit user control for consequential actions.

## Outcome

${draft.desiredOutcome.trim()}

## Process

${process}

## Done

Finish only when every applicable criterion is satisfied:

${done}
`;
}

export function generateOpenaiYaml(draft: SkillDraft): string {
  const name = normalizeSkillName(draft.name);
  const displayName = draft.displayName.trim() || titleFromName(name);
  const shortDescription = compactDescription(draft.description);
  const defaultPrompt = `Use $${name} to ${draft.desiredOutcome.trim().replace(/[.!?]+$/, "").toLowerCase()}.`;

  return `interface:
  display_name: ${JSON.stringify(displayName)}
  short_description: ${JSON.stringify(shortDescription)}
  default_prompt: ${JSON.stringify(defaultPrompt)}
`;
}

export function generateEvalsYaml(draft: SkillDraft): string {
  const name = normalizeSkillName(draft.name);
  const cases = [
    ...draft.positiveTriggers.map((prompt, index) => ({
      id: `trigger-${index + 1}`,
      prompt,
      should_trigger: true,
    })),
    ...draft.negativeTriggers.map((prompt, index) => ({
      id: `near-miss-${index + 1}`,
      prompt,
      should_trigger: false,
    })),
  ];

  return YAML.stringify({
    version: 1,
    skill: name,
    cases,
    rubric: {
      outcome: draft.desiredOutcome.trim(),
      verification: draft.verification.trim(),
      done: draft.doneCriteria,
    },
  }, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" });
}

export function generatePackage(draft: SkillDraft): GeneratedPackage {
  return {
    skillMarkdown: generateSkillMarkdown(draft),
    openaiYaml: generateOpenaiYaml(draft),
    evalsYaml: generateEvalsYaml(draft),
  };
}

async function isNonEmptyDirectory(target: string): Promise<boolean> {
  try {
    return (await readdir(target)).length > 0;
  } catch {
    return false;
  }
}

export async function writeSkillPackage(
  draft: SkillDraft,
  targetPath = draft.outputPath,
): Promise<string> {
  const resolved = path.resolve(targetPath);
  if (await isNonEmptyDirectory(resolved)) {
    throw new Error(`Refusing to overwrite non-empty directory: ${resolved}`);
  }

  const generated = generatePackage(draft);
  await mkdir(path.join(resolved, "agents"), { recursive: true });
  await mkdir(path.join(resolved, "evals"), { recursive: true });
  await writeFile(path.join(resolved, "SKILL.md"), generated.skillMarkdown, "utf8");
  await writeFile(path.join(resolved, "agents", "openai.yaml"), generated.openaiYaml, "utf8");
  await writeFile(path.join(resolved, "evals", "cases.yaml"), generated.evalsYaml, "utf8");

  await access(path.join(resolved, "SKILL.md"));
  return resolved;
}
