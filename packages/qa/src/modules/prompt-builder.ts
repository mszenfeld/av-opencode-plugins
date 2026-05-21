import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { toolsForVariant, type QaTesterStack } from "./allowed-tools.js"

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

function loadSection(name: string): string {
  // At runtime moduleDir resolves to `dist/` (the bundled entrypoint's
  // directory). Section files land at `dist/modules/prompt-sections/<name>`
  // via the post-build `copy-assets.mjs` step. If this read fails, either
  // the build script didn't copy the assets or someone moved them — fix
  // the build, not this resolver.
  const filePath = path.resolve(moduleDir, "modules/prompt-sections", name)
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
