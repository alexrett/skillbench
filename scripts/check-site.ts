#!/usr/bin/env bun
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve("site");
const indexPath = path.join(root, "index.html");
const html = await readFile(indexPath, "utf8");
const failures: string[] = [];

const requiredSnippets = [
  "<title>",
  'name="description"',
  'rel="canonical"',
  'property="og:title"',
  'name="twitter:card"',
  "Turn repeated agent failures into tested skills.",
  "A real project, not a demo fixture.",
  "Treat every skill as untrusted input.",
  "Our own example failed the usefulness challenge.",
  "Then the mobile bug became a skill.",
  "skillbench check --strict --fail-on high",
  "malikov.tech",
  "npm i -g skillbench-cli",
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) failures.push(`Missing required HTML: ${snippet}`);
}

const ids = new Set([...html.matchAll(/\sid=["']([^"']+)["']/g)].map((match) => match[1]));
const hrefs = [...html.matchAll(/\shref=["']([^"']*)["']/g)].map((match) => match[1]);

for (const href of hrefs) {
  if (!href) {
    failures.push("Found an empty href");
    continue;
  }
  if (href.startsWith("#") && href !== "#" && !ids.has(href.slice(1))) {
    failures.push(`Missing anchor target for ${href}`);
  }
  if (/^(javascript:|data:)/i.test(href)) failures.push(`Unsafe href: ${href}`);
}

const localReferences = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/g)]
  .map((match) => match[1])
  .filter((value) => !/^(https?:|mailto:|#)/.test(value));

for (const reference of localReferences) {
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) continue;
  try {
    await access(path.join(root, clean));
  } catch {
    failures.push(`Missing local asset: ${reference}`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Site check passed: ${hrefs.length} links, ${ids.size} anchor targets, ${localReferences.length} local assets.`);
