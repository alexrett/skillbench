import React, { useEffect, useRef, useState } from "react";
import { Box, Keybind, Progress, ScrollView, Spinner, Text, useApp } from "@semos-labs/glyph";
import { runTriggerEvals } from "../eval/run.ts";
import type {
  TriggerCaseResult,
  TriggerEvalReport,
  TriggerEvalSuite,
  TriggerRunner,
} from "../eval/types.ts";
import { ActionButton, COLORS } from "./components.tsx";

type CaseState =
  | { status: "pending" }
  | { status: "running" }
  | { status: "complete"; result: TriggerCaseResult };

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function EvalApp({
  suite,
  runner,
  concurrency,
  limit,
}: {
  suite: TriggerEvalSuite;
  runner: TriggerRunner;
  concurrency: number;
  limit?: number;
}) {
  const { exit } = useApp();
  const cases = suite.cases.slice(0, limit);
  const [states, setStates] = useState<CaseState[]>(cases.map(() => ({ status: "pending" })));
  const [report, setReport] = useState<TriggerEvalReport | null>(null);
  const [error, setError] = useState("");
  const started = useRef(false);
  const complete = states.filter((entry) => entry.status === "complete").length;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void runTriggerEvals(suite, runner, {
      concurrency,
      limit,
      onEvent(event) {
        setStates((current) => current.map((state, index) => {
          if (index !== event.index) return state;
          if (event.type === "case-start") return { status: "running" };
          return { status: "complete", result: event.result };
        }));
      },
    }).then(setReport).catch((caught) => setError((caught as Error).message));
  }, [suite, runner, concurrency, limit]);

  return (
    <Box style={{ width: "100%", height: "100%", padding: 1, gap: 1 }}>
      <Box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ bold: true }}>Skillbench Eval</Text>
        <Text style={{ color: COLORS.muted }}>{runner.name}{runner.model ? ` · ${runner.model}` : ""}</Text>
      </Box>
      <Box style={{ gap: 0 }}>
        <Text style={{ bold: true, color: COLORS.accent }}>{suite.skillName}</Text>
        <Text style={{ color: COLORS.muted }}>{suite.description}</Text>
      </Box>
      <Progress value={cases.length === 0 ? 0 : complete / cases.length} showPercent label={`${complete}/${cases.length}`} />
      <ScrollView style={{ flexGrow: 1, minHeight: 0, bg: COLORS.panel, padding: 1 }}>
        <Box style={{ gap: 1 }}>
          {cases.map((evalCase, index) => {
            const state = states[index];
            const expected = evalCase.shouldTrigger ? "trigger" : "skip";
            if (!state || state.status === "pending") {
              return <Text key={evalCase.id} style={{ color: COLORS.muted }}>· {evalCase.id} [{expected}] {evalCase.prompt}</Text>;
            }
            if (state.status === "running") {
              return <Box key={evalCase.id} style={{ flexDirection: "row", gap: 1 }}><Spinner /><Text>{evalCase.id} [{expected}] {evalCase.prompt}</Text></Box>;
            }
            return (
              <Box key={evalCase.id} style={{ gap: 0 }}>
                <Text style={{ color: state.result.passed ? COLORS.success : COLORS.error }}>
                  {state.result.passed ? "✓" : "×"} {evalCase.id} [{expected}] {evalCase.prompt}
                </Text>
                <Text style={{ color: COLORS.muted }}>  model: {state.result.decision.trigger ? "trigger" : "skip"} · confidence {percent(state.result.decision.confidence)} · {state.result.decision.durationMs}ms</Text>
                {!state.result.passed ? <Text style={{ color: COLORS.warning }}>  {state.result.decision.rationale}</Text> : null}
              </Box>
            );
          })}
        </Box>
      </ScrollView>
      {report ? (
        <Box style={{ border: "round", borderColor: report.passed ? COLORS.success : COLORS.error, paddingX: 1 }}>
          <Text style={{ bold: true, color: report.passed ? COLORS.success : COLORS.error }}>{report.passed ? "PASS" : "FAIL"}</Text>
          <Text>accuracy {percent(report.metrics.accuracy)} · precision {percent(report.metrics.precision)} · recall {percent(report.metrics.recall)} · specificity {percent(report.metrics.specificity)}</Text>
          <ActionButton onPress={() => exit(report.passed ? 0 : 1)}>Exit</ActionButton>
        </Box>
      ) : error ? (
        <Box style={{ border: "round", borderColor: COLORS.error, padding: 1 }}>
          <Text style={{ color: COLORS.error }}>Eval failed</Text>
          <Text>{error}</Text>
          <ActionButton onPress={() => exit(1)}>Exit</ActionButton>
        </Box>
      ) : (
        <Text style={{ color: COLORS.muted }}>Expected labels are held by Skillbench and are never included in evaluator prompts.</Text>
      )}
      <Text style={{ color: COLORS.muted }}>q exit after completion · Ctrl+C abort</Text>
      <Keybind keypress="q" onPress={() => report || error ? exit(report?.passed ? 0 : 1) : undefined} />
      <Keybind keypress="ctrl+c" onPress={() => exit(130)} priority />
    </Box>
  );
}
