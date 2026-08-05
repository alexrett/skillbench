import React, { useState } from "react";
import { Box, Checkbox, Keybind, Menu, ScrollView, Text, useApp, useMediaQuery } from "@semos-labs/glyph";
import { checkSkills, type CheckSkillsReport } from "../check.ts";
import { CodexTriggerRunner } from "../eval/codex-runner.ts";
import { loadTriggerEvalSuite } from "../eval/load.ts";
import type { TriggerEvalSuite } from "../eval/types.ts";
import { inspectRegistrySkill, installSkill, openRegistry, searchRegistry } from "../registry/registry.ts";
import type { OpenedRegistry, RegistrySkillVersion } from "../registry/types.ts";
import { auditSkillDirectory } from "../security/audit.ts";
import type { SecuritySeverity, SkillSecurityReport } from "../security/types.ts";
import { CodexTaskRunner } from "../task-eval/codex-runner.ts";
import { loadTaskEvalSuite } from "../task-eval/load.ts";
import type { TaskEvalSuite } from "../task-eval/types.ts";
import { validateSkillDirectory, type ValidationResult } from "../validate.ts";
import { App } from "./App.tsx";
import { ActionButton, COLORS, Field } from "./components.tsx";
import { EvalApp } from "./EvalApp.tsx";
import { TaskEvalApp } from "./TaskEvalApp.tsx";

type Screen = "home" | "new" | "trigger" | "task" | "registry" | "validate" | "audit" | "check";
type TaskRunConfig = { runs: number; order: "fixed" | "counterbalanced"; seed: number };

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <Box style={{ gap: 0 }}>
      <Text style={{ bold: true, color: COLORS.accent }}>{title}</Text>
      <Text style={{ color: COLORS.muted }}>{subtitle}</Text>
    </Box>
  );
}

function SetupPanel({
  kind,
  onBack,
  onTrigger,
  onTask,
}: {
  kind: "trigger" | "task";
  onBack: () => void;
  onTrigger: (suite: TriggerEvalSuite, runner: CodexTriggerRunner) => void;
  onTask: (suite: TaskEvalSuite, runner: CodexTaskRunner, config: TaskRunConfig) => void;
}) {
  const [target, setTarget] = useState(".");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [runs, setRuns] = useState(kind === "task" ? "3" : "1");
  const [seed, setSeed] = useState("1");
  const [counterbalanced, setCounterbalanced] = useState(true);

  async function start() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      if (kind === "trigger") {
        onTrigger(await loadTriggerEvalSuite(target), new CodexTriggerRunner({ model: model || undefined }));
      } else {
        const parsedRuns = Number.parseInt(runs, 10);
        const parsedSeed = Number.parseInt(seed, 10);
        if (!Number.isInteger(parsedRuns) || parsedRuns < 1 || parsedRuns > 25) throw new Error("Runs must be an integer from 1 to 25");
        if (!Number.isInteger(parsedSeed)) throw new Error("Seed must be an integer");
        onTask(
          await loadTaskEvalSuite(target),
          new CodexTaskRunner({ model: model || undefined }),
          { runs: parsedRuns, order: counterbalanced ? "counterbalanced" : "fixed", seed: parsedSeed },
        );
      }
    } catch (caught) {
      setError((caught as Error).message);
      setLoading(false);
    }
  }

  return (
    <Box style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center", padding: 2 }}>
      <Box style={{ width: 76, border: "round", borderColor: COLORS.accent, padding: 2, gap: 1 }}>
        <Header title={kind === "trigger" ? "Trigger evaluation" : "Task A/B evaluation"} subtitle={kind === "trigger" ? "Measure discovery precision and recall" : "Compare baseline and skill in isolated workspaces"} />
        <Field label="Skill directory" value={target} onChange={setTarget} autoFocus />
        <Field label="Model" hint="optional" value={model} onChange={setModel} placeholder="Codex default" />
        {kind === "task" ? (
          <>
            <Box style={{ flexDirection: "row", gap: 1 }}>
              <Box style={{ flexGrow: 1 }}><Field label="Runs" hint="1–25" value={runs} onChange={setRuns} /></Box>
              <Box style={{ flexGrow: 1 }}><Field label="Seed" value={seed} onChange={setSeed} /></Box>
            </Box>
            <Checkbox checked={counterbalanced} onChange={setCounterbalanced} label="Counterbalance run order (AB/BA)" focusedStyle={{ color: COLORS.accent }} />
          </>
        ) : null}
        {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
        <Box style={{ flexDirection: "row", gap: 1 }}>
          <ActionButton onPress={onBack}>Back</ActionButton>
          <ActionButton onPress={() => void start()} primary disabled={loading}>{loading ? "Loading…" : "Start"}</ActionButton>
        </Box>
      </Box>
    </Box>
  );
}

function ValidatePanel({ onBack }: { onBack: () => void }) {
  const [target, setTarget] = useState(".");
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [error, setError] = useState("");

  async function validate() {
    setError("");
    try {
      setResult(await validateSkillDirectory(target));
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <Box style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center", padding: 2 }}>
      <Box style={{ width: 76, border: "round", borderColor: COLORS.accent, padding: 2, gap: 1 }}>
        <Header title="Validate package" subtitle="Check structure, metadata, references, and eval contracts" />
        <Field label="Skill directory" value={target} onChange={setTarget} autoFocus />
        {result ? (
          <Box style={{ bg: COLORS.panel, padding: 1, gap: 0 }}>
            <Text style={{ bold: true, color: result.valid ? COLORS.success : COLORS.error }}>{result.valid ? "PASS" : "FAIL"} {result.path}</Text>
            {result.issues.length === 0 ? <Text style={{ color: COLORS.success }}>✓ No issues</Text> : result.issues.map((issue) => (
              <Text key={`${issue.code}-${issue.message}`} style={{ color: issue.severity === "error" ? COLORS.error : COLORS.warning }}>
                {issue.severity === "error" ? "×" : "!"} {issue.message}
              </Text>
            ))}
          </Box>
        ) : null}
        {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
        <Box style={{ flexDirection: "row", gap: 1 }}>
          <ActionButton onPress={onBack}>Back</ActionButton>
          <ActionButton onPress={() => void validate()} primary>Validate</ActionButton>
        </Box>
      </Box>
    </Box>
  );
}

function severityColor(severity: SecuritySeverity) {
  if (severity === "critical" || severity === "high") return COLORS.error;
  if (severity === "medium" || severity === "low") return COLORS.warning;
  return COLORS.muted;
}

function AuditPanel({ onBack }: { onBack: () => void }) {
  const [target, setTarget] = useState(".");
  const [failOn, setFailOn] = useState<SecuritySeverity>("high");
  const [result, setResult] = useState<SkillSecurityReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function audit() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      setResult(await auditSkillDirectory(target, { failOn }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Header title="Security audit" subtitle="Static scan only — skill instructions and bundled files are never executed" />
      <Field label="Skill directory" value={target} onChange={setTarget} autoFocus />
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <Text style={{ bold: true }}>Fail on</Text>
        {(["medium", "high", "critical"] as SecuritySeverity[]).map((severity) => (
          <ActionButton key={severity} onPress={() => setFailOn(severity)} primary={failOn === severity}>{severity}</ActionButton>
        ))}
      </Box>
      <ScrollView style={{ flexGrow: 1, minHeight: 0, bg: COLORS.panel, padding: 1 }}>
        {result ? (
          <Box style={{ gap: 1 }}>
            <Text style={{ bold: true, color: result.passed ? COLORS.success : COLORS.error }}>
              {result.passed ? "PASS" : "FAIL"} · {result.findings.length} finding{result.findings.length === 1 ? "" : "s"} · threshold {result.failOn}
            </Text>
            {result.findings.length === 0 ? <Text style={{ color: COLORS.success }}>✓ No suspicious patterns found</Text> : result.findings.map((finding, index) => (
              <Box key={`${finding.path}-${finding.line ?? 0}-${finding.code}-${index}`} style={{ gap: 0 }}>
                <Text style={{ bold: true, color: severityColor(finding.severity) }}>{finding.severity.toUpperCase()} · {finding.code}</Text>
                <Text>{finding.path}{finding.line ? `:${finding.line}` : ""} · {finding.message}</Text>
                <Text style={{ color: COLORS.muted }}>{finding.recommendation}</Text>
              </Box>
            ))}
            {result.suppressions.length > 0 ? <Text style={{ color: COLORS.muted }}>{result.suppressions.length} documented suppression{result.suppressions.length === 1 ? "" : "s"}</Text> : null}
          </Box>
        ) : <Text style={{ color: COLORS.muted }}>Detects instruction hijacking, secret access, exfiltration, unsafe shell, dynamic execution, suspicious Unicode, and package escape paths.</Text>}
      </ScrollView>
      {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <ActionButton onPress={onBack}>Back</ActionButton>
        <ActionButton onPress={() => void audit()} primary disabled={loading}>{loading ? "Scanning…" : "Audit"}</ActionButton>
      </Box>
    </Box>
  );
}

function CheckPanel({ onBack }: { onBack: () => void }) {
  const [target, setTarget] = useState("");
  const [strict, setStrict] = useState(true);
  const [result, setResult] = useState<CheckSkillsReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function check() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      setResult(await checkSkills(target.trim() ? [target.trim()] : [], { strict, failOn: "high" }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Header title="Repository gate" subtitle="Validate, lint, and audit every discovered skill exactly as CI will" />
      <Field label="Path" hint="optional; auto-discovers conventional skill roots" value={target} onChange={setTarget} autoFocus />
      <Checkbox checked={strict} onChange={setStrict} label="Strict authoring lint" focusedStyle={{ color: COLORS.accent }} />
      <ScrollView style={{ flexGrow: 1, minHeight: 0, bg: COLORS.panel, padding: 1 }}>
        {result ? (
          <Box style={{ gap: 1 }}>
            <Text style={{ bold: true, color: result.passed ? COLORS.success : COLORS.error }}>
              {result.passed ? "PASS" : "FAIL"} · {result.summary.skills} skill{result.summary.skills === 1 ? "" : "s"}
            </Text>
            {result.skills.map((skill) => (
              <Box key={skill.path} style={{ gap: 0 }}>
                <Text style={{ bold: true, color: skill.passed ? COLORS.success : COLORS.error }}>{skill.passed ? "✓" : "×"} {skill.path}</Text>
                <Text style={{ color: COLORS.muted }}>
                  validation {skill.validation.issues.filter((issue) => issue.severity === "error").length} errors · lint {skill.lint?.issues.filter((issue) => issue.severity === "error").length ?? 0} · security {skill.security.findings.length}
                </Text>
              </Box>
            ))}
            {result.summary.skills === 0 ? <Text style={{ color: COLORS.error }}>No skills found; an empty gate fails.</Text> : null}
          </Box>
        ) : <Text style={{ color: COLORS.muted }}>Looks in .agents/skills, .claude/skills, and .codex/skills when no path is supplied.</Text>}
      </ScrollView>
      {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <ActionButton onPress={onBack}>Back</ActionButton>
        <ActionButton onPress={() => void check()} primary disabled={loading}>{loading ? "Checking…" : "Run gate"}</ActionButton>
      </Box>
    </Box>
  );
}

function RegistryPanel({ onBack }: { onBack: () => void }) {
  const [source, setSource] = useState("./registry");
  const [query, setQuery] = useState("");
  const [targetRoot, setTargetRoot] = useState("./.agents/skills");
  const [opened, setOpened] = useState<OpenedRegistry | null>(null);
  const [entries, setEntries] = useState<RegistrySkillVersion[]>([]);
  const [selected, setSelected] = useState(0);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");

  async function load() {
    setError("");
    setStatus("");
    try {
      const registry = await openRegistry(source, true);
      setOpened(registry);
      setEntries(searchRegistry(registry.manifest, query));
      setSelected(0);
      setPreview("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  function search(value: string) {
    setQuery(value);
    if (opened) {
      setEntries(searchRegistry(opened.manifest, value));
      setSelected(0);
      setPreview("");
    }
  }

  async function install() {
    const entry = entries[selected];
    if (!entry) return;
    setError("");
    setStatus("");
    try {
      const result = await installSkill({ registry: source, selector: `${entry.name}@${entry.version}`, targetRoot, force: replaceExisting });
      setStatus(`Installed ${result.name}@${result.version} → ${result.path}`);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  async function previewSelected() {
    const entry = entries[selected];
    if (!entry) return;
    setError("");
    try {
      const result = await inspectRegistrySkill(source, `${entry.name}@${entry.version}`);
      setPreview(result.skillMarkdown);
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Header title="Skill registry" subtitle="Browse a local folder or git-backed registry, verify checksums, install atomically" />
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <Box style={{ flexGrow: 1 }}><Field label="Registry" value={source} onChange={setSource} autoFocus /></Box>
        <Box style={{ width: 32 }}><Field label="Search" value={query} onChange={search} placeholder="name or description" /></Box>
      </Box>
      <Field label="Install to" value={targetRoot} onChange={setTargetRoot} />
      <Checkbox checked={replaceExisting} onChange={setReplaceExisting} label="Replace an existing installed copy" focusedStyle={{ color: COLORS.accent }} />
      <ScrollView style={{ flexGrow: 1, minHeight: 0, bg: COLORS.panel, padding: 1 }}>
        {preview ? (
          <Text>{preview}</Text>
        ) : entries.length > 0 ? (
          <Menu
            items={entries.map((entry) => ({ label: `${entry.name}@${entry.version}  ${entry.description}`, value: `${entry.name}@${entry.version}` }))}
            selectedIndex={selected}
            onSelectionChange={setSelected}
            onSelect={(_, index) => setSelected(index)}
            highlightColor="blueBright"
          />
        ) : <Text style={{ color: COLORS.muted }}>{opened ? "No matching skills" : "Load a registry to browse skills"}</Text>}
      </ScrollView>
      {status ? <Text style={{ color: COLORS.success }}>✓ {status}</Text> : null}
      {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
      <Box style={{ flexDirection: "row", gap: 1 }}>
        <ActionButton onPress={onBack}>Back</ActionButton>
        <ActionButton onPress={() => void load()}>Load</ActionButton>
        <ActionButton onPress={() => preview ? setPreview("") : void previewSelected()} disabled={!entries[selected]}>{preview ? "Hide preview" : "Preview"}</ActionButton>
        <ActionButton onPress={() => void install()} primary disabled={!entries[selected]}>Install selected</ActionButton>
      </Box>
    </Box>
  );
}

function Home({ onSelect }: { onSelect: (screen: Screen) => void }) {
  const { exit } = useApp();
  const spacious = useMediaQuery({ minColumns: 90, minRows: 28 });
  const items = [
    { label: "Create a skill       Guided package constructor", value: "new" },
    { label: "Trigger eval         Discovery precision / recall", value: "trigger" },
    { label: "Task challenge       Counterbalanced A/B + ROI verdict", value: "task" },
    { label: "Security audit       Static threat scan; no execution", value: "audit" },
    { label: "Repository gate      Validate + lint + security", value: "check" },
    { label: "Registry             Search and install skills", value: "registry" },
    { label: "Validate             Static package checks", value: "validate" },
    { label: "Quit", value: "quit" },
  ];
  return (
    <Box style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center", padding: spacious ? 2 : 1 }}>
      <Box style={{ width: spacious ? 78 : "100%", border: "round", borderColor: COLORS.accent, padding: spacious ? 2 : 1, gap: spacious ? 2 : 1 }}>
        <Box style={{ gap: 0 }}>
          <Text style={{ bold: true, color: COLORS.accent }}>SKILLBENCH</Text>
          <Text style={{ color: COLORS.muted }}>behavior → package → evidence → distribution</Text>
        </Box>
        <Menu items={items} onSelect={(value) => value === "quit" ? exit() : onSelect(value as Screen)} highlightColor="blueBright" />
        {spacious ? (
          <Box style={{ bg: COLORS.panel, padding: 1, gap: 0 }}>
            <Text>Trigger eval checks <Text style={{ color: COLORS.accent }}>when</Text> a skill loads.</Text>
            <Text>Task A/B checks <Text style={{ color: COLORS.accent }}>whether it improves the outcome</Text>.</Text>
            <Text>Audit + CI gate block suspicious or malformed packages before install.</Text>
          </Box>
        ) : <Text style={{ color: COLORS.muted }}>create · evaluate · validate · distribute</Text>}
        <Text style={{ color: COLORS.muted }}>↑/↓ or j/k navigate · Enter select · Ctrl+C quit</Text>
      </Box>
    </Box>
  );
}

export function HomeApp() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>("home");
  const [activeTrigger, setActiveTrigger] = useState<{ suite: TriggerEvalSuite; runner: CodexTriggerRunner } | null>(null);
  const [activeTask, setActiveTask] = useState<{ suite: TaskEvalSuite; runner: CodexTaskRunner; config: TaskRunConfig } | null>(null);

  if (activeTrigger) return <EvalApp suite={activeTrigger.suite} runner={activeTrigger.runner} concurrency={2} />;
  if (activeTask) return <TaskEvalApp suite={activeTask.suite} runner={activeTask.runner} concurrency={1} {...activeTask.config} />;
  if (screen === "new") return <App />;
  if (screen === "trigger") return <SetupPanel kind="trigger" onBack={() => setScreen("home")} onTrigger={(suite, runner) => setActiveTrigger({ suite, runner })} onTask={() => undefined} />;
  if (screen === "task") return <SetupPanel kind="task" onBack={() => setScreen("home")} onTrigger={() => undefined} onTask={(suite, runner, config) => setActiveTask({ suite, runner, config })} />;
  if (screen === "registry") return <RegistryPanel onBack={() => setScreen("home")} />;
  if (screen === "validate") return <ValidatePanel onBack={() => setScreen("home")} />;
  if (screen === "audit") return <AuditPanel onBack={() => setScreen("home")} />;
  if (screen === "check") return <CheckPanel onBack={() => setScreen("home")} />;
  return (
    <>
      <Home onSelect={setScreen} />
      <Keybind keypress="ctrl+c" onPress={() => exit()} priority />
    </>
  );
}
