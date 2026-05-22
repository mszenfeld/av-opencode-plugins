import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { toolsForVariant, type QaTesterStack } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadSection(name: string): string {
  // After absorption into src/modules/qa/, this file is compiled standalone
  // (root tsup uses `bundle: false`) so `moduleDir` resolves to:
  //   Production:                dist/modules/qa/
  //   Dev (tests against src):   src/modules/qa/
  // Section files land at moduleDir/prompt-sections/<name> via the post-build
  // `copy-root-assets.mjs` step (production) and live alongside the source in
  // dev. If this read fails, either the build script didn't copy the assets
  // or someone moved them — fix the build, not this resolver.
  const filePath = path.resolve(moduleDir, "prompt-sections", name)
  return readFileSync(filePath, "utf8")
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
  const description = `Zmora — ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`
  const frontmatter = [
    "---",
    `name: zmora-${stack}`,
    `description: ${description}`,
    "mode: subagent",
    `allowed-tools: ${tools}`,
    "---",
  ].join("\n")
  const body = `${getCore()}\n\n${getOverlay(stack)}`
  return { prompt: `${frontmatter}\n\n${body}`, stack }
}
