import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import packageJson from "../package.json";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function cli(...args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const subprocess = Bun.spawn(["bun", "run", "src/cli.tsx", ...args], {
    cwd: process.cwd(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("CLI", () => {
  test("prints the package version", async () => {
    const result = await cli("--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(packageJson.version);
  });

  test("prints help instead of trying to render when stdin is not a TTY", async () => {
    const result = await cli();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skillbench — build testable Agent Skills");
    expect(result.stdout).toContain("skillbench registry");
    expect(result.stdout).toContain("skillbench audit");
    expect(result.stdout).toContain("skillbench check");
    expect(result.stdout).toContain("skillbench challenge");
    expect(result.stdout).toContain("--runner codex|claude");
    expect(result.stdout).toContain("--agent codex|claude");
  });

  test("selects the Claude trigger runner from the CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skillbench-cli-claude-test-"));
    temporaryDirectories.push(root);
    const binary = path.join(root, "claude");
    await writeFile(binary, `#!/usr/bin/env bun
await Bun.stdin.text();
console.log(JSON.stringify({ type: "result", is_error: false, structured_output: { trigger: true, confidence: 0.9, rationale: "match" } }));
`, "utf8");
    await chmod(binary, 0o755);

    const result = await cli(
      "eval",
      "examples/generated/verify-real-outcome",
      "--runner",
      "claude",
      "--claude-bin",
      binary,
      "--prompt",
      "Verify the real deployed result",
      "--expect",
      "trigger",
      "--plain",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("· claude ·");
    expect(result.stdout).toContain("pass probe");
  });

  test("resolves Claude project installs under .claude/skills", async () => {
    const result = await cli("installed", "--agent", "claude", "--json");
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { root: string };
    expect(parsed.root).toBe(path.resolve(".claude", "skills"));
  });

  test("rejects an unknown command", async () => {
    const result = await cli("definitely-not-a-command");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
