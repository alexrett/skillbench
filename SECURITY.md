# Security policy

## Supported versions

Security fixes are applied to the latest published version of Skillbench.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/alexrett/skillbench/security/advisories/new). Do not open a public issue for a suspected vulnerability.

Skills and task fixtures can contain executable agent instructions. Inspect untrusted packages before evaluation and use a disposable environment. Skillbench disables network access in Codex task workspaces, but a workspace sandbox is a safety layer rather than permission to execute hostile content.

## Skill package audit

Run the static scanner before evaluating or installing a package:

```bash
skillbench audit path/to/skill --fail-on high
skillbench check --strict --fail-on high
```

The audit reads files and symlink metadata but never executes the skill. It detects a focused set of high-signal patterns:

- instruction override and concealed-action language;
- credential paths, secret-like bundled filenames, and likely data exfiltration;
- download-to-shell, broadly destructive commands, privilege escalation, and sandbox weakening;
- dynamic code execution and bidirectional Unicode controls;
- symlinks whose resolved target leaves the skill package.

Text files larger than 1 MB are sampled and blocked as `oversized-text-file` because a bounded scanner cannot prove that the unscanned tail is safe. Binary assets are not subject to that text-size rule.

The default gate fails on `high` and `critical` findings. Registry publication, installation, registry doctor, and installed-skill checks use the same audit boundary.

This is defense in depth, not a trust oracle. Static matching can miss obfuscated, indirect, novel, or context-dependent attacks and can flag legitimate documentation. It does not inspect model behavior, remote dependencies fetched later, or the safety of commands after variable expansion.

When reviewed documentation genuinely needs to show a flagged pattern, place a narrow suppression immediately before it:

```html
<!-- skillbench-security: allow destructive-command -- documents the command users must never run -->
```

Suppressions require a reason and apply only to the same rule, file, and following two lines. Broad or distant suppressions are intentionally unsupported.

## CI supply chain

Skillbench's own workflows pin third-party actions to full commit SHAs. The reusable action validates all inputs, passes them through environment variables instead of interpolating them into shell source, and executes an exact `skillbench-cli` version. Consumers should pin `alexrett/skillbench` to the release commit SHA as well.
