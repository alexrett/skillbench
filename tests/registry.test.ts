import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addSkillToRegistry,
  checkInstalledSkills,
  doctorRegistry,
  initRegistry,
  inspectRegistrySkill,
  installSkill,
  openRegistry,
  removeInstalledSkill,
  searchRegistry,
} from "../src/registry/registry.ts";
import { readLock } from "../src/registry/lock.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("skill registry", () => {
  test("publishes, searches, verifies, installs, and removes a versioned skill", async () => {
    const root = await temporaryDirectory("skillbench-registry-");
    const registry = path.join(root, "registry");
    const installed = path.join(root, "installed");
    await initRegistry(registry, "test-registry");

    const entry = await addSkillToRegistry({
      registry,
      skillPath: path.resolve("examples/generated/verify-real-outcome"),
      version: "0.1.0",
    });

    expect(entry.name).toBe("verify-real-outcome");
    expect(entry.checksum).toStartWith("sha256:");
    const opened = await openRegistry(registry);
    expect(searchRegistry(opened.manifest, "runtime")).toHaveLength(1);
    expect((await inspectRegistrySkill(registry, "verify-real-outcome")).skillMarkdown).toContain("## Done");
    expect((await doctorRegistry(registry)).valid).toBe(true);

    const result = await installSkill({ registry, selector: "verify-real-outcome", targetRoot: installed });
    expect(result.version).toBe("0.1.0");
    expect(await readFile(path.join(result.path, "SKILL.md"), "utf8")).toContain("name: verify-real-outcome");
    expect((await readLock(installed)).skills[0]?.version).toBe("0.1.0");
    expect((await checkInstalledSkills(installed)).valid).toBe(true);
    await expect(installSkill({ registry, selector: "verify-real-outcome", targetRoot: installed })).rejects.toThrow("pass --force");

    expect(await removeInstalledSkill("verify-real-outcome", installed)).toBe(result.path);
    expect((await readLock(installed)).skills).toHaveLength(0);
  });

  test("detects drift in an installed skill", async () => {
    const root = await temporaryDirectory("skillbench-installed-drift-");
    const registry = path.join(root, "registry");
    const installed = path.join(root, "installed");
    await initRegistry(registry);
    await addSkillToRegistry({ registry, skillPath: path.resolve("examples/generated/verify-real-outcome"), version: "1.0.0" });
    const result = await installSkill({ registry, selector: "verify-real-outcome", targetRoot: installed });
    await writeFile(path.join(result.path, "drift.txt"), "local change", "utf8");

    const report = await checkInstalledSkills(installed);
    expect(report.valid).toBe(false);
    expect(report.skills[0]?.issues).toContain("Checksum differs from lockfile");
  });

  test("doctor detects a package changed behind the manifest", async () => {
    const root = await temporaryDirectory("skillbench-registry-tamper-");
    const registry = path.join(root, "registry");
    await initRegistry(registry);
    const entry = await addSkillToRegistry({
      registry,
      skillPath: path.resolve("examples/generated/verify-real-outcome"),
      version: "1.0.0",
    });
    await writeFile(path.join(registry, entry.path, "tampered.txt"), "changed", "utf8");

    const report = await doctorRegistry(registry);
    expect(report.valid).toBe(false);
    expect(report.issues.some((issue) => issue.code === "checksum-mismatch")).toBe(true);
  });
});
