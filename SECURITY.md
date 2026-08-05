# Security policy

## Supported versions

Security fixes are applied to the latest published version of Skillbench.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/alexrett/skillbench/security/advisories/new). Do not open a public issue for a suspected vulnerability.

Skills and task fixtures can contain executable agent instructions. Inspect untrusted packages before evaluation and use a disposable environment. Skillbench disables network access in Codex task workspaces, but a workspace sandbox is a safety layer rather than permission to execute hostile content.
