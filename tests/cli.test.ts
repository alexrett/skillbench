import { describe, expect, test } from "bun:test";

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
    expect(result.stdout.trim()).toBe("0.3.0");
  });

  test("prints help instead of trying to render when stdin is not a TTY", async () => {
    const result = await cli();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Skillbench — build testable Agent Skills");
    expect(result.stdout).toContain("skillbench registry");
  });

  test("rejects an unknown command", async () => {
    const result = await cli("definitely-not-a-command");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown command");
  });
});
