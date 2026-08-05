import React, { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  Keybind,
  Radio,
  ScrollView,
  Text,
  useApp,
  useMediaQuery,
} from "@semos-labs/glyph";
import { generateSkillMarkdown, writeSkillPackage } from "../generate.ts";
import {
  defaultOutputPath,
  EMPTY_DRAFT,
  joinLines,
  normalizeSkillName,
  splitLines,
  titleFromName,
  type SkillDraft,
  type SourceKind,
} from "../model.ts";
import { validateSkillDirectory, type ValidationIssue } from "../validate.ts";
import { ActionButton, COLORS, Field, StepActions } from "./components.tsx";

const STEPS = ["Identity", "Scenario", "Triggers", "Process", "Review"] as const;

interface AppProps {
  initialOutputPath?: string;
}

function StepRail({ current }: { current: number }) {
  return (
    <Box style={{ width: 20, flexShrink: 0, paddingRight: 2, gap: 1 }}>
      <Text style={{ bold: true, color: COLORS.accent }}>SKILLBENCH</Text>
      <Text style={{ color: COLORS.muted }}>behavior → package</Text>
      <Box style={{ paddingTop: 1, gap: 0 }}>
        {STEPS.map((label, index) => (
          <Text
            key={label}
            style={index === current
              ? { color: COLORS.accent, bold: true }
              : index < current
                ? { color: COLORS.success }
                : { color: COLORS.muted }}
          >
            {index < current ? "✓" : String(index + 1).padStart(2, "0")} {label}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

function CompactProgress({ current }: { current: number }) {
  return (
    <Box style={{ flexDirection: "row", justifyContent: "space-between", paddingBottom: 1 }}>
      <Text style={{ bold: true, color: COLORS.accent }}>{String(current + 1).padStart(2, "0")} {STEPS[current]}</Text>
      <Text style={{ color: COLORS.muted }}>{current + 1}/{STEPS.length}</Text>
    </Box>
  );
}

function Preview({ draft, compact = false }: { draft: SkillDraft; compact?: boolean }) {
  const preview = generateSkillMarkdown({
    ...draft,
    name: normalizeSkillName(draft.name) || "new-skill",
    displayName: draft.displayName || titleFromName(draft.name || "new-skill"),
    description: draft.description || "Describe what this skill does and when to use it.",
    desiredOutcome: draft.desiredOutcome || "State the observable outcome.",
  });
  const lines = preview.split("\n").slice(0, compact ? 12 : 28);

  return (
    <Box style={{ width: compact ? "100%" : 48, flexShrink: 0, bg: COLORS.panel, padding: 1, gap: 1 }}>
      <Box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ bold: true }}>SKILL.md</Text>
        <Text style={{ color: COLORS.muted }}>{preview.split("\n").length} lines</Text>
      </Box>
      <Text style={{ color: "#CAD3F5" }}>{lines.join("\n")}</Text>
    </Box>
  );
}

function IdentityStep({ draft, update, next }: StepProps) {
  const updateName = (value: string) => {
    const previousDefault = defaultOutputPath(draft.name);
    const normalized = normalizeSkillName(value);
    update({
      name: normalized,
      displayName: !draft.displayName || draft.displayName === titleFromName(draft.name)
        ? titleFromName(normalized)
        : draft.displayName,
      outputPath: !draft.outputPath || draft.outputPath === previousDefault
        ? defaultOutputPath(normalized)
        : draft.outputPath,
    });
  };

  const ready = Boolean(draft.name && draft.displayName && draft.description);
  return (
    <Box style={{ gap: 1 }}>
      <Text style={{ bold: true }}>Name the behavior</Text>
      <Text style={{ color: COLORS.muted }}>Keep the skill narrow. Its description is the trigger surface.</Text>
      <Field label="Name" hint="lowercase-hyphenated" value={draft.name} onChange={updateName} placeholder="verify-real-outcome" autoFocus />
      <Field label="Display name" value={draft.displayName} onChange={(displayName) => update({ displayName })} placeholder="Verify real outcome" />
      <Field
        label="Description"
        hint="what it does + when to use it"
        value={draft.description}
        onChange={(description) => update({ description })}
        placeholder="Verify the real user-facing outcome. Use when a task has a build, release, or runtime acceptance path."
        multiline
        height={3}
      />
      <StepActions canGoBack={false} onBack={() => undefined} onNext={next} nextLabel={ready ? "Continue" : "Complete fields"} disabled={!ready} />
    </Box>
  );
}

function ScenarioStep({ draft, update, back, next }: StepProps) {
  const ready = Boolean(draft.scenario && draft.desiredOutcome && draft.verification);
  return (
    <Box style={{ gap: 1 }}>
      <Text style={{ bold: true }}>Start from evidence</Text>
      <Radio
        items={[
          { label: "Agent failure", value: "failure" as SourceKind },
          { label: "Successful session", value: "success" as SourceKind },
          { label: "Existing process", value: "process" as SourceKind },
        ]}
        value={draft.sourceKind}
        onChange={(sourceKind) => update({ sourceKind })}
        direction="row"
        gap={2}
        focusedItemStyle={{ color: COLORS.accent }}
        selectedItemStyle={{ bold: true }}
      />
      <Field label="Concrete case" value={draft.scenario} onChange={(scenario) => update({ scenario })} multiline height={3} autoFocus placeholder="What happened? Where did the agent diverge?" />
      <Field label="Desired outcome" value={draft.desiredOutcome} onChange={(desiredOutcome) => update({ desiredOutcome })} multiline height={2} placeholder="What must be true when the skill succeeds?" />
      <Field label="Verification" value={draft.verification} onChange={(verification) => update({ verification })} multiline height={2} placeholder="Which command, artifact, or observation proves it?" />
      <StepActions canGoBack onBack={back} onNext={next} nextLabel={ready ? "Continue" : "Complete fields"} disabled={!ready} />
    </Box>
  );
}

function TriggerStep({ draft, update, back, next }: StepProps) {
  const ready = draft.positiveTriggers.length >= 3 && draft.negativeTriggers.length >= 3;
  return (
    <Box style={{ gap: 1 }}>
      <Text style={{ bold: true }}>Draw the invocation boundary</Text>
      <Text style={{ color: COLORS.muted }}>Use real prompts. Three matches and three near-misses make the first useful test set.</Text>
      <Field
        label="Should trigger"
        hint="one prompt per line"
        value={joinLines(draft.positiveTriggers)}
        onChange={(value) => update({ positiveTriggers: splitLines(value) })}
        multiline
        height={5}
        autoFocus
        placeholder={"Verify the deployed checkout flow\nFinish the release and prove it works\nCheck the actual user-facing result"}
      />
      <Field
        label="Should not trigger"
        hint="near-misses"
        value={joinLines(draft.negativeTriggers)}
        onChange={(value) => update({ negativeTriggers: splitLines(value) })}
        multiline
        height={5}
        placeholder={"Explain how the build works\nReview this deployment plan\nWhat does acceptance testing mean?"}
      />
      <StepActions canGoBack onBack={back} onNext={next} nextLabel={ready ? "Continue" : "Add 3 + 3 cases"} disabled={!ready} />
    </Box>
  );
}

function ProcessStep({ draft, update, back, next }: StepProps) {
  const ready = draft.processSteps.length > 0 && draft.doneCriteria.length > 0;
  return (
    <Box style={{ gap: 1 }}>
      <Text style={{ bold: true }}>Encode only the behavior delta</Text>
      <Text style={{ color: COLORS.muted }}>One imperative step per line. Put the strongest observable gate in Done.</Text>
      <Field
        label="Process"
        hint="one step per line"
        value={joinLines(draft.processSteps)}
        onChange={(value) => update({ processSteps: splitLines(value) })}
        multiline
        height={7}
        autoFocus
        placeholder={"Inspect the real acceptance path\nRun the narrowest relevant checks\nExercise the user-visible workflow\nRecord evidence"}
      />
      <Field
        label="Done criteria"
        hint="one check per line"
        value={joinLines(draft.doneCriteria)}
        onChange={(value) => update({ doneCriteria: splitLines(value) })}
        multiline
        height={4}
        placeholder={"The user-visible flow succeeds\nThe artifact matches the tested source\nNo unresolved failure is hidden"}
      />
      <StepActions canGoBack onBack={back} onNext={next} nextLabel={ready ? "Review" : "Add process + done"} disabled={!ready} />
    </Box>
  );
}

function ReviewStep({ draft, update, back, onBuild, building }: StepProps & { onBuild: () => void; building: boolean }) {
  const [confirmed, setConfirmed] = useState(false);
  return (
    <Box style={{ gap: 1 }}>
      <Text style={{ bold: true }}>Build the portable package</Text>
      <Field label="Output directory" value={draft.outputPath} onChange={(outputPath) => update({ outputPath })} autoFocus />
      <Box style={{ bg: COLORS.panel, padding: 1, gap: 0 }}>
        <Text><Text style={{ color: COLORS.muted }}>skill </Text>{draft.name}</Text>
        <Text><Text style={{ color: COLORS.muted }}>triggers </Text>{draft.positiveTriggers.length} positive / {draft.negativeTriggers.length} near-miss</Text>
        <Text><Text style={{ color: COLORS.muted }}>process </Text>{draft.processSteps.length} steps / {draft.doneCriteria.length} done checks</Text>
        <Text><Text style={{ color: COLORS.muted }}>files </Text>SKILL.md · agents/openai.yaml · evals/cases.yaml</Text>
      </Box>
      <Checkbox
        checked={confirmed}
        onChange={setConfirmed}
        label="I reviewed the trigger boundary and completion criteria"
        focusedStyle={{ color: COLORS.accent }}
      />
      <Box style={{ flexDirection: "row", gap: 1, paddingTop: 1 }}>
        <ActionButton onPress={back}>Back</ActionButton>
        <ActionButton onPress={onBuild} primary disabled={!confirmed || building || !draft.outputPath}>{building ? "Building…" : confirmed ? "Build skill" : "Confirm first"}</ActionButton>
      </Box>
    </Box>
  );
}

interface StepProps {
  draft: SkillDraft;
  update: (patch: Partial<SkillDraft>) => void;
  back: () => void;
  next: () => void;
}

function Issues({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) return <Text style={{ color: COLORS.success }}>✓ No validation issues</Text>;
  return (
    <Box style={{ gap: 0 }}>
      {issues.map((entry) => (
        <Text key={`${entry.code}-${entry.message}`} style={{ color: entry.severity === "error" ? COLORS.error : COLORS.warning }}>
          {entry.severity === "error" ? "×" : "!"} {entry.message}
        </Text>
      ))}
    </Box>
  );
}

export function App({ initialOutputPath }: AppProps) {
  const { exit } = useApp();
  const isWide = useMediaQuery({ minColumns: 112 });
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SkillDraft>({ ...EMPTY_DRAFT, outputPath: initialOutputPath ?? "" });
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<{ path: string; issues: ValidationIssue[] } | null>(null);
  const [error, setError] = useState("");
  const update = (patch: Partial<SkillDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const currentStep = useMemo(() => {
    const props: StepProps = {
      draft,
      update,
      back: () => setStep((value) => Math.max(0, value - 1)),
      next: () => setStep((value) => Math.min(STEPS.length - 1, value + 1)),
    };
    if (step === 0) return <IdentityStep {...props} />;
    if (step === 1) return <ScenarioStep {...props} />;
    if (step === 2) return <TriggerStep {...props} />;
    if (step === 3) return <ProcessStep {...props} />;
    return <ReviewStep {...props} building={building} onBuild={() => void build()} />;
  }, [draft, step, building]);

  async function build() {
    if (building) return;
    setBuilding(true);
    setError("");
    try {
      const target = await writeSkillPackage(draft, draft.outputPath || defaultOutputPath(draft.name));
      const validation = await validateSkillDirectory(target);
      setResult({ path: target, issues: validation.issues });
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBuilding(false);
    }
  }

  if (result) {
    return (
      <Box style={{ width: "100%", height: "100%", justifyContent: "center", alignItems: "center", padding: 2 }}>
        <Box style={{ width: 74, border: "round", borderColor: COLORS.success, padding: 2, gap: 1 }}>
          <Text style={{ bold: true, color: COLORS.success }}>Skill package built</Text>
          <Text>{result.path}</Text>
          <Issues issues={result.issues} />
          <Text style={{ color: COLORS.muted }}>Run: skillbench validate {result.path}</Text>
          <ActionButton onPress={() => exit()}>Exit</ActionButton>
        </Box>
        <Keybind keypress="ctrl+c" onPress={() => exit()} priority />
      </Box>
    );
  }

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Box style={{ flexDirection: "row", justifyContent: "space-between", paddingBottom: 1 }}>
        <Text style={{ bold: true }}>Skillbench</Text>
        <Text style={{ color: COLORS.muted }}>local draft · Ctrl+C quit</Text>
      </Box>
      {isWide ? (
        <Box style={{ flexDirection: "row", flexGrow: 1, minHeight: 0, gap: 2 }}>
          <StepRail current={step} />
          <ScrollView style={{ flexGrow: 1, minWidth: 0, paddingRight: 1 }}>
            {currentStep}
            {error ? <Text style={{ color: COLORS.error, paddingTop: 1 }}>× {error}</Text> : null}
          </ScrollView>
          <Preview draft={draft} />
        </Box>
      ) : (
        <Box style={{ flexGrow: 1, minHeight: 0 }}>
          <CompactProgress current={step} />
          <ScrollView style={{ flexGrow: 1, minHeight: 0 }}>
            {currentStep}
            {error ? <Text style={{ color: COLORS.error, paddingTop: 1 }}>× {error}</Text> : null}
            {step === 4 ? <Preview draft={draft} compact /> : null}
          </ScrollView>
        </Box>
      )}
      <Text style={{ color: COLORS.muted }}>Tab navigate · Enter/Space activate · multiline fields keep Enter</Text>
      <Keybind keypress="ctrl+c" onPress={() => exit()} priority />
    </Box>
  );
}
