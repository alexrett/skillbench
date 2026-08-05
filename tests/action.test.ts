import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dir, "..");

describe("GitHub Actions supply-chain boundary", () => {
  test("pins third-party actions by full commit SHA", async () => {
    const files = [
      "action.yml",
      ".github/workflows/ci.yml",
      ".github/workflows/pages.yml",
      ".github/workflows/release.yml",
    ];

    for (const file of files) {
      const source = await readFile(path.join(root, file), "utf8");
      const references = [...source.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1] ?? "");
      for (const reference of references) {
        if (reference.startsWith("./")) continue;
        expect(reference, `${file}: ${reference}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      }
    }
  });

  test("runs an exact package version and keeps inputs out of the shell source", async () => {
    const packageJson = await Bun.file(path.join(root, "package.json")).json() as { version: string };
    const source = await readFile(path.join(root, "action.yml"), "utf8");
    const action = YAML.parse(source) as {
      inputs: { version: { default: string } };
      runs: { steps: Array<{ run?: string; env?: Record<string, string> }> };
    };

    expect(action.inputs.version.default).toBe(packageJson.version);
    const runSource = action.runs.steps.map((step) => step.run ?? "").join("\n");
    expect(runSource).not.toContain("${{ inputs.");
    expect(runSource).toContain('bunx "skillbench-cli@$SKILLBENCH_VERSION"');
  });
});
