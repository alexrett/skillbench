# Skillbench

[![CI](https://github.com/alexrett/skillbench/actions/workflows/ci.yml/badge.svg)](https://github.com/alexrett/skillbench/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillbench-cli)](https://www.npmjs.com/package/skillbench-cli)
[![MIT](https://img.shields.io/badge/license-MIT-dfff00)](LICENSE)

Turn repeated agent failures into portable, tested Agent Skills.

Skillbench is a local-first CLI and [Glyph](https://github.com/semos-labs/glyph) TUI for constructing `SKILL.md` packages, validating their portable shape, auditing suspicious instructions, testing discovery boundaries, challenging actual agent behavior against a baseline, and shipping immutable versions with checksums and lockfile provenance.

**[Website](https://alexrett.github.io/skillbench/)** · **[npm](https://www.npmjs.com/package/skillbench-cli)** · **[Releases](https://github.com/alexrett/skillbench/releases)**

## Install

Skillbench's npm CLI requires [Bun 1.2+](https://bun.sh/).

```bash
npm install -g skillbench-cli
skillbench
```

Or run it without a global install:

```bash
bunx skillbench-cli --version
```

Standalone macOS, Linux, and Windows executables are attached to every [GitHub release](https://github.com/alexrett/skillbench/releases) and do not require Bun at runtime.

## Why

A `SKILL.md` can read well and still fail in practice:

- its description may trigger too broadly or not trigger at all;
- its instructions may not improve the target task;
- a skill may be redundant, slower, or actively harmful despite sounding useful;
- an evaluation can accidentally leak its own expected answer;
- an untrusted package can ask for secrets, sandbox bypasses, destructive commands, or concealed actions;
- copied packages lose version and provenance;
- a successful fix stays trapped in one conversation instead of becoming reusable behavior.

Skillbench makes that loop explicit:

```text
repeated failure or success
          │
          ▼
guided construction ──► portable validation ──► static security audit
                                                      │
                                                      ▼
                                           trigger / near-miss eval
                                                      │
                                                      ▼
                                      counterbalanced task challenge
                                                      │
                                                      ▼
                                   verdict + evidence + provenance
```

## Five-minute workflow

```bash
# Open the guided workbench
skillbench new

# Or generate from a JSON brief
skillbench build ./brief.json --out ./.agents/skills/release-check

# Validate portable compatibility, then apply stricter authoring rules
skillbench validate ./.agents/skills/release-check
skillbench lint ./.agents/skills/release-check

# Inspect suspicious instructions and bundled files without executing the skill
skillbench audit ./.agents/skills/release-check

# Test when the skill should and should not be discovered
skillbench eval ./.agents/skills/release-check

# Challenge the skill with repeated counterbalanced baseline/skill runs
skillbench challenge ./.agents/skills/release-check \
  --runs 3 --seed 17 --report .skillbench/evidence.json

# Gate every skill under conventional roots in CI
skillbench check --strict --fail-on high
```

Interactive terminals receive live Glyph dashboards. `--plain` and `--json` provide stable headless output where supported.

## Generated package

```text
release-check/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── scripts/                    # optional runtime resources
├── references/                 # optional runtime resources
├── assets/                     # optional runtime resources
└── evals/
    ├── cases.yaml               # trigger and near-miss cases
    ├── tasks.yaml               # optional behavior A/B contract
    └── fixtures/                # optional isolated workspaces
```

The `evals/` directory is a Skillbench extension. It does not change the portable skill semantics, and existing installers copy it as ordinary package content.

## What gets measured

### Trigger boundaries

Trigger evaluation gives the agent only the skill's name, description, and one user request. The `should_trigger` label stays inside the scorer.

```bash
skillbench eval ./.agents/skills/release-check
skillbench eval ./.agents/skills/release-check \
  --prompt "Finish the release" \
  --expect trigger
```

### Actual behavior

Task evaluation makes two fresh copies of one fixture:

```text
fixture ──► baseline workspace ──► deterministic rubric
        └─► skill workspace    ──► deterministic rubric
```

Neither run receives the rubric, expected score, or other run's output. The skill run receives a faithful copy of the runtime package, including `SKILL.md`, `scripts/`, `references/`, and `assets/`; `evals/` is deliberately excluded so hidden answers cannot leak through the installed skill. The baseline receives no skill.

Current deterministic rubric checks:

- `file-exists`
- `file-not-exists`
- `file-contains`
- `file-not-contains`
- `json-equals`
- `final-contains`
- `final-not-contains`
- `command-ran`
- `command-not-ran`
- `command-exit-code`

Example `evals/tasks.yaml`:

```yaml
version: 1
skill: release-check
thresholds:
  min_skill_score: 1
  min_delta: 0
cases:
  - id: release-evidence
    prompt: Finish the release and record verification.json.
    fixture: fixtures/release-evidence
    rubric:
      - id: evidence
        description: Runtime evidence was recorded
        type: file-contains
        path: verification.json
        value: READY
        weight: 1
```

Task runs use ephemeral `workspace-write` sandboxes. Trigger evaluators use empty, read-only workspaces. `--keep` preserves task workspaces for debugging; otherwise they are removed after scoring.

`skillbench challenge` defaults to three paired runs and counterbalances execution order (`AB/BA`) with a reproducible seed. Reports include score delta and variance, latency, token usage when the runner exposes it, command traces, and one deliberately opinionated verdict:

- `proven`: the skill improves the deterministic outcome;
- `efficient`: quality is not worse and cost drops materially;
- `redundant`: repeated runs show no quality improvement or material efficiency win;
- `harmful`: the skill lowers the score;
- `inconclusive`: the available evidence does not support a stronger claim.

Unlike `eval --task`, `challenge` exits non-zero for `redundant`, `harmful`, and `inconclusive`. This makes “the skill adds no value” a usable CI result instead of a buried metric.

## Repository gate

With no paths, `skillbench check` discovers `SKILL.md` packages under `.agents/skills`, `.claude/skills`, and `.codex/skills`. An empty repository gate fails instead of silently passing.

```yaml
name: Skills
on: [pull_request]

permissions:
  contents: read

jobs:
  skillbench:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: alexrett/skillbench@v0.4.0
        with:
          strict: "true"
          fail-on: high
          version: 0.4.0
          report: skillbench-report.json
```

For a hardened workflow, replace the Skillbench tag with the full release commit SHA and let Dependabot manage updates. The action keeps all caller-controlled values in environment variables, validates them before use, and runs an exact npm package version. The JSON report can be uploaded as a CI evidence artifact.

`validate` is intentionally portable: it rejects broken metadata, references, and eval contracts, but does not require Skillbench's preferred prose structure. `lint` adds the opinionated authoring contract such as `## Process` and `## Done`. This separation lets existing community skills enter the gate without being falsely labeled incompatible.

## Security audit

```bash
skillbench audit .agents/skills/release-check --fail-on high
skillbench audit .agents/skills/release-check --json --report audit.json
```

The scanner is static-only: it never executes the skill. It examines instructions and bundled files for instruction hijacking, concealed actions, credential access, download-to-shell patterns, destructive or privileged commands, sandbox weakening, likely exfiltration, dynamic execution, bidirectional Unicode controls, sensitive filenames, oversized text payloads, and symlinks that escape the package. Registry publication and installation re-run the high-severity gate.

False positives must be narrow and documented next to the reviewed line:

```html
<!-- skillbench-security: allow destructive-command -- documentation shows a forbidden example -->
```

A suppression applies only to the matching rule in the same file and the next two lines. The scanner is a heuristic preflight, not malware analysis, a signature, or proof that a skill is safe. Untrusted packages still belong in an external disposable sandbox.

## Versioned registry

Skillbench includes a deliberately small git/local registry for controlled teams:

```bash
skillbench registry init ./registry --name team-skills
skillbench registry add ./.agents/skills/release-check --registry ./registry --version 0.1.0
skillbench registry search release --registry ./registry
skillbench registry show release-check@0.1.0 --registry ./registry
skillbench registry doctor --registry ./registry
skillbench install release-check@0.1.0 --registry ./registry
skillbench installed --check
```

`registry.yaml` indexes immutable `name@version` directories. Every entry includes SHA-256 over its normalized file tree. Publication and installation validate the package, run the security gate, verify the checksum, stage a copy, then rename it into place. `.skillbench-lock.yaml` records source, version, checksum, and installation time.

A checksum detects corruption or a package changed behind its manifest. It is not a signature and does not establish that a registry maintainer is trustworthy.

## Alternatives and fit

Skillbench is an authoring-and-evidence workbench, not a replacement for the ecosystem around it.

| Tool | Best at | Where Skillbench differs |
| --- | --- | --- |
| A hand-written `SKILL.md` | Maximum freedom and zero tooling | Adds guided construction, validation, evals, and version provenance |
| [`npx skills`](https://github.com/vercel-labs/skills) | Discovering and installing skills across many agent harnesses | Skillbench focuses on proving a skill before distribution; the two work together |
| [SkillsBench](https://github.com/benchflow-ai/skillsbench) | Research-scale gym benchmarking of skill effectiveness and agent behavior | Skillbench is a day-to-day local workflow for one skill and its fixtures |
| [`skill-eval`](https://github.com/effectorHQ/skill-eval) | Static structural quality analysis | Skillbench also audits threats and runs repeated, isolated baseline-versus-skill tasks |
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | A real, composable collection of production engineering skills | It is a skill collection and inspiration; Skillbench is tooling for building and testing your own |

Skillbench intentionally does **not** provide hosted accounts, ratings, a marketplace, or multi-agent installation. Create and prove with Skillbench, then publish standard Agent Skills and install them with the ecosystem tool your team already uses.

## Honest dogfood

The first counterbalanced run against Skillbench's own `verify-real-outcome` example returned `REDUNDANT`: baseline and skill both scored 100% over two paired runs; the skill used about 3% fewer tokens but was about 7% slower, below the efficiency threshold. That is a successful product result and a failed skill hypothesis. The challenge command exits non-zero, so we must improve or delete the skill rather than advertise a cosmetic win. [Inspect the sanitized evidence](site/evidence/verify-real-outcome-v0.4.0.json).

On the Polimat repository, portable `validate` now accepts its existing `ticket` skill while strict `lint` separately reports the missing Skillbench-specific sections. That real compatibility failure is why validation and authoring style are no longer conflated.

The mobile overflow found while building this release became [`responsive-release-proof`](examples/generated/responsive-release-proof/SKILL.md). Its two-run counterbalanced challenge scored baseline 25%, skill 95%, average delta +70%, so the verdict was `PROVEN` in both orders. It also cost 26% more tokens and 45% more latency. That is why `challenge` is an evidence/release check, while the fast deterministic `check` command is the every-PR gate. [Inspect the sanitized evidence](site/evidence/responsive-release-proof-v0.4.0.json).

These are small local samples, not universal benchmark claims. Keep the fixtures, rubrics, seeds, and JSON reports reviewable.

## Security boundary

Run `skillbench audit` before any task evaluation. Task evaluation executes agent instructions and local commands, so a static pass is not permission to trust a hostile package. Skillbench disables workspace network access for Codex task runs, but a workspace sandbox is a safety layer rather than proof that arbitrary third-party instructions are harmless. See [SECURITY.md](SECURITY.md) for reporting and threat-model limitations.

## Development

```bash
git clone https://github.com/alexrett/skillbench.git
cd skillbench
bun install
bun run check
bun run site:check
```

Useful commands:

```bash
bun run src/cli.tsx              # workbench from source
bun run build                    # npm entrypoint
bun run build:binary             # current-platform executable
bun run build:release            # current release target
bun run site:serve               # local website on :4173
npm pack --dry-run               # inspect npm package contents
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before a substantial change.

## Release model

- Pull requests and `main` run typechecking, tests, dependency audit, package inspection, site checks, and binary smoke tests.
- `main` deploys the static site to GitHub Pages.
- A `v*` tag publishes the npm package through npm trusted publishing, builds five standalone targets, records SHA-256 checksums, and creates a GitHub release.

## License

[MIT](LICENSE)
