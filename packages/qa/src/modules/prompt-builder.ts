import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { toolsForVariant, type QaTesterStack } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

// Resolve the prompt-section asset against multiple candidate locations.
// The module is shipped two ways:
//   (a) bundled into dist/index.js by tsup — moduleDir = packages/qa/dist
//   (b) emitted as a standalone module at dist/modules/prompt-builder.js
//   (c) executed directly from src for ad-hoc dev — moduleDir = src/modules
// Each candidate is tried in turn; the first existing file wins.
function loadSection(name: string): string {
  const candidates = [
    // (a) bundled into dist/index.js
    path.resolve(moduleDir, "modules/prompt-sections", name),
    // (b) standalone dist/modules/prompt-builder.js
    path.resolve(moduleDir, "prompt-sections", name),
    // (c) src/modules/prompt-builder.ts running unbundled
    path.resolve(moduleDir, "../prompt-sections", name),
    // (a-fallback) when bundle is at dist/index.js and src copy is desired
    path.resolve(moduleDir, "../src/modules/prompt-sections", name),
  ]
  let lastError: unknown
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, "utf8")
    } catch (err) {
      lastError = err
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`prompt-section asset not found: ${name}`)
}

let cachedCore: string | undefined
let cachedOverlayFe: string | undefined
let cachedOverlayBe: string | undefined

function getCore(): string {
  cachedCore ??= loadSection("core.md")
  return cachedCore
}

function getOverlay(stack: QaTesterStack): string {
  if (stack === "fe") {
    cachedOverlayFe ??= loadSection("overlay-fe.md")
    return cachedOverlayFe
  }
  cachedOverlayBe ??= loadSection("overlay-be.md")
  return cachedOverlayBe
}

export interface BuiltAgent {
  /** Full markdown (frontmatter + body) ready for `config.agent[].prompt`. */
  prompt: string
  /** Stack tag (for tests and diagnostics). */
  stack: QaTesterStack
}

export function buildQATesterAgent(stack: QaTesterStack): BuiltAgent {
  const tools = toolsForVariant(stack).join(", ")
  const description = `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`
  const frontmatter = [
    "---",
    `name: qa-tester-${stack}`,
    `description: ${description}`,
    "mode: subagent",
    `allowed-tools: ${tools}`,
    "---",
  ].join("\n")
  const body = `${getCore()}\n\n${getOverlay(stack)}`
  return { prompt: `${frontmatter}\n\n${body}`, stack }
}
