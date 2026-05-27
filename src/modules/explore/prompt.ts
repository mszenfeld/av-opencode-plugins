import { loadModuleAsset } from "../_shared/load-asset.js"
import { TRIGLAV_TOOLS } from "./allowed-tools.js"
import { triglavSpecialistInfo } from "./triglav.metadata.js"

let cached: string | undefined

export function buildTriglavPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${triglavSpecialistInfo.name}`,
      `description: ${triglavSpecialistInfo.description}`,
      `mode: ${triglavSpecialistInfo.mode}`,
      `allowed-tools: ${TRIGLAV_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "triglav.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
