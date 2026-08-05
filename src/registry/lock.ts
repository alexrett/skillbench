import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export interface InstalledSkillRecord {
  name: string;
  version: string;
  checksum: string;
  source: string;
  installedAt: string;
}

export interface SkillbenchLock {
  version: 1;
  updatedAt: string;
  skills: InstalledSkillRecord[];
}

export const LOCK_NAME = ".skillbench-lock.yaml";

export async function readLock(targetRoot: string): Promise<SkillbenchLock> {
  const lockPath = path.join(path.resolve(targetRoot), LOCK_NAME);
  try {
    const parsed = YAML.parse(await readFile(lockPath, "utf8"));
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.skills)) throw new Error("Invalid Skillbench lockfile");
    return {
      version: 1,
      updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : "",
      skills: parsed.skills.map((entry: Record<string, unknown>) => ({
        name: String(entry.name ?? ""),
        version: String(entry.version ?? ""),
        checksum: String(entry.checksum ?? ""),
        source: String(entry.source ?? ""),
        installedAt: String(entry.installed_at ?? ""),
      })),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, updatedAt: new Date(0).toISOString(), skills: [] };
    throw error;
  }
}

export async function writeLock(targetRoot: string, lock: SkillbenchLock): Promise<void> {
  const root = path.resolve(targetRoot);
  const lockPath = path.join(root, LOCK_NAME);
  const temporary = path.join(root, `.skillbench-lock-${process.pid}-${Date.now()}.tmp`);
  const serializable = {
    version: 1,
    updated_at: lock.updatedAt,
    skills: [...lock.skills].sort((a, b) => a.name.localeCompare(b.name)).map((entry) => ({
      name: entry.name,
      version: entry.version,
      checksum: entry.checksum,
      source: entry.source,
      installed_at: entry.installedAt,
    })),
  };
  await writeFile(temporary, YAML.stringify(serializable, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }), "utf8");
  await rename(temporary, lockPath);
}

export async function recordInstallation(targetRoot: string, record: InstalledSkillRecord): Promise<void> {
  const lock = await readLock(targetRoot);
  lock.skills = lock.skills.filter((entry) => entry.name !== record.name);
  lock.skills.push(record);
  lock.updatedAt = new Date().toISOString();
  await writeLock(targetRoot, lock);
}

export async function forgetInstallation(targetRoot: string, name: string): Promise<void> {
  const lock = await readLock(targetRoot);
  const next = lock.skills.filter((entry) => entry.name !== name);
  if (next.length === lock.skills.length && lock.skills.length === 0) return;
  lock.skills = next;
  lock.updatedAt = new Date().toISOString();
  await writeLock(targetRoot, lock);
}
