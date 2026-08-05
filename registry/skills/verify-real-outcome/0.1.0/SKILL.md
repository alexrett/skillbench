---
name: verify-real-outcome
description: "Verify the real user-facing outcome after implementation. Use when a task includes a build, release, deployment, browser flow, runtime path, or deliverable that must be proven outside source code."
---

# Verify Real Outcome

Use this workflow to reach the stated outcome consistently. Keep the procedure proportional to the task and preserve explicit user control for consequential actions.

## Outcome

Prove that the implemented change works through the narrowest real user-facing acceptance path

## Process

1. Identify the observable user-facing outcome in the request
2. Choose the narrowest real runtime path that proves that outcome
3. Run implementation checks before touching the real acceptance path
4. Exercise the real path and capture direct evidence
5. Report any unverified boundary explicitly

## Done

Finish only when every applicable criterion is satisfied:

- The requested user-visible path succeeds
- The tested runtime or artifact corresponds to the implemented source
- The handoff names the verification performed and any remaining boundary
