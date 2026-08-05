export type SecuritySeverity = "info" | "low" | "medium" | "high" | "critical";

export interface SecurityFinding {
  code: string;
  severity: SecuritySeverity;
  path: string;
  line?: number;
  message: string;
  recommendation: string;
}

export interface SecuritySuppression {
  code: string;
  path: string;
  line: number;
  reason: string;
}

export interface SecuritySummary {
  info: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface SkillSecurityReport {
  version: 1;
  root: string;
  passed: boolean;
  failOn: SecuritySeverity;
  findings: SecurityFinding[];
  suppressions: SecuritySuppression[];
  summary: SecuritySummary;
}

export interface AuditSkillOptions {
  failOn?: SecuritySeverity;
}
