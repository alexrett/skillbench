# Changelog

## 0.5.0 — 2026-08-06

- Add Claude Code as a first-class trigger-eval and task-challenge runner through `--runner claude` and the Glyph TUI.
- Parse Claude structured output, token usage, final responses, and Bash command traces without leaking labels or rubrics.
- Run Claude trigger evals with no tools and task evals with user customizations and native web tools disabled.
- Add actionable missing-binary, authentication, malformed-output, and timeout errors for Claude runs.
- Install registry skills into project or global Claude directories with `--agent claude`.
- Keep all deterministic construction, validation, lint, audit, registry, and CI workflows model- and license-independent.
- Document the weaker Claude task-network boundary and the expired-license live-test limitation honestly.

## 0.4.0 — 2026-08-05

- Add static skill-package vulnerability auditing with severity gates, narrow suppressions, package-escape detection, and registry enforcement.
- Add repository-wide `check` / `ci` commands and a reusable GitHub Action with JSON evidence reports.
- Split portable structural `validate` from opinionated authoring `lint`.
- Run faithful skill packages without leaking `evals/` into agent workspaces.
- Add repeated counterbalanced AB/BA challenges, score variance, latency and token ROI, command traces, and proven/efficient/redundant/harmful/inconclusive verdicts.
- Add negative file/output rubrics and command execution/exit-code rubrics.
- Extend the Glyph TUI with task challenge controls, security audit, and repository gate screens.
- Pin third-party Actions to immutable commit SHAs and publish CI evidence artifacts.
- Document an honest redundant dogfood result and the Polimat compatibility finding.
- Add a browser-evidence `responsive-release-proof` skill born from a real 390px overflow bug and publish its counterbalanced cost/quality result.

## 0.3.1 — 2026-08-05

- Publish releases through npm Trusted Publishing with GitHub Actions OIDC.
- Replace the condensed website headline stack with a wider, clearer type hierarchy.
- Bust the GitHub Pages stylesheet cache for the typography update.

## 0.3.0 — 2026-08-05

First public release.

- Guided Glyph TUI and headless JSON workflows for skill construction.
- Structural validation for portable Agent Skill packages.
- Trigger and near-miss evaluation.
- Isolated baseline-versus-skill task evaluation with deterministic rubrics.
- Versioned git/local registry with checksums and lockfile provenance.
- Cross-platform standalone release binaries.
- GitHub Pages documentation and npm distribution.
