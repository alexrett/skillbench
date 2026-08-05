# Contributing to Skillbench

Skillbench is early, local-first software. Small issues with a reproducible example are more useful than broad feature requests.

## Development

```bash
bun install
bun run check
bun run site:check
```

Run the workbench from source with `bun run src/cli.tsx`. Build a standalone binary with `bun run build:binary`.

## Pull requests

- Keep generated Agent Skills compatible with the standard `SKILL.md` directory shape.
- Add or update tests for behavior changes.
- Preserve evaluation isolation: do not expose rubrics or expected answers to agent runs.
- Treat `evals/` as hidden scorer input: faithful skill installs include runtime resources but must exclude eval fixtures and rubrics.
- Keep portable compatibility checks in `validate`; put Skillbench-specific prose and style rules in `lint`.
- Add a focused security fixture for every new audit rule and test a legitimate/suppressed example when practical.
- Keep security suppressions adjacent, rule-specific, and reasoned; do not weaken a rule merely to make a bundled example pass.
- Keep registry packages immutable once indexed as `name@version`.
- Pin third-party GitHub Actions by full commit SHA and keep untrusted context out of shell source.
- Avoid hosted product features unless the local-first boundary has been discussed first.

For substantial changes, open an issue before implementation so the package format and CLI surface can be agreed on.
