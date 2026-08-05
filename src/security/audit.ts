import { lstat, open, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  AuditSkillOptions,
  SecurityFinding,
  SecuritySeverity,
  SecuritySummary,
  SecuritySuppression,
  SkillSecurityReport,
} from "./types.ts";

const SEVERITY_RANK: Record<SecuritySeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);
const MAX_TEXT_FILE_BYTES = 1_000_000;

interface ContentRule {
  code: string;
  severity: SecuritySeverity;
  pattern: RegExp;
  message: string;
  recommendation: string;
}

const CONTENT_RULES: ContentRule[] = [
  {
    code: "prompt-instruction-override",
    severity: "high",
    pattern: /\b(?:ignore|disregard|override)\b.{0,100}\b(?:previous|prior|system|developer)\b.{0,60}\binstructions?\b/i,
    message: "The package attempts to override higher-priority or prior instructions.",
    recommendation: "Remove instruction-hijacking language and scope the skill to its declared workflow.",
  },
  {
    code: "concealed-action",
    severity: "high",
    pattern: /\b(?:secretly|without informing|do not tell|don't tell|hide this from)\b.{0,80}\b(?:user|reviewer|operator|owner)?\b/i,
    message: "The package asks the agent to conceal an action from the user or reviewer.",
    recommendation: "Require transparent reporting and explicit approval for consequential actions.",
  },
  {
    code: "credential-file-access",
    severity: "critical",
    pattern: /(?:~|\$HOME|\/Users\/[^/]+|\/home\/[^/]+)\/(?:\.ssh|\.aws|\.config\/gcloud)|\b(?:id_rsa|id_ed25519|credentials\.json|\/etc\/shadow|find-generic-password)\b/i,
    message: "The package references credential stores or private key material.",
    recommendation: "Remove credential access; accept narrowly scoped credentials through documented environment variables instead.",
  },
  {
    code: "download-pipe-shell",
    severity: "critical",
    pattern: /\b(?:curl|wget)\b[^\n|]{0,300}\|\s*(?:sudo\s+)?(?:sh|bash|zsh|pwsh|powershell)\b/i,
    message: "The package downloads remote content and executes it directly in a shell.",
    recommendation: "Download to a file, verify an immutable checksum or signature, inspect it, then execute explicitly.",
  },
  {
    code: "destructive-command",
    severity: "high",
    pattern: /\brm\s+(?:-[A-Za-z]*r[A-Za-z]*f|-rf|-fr)\s+(?:\/|~|\$HOME|[^\n]{0,80}\*)|\bgit\s+(?:reset\s+--hard|clean\s+-[A-Za-z]*f)|\b(?:mkfs|diskutil\s+eraseDisk)\b/i,
    message: "The package contains a broadly destructive filesystem or repository command.",
    recommendation: "Resolve exact targets first and use recoverable, narrowly scoped operations.",
  },
  {
    code: "privilege-escalation",
    severity: "high",
    pattern: /\bsudo\b|\bchmod\s+(?:-R\s+)?777\b|\bchown\s+(?:-R\s+)?root\b/i,
    message: "The package requests elevated privileges or overly broad filesystem permissions.",
    recommendation: "Remove elevation or document and isolate the smallest explicitly approved privileged operation.",
  },
  {
    code: "sandbox-bypass",
    severity: "critical",
    pattern: /--dangerously-bypass-(?:approvals-and-sandbox|hook-trust)|sandbox[_ .-]*(?:mode|enabled)?\s*[:=]\s*(?:false|off|disabled)|network_access\s*=\s*true/i,
    message: "The package attempts to weaken the agent sandbox or approval boundary.",
    recommendation: "Keep the sandbox enabled and declare the minimum capabilities the skill requires.",
  },
  {
    code: "possible-exfiltration",
    severity: "high",
    pattern: /\b(?:curl|wget)\b[^\n]{0,240}(?:--data-binary|--upload-file|-F|-d)\s+@?(?:~|\$HOME|\/?[^\s]+)|\b(?:nc|ncat|netcat|socat)\b/i,
    message: "The package contains a command pattern commonly used to upload local data or open a raw network channel.",
    recommendation: "Remove the transfer or constrain it to an explicit, reviewed endpoint and non-sensitive artifact.",
  },
  {
    code: "dynamic-code-execution",
    severity: "medium",
    pattern: /\b(?:eval|exec)\s*\(|\bnew\s+Function\s*\(|\b(?:child_process\.(?:exec|spawn)|Bun\.spawn)\s*\(/,
    message: "The package performs dynamic code or process execution.",
    recommendation: "Use fixed argument arrays and validate every externally influenced value before execution.",
  },
  {
    code: "unicode-control",
    severity: "high",
    pattern: /[\u202A-\u202E\u2066-\u2069]/,
    message: "The package contains bidirectional Unicode control characters that can conceal instruction or code order.",
    recommendation: "Remove the control characters and keep security-relevant text visually unambiguous.",
  },
];

const SENSITIVE_FILENAMES = /(?:^|\/)(?:\.env(?:\..+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials\.json|service-account\.json|kubeconfig)$/i;
const SUPPRESSION_PATTERN = /skillbench-security:\s*allow\s+([a-z0-9-]+)\s+--\s*(\S[^\r\n]*)/gi;

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(target);
      else files.push(target);
    }
  }
  await visit(root);
  return files;
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split(/\r?\n/).length;
}

function findSuppressions(source: string, relativePath: string): SecuritySuppression[] {
  const suppressions: SecuritySuppression[] = [];
  SUPPRESSION_PATTERN.lastIndex = 0;
  for (const match of source.matchAll(SUPPRESSION_PATTERN)) {
    suppressions.push({
      code: match[1] as string,
      path: relativePath,
      line: lineNumber(source, match.index ?? 0),
      reason: (match[2] as string).trim(),
    });
  }
  return suppressions;
}

function emptySummary(): SecuritySummary {
  return { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
}

function isProbablyText(buffer: Buffer): boolean {
  return !buffer.subarray(0, Math.min(buffer.length, 8_192)).includes(0);
}

async function readSample(filePath: string, size: number): Promise<Buffer> {
  const length = Math.min(size, MAX_TEXT_FILE_BYTES);
  const buffer = Buffer.alloc(length);
  const handle = await open(filePath, "r");
  try {
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function auditSkillDirectory(
  inputPath: string,
  options: AuditSkillOptions = {},
): Promise<SkillSecurityReport> {
  const root = path.resolve(inputPath);
  const failOn = options.failOn ?? "high";
  const findings: SecurityFinding[] = [];
  const suppressions: SecuritySuppression[] = [];
  const rootRealPath = await realpath(root);

  for (const filePath of await walk(root)) {
    const relativePath = path.relative(root, filePath) || path.basename(filePath);
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      const link = await readlink(filePath);
      let resolved = "";
      try {
        resolved = await realpath(filePath);
      } catch {
        resolved = path.resolve(path.dirname(filePath), link);
      }
      if (resolved !== rootRealPath && !resolved.startsWith(`${rootRealPath}${path.sep}`)) {
        findings.push({
          code: "external-symlink",
          severity: "critical",
          path: relativePath,
          message: `Symlink escapes the skill package: ${link}`,
          recommendation: "Bundle a regular file or use a symlink whose resolved target stays inside the package.",
        });
      }
      continue;
    }
    if (!stats.isFile()) continue;

    if (SENSITIVE_FILENAMES.test(relativePath)) {
      findings.push({
        code: "bundled-sensitive-file",
        severity: "critical",
        path: relativePath,
        message: "The skill package includes a filename commonly used for secrets or credentials.",
        recommendation: "Remove the file and rotate any credential that may have been published.",
      });
    }
    const buffer = await readSample(filePath, stats.size);
    if (!isProbablyText(buffer)) continue;
    const source = buffer.toString("utf8");
    suppressions.push(...findSuppressions(source, relativePath));
    if (stats.size > MAX_TEXT_FILE_BYTES) {
      findings.push({
        code: "oversized-text-file",
        severity: "high",
        path: relativePath,
        line: 1,
        message: `Text file exceeds the ${MAX_TEXT_FILE_BYTES}-byte static scan boundary.`,
        recommendation: "Split or remove the file, or place a reasoned suppression at its start after reviewing the entire payload.",
      });
    }
    for (const rule of CONTENT_RULES) {
      const flags = rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`;
      const matcher = new RegExp(rule.pattern.source, flags);
      for (const match of source.matchAll(matcher)) {
        findings.push({
          code: rule.code,
          severity: rule.severity,
          path: relativePath,
          line: lineNumber(source, match.index ?? 0),
          message: rule.message,
          recommendation: rule.recommendation,
        });
      }
    }
  }

  const activeFindings = findings.filter((finding) => !suppressions.some(
    (suppression) => suppression.code === finding.code
      && suppression.path === finding.path
      && finding.line !== undefined
      && finding.line >= suppression.line
      && finding.line <= suppression.line + 2,
  ));
  const summary = emptySummary();
  for (const finding of activeFindings) summary[finding.severity] += 1;

  return {
    version: 1,
    root,
    passed: !activeFindings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn]),
    failOn,
    findings: activeFindings,
    suppressions,
    summary,
  };
}
