import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseAllowedBashPrograms } from "@appverk/opencode-skill-utils"

/** Read Perun's allowed bash programs from its agent markdown frontmatter (single source of truth). */
export function readCoordinatorBashAllowlist(): string[] {
  const perunMd = fileURLToPath(new URL("../../agents/perun.md", import.meta.url))
  const text = readFileSync(perunMd, "utf8")
  const line = text.match(/^allowed-tools:.*$/m)?.[0] ?? ""
  return parseAllowedBashPrograms(line)
}
