---
name: responsive-release-proof
description: "Prove a changed web surface at desktop and mobile before release. Use when a website, landing page, rendered frontend, or responsive CSS changed and the task includes final QA, deployment, release, or a claim that the user-visible page is ready."
---

# Responsive Release Proof

Use this workflow to prove the rendered surface, not merely its source or build. Keep the procedure proportional to the change.

## Outcome

produce browser-backed release evidence and fix responsive blockers instead of treating a passing build as proof

## Process

1. Name the exact page URL, primary interaction, and user-visible ready state before testing
2. Run the repository's static and build checks, but do not treat them as browser evidence
3. Open the actual built or served page in the available browser surface and verify URL, title, meaningful DOM, missing assets, and console warnings or errors; prefer the user's/browser plugin surface, then existing project browser tooling
4. At a normal desktop viewport, inspect the first viewport, the changed sections, and at least one primary interaction
5. At 390px or the requested mobile width, assert document scrollWidth equals innerWidth and inspect wrapping, clipping, overlap, navigation, and touch-sized controls
6. If horizontal overflow exists, project the bounding boxes of elements outside the viewport, fix the smallest root cause, reload, and repeat the identical measurement
7. Capture desktop and mobile screenshots plus the interaction state; report exact viewports, checks, fixes, and remaining browser or flow boundaries

## Evidence contract

Write `.skillbench/responsive-evidence.json` using [the bundled schema](references/evidence-schema.md). Create the directory when needed.

- Set `ready: true` only after a real rendered browser path proves every applicable gate.
- A source inspection, build, or static proxy may help locate a bug but is never browser evidence. Record it under `proxies`, keep `ready: false`, and name the browser gap in `remainingRisk`.
- Record measured values, not conclusions alone. For every mobile viewport include both `innerWidth` and `scrollWidth`.
- Keep screenshots outside the repository unless the task explicitly asks for committed artifacts; the evidence file may reference their temporary paths.

If `scrollWidth > innerWidth`, project a bounded list of elements whose rectangles cross the viewport edge. Fix the smallest root cause and repeat the same measurement after reload.

## Done

Finish only when every applicable criterion is satisfied:

- The actual local, staged, or released page has the expected URL, title, and meaningful rendered content
- No relevant console warning, framework overlay, missing asset, clipping, overlap, or horizontal viewport overflow remains
- At least one primary interaction has a directly observed state change
- Desktop and 390px mobile evidence correspond to the implementation being released
- The handoff names exact viewports, evidence, fixed blockers, and any untested browser or state
