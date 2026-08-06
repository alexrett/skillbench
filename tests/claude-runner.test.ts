import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ClaudeTriggerRunner } from "../src/eval/claude-runner.ts";
import { ClaudeTaskRunner, metadataFromClaudeJsonLines } from "../src/task-eval/claude-runner.ts";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function fakeClaude(directory: string, body: string): Promise<string> {
  const executable = path.join(directory, "claude");
  await writeFile(executable, `#!/usr/bin/env bun\n${body}\n`, "utf8");
  await chmod(executable, 0o755);
  return executable;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Claude runners", () => {
  test("runs a tool-free structured trigger decision", async () => {
    const root = await temporaryDirectory("skillbench-claude-trigger-test-");
    const capture = path.join(root, "capture.json");
    const binary = await fakeClaude(root, `
const prompt = await Bun.stdin.text();
await Bun.write(${JSON.stringify(capture)}, JSON.stringify({ args: Bun.argv.slice(2), prompt }));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  structured_output: { trigger: true, confidence: 0.91, rationale: "Direct match" },
}));`);

    const decision = await new ClaudeTriggerRunner({ binary, model: "sonnet", timeoutMs: 5_000 }).decide({
      skillName: "release-check",
      description: "Verifies releases",
      prompt: "Check this release",
    });
    const captureResult = JSON.parse(await readFile(capture, "utf8")) as { args: string[]; prompt: string };

    expect(decision.trigger).toBe(true);
    expect(decision.confidence).toBe(0.91);
    expect(captureResult.args).toContain("--json-schema");
    expect(captureResult.args).toContain("--safe-mode");
    expect(captureResult.args).toContain("--tools");
    expect(captureResult.args[captureResult.args.indexOf("--tools") + 1]).toBe("");
    expect(captureResult.args.slice(captureResult.args.indexOf("--model"), captureResult.args.indexOf("--model") + 2)).toEqual(["--model", "sonnet"]);
    expect(captureResult.prompt).toContain("Check this release");
    expect(captureResult.prompt).not.toContain("shouldTrigger");
  });

  test("surfaces a Claude authentication failure", async () => {
    const root = await temporaryDirectory("skillbench-claude-auth-test-");
    const binary = await fakeClaude(root, `
await Bun.stdin.text();
console.log(JSON.stringify({ type: "result", is_error: true, result: "OAuth session expired and could not be refreshed" }));
process.exit(1);`);

    await expect(new ClaudeTriggerRunner({ binary, timeoutMs: 5_000 }).decide({
      skillName: "release-check",
      description: "Verifies releases",
      prompt: "Check this release",
    })).rejects.toThrow("OAuth session expired and could not be refreshed");
  });

  test("captures Claude task output, usage, and Bash commands", async () => {
    const root = await temporaryDirectory("skillbench-claude-task-test-");
    const workspace = path.join(root, "workspace");
    await mkdir(workspace);
    const capture = path.join(root, "capture.json");
    const binary = await fakeClaude(root, `
const prompt = await Bun.stdin.text();
await Bun.write(${JSON.stringify(capture)}, JSON.stringify({ args: Bun.argv.slice(2), prompt, cwd: process.cwd() }));
console.log(JSON.stringify({ type: "system", subtype: "init" }));
console.log(JSON.stringify({
  type: "assistant",
  message: {
    usage: { input_tokens: 7, output_tokens: 2 },
    content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "bun test" } }],
  },
}));
console.log(JSON.stringify({
  type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "tests passed", is_error: false }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "Implemented and verified.",
  usage: { input_tokens: 11, output_tokens: 5 },
}));`);

    const execution = await new ClaudeTaskRunner({ binary, timeoutMs: 5_000 }).execute({
      variant: "skill",
      prompt: "Fix the project",
      workspacePath: workspace,
      skillName: "release-check",
      skillMarkdown: "# Release check\n\nRun tests.",
      skillPath: path.join(workspace, ".skillbench", "skills", "release-check"),
    });
    const captureResult = JSON.parse(await readFile(capture, "utf8")) as { args: string[]; prompt: string; cwd: string };

    expect(execution.finalOutput).toBe("Implemented and verified.");
    expect(execution.inputTokens).toBe(11);
    expect(execution.outputTokens).toBe(5);
    expect(execution.commands).toEqual([{ command: "bun test", exitCode: 0 }]);
    expect(captureResult.cwd).toBe(await realpath(workspace));
    expect(captureResult.args).toContain("stream-json");
    expect(captureResult.args).toContain("bypassPermissions");
    expect(captureResult.args).toContain("WebFetch");
    expect(captureResult.args).toContain("WebSearch");
    expect(captureResult.prompt).toContain("<skill_instructions>");
    expect(captureResult.prompt).not.toContain("rubric");
  });

  test("parses explicit non-zero Bash exit codes", () => {
    const source = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: "tool-2", name: "Bash", input: { command: "bun test" } }] } }),
      JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tool-2", content: "Exit code 2\nfailed", is_error: true }] } }),
      JSON.stringify({ type: "result", is_error: false, result: "Tests failed" }),
    ].join("\n");

    expect(metadataFromClaudeJsonLines(source).commands).toEqual([{ command: "bun test", exitCode: 2 }]);
  });
});
