# Skillbench

Private codename for a terminal workbench that turns repeated agent behavior into portable, testable Agent Skills.

The product has three jobs:

1. Construct a concise `SKILL.md` package from a real success, failure, or process.
2. Measure both discovery quality and actual task behavior instead of trusting the prose.
3. Move validated packages between projects without losing version or checksum provenance.

Skillbench is not intended to replace the open `skills` package manager. Generated packages are standard Agent Skills and work with `npx skills add`; the built-in registry is a deliberately small private catalog for dogfood and controlled teams.

## Install and run

From this checkout:

```bash
bun install
bun run build
bun run src/cli.tsx
```

The command without arguments opens the Glyph workbench. Keyboard: arrows or `j`/`k` navigate menus, `Tab` moves between fields, `Enter` or `Space` activates controls, and `Ctrl+C` exits.

Build a standalone executable that does not require Bun at runtime:

```bash
bun run build:binary
./dist/skillbench --version
```

Build and verify the npm package locally:

```bash
npm pack --pack-destination dist
npm install -g ./dist/skillbench-cli-0.3.0.tgz
skillbench --version
```

After an npm release, the intended commands are `npm install -g skillbench-cli` and `bunx skillbench-cli`. The package has not been published from this private repository yet.

## Workflows

```bash
# Guided constructor or headless generation
skillbench new
skillbench build ./brief.json --out ./.agents/skills/my-skill

# Static package checks
skillbench validate ./.agents/skills/my-skill

# Discovery boundary
skillbench eval ./.agents/skills/my-skill
skillbench eval ./.agents/skills/my-skill --prompt "Finish the release" --expect trigger

# Actual behavior: baseline versus skill
skillbench eval ./.agents/skills/my-skill --task

# Private versioned catalog
skillbench registry init ./registry --name team-skills
skillbench registry add ./.agents/skills/my-skill --registry ./registry --version 0.1.0
skillbench registry search release --registry ./registry
skillbench registry show my-skill@0.1.0 --registry ./registry
skillbench registry doctor --registry ./registry
skillbench install my-skill@0.1.0 --registry ./registry
skillbench installed
skillbench installed --check
```

Interactive terminals receive live Glyph dashboards. `--plain` and `--json` provide stable headless output for CI.

## Generated package

```text
my-skill/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── evals/
    ├── cases.yaml               # trigger / near-miss cases
    ├── tasks.yaml               # optional task A/B contract
    └── fixtures/                # optional isolated workspaces
```

The `evals/` directory is a Skillbench extension. It does not change the semantics of the portable skill, and existing installers copy it as ordinary package content.

## Evaluation integrity

Trigger evals give Codex only the skill name, description, and one user request. `should_trigger` remains inside the scorer.

Task evals make two fresh copies of the same fixture:

```text
fixture ──► baseline workspace ──► deterministic rubric
        └─► skill workspace    ──► deterministic rubric
```

Neither run receives the rubric, the expected score, or the other run's output. The skill run receives `SKILL.md`; the baseline does not. Current rubric checks are:

- `file-exists`
- `file-contains`
- `json-equals`
- `final-contains`

Example `evals/tasks.yaml`:

```yaml
version: 1
skill: verify-real-outcome
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

Task evaluation executes agent instructions and local commands. Treat a skill under evaluation as executable input: inspect it first and use a disposable machine or stronger external sandbox for hostile packages. Skillbench explicitly disables workspace network access, but the Codex workspace sandbox is a safety layer rather than a proof that arbitrary third-party instructions are harmless.

## Registry model

`registry.yaml` indexes immutable `name@version` directories. Every entry includes SHA-256 over its normalized file tree. Installation validates the package, verifies the checksum, stages a copy, and then renames it into place. `.skillbench-lock.yaml` records source, version, checksum, and installation time.

The registry source can be a local directory, a manifest path, or a git URL. Remote git registries are cloned into a cache; `--refresh` performs a fast-forward pull.

The checksum detects corruption or a package changed behind its manifest. It is not a signature and does not establish that a registry maintainer is trustworthy. Public/community distribution should use a reviewed git repository and an established installer such as `npx skills add`.

## Release gates

```bash
bun run check
bun run build:release bun-darwin-arm64
cd release && shasum -a 256 -c SHA256SUMS
npm pack --dry-run
```

The release workflow cross-compiles macOS, Linux, and Windows artifacts. npm publication is a separate manual workflow input and can be protected with a GitHub environment.

## Product boundary

Skillbench should stay focused on authoring quality, leak-free evaluation, and evidence. Multi-agent installation, public discovery, ratings, accounts, and hosted registry infrastructure already belong to broader ecosystem tools. The private catalog remains useful where a team needs pinned, checksummed packages without a service.

The public name is intentionally unresolved: `SkillsBench` is already used by an existing benchmark project, so this private codename should be changed before open source release.
