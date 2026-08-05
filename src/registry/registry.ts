import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { auditSkillDirectory } from "../security/audit.ts";
import { validateSkillDirectory } from "../validate.ts";
import { forgetInstallation, readLock, recordInstallation } from "./lock.ts";
import { readManifest, writeManifest } from "./manifest.ts";
import type {
  InstalledSkill,
  InstalledSkillsReport,
  OpenedRegistry,
  RegistryDoctorIssue,
  RegistryDoctorResult,
  RegistrySkillVersion,
  RegistrySkillInspection,
  SkillRegistryManifest,
} from "./types.ts";

const MANIFEST_NAME = "registry.yaml";

function isGitSource(value: string): boolean {
  return /^(?:https?:\/\/|ssh:\/\/|git@)/.test(value) || value.endsWith(".git") || value.includes(".git#");
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function parseFrontmatter(source: string): Record<string, unknown> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match?.[1]) throw new Error("SKILL.md must start with YAML frontmatter");
  const parsed = YAML.parse(match[1]);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("SKILL.md frontmatter must be a mapping");
  return parsed as Record<string, unknown>;
}

function normalizeRegistryRoot(input: string): { root: string; manifestPath: string } {
  const resolved = path.resolve(input);
  return path.basename(resolved) === MANIFEST_NAME
    ? { root: path.dirname(resolved), manifestPath: resolved }
    : { root: resolved, manifestPath: path.join(resolved, MANIFEST_NAME) };
}

async function runGit(args: string[], cwd?: string): Promise<void> {
  const git = Bun.which("git");
  if (!git) throw new Error("git is required for remote registries");
  const process = Bun.spawn([git, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: globalThis.process.env });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0) throw new Error(`git ${args[0]} failed: ${(stderr || stdout).trim()}`);
}

function splitGitSource(source: string): { url: string; subdirectory?: string } {
  const marker = source.lastIndexOf(".git#");
  if (marker < 0) return { url: source };
  const url = source.slice(0, marker + 4);
  const subdirectory = source.slice(marker + 5).replace(/^\/+|\/+$/g, "");
  if (!subdirectory || subdirectory.split("/").includes("..")) throw new Error("Invalid registry git subdirectory");
  return { url, subdirectory };
}

async function openGitRegistry(source: string, refresh: boolean): Promise<OpenedRegistry> {
  const { url, subdirectory } = splitGitSource(source);
  const cacheKey = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const cacheRoot = path.join(os.homedir(), ".cache", "skillbench", "registries", cacheKey);
  if (!(await exists(path.join(cacheRoot, ".git")))) {
    await mkdir(path.dirname(cacheRoot), { recursive: true });
    await runGit(["clone", "--depth", "1", url, cacheRoot]);
  } else if (refresh) {
    await runGit(["pull", "--ff-only"], cacheRoot);
  }
  const root = subdirectory ? path.join(cacheRoot, subdirectory) : cacheRoot;
  const manifestPath = path.join(root, MANIFEST_NAME);
  return { root, manifestPath, manifest: await readManifest(manifestPath), source, remote: true };
}

export async function openRegistry(input = "./registry", refresh = false): Promise<OpenedRegistry> {
  if (isGitSource(input)) return openGitRegistry(input, refresh);
  const { root, manifestPath } = normalizeRegistryRoot(input);
  return { root, manifestPath, manifest: await readManifest(manifestPath), source: path.resolve(input), remote: false };
}

export async function initRegistry(input = "./registry", name = "skillbench-local"): Promise<OpenedRegistry> {
  const { root, manifestPath } = normalizeRegistryRoot(input);
  await mkdir(root, { recursive: true });
  if (await exists(manifestPath)) throw new Error(`Registry already exists: ${manifestPath}`);
  const manifest: SkillRegistryManifest = { version: 1, name, updatedAt: new Date().toISOString(), skills: [] };
  await writeManifest(manifestPath, manifest);
  await mkdir(path.join(root, "skills"), { recursive: true });
  return { root, manifestPath, manifest, source: path.resolve(input), remote: false };
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store") continue;
    const absolute = path.join(current, entry.name);
    const relative = path.relative(root, absolute);
    if (entry.isSymbolicLink()) throw new Error(`Skill packages cannot contain symbolic links: ${relative}`);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function checksumDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const relative of await walkFiles(root)) {
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(path.join(root, relative)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function safeRegistryPath(root: string, relative: string): string {
  if (path.isAbsolute(relative)) throw new Error(`Registry entry path must be relative: ${relative}`);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error(`Registry entry escapes root: ${relative}`);
  return resolved;
}

export async function addSkillToRegistry(options: {
  registry: string;
  skillPath: string;
  version: string;
  force?: boolean;
}): Promise<RegistrySkillVersion> {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) throw new Error("--version must be semantic, for example 0.1.0");
  const opened = await openRegistry(options.registry);
  if (opened.remote) throw new Error("Cannot publish into a cached remote registry; clone it locally first");
  const source = await realpath(path.resolve(options.skillPath));
  const validation = await validateSkillDirectory(source);
  if (!validation.valid || !validation.name) {
    const errors = validation.issues.filter((entry) => entry.severity === "error").map((entry) => entry.message).join("; ");
    throw new Error(`Skill validation failed${errors ? `: ${errors}` : ""}`);
  }
  const security = await auditSkillDirectory(source, { failOn: "high" });
  if (!security.passed) {
    const risks = security.findings
      .filter((finding) => finding.severity === "high" || finding.severity === "critical")
      .map((finding) => `${finding.code} in ${finding.path}${finding.line ? `:${finding.line}` : ""}`)
      .join("; ");
    throw new Error(`Skill security audit failed${risks ? `: ${risks}` : ""}`);
  }
  const skillSource = await readFile(path.join(source, "SKILL.md"), "utf8");
  const frontmatter = parseFrontmatter(skillSource);
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  const relative = path.join("skills", validation.name, options.version);
  const target = safeRegistryPath(opened.root, relative);
  const existing = opened.manifest.skills.find((entry) => entry.name === validation.name && entry.version === options.version);
  if ((existing || await exists(target)) && !options.force) throw new Error(`${validation.name}@${options.version} already exists; pass --force to replace it`);

  const stagingRoot = await mkdtemp(path.join(opened.root, ".skillbench-stage-"));
  const staged = path.join(stagingRoot, validation.name);
  try {
    await cp(source, staged, { recursive: true, force: false });
    const checksum = await checksumDirectory(staged);
    if (await exists(target)) await rm(target, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await rename(staged, target);
    const entry: RegistrySkillVersion = {
      name: validation.name,
      version: options.version,
      description,
      path: relative.split(path.sep).join("/"),
      checksum,
      publishedAt: new Date().toISOString(),
    };
    opened.manifest.skills = opened.manifest.skills.filter((item) => !(item.name === entry.name && item.version === entry.version));
    opened.manifest.skills.push(entry);
    opened.manifest.updatedAt = new Date().toISOString();
    await writeManifest(opened.manifestPath, opened.manifest);
    return entry;
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

function compareVersions(left: string, right: string): number {
  return right.localeCompare(left, undefined, { numeric: true, sensitivity: "base" });
}

export function searchRegistry(manifest: SkillRegistryManifest, query = ""): RegistrySkillVersion[] {
  const needle = query.trim().toLocaleLowerCase();
  const matches = manifest.skills.filter((entry) => !needle || entry.name.includes(needle) || entry.description.toLocaleLowerCase().includes(needle));
  return matches.sort((a, b) => a.name.localeCompare(b.name) || compareVersions(a.version, b.version));
}

export function selectRegistryEntry(manifest: SkillRegistryManifest, selector: string): RegistrySkillVersion {
  const at = selector.lastIndexOf("@");
  const name = at > 0 ? selector.slice(0, at) : selector;
  const version = at > 0 ? selector.slice(at + 1) : undefined;
  const matches = manifest.skills.filter((entry) => entry.name === name && (!version || entry.version === version)).sort((a, b) => compareVersions(a.version, b.version));
  const selected = matches[0];
  if (!selected) throw new Error(`Skill not found in registry: ${selector}`);
  return selected;
}

export async function inspectRegistrySkill(
  registry: string,
  selector: string,
  refresh = false,
): Promise<RegistrySkillInspection> {
  const opened = await openRegistry(registry, refresh);
  const entry = selectRegistryEntry(opened.manifest, selector);
  const source = safeRegistryPath(opened.root, entry.path);
  const actualChecksum = await checksumDirectory(source);
  if (actualChecksum !== entry.checksum) throw new Error(`Checksum mismatch for ${entry.name}@${entry.version}`);
  return {
    entry,
    source: opened.source,
    files: await walkFiles(source),
    skillMarkdown: await readFile(path.join(source, "SKILL.md"), "utf8"),
  };
}

export async function installSkill(options: {
  registry: string;
  selector: string;
  targetRoot: string;
  force?: boolean;
  refresh?: boolean;
}): Promise<InstalledSkill> {
  const opened = await openRegistry(options.registry, options.refresh);
  const entry = selectRegistryEntry(opened.manifest, options.selector);
  const source = safeRegistryPath(opened.root, entry.path);
  const actualChecksum = await checksumDirectory(source);
  if (actualChecksum !== entry.checksum) throw new Error(`Checksum mismatch for ${entry.name}@${entry.version}`);
  const validation = await validateSkillDirectory(source, { enforceDirectoryName: false });
  if (!validation.valid) throw new Error(`Registry skill ${entry.name}@${entry.version} is invalid`);
  const security = await auditSkillDirectory(source, { failOn: "high" });
  if (!security.passed) throw new Error(`Registry skill ${entry.name}@${entry.version} failed security audit`);
  const root = path.resolve(options.targetRoot);
  const target = path.join(root, entry.name);
  if (await exists(target)) {
    if (!options.force) throw new Error(`Install target exists: ${target}; pass --force to replace it`);
    await rm(target, { recursive: true, force: true });
  }
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(path.join(root, ".skillbench-install-"));
  try {
    const staged = path.join(staging, entry.name);
    await cp(source, staged, { recursive: true, force: false });
    if (await checksumDirectory(staged) !== entry.checksum) throw new Error("Installed staging checksum mismatch");
    await rename(staged, target);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await recordInstallation(root, {
    name: entry.name,
    version: entry.version,
    source: opened.source,
    checksum: entry.checksum,
    installedAt: new Date().toISOString(),
  });
  return { name: entry.name, version: entry.version, source: opened.source, path: target, checksum: entry.checksum };
}

export async function removeInstalledSkill(name: string, targetRoot: string): Promise<string> {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error("Invalid skill name");
  const root = path.resolve(targetRoot);
  const target = path.join(root, name);
  if (!(await exists(target))) throw new Error(`Installed skill not found: ${target}`);
  const stat = await lstat(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Refusing to remove non-directory target: ${target}`);
  await rm(target, { recursive: true, force: false });
  await forgetInstallation(root, name);
  return target;
}

export async function checkInstalledSkills(targetRoot: string): Promise<InstalledSkillsReport> {
  const root = path.resolve(targetRoot);
  const lock = await readLock(root);
  const skills = await Promise.all(lock.skills.map(async (record) => {
    const target = path.join(root, record.name);
    const issues: string[] = [];
    let actualChecksum: string | undefined;
    if (!(await exists(target))) {
      issues.push("Installed directory is missing");
    } else {
      try {
        actualChecksum = await checksumDirectory(target);
        if (actualChecksum !== record.checksum) issues.push("Checksum differs from lockfile");
        const validation = await validateSkillDirectory(target);
        issues.push(...validation.issues.filter((entry) => entry.severity === "error").map((entry) => entry.message));
        const security = await auditSkillDirectory(target, { failOn: "high" });
        issues.push(...security.findings
          .filter((finding) => finding.severity === "high" || finding.severity === "critical")
          .map((finding) => `Security ${finding.code}: ${finding.message}`));
      } catch (error) {
        issues.push((error as Error).message);
      }
    }
    return {
      name: record.name,
      version: record.version,
      path: target,
      valid: issues.length === 0,
      expectedChecksum: record.checksum,
      actualChecksum,
      issues,
    };
  }));
  return { valid: skills.every((entry) => entry.valid), root, skills };
}

export async function doctorRegistry(input = "./registry", refresh = false): Promise<RegistryDoctorResult> {
  const opened = await openRegistry(input, refresh);
  const issues: RegistryDoctorIssue[] = [];
  for (const entry of opened.manifest.skills) {
    try {
      const source = safeRegistryPath(opened.root, entry.path);
      if (!(await exists(source))) {
        issues.push({ severity: "error", code: "missing-package", message: `Package path is missing: ${entry.path}`, skill: entry.name, version: entry.version });
        continue;
      }
      const checksum = await checksumDirectory(source);
      if (checksum !== entry.checksum) issues.push({ severity: "error", code: "checksum-mismatch", message: `Checksum differs for ${entry.name}@${entry.version}`, skill: entry.name, version: entry.version });
      const validation = await validateSkillDirectory(source, { enforceDirectoryName: false });
      for (const issue of validation.issues) {
        issues.push({ severity: issue.severity, code: `skill-${issue.code}`, message: issue.message, skill: entry.name, version: entry.version });
      }
      const security = await auditSkillDirectory(source, { failOn: "high" });
      for (const finding of security.findings.filter((entry) => entry.severity === "high" || entry.severity === "critical")) {
        issues.push({ severity: "error", code: `security-${finding.code}`, message: `${finding.path}${finding.line ? `:${finding.line}` : ""}: ${finding.message}`, skill: entry.name, version: entry.version });
      }
    } catch (error) {
      issues.push({ severity: "error", code: "package-error", message: (error as Error).message, skill: entry.name, version: entry.version });
    }
  }
  return { valid: !issues.some((entry) => entry.severity === "error"), source: opened.source, checked: opened.manifest.skills.length, issues };
}
