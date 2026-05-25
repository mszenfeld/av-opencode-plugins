import { toolsForVariant, type QaTesterStack } from "./allowed-tools.js"
import { loadModuleAsset } from "../_shared/load-asset.js"

function loadSection(name: string): string {
  return loadModuleAsset(import.meta.url, `prompt-sections/${name}`)
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
