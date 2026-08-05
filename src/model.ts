export type SourceKind = "failure" | "success" | "process";

export interface SkillDraft {
  name: string;
  displayName: string;
  description: string;
  sourceKind: SourceKind;
  scenario: string;
  desiredOutcome: string;
  verification: string;
  positiveTriggers: string[];
  negativeTriggers: string[];
  processSteps: string[];
  doneCriteria: string[];
  outputPath: string;
}

export const EMPTY_DRAFT: SkillDraft = {
  name: "",
  displayName: "",
  description: "",
  sourceKind: "failure",
  scenario: "",
  desiredOutcome: "",
  verification: "",
  positiveTriggers: [],
  negativeTriggers: [],
  processSteps: [],
  doneCriteria: [],
  outputPath: "",
};

export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .replace(/-$/g, "");
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function joinLines(value: string[]): string {
  return value.join("\n");
}

export function defaultOutputPath(name: string): string {
  return `./.agents/skills/${normalizeSkillName(name) || "new-skill"}`;
}

export function titleFromName(name: string): string {
  return normalizeSkillName(name)
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export function compactDescription(description: string): string {
  const normalized = description
    .replace(/\s+/g, " ")
    .split(/\buse when\b/i)[0]
    ?.trim()
    .replace(/\s*[.!?]+$/, "") ?? "";
  if (normalized.length <= 64 && normalized.length >= 25) return normalized;
  if (normalized.length < 25) return `${normalized || "Build a focused agent skill"} reliably`.slice(0, 64);

  const clipped = normalized.slice(0, 64);
  const wordBoundary = clipped.lastIndexOf(" ");
  return (wordBoundary >= 25 ? clipped.slice(0, wordBoundary) : clipped).trim();
}
