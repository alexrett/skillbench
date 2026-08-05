const copyButtons = document.querySelectorAll(".copy-command");

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

for (const button of copyButtons) {
  const originalLabel = button.querySelector(".copy-label")?.textContent ?? "Copy";
  button.addEventListener("click", async () => {
    const text = button.dataset.copy;
    if (!text) return;

    try {
      await copyText(text);
      button.classList.add("copied");
      const label = button.querySelector(".copy-label");
      if (label) label.textContent = "Copied";
      window.setTimeout(() => {
        button.classList.remove("copied");
        if (label) label.textContent = originalLabel;
      }, 1800);
    } catch {
      const label = button.querySelector(".copy-label");
      if (label) label.textContent = "Select + copy";
    }
  });
}

const navToggle = document.querySelector(".nav-toggle");
const siteNav = document.querySelector(".site-nav");

navToggle?.addEventListener("click", () => {
  const open = siteNav?.classList.toggle("open") ?? false;
  navToggle.setAttribute("aria-expanded", String(open));
});

siteNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    siteNav.classList.remove("open");
    navToggle?.setAttribute("aria-expanded", "false");
  });
});

const terminalRows = [...document.querySelectorAll(".terminal-row")];
const terminalResult = document.querySelector(".terminal-result");

function renderTerminalResult(row) {
  for (const candidate of terminalRows) {
    const active = candidate === row;
    candidate.classList.toggle("active", active);
    candidate.setAttribute("aria-selected", String(active));
  }

  if (!terminalResult) return;
  const parts = (row.dataset.result ?? "").split("|");
  terminalResult.replaceChildren();

  if (parts.length === 4) {
    const [baseline, skill, separator, delta] = parts;
    const baselineElement = document.createElement("span");
    baselineElement.textContent = baseline;
    const arrow = document.createElement("b");
    arrow.textContent = "→";
    arrow.setAttribute("aria-hidden", "true");
    const skillElement = document.createElement("strong");
    skillElement.textContent = skill;
    const separatorElement = document.createElement("em");
    separatorElement.textContent = separator;
    const deltaElement = document.createElement("mark");
    deltaElement.textContent = delta;
    terminalResult.append(baselineElement, arrow, skillElement, separatorElement, deltaElement);
  } else {
    const result = document.createElement("strong");
    result.textContent = parts[0];
    terminalResult.append(result);
  }
}

terminalRows.forEach((row) => row.addEventListener("click", () => renderTerminalResult(row)));

document.querySelector(".terminal-menu")?.addEventListener("keydown", (event) => {
  if (!["ArrowDown", "ArrowUp", "j", "k"].includes(event.key)) return;
  event.preventDefault();
  const activeIndex = Math.max(0, terminalRows.findIndex((row) => row.classList.contains("active")));
  const direction = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
  const nextIndex = (activeIndex + direction + terminalRows.length) % terminalRows.length;
  renderTerminalResult(terminalRows[nextIndex]);
  terminalRows[nextIndex].focus();
});

const evalButtons = [...document.querySelectorAll("[data-eval-mode]")];
const evidenceConsole = document.querySelector(".evidence-console");
const evidenceModes = {
  task: {
    leftLabel: "BASELINE",
    leftCommand: "$ skillbench eval ./release-check --task",
    leftScore: "0.40",
    rightLabel: "WITH SKILL",
    rightCommand: "$ skillbench eval ./release-check --task",
    rightScore: "1.00",
    delta: "+0.60",
    rubric: ["✓ verification.json exists", "✓ status contains READY", "✓ final mentions live evidence"],
  },
  trigger: {
    leftLabel: "SHOULD TRIGGER",
    leftCommand: "$ skillbench eval ./release-check",
    leftScore: "5 / 5",
    rightLabel: "NEAR MISS",
    rightCommand: "$ skillbench eval ./release-check",
    rightScore: "5 / 5",
    delta: "CLEAN",
    rubric: ["✓ direct requests discovered", "✓ adjacent requests ignored", "✓ expected labels stayed hidden"],
  },
};

function renderEvalMode(mode) {
  const content = evidenceModes[mode];
  if (!content || !evidenceConsole) return;
  evidenceConsole.dataset.mode = mode;
  evalButtons.forEach((button) => button.classList.toggle("active", button.dataset.evalMode === mode));

  const panels = evidenceConsole.querySelectorAll(".score-panel");
  const left = panels[0];
  const right = panels[1];
  if (left) {
    left.querySelector("span").textContent = content.leftLabel;
    left.querySelector("code").textContent = content.leftCommand;
    left.querySelector("strong").textContent = content.leftScore;
  }
  if (right) {
    right.querySelector("span").textContent = content.rightLabel;
    right.querySelector("code").textContent = content.rightCommand;
    right.querySelector("strong").textContent = content.rightScore;
  }
  evidenceConsole.querySelector(".score-delta strong").textContent = content.delta;
  evidenceConsole.querySelectorAll(".rubric-grid span").forEach((row, index) => {
    row.textContent = content.rubric[index] ?? "";
  });
}

evalButtons.forEach((button) => button.addEventListener("click", () => renderEvalMode(button.dataset.evalMode)));

const commandModes = {
  headless: [
    "skillbench build ./brief.json --out ./.agents/skills/release-check",
    "skillbench validate ./.agents/skills/release-check --json",
    "skillbench eval ./.agents/skills/release-check --json",
    "skillbench eval ./.agents/skills/release-check --task --json",
    "skillbench registry add ./.agents/skills/release-check --version 0.1.0 --json",
  ],
  guided: [
    "skillbench",
    "skillbench validate ./.agents/skills/release-check",
    "skillbench eval ./.agents/skills/release-check",
    "skillbench eval ./.agents/skills/release-check --task",
    "skillbench registry add ./.agents/skills/release-check --version 0.1.0",
  ],
};

const docButtons = [...document.querySelectorAll("[data-doc-mode]")];
const commandRows = [...document.querySelectorAll(".command-list li")];

function renderDocMode(mode) {
  const commands = commandModes[mode];
  if (!commands) return;
  docButtons.forEach((button) => button.classList.toggle("active", button.dataset.docMode === mode));
  commandRows.forEach((row, index) => {
    const command = commands[index];
    if (!command) return;
    row.querySelector(":scope > code").textContent = command;
    const copy = row.querySelector(".copy-command");
    if (copy) copy.dataset.copy = command;
  });
}

docButtons.forEach((button) => button.addEventListener("click", () => renderDocMode(button.dataset.docMode)));

commandRows.forEach((row) => {
  row.addEventListener("focusin", () => {
    commandRows.forEach((candidate) => candidate.classList.toggle("active", candidate === row));
  });
  row.addEventListener("mouseenter", () => {
    commandRows.forEach((candidate) => candidate.classList.toggle("active", candidate === row));
  });
});

renderDocMode("headless");
