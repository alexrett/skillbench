import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type { RegistrySkillVersion, SkillRegistryManifest } from "./types.ts";

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function parseEntry(raw: unknown, index: number): RegistrySkillVersion {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Registry skill ${index + 1} must be a mapping`);
  const value = raw as Record<string, unknown>;
  const name = requiredString(value.name, `Registry skill ${index + 1} name`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Registry skill ${name} has an invalid name`);
  const version = requiredString(value.version, `Registry skill ${name} version`);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Registry skill ${name} has an invalid semantic version`);
  return {
    name,
    version,
    description: requiredString(value.description, `Registry skill ${name} description`),
    path: requiredString(value.path, `Registry skill ${name} path`),
    checksum: requiredString(value.checksum, `Registry skill ${name} checksum`),
    publishedAt: requiredString(value.published_at, `Registry skill ${name} published_at`),
  };
}

export async function readManifest(manifestPath: string): Promise<SkillRegistryManifest> {
  const parsed = YAML.parse(await readFile(manifestPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("registry.yaml must be a mapping");
  if (parsed.version !== 1) throw new Error(`Unsupported registry version ${String(parsed.version)}`);
  const entries = Array.isArray(parsed.skills) ? parsed.skills.map(parseEntry) : [];
  const unique = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.name}@${entry.version}`;
    if (unique.has(key)) throw new Error(`Duplicate registry entry ${key}`);
    unique.add(key);
  }
  return {
    version: 1,
    name: requiredString(parsed.name, "Registry name"),
    updatedAt: requiredString(parsed.updated_at, "Registry updated_at"),
    skills: entries,
  };
}

export async function writeManifest(manifestPath: string, manifest: SkillRegistryManifest): Promise<void> {
  const serializable = {
    version: manifest.version,
    name: manifest.name,
    updated_at: manifest.updatedAt,
    skills: [...manifest.skills]
      .sort((a, b) => a.name.localeCompare(b.name) || b.version.localeCompare(a.version, undefined, { numeric: true }))
      .map((entry) => ({
        name: entry.name,
        version: entry.version,
        description: entry.description,
        path: entry.path,
        checksum: entry.checksum,
        published_at: entry.publishedAt,
      })),
  };
  const temporary = path.join(path.dirname(manifestPath), `.registry-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, YAML.stringify(serializable, { lineWidth: 0, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN" }), "utf8");
  await rename(temporary, manifestPath);
}
