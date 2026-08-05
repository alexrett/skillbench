#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SUPPORTED_TARGETS = [
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-windows-x64-baseline",
] as const;

function artifactName(target: string): string {
  const platform = target.replace(/^bun-/, "").replace(/-baseline$/, "");
  return `skillbench-${platform}${platform.startsWith("windows-") ? ".exe" : ""}`;
}

async function run(command: string[]): Promise<void> {
  const subprocess = Bun.spawn(command, { stdout: "inherit", stderr: "inherit", env: process.env });
  const exitCode = await subprocess.exited;
  if (exitCode !== 0) throw new Error(`${command.slice(0, 3).join(" ")} exited with ${exitCode}`);
}

const requested = process.argv.slice(2);
const targets = requested.length > 0 ? requested : [process.platform === "darwin" ? (process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64") : "bun-linux-x64-baseline"];
for (const target of targets) {
  if (!(SUPPORTED_TARGETS as readonly string[]).includes(target)) throw new Error(`Unsupported release target: ${target}`);
}

const outputDirectory = path.resolve("release");
await mkdir(outputDirectory, { recursive: true });
const checksums: string[] = [];
for (const target of targets) {
  const output = path.join(outputDirectory, artifactName(target));
  await run(["bun", "build", "src/cli.tsx", "--compile", `--target=${target}`, "--outfile", output]);
  const digest = createHash("sha256").update(await readFile(output)).digest("hex");
  checksums.push(`${digest}  ${path.basename(output)}`);
}
await writeFile(path.join(outputDirectory, "SHA256SUMS"), `${checksums.join("\n")}\n`, "utf8");
console.log(`Built ${targets.length} release artifact${targets.length === 1 ? "" : "s"} in ${outputDirectory}`);
