import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toolsForVariant } from "./allowed-tools.js";
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
function loadSection(name) {
  const filePath = path.resolve(moduleDir, "prompt-sections", name);
  return readFileSync(filePath, "utf8");
}
let cachedCore;
let cachedOverlayFe;
let cachedOverlayBe;
function getCore() {
  cachedCore ??= loadSection("core.md");
  return cachedCore;
}
function getOverlay(stack) {
  if (stack === "fe") {
    cachedOverlayFe ??= loadSection("overlay-fe.md");
    return cachedOverlayFe;
  }
  cachedOverlayBe ??= loadSection("overlay-be.md");
  return cachedOverlayBe;
}
function buildQATesterAgent(stack) {
  const tools = toolsForVariant(stack).join(", ");
  const description = `Zmora \u2014 ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`;
  const frontmatter = [
    "---",
    `name: zmora-${stack}`,
    `description: ${description}`,
    "mode: subagent",
    `allowed-tools: ${tools}`,
    "---"
  ].join("\n");
  const body = `${getCore()}

${getOverlay(stack)}`;
  return { prompt: `${frontmatter}

${body}`, stack };
}
export {
  buildQATesterAgent
};
