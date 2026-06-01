import { loadModuleAsset } from "../_shared/load-asset.js"
import { VELES_TOOLS } from "./allowed-tools.js"
import { velesSpecialistInfo } from "./veles.metadata.js"

let cached: string | undefined

export function buildVelesPrompt(): string {
  if (cached === undefined) {
    const frontmatter = [
      "---",
      `name: ${velesSpecialistInfo.name}`,
      `description: ${velesSpecialistInfo.description}`,
      `mode: ${velesSpecialistInfo.mode}`,
      `allowed-tools: ${VELES_TOOLS.join(", ")}`,
      "---",
    ].join("\n")
    const body = loadModuleAsset(import.meta.url, "veles.md")
    cached = `${frontmatter}\n\n${body}`
  }
  return cached
}
