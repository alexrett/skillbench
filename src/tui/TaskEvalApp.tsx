import React, { useEffect, useRef, useState } from "react";
import { Box, Keybind, Progress, ScrollView, Spinner, Text, useApp } from "@semos-labs/glyph";
import { runTaskEvals } from "../task-eval/run.ts";
import type {
  TaskCaseResult,
  TaskEvalReport,
  TaskEvalSuite,
  TaskRunner,
  TaskVariant,
  TaskVariantResult,
} from "../task-eval/types.ts";
import { ActionButton, COLORS } from "./components.tsx";

type VariantState =
  | { status: "pending" }
  | { status: "running" }
  | { status: "complete"; result: TaskVariantResult };

interface CaseState {
  baseline: VariantState;
  skill: VariantState;
  result?: TaskCaseResult;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function VariantRow({ label, state }: { label: TaskVariant; state: VariantState }) {
  if (state.status === "pending") return <Text style={{ color: COLORS.muted }}>· {label}</Text>;
  if (state.status === "running") return <Box style={{ flexDirection: "row", gap: 1 }}><Spinner /><Text>{label}</Text></Box>;
  return (
    <Text style={{ color: state.result.score === 1 ? COLORS.success : COLORS.warning }}>
      {state.result.score === 1 ? "✓" : "!"} {label} · {percent(state.result.score)} · {state.result.execution.durationMs}ms
    </Text>
  );
}

export function TaskEvalApp({
  suite,
  runner,
  concurrency,
  limit,
  keepWorkspaces,
}: {
  suite: TaskEvalSuite;
  runner: TaskRunner;
  concurrency: number;
  limit?: number;
  keepWorkspaces?: boolean;
}) {
  const { exit } = useApp();
  const cases = suite.cases.slice(0, limit);
  const [states, setStates] = useState<CaseState[]>(cases.map(() => ({ baseline: { status: "pending" }, skill: { status: "pending" } })));
  const [report, setReport] = useState<TaskEvalReport | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);
  const completedVariants = states.reduce((sum, state) => sum + Number(state.baseline.status === "complete") + Number(state.skill.status === "complete"), 0);
  const totalVariants = cases.length * 2;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runTaskEvals(suite, runner, {
      concurrency,
      limit,
      keepWorkspaces,
      onEvent(event) {
        setStates((current) => current.map((state, index) => {
          if (index !== event.index) return state;
          if (event.type === "variant-start") return { ...state, [event.variant]: { status: "running" } };
          if (event.type === "variant-complete") return { ...state, [event.result.variant]: { status: "complete", result: event.result } };
          if (event.type === "case-complete") return { ...state, result: event.result };
          return state;
        }));
      },
    }).then(setReport).catch((caught) => setError((caught as Error).message));
  }, [suite, runner, concurrency, limit, keepWorkspaces]);

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ bold: true }}>Skillbench Task A/B</Text>
        <Text style={{ color: COLORS.muted }}>{runner.name}{runner.model ? ` · ${runner.model}` : ""}</Text>
      </Box>
      <Box style={{ gap: 0 }}>
        <Text style={{ bold: true, color: COLORS.accent }}>{suite.skillName}</Text>
        <Text style={{ color: COLORS.muted }}>baseline → skill · rubric hidden from both runs</Text>
      </Box>
      <Progress value={totalVariants === 0 ? 0 : completedVariants / totalVariants} showPercent label={`${completedVariants}/${totalVariants}`} />
      <ScrollView style={{ flexGrow: 1, minHeight: 0, bg: COLORS.panel, padding: 1 }}>
        <Box style={{ gap: 1 }}>
          {cases.map((evalCase, index) => {
            const state = states[index];
            if (!state) return null;
            return (
              <Box key={evalCase.id} style={{ gap: 0 }}>
                <Text style={{ bold: true }}>{evalCase.id} · {evalCase.prompt}</Text>
                <VariantRow label="baseline" state={state.baseline} />
                <VariantRow label="skill" state={state.skill} />
                {state.result ? (
                  <Text style={{ color: state.result.passed ? COLORS.success : COLORS.error }}>
                    {state.result.passed ? "PASS" : "FAIL"} · delta {state.result.delta >= 0 ? "+" : ""}{percent(state.result.delta)}
                  </Text>
                ) : null}
                {state.result?.skill.rubric.filter((entry) => !entry.passed).map((entry) => (
                  <Text key={entry.id} style={{ color: COLORS.error }}>  × {entry.description}: {entry.diagnostic}</Text>
                ))}
              </Box>
            );
          })}
        </Box>
      </ScrollView>
      {error ? <Text style={{ color: COLORS.error }}>× {error}</Text> : null}
      {report ? (
        <Box style={{ border: "round", borderColor: report.passed ? COLORS.success : COLORS.error, padding: 1, gap: 0 }}>
          <Text style={{ bold: true, color: report.passed ? COLORS.success : COLORS.error }}>{report.passed ? "PASS" : "FAIL"}</Text>
          <Text>baseline {percent(report.metrics.averageBaselineScore)} · skill {percent(report.metrics.averageSkillScore)} · delta {report.metrics.averageDelta >= 0 ? "+" : ""}{percent(report.metrics.averageDelta)}</Text>
          <Text style={{ color: COLORS.muted }}>improved {report.metrics.improved} · unchanged {report.metrics.unchanged} · regressed {report.metrics.regressed}</Text>
          <ActionButton onPress={() => exit()}>Exit</ActionButton>
        </Box>
      ) : null}
      <Text style={{ color: COLORS.muted }}>Rubric and baseline output are never included in agent prompts.</Text>
      <Keybind keypress="ctrl+c" onPress={() => exit()} priority />
      <Keybind keypress="q" onPress={() => (report || error) ? exit() : undefined} priority />
    </Box>
  );
}
