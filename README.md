# Skillbench

[![CI](https://github.com/alexrett/skillbench/actions/workflows/ci.yml/badge.svg)](https://github.com/alexrett/skillbench/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/skillbench-cli)](https://www.npmjs.com/package/skillbench-cli)
[![MIT](https://img.shields.io/badge/license-MIT-dfff00)](LICENSE)

Turn repeated agent failures into portable, tested Agent Skills.

Skillbench is a local-first CLI and [Glyph](https://github.com/semos-labs/glyph) TUI for constructing `SKILL.md` packages, validating their shape, testing discovery boundaries, comparing actual agent behavior against a baseline, and shipping immutable versions with checksums and lockfile provenance.

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
- an evaluation can accidentally leak its own expected answer;
- copied packages lose version and provenance;
- a successful fix stays trapped in one conversation instead of becoming reusable behavior.

Skillbench makes that loop explicit:

```text
repeated failure or success
          │
          ▼
guided construction ──► static validation ──► trigger / near-miss eval
                                                      │
                                                      ▼
                                           baseline vs skill task eval
                                                      │
                                                      ▼
                                      version + checksum + lockfile
```

## Five-minute workflow

```bash
# Open the guided workbench
skillbench new

# Or generate from a JSON brief
skillbench build ./brief.json --out ./.agents/skills/release-check

# Validate the package
skillbench validate ./.agents/skills/release-check

# Test when the skill should and should not be discovered
skillbench eval ./.agents/skills/release-check

# Run the same fixture with and without the skill
skillbench eval ./.agents/skills/release-check --task
```

Interactive terminals receive live Glyph dashboards. `--plain` and `--json` provide stable headless output where supported.

## Generated package

```text
release-check/
├── SKILL.md
├── agents/
│   └── openai.yaml
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

Neither run receives the rubric, expected score, or other run's output. The skill run receives `SKILL.md`; the baseline does not.

Current deterministic rubric checks:

- `file-exists`
- `file-contains`
- `json-equals`
- `final-contains`

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

`registry.yaml` indexes immutable `name@version` directories. Every entry includes SHA-256 over its normalized file tree. Installation validates the package, verifies the checksum, stages a copy, then renames it into place. `.skillbench-lock.yaml` records source, version, checksum, and installation time.

A checksum detects corruption or a package changed behind its manifest. It is not a signature and does not establish that a registry maintainer is trustworthy.

## Alternatives and fit

Skillbench is an authoring-and-evidence workbench, not a replacement for the ecosystem around it.

| Tool | Best at | Where Skillbench differs |
| --- | --- | --- |
| A hand-written `SKILL.md` | Maximum freedom and zero tooling | Adds guided construction, validation, evals, and version provenance |
| [`npx skills`](https://github.com/vercel-labs/skills) | Discovering and installing skills across many agent harnesses | Skillbench focuses on proving a skill before distribution; the two work together |
| [SkillsBench](https://github.com/benchflow-ai/skillsbench) | Research-scale gym benchmarking of skill effectiveness and agent behavior | Skillbench is a day-to-day local workflow for one skill and its fixtures |
| [`skill-eval`](https://github.com/effectorHQ/skill-eval) | Static structural quality analysis | Skillbench also runs trigger boundaries and isolated baseline-versus-skill tasks |
| [`mattpocock/skills`](https://github.com/mattpocock/skills) | A real, composable collection of production engineering skills | It is a skill collection and inspiration; Skillbench is tooling for building and testing your own |

Skillbench intentionally does **not** provide hosted accounts, ratings, a marketplace, or multi-agent installation. Create and prove with Skillbench, then publish standard Agent Skills and install them with the ecosystem tool your team already uses.

## Security boundary

Task evaluation executes agent instructions and local commands. Treat a skill under evaluation as executable input: inspect it first and use a disposable machine or stronger external sandbox for hostile packages.

Skillbench disables workspace network access for Codex task runs, but a workspace sandbox is a safety layer rather than proof that arbitrary third-party instructions are harmless. See [SECURITY.md](SECURITY.md) for reporting.

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
