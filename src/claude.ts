import { realpath } from "node:fs/promises";

export async function resolveClaudeBinary(explicit?: string): Promise<string> {
  const candidate = explicit ?? Bun.which("claude");
  if (!candidate) {
    throw new Error("Claude Code CLI was not found. Install it or pass --claude-bin <path>.");
  }
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

function messageFromRecord(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["result", "error", "message"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

export function claudeDiagnostic(stdout: string, stderr: string): string {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const message = messageFromRecord(JSON.parse(line));
      if (message) return message;
    } catch {
      // Non-JSON diagnostics are handled below.
    }
  }
  return (stderr || stdout).trim().split(/\r?\n/).slice(-6).join("\n");
}

export function numericProperty(value: unknown, ...keys: string[]): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "number") return record[key] as number;
  }
  return undefined;
}
