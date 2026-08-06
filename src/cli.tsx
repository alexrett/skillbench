#!/usr/bin/env bun
import React from "react";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { render } from "@semos-labs/glyph";
import { checkSkills } from "./check.ts";
import { loadTriggerEvalSuite } from "./eval/load.ts";
import { runTriggerEvals } from "./eval/run.ts";
import type { TriggerEvalReport } from "./eval/types.ts";
import { writeSkillPackage } from "./generate.ts";
import { defaultOutputPath, type SkillDraft } from "./model.ts";
import { lintSkillDirectory } from "./lint.ts";
import {
  addSkillToRegistry,
  checkInstalledSkills,
  doctorRegistry,
  initRegistry,
  inspectRegistrySkill,
  installSkill,
  openRegistry,
  removeInstalledSkill,
  searchRegistry,
} from "./registry/registry.ts";
import { readLock } from "./registry/lock.ts";
import { createTaskRunner, createTriggerRunner, parseAgentRunner, type AgentRunnerName } from "./runners.ts";
import { auditSkillDirectory } from "./security/audit.ts";
import type { SecuritySeverity, SkillSecurityReport } from "./security/types.ts";
import { loadTaskEvalSuite } from "./task-eval/load.ts";
import { runTaskEvals } from "./task-eval/run.ts";
import type { TaskEvalReport } from "./task-eval/types.ts";
import { App } from "./tui/App.tsx";
import { EvalApp } from "./tui/EvalApp.tsx";
import { HomeApp } from "./tui/HomeApp.tsx";
import { TaskEvalApp } from "./tui/TaskEvalApp.tsx";
import { validateSkillDirectory } from "./validate.ts";
import packageJson from "../package.json" with { type: "json" };

const HELP = `Skillbench — build testable Agent Skills

Usage:
  skillbench new [--out <directory>]       Open the Glyph constructor
  skillbench build <brief.json> [--out <directory>]
  skillbench validate <skill-directory> [--json] [--report <file>]
  skillbench lint <skill-directory> [--json] [--report <file>]
  skillbench audit <skill-directory> [--fail-on high] [--json] [--report <file>]
  skillbench check [paths...] [--strict] [--fail-on high] [--json] [--report <file>]
  skillbench eval <skill-directory> [--task] [--runner codex|claude] [--model <model>] [--plain|--json]
  skillbench challenge <skill-directory> [--runner codex|claude] [--runs 3] [--seed 1] [--report <file>]
  skillbench eval <skill-directory> --prompt <request> --expect trigger|skip
  skillbench registry init [directory] [--name <name>]
  skillbench registry add <skill-directory> --registry <directory> --version <version>
  skillbench registry list|search|show|doctor [query] [--registry <path-or-git-url>]
  skillbench install <skill[@version]> [--registry <path-or-git-url>] [--agent codex|claude] [--to <directory>|--global]
  skillbench remove <skill> [--agent codex|claude] [--to <directory>|--global]
  skillbench installed [--check] [--agent codex|claude] [--to <directory>|--global] [--json]
  skillbench --version
  skillbench help

Evaluation defaults to Codex. Use --runner claude or SKILLBENCH_RUNNER=claude for Claude Code.
The generated package contains portable SKILL.md instructions, optional Codex UI metadata, and eval cases.`;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const VALUE_OPTIONS = new Set(["--out", "--model", "--runner", "--codex-bin", "--claude-bin", "--agent", "--concurrency", "--limit", "--timeout", "--registry", "--version", "--to", "--name", "--prompt", "--expect", "--runs", "--seed", "--order", "--fail-on", "--report"]);

function positional(args: string[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index]?.startsWith("--")) {
      if (VALUE_OPTIONS.has(args[index] as string)) index += 1;
      continue;
    }
    values.push(args[index] as string);
  }
  return values;
}

function numberOption(args: string[], name: string, fallback: number): number {
  const value = Number(option(args, name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return Math.floor(value);
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPercent(value: number | undefined): string {
  if (value === undefined) return "n/a";
  return `${value >= 0 ? "+" : ""}${percent(value)}`;
}

function severityOption(args: string[]): SecuritySeverity {
  const value = option(args, "--fail-on") ?? "high";
  if (!["info", "low", "medium", "high", "critical"].includes(value)) {
    throw new Error("--fail-on must be info, low, medium, high, or critical");
  }
  return value as SecuritySeverity;
}

function orderOption(args: string[]): "fixed" | "counterbalanced" {
  const value = option(args, "--order") ?? "fixed";
  if (value !== "fixed" && value !== "counterbalanced") {
    throw new Error("--order must be fixed or counterbalanced");
  }
  return value;
}

function runnerOption(args: string[]): AgentRunnerName {
  return parseAgentRunner(option(args, "--runner") ?? process.env.SKILLBENCH_RUNNER);
}

function runnerBinary(args: string[], runner: AgentRunnerName): string | undefined {
  return option(args, runner === "claude" ? "--claude-bin" : "--codex-bin");
}

async function writeJsonReport(args: string[], value: unknown): Promise<void> {
  const reportPath = option(args, "--report");
  if (!reportPath) return;
  const resolved = path.resolve(reportPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printEvalReport(report: TriggerEvalReport): void {
  console.log(`${report.passed ? "PASS" : "FAIL"} ${report.skill} · ${report.runner}${report.model ? `/${report.model}` : ""} · ${report.durationMs}ms`);
  console.log(`accuracy ${percent(report.metrics.accuracy)} · precision ${percent(report.metrics.precision)} · recall ${percent(report.metrics.recall)} · specificity ${percent(report.metrics.specificity)}`);
  for (const result of report.results) {
    const expected = result.case.shouldTrigger ? "trigger" : "skip";
    const actual = result.decision.trigger ? "trigger" : "skip";
    console.log(`${result.passed ? "pass" : "FAIL"} ${result.case.id} expected=${expected} actual=${actual} confidence=${percent(result.decision.confidence)} ${result.decision.durationMs}ms`);
    if (!result.passed) console.log(`  ${result.decision.rationale}`);
  }
}

function printTaskEvalReport(report: TaskEvalReport): void {
  console.log(`${report.passed ? "PASS" : "FAIL"} ${report.skill} · task A/B · ${report.runner}${report.model ? `/${report.model}` : ""} · ${report.durationMs}ms`);
  console.log(`verdict ${report.verdict.toUpperCase()} · ${report.metrics.runs} paired run${report.metrics.runs === 1 ? "" : "s"}`);
  console.log(`baseline ${percent(report.metrics.averageBaselineScore)} · skill ${percent(report.metrics.averageSkillScore)} · delta ${report.metrics.averageDelta >= 0 ? "+" : ""}${percent(report.metrics.averageDelta)}`);
  console.log(`latency ${Math.round(report.metrics.averageBaselineDurationMs)}ms → ${Math.round(report.metrics.averageSkillDurationMs)}ms (${signedPercent(report.metrics.durationDeltaPercent)}) · tokens ${report.metrics.averageBaselineTokens === undefined ? "n/a" : `${Math.round(report.metrics.averageBaselineTokens)} → ${Math.round(report.metrics.averageSkillTokens ?? 0)} (${signedPercent(report.metrics.tokenDeltaPercent)})`}`);
  console.log(`improved ${report.metrics.improved} · unchanged ${report.metrics.unchanged} · regressed ${report.metrics.regressed}`);
  for (const result of report.results) {
    console.log(`${result.passed ? "pass" : "FAIL"} ${result.caseId}#${result.run} order=${result.order.join("→")} baseline=${percent(result.baseline.score)} skill=${percent(result.skill.score)} delta=${result.delta >= 0 ? "+" : ""}${percent(result.delta)}`);
    for (const entry of result.skill.rubric.filter((rubric) => !rubric.passed)) {
      console.log(`  × ${entry.description}: ${entry.diagnostic}`);
    }
    if (result.keptWorkspaces) console.log(`  kept ${result.keptWorkspaces.baseline} ${result.keptWorkspaces.skill}`);
  }
}

function printSecurityReport(report: SkillSecurityReport): void {
  console.log(`${report.passed ? "PASS" : "FAIL"} security ${report.root} · fail-on ${report.failOn}`);
  console.log(`critical ${report.summary.critical} · high ${report.summary.high} · medium ${report.summary.medium} · low ${report.summary.low} · info ${report.summary.info}`);
  for (const finding of report.findings) {
    console.log(`${finding.severity.toUpperCase()} [${finding.code}] ${finding.path}${finding.line ? `:${finding.line}` : ""} ${finding.message}`);
    console.log(`  ${finding.recommendation}`);
  }
  for (const suppression of report.suppressions) {
    console.log(`allow [${suppression.code}] ${suppression.path}:${suppression.line} ${suppression.reason}`);
  }
}

function installRoot(args: string[]): string {
  const explicit = option(args, "--to");
  if (explicit) return path.resolve(explicit);
  const agent = option(args, "--agent");
  if (agent !== undefined && agent !== "codex" && agent !== "claude") {
    throw new Error("--agent must be codex or claude");
  }
  if (agent === "claude") {
    return args.includes("--global")
      ? path.join(os.homedir(), ".claude", "skills")
      : path.resolve(".claude", "skills");
  }
  if (agent === "codex") {
    return args.includes("--global")
      ? path.join(os.homedir(), ".codex", "skills")
      : path.resolve(".codex", "skills");
  }
  if (args.includes("--global")) return path.join(os.homedir(), ".codex", "skills");
  return path.resolve(".agents", "skills");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    if (process.stdin.isTTY && process.stdout.isTTY) render(<HomeApp />);
    else console.log(HELP);
    return;
  }

  if (command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    console.log(packageJson.version);
    return;
  }

  if (command === "new") {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("The Glyph constructor needs an interactive TTY. Use `skillbench build` in scripts or CI.");
    }
    render(<App initialOutputPath={option(args, "--out")} />);
    return;
  }

  if (command === "build") {
    const [briefPath] = positional(args);
    if (!briefPath) throw new Error("Usage: skillbench build <brief.json> [--out <directory>]");
    const draft = JSON.parse(await readFile(path.resolve(briefPath), "utf8")) as SkillDraft;
    const target = option(args, "--out") ?? draft.outputPath ?? defaultOutputPath(draft.name);
    const output = await writeSkillPackage(draft, target);
    const validation = await validateSkillDirectory(output);
    console.log(`Built ${output}`);
    for (const entry of validation.issues) {
      console.log(`${entry.severity === "error" ? "error" : "warn"} [${entry.code}] ${entry.message}`);
    }
    process.exitCode = validation.valid ? 0 : 1;
    return;
  }

  if (command === "validate") {
    const [target = "."] = positional(args);
    const result = await validateSkillDirectory(target);
    await writeJsonReport(args, result);
    if (args.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.valid ? "PASS" : "FAIL"} ${result.path}`);
      if (result.issues.length === 0) console.log("No validation issues");
      for (const entry of result.issues) {
        console.log(`${entry.severity === "error" ? "error" : "warn"} [${entry.code}] ${entry.message}`);
      }
    }
    process.exitCode = result.valid ? 0 : 1;
    return;
  }

  if (command === "lint") {
    const [target = "."] = positional(args);
    const result = await lintSkillDirectory(target);
    await writeJsonReport(args, result);
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${result.valid ? "PASS" : "FAIL"} lint ${result.path}`);
      if (result.issues.length === 0) console.log("No lint issues");
      for (const entry of result.issues) console.log(`${entry.severity === "error" ? "error" : "warn"} [${entry.code}] ${entry.message}`);
    }
    process.exitCode = result.valid ? 0 : 1;
    return;
  }

  if (command === "audit") {
    const [target = "."] = positional(args);
    const report = await auditSkillDirectory(target, { failOn: severityOption(args) });
    await writeJsonReport(args, report);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else printSecurityReport(report);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  if (command === "check" || command === "ci") {
    const report = await checkSkills(positional(args), {
      strict: args.includes("--strict"),
      failOn: severityOption(args),
    });
    await writeJsonReport(args, report);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`${report.passed ? "PASS" : "FAIL"} skill gate · ${report.summary.skills} skill${report.summary.skills === 1 ? "" : "s"}`);
      if (report.skills.length === 0) console.log("error [no-skills] No SKILL.md packages found in conventional roots or supplied paths");
      for (const skill of report.skills) {
        console.log(`${skill.passed ? "pass" : "FAIL"} ${skill.path}`);
        for (const issue of skill.validation.issues.filter((entry) => entry.severity === "error")) console.log(`  error [${issue.code}] ${issue.message}`);
        for (const issue of skill.lint?.issues.filter((entry) => entry.severity === "error") ?? []) console.log(`  lint [${issue.code}] ${issue.message}`);
        for (const finding of skill.security.findings) console.log(`  ${finding.severity} [${finding.code}] ${finding.path}${finding.line ? `:${finding.line}` : ""} ${finding.message}`);
      }
    }
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  if (command === "challenge") {
    const [target = "."] = positional(args);
    const suite = await loadTaskEvalSuite(target);
    const runnerName = runnerOption(args);
    const runner = createTaskRunner(runnerName, {
      binary: runnerBinary(args, runnerName),
      model: option(args, "--model"),
      timeoutMs: numberOption(args, "--timeout", 180_000),
    });
    const report = await runTaskEvals(suite, runner, {
      concurrency: numberOption(args, "--concurrency", 1),
      limit: option(args, "--limit") ? numberOption(args, "--limit", suite.cases.length) : undefined,
      keepWorkspaces: args.includes("--keep"),
      runs: numberOption(args, "--runs", 3),
      order: option(args, "--order") ? orderOption(args) : "counterbalanced",
      seed: numberOption(args, "--seed", 1),
    });
    await writeJsonReport(args, report);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else printTaskEvalReport(report);
    process.exitCode = report.verdict === "proven" || report.verdict === "efficient" ? 0 : 1;
    return;
  }

  if (command === "eval") {
    const [target = "."] = positional(args);
    const concurrency = numberOption(args, "--concurrency", 2);
    const interactive = process.stdin.isTTY && process.stdout.isTTY && !args.includes("--plain") && !args.includes("--json") && option(args, "--runs") === undefined;

    if (args.includes("--task")) {
      const suite = await loadTaskEvalSuite(target);
      const limitValue = option(args, "--limit");
      const limit = limitValue ? numberOption(args, "--limit", suite.cases.length) : undefined;
      const runnerName = runnerOption(args);
      const runner = createTaskRunner(runnerName, {
        binary: runnerBinary(args, runnerName),
        model: option(args, "--model"),
        timeoutMs: numberOption(args, "--timeout", 180_000),
      });
      if (interactive) {
        render(<TaskEvalApp suite={suite} runner={runner} concurrency={concurrency} limit={limit} keepWorkspaces={args.includes("--keep")} />);
        return;
      }
      const report = await runTaskEvals(suite, runner, {
        concurrency,
        limit,
        keepWorkspaces: args.includes("--keep"),
        runs: numberOption(args, "--runs", 1),
        order: orderOption(args),
        seed: numberOption(args, "--seed", 1),
      });
      await writeJsonReport(args, report);
      if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else printTaskEvalReport(report);
      process.exitCode = report.passed ? 0 : 1;
      return;
    }

    const suite = await loadTriggerEvalSuite(target);
    const probePrompt = option(args, "--prompt");
    if (probePrompt) {
      const expectation = option(args, "--expect") ?? "trigger";
      if (expectation !== "trigger" && expectation !== "skip") throw new Error("--expect must be trigger or skip");
      suite.cases = [{ id: "probe", prompt: probePrompt, shouldTrigger: expectation === "trigger" }];
    }
    const limitValue = option(args, "--limit");
    const limit = limitValue ? numberOption(args, "--limit", suite.cases.length) : undefined;
    const runnerName = runnerOption(args);
    const runner = createTriggerRunner(runnerName, {
      binary: runnerBinary(args, runnerName),
      model: option(args, "--model"),
      timeoutMs: numberOption(args, "--timeout", 120_000),
    });
    if (interactive) {
      render(<EvalApp suite={suite} runner={runner} concurrency={concurrency} limit={limit} />);
      return;
    }
    const report = await runTriggerEvals(suite, runner, { concurrency, limit });
    await writeJsonReport(args, report);
    if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
    else printEvalReport(report);
    process.exitCode = report.passed ? 0 : 1;
    return;
  }

  if (command === "registry") {
    const [subcommand = "list", first] = positional(args);
    const registryInput = option(args, "--registry") ?? "./registry";
    if (subcommand === "init") {
      const created = await initRegistry(first ?? registryInput, option(args, "--name") ?? "skillbench-local");
      console.log(`Initialized ${created.manifestPath}`);
      return;
    }
    if (subcommand === "add") {
      if (!first) throw new Error("Usage: skillbench registry add <skill-directory> --registry <directory> --version <version>");
      const version = option(args, "--version");
      if (!version) throw new Error("registry add requires --version <semver>");
      const entry = await addSkillToRegistry({ registry: registryInput, skillPath: first, version, force: args.includes("--force") });
      if (args.includes("--json")) console.log(JSON.stringify(entry, null, 2));
      else console.log(`Added ${entry.name}@${entry.version} · ${entry.checksum}`);
      return;
    }
    if (subcommand === "list" || subcommand === "search") {
      const opened = await openRegistry(registryInput, args.includes("--refresh"));
      const entries = searchRegistry(opened.manifest, subcommand === "search" ? (first ?? "") : "");
      if (args.includes("--json")) console.log(JSON.stringify({ registry: opened.source, entries }, null, 2));
      else if (entries.length === 0) console.log("No matching skills");
      else for (const entry of entries) console.log(`${entry.name}@${entry.version}  ${entry.description}`);
      return;
    }
    if (subcommand === "show") {
      if (!first) throw new Error("Usage: skillbench registry show <skill[@version]> [--registry <path-or-git-url>]");
      const inspection = await inspectRegistrySkill(registryInput, first, args.includes("--refresh"));
      if (args.includes("--json")) console.log(JSON.stringify(inspection, null, 2));
      else {
        console.log(`${inspection.entry.name}@${inspection.entry.version} · ${inspection.entry.checksum}`);
        console.log(`source ${inspection.source}`);
        console.log(`files ${inspection.files.join(", ")}`);
        console.log("");
        console.log(inspection.skillMarkdown.trimEnd());
      }
      return;
    }
    if (subcommand === "doctor") {
      const report = await doctorRegistry(registryInput, args.includes("--refresh"));
      if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`${report.valid ? "PASS" : "FAIL"} ${report.source} · ${report.checked} package${report.checked === 1 ? "" : "s"}`);
        for (const issue of report.issues) console.log(`${issue.severity === "error" ? "error" : "warn"} [${issue.code}] ${issue.skill ? `${issue.skill}@${issue.version}: ` : ""}${issue.message}`);
      }
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    throw new Error(`Unknown registry command: ${subcommand}`);
  }

  if (command === "install") {
    const [selector] = positional(args);
    if (!selector) throw new Error("Usage: skillbench install <skill[@version]> [--registry <path-or-git-url>] [--agent codex|claude] [--to <directory>|--global]");
    const result = await installSkill({
      registry: option(args, "--registry") ?? "./registry",
      selector,
      targetRoot: installRoot(args),
      force: args.includes("--force"),
      refresh: args.includes("--refresh"),
    });
    if (args.includes("--json")) console.log(JSON.stringify(result, null, 2));
    else console.log(`Installed ${result.name}@${result.version} → ${result.path}`);
    return;
  }

  if (command === "remove") {
    const [name] = positional(args);
    if (!name) throw new Error("Usage: skillbench remove <skill> [--agent codex|claude] [--to <directory>|--global]");
    const removed = await removeInstalledSkill(name, installRoot(args));
    console.log(`Removed ${removed}`);
    return;
  }

  if (command === "installed") {
    const root = installRoot(args);
    if (args.includes("--check")) {
      const report = await checkInstalledSkills(root);
      if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
      else if (report.skills.length === 0) console.log(`No Skillbench-managed skills in ${root}`);
      else {
        console.log(`${report.valid ? "PASS" : "FAIL"} ${root} · ${report.skills.length} installed`);
        for (const entry of report.skills) {
          console.log(`${entry.valid ? "pass" : "FAIL"} ${entry.name}@${entry.version}`);
          for (const issue of entry.issues) console.log(`  × ${issue}`);
        }
      }
      process.exitCode = report.valid ? 0 : 1;
      return;
    }
    const lock = await readLock(root);
    if (args.includes("--json")) console.log(JSON.stringify({ root, ...lock }, null, 2));
    else if (lock.skills.length === 0) console.log(`No Skillbench-managed skills in ${root}`);
    else for (const entry of lock.skills) console.log(`${entry.name}@${entry.version}  ${entry.checksum}  ${entry.source}`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

main().catch((error) => {
  console.error(`skillbench: ${(error as Error).message}`);
  process.exitCode = 1;
});
