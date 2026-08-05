export interface RegistrySkillVersion {
  name: string;
  version: string;
  description: string;
  path: string;
  checksum: string;
  publishedAt: string;
}

export interface SkillRegistryManifest {
  version: 1;
  name: string;
  updatedAt: string;
  skills: RegistrySkillVersion[];
}

export interface OpenedRegistry {
  root: string;
  manifestPath: string;
  manifest: SkillRegistryManifest;
  source: string;
  remote: boolean;
}

export interface RegistryDoctorIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  skill?: string;
  version?: string;
}

export interface RegistryDoctorResult {
  valid: boolean;
  source: string;
  checked: number;
  issues: RegistryDoctorIssue[];
}

export interface InstalledSkill {
  name: string;
  version: string;
  source: string;
  path: string;
  checksum: string;
}

export interface InstalledSkillCheck {
  name: string;
  version: string;
  path: string;
  valid: boolean;
  expectedChecksum: string;
  actualChecksum?: string;
  issues: string[];
}

export interface InstalledSkillsReport {
  valid: boolean;
  root: string;
  skills: InstalledSkillCheck[];
}

export interface RegistrySkillInspection {
  entry: RegistrySkillVersion;
  source: string;
  files: string[];
  skillMarkdown: string;
}
