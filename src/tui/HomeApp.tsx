import React, { useState } from "react";
import { Box, Checkbox, Keybind, Menu, ScrollView, Text, useApp, useMediaQuery } from "@semos-labs/glyph";
import { CodexTriggerRunner } from "../eval/codex-runner.ts";
import { loadTriggerEvalSuite } from "../eval/load.ts";
import type { TriggerEvalSuite } from "../eval/types.ts";
import { inspectRegistrySkill, installSkill, openRegistry, searchRegistry } from "../registry/registry.ts";
import type { OpenedRegistry, RegistrySkillVersion } from "../registry/types.ts";
import { CodexTaskRunner } from "../task-eval/codex-runner.ts";
import { loadTaskEvalSuite } from "../task-eval/load.ts";
import type { TaskEvalSuite } from "../task-eval/types.ts";
import { validateSkillDirectory, type ValidationResult } from "../validate.ts";
import { App } from "./App.tsx";
import { ActionButton, COLORS, Field } from "./components.tsx";
import { EvalApp } from "./EvalApp.tsx";
import { TaskEvalApp } from "./TaskEvalApp.tsx";

type Screen = "home" | "new" | "trigger" | "task" | "registry" | "validate";

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
  onTask: (suite: TaskEvalSuite, runner: CodexTaskRunner) => void;
}) {
  const [target, setTarget] = useState(".");
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      if (kind === "trigger") {
        onTrigger(await loadTriggerEvalSuite(target), new CodexTriggerRunner({ model: model || undefined }));
      } else {
        onTask(await loadTaskEvalSuite(target), new CodexTaskRunner({ model: model || undefined }));
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
    { label: "Task A/B             Baseline vs skill artifacts", value: "task" },
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
            <Text>Registry ships only validated, checksummed packages.</Text>
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
  const [activeTask, setActiveTask] = useState<{ suite: TaskEvalSuite; runner: CodexTaskRunner } | null>(null);

  if (activeTrigger) return <EvalApp suite={activeTrigger.suite} runner={activeTrigger.runner} concurrency={2} />;
  if (activeTask) return <TaskEvalApp suite={activeTask.suite} runner={activeTask.runner} concurrency={1} />;
  if (screen === "new") return <App />;
  if (screen === "trigger") return <SetupPanel kind="trigger" onBack={() => setScreen("home")} onTrigger={(suite, runner) => setActiveTrigger({ suite, runner })} onTask={() => undefined} />;
  if (screen === "task") return <SetupPanel kind="task" onBack={() => setScreen("home")} onTrigger={() => undefined} onTask={(suite, runner) => setActiveTask({ suite, runner })} />;
  if (screen === "registry") return <RegistryPanel onBack={() => setScreen("home")} />;
  if (screen === "validate") return <ValidatePanel onBack={() => setScreen("home")} />;
  return (
    <>
      <Home onSelect={setScreen} />
      <Keybind keypress="ctrl+c" onPress={() => exit()} priority />
    </>
  );
}
