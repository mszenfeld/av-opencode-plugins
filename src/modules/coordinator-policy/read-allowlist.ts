import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { parseAllowedBashPrograms } from "@appverk/opencode-skill-utils"

/**
 * Canonical coordinator bash allowlist — mirrors the `Bash(...)` entries in
 * `src/agents/perun.md` frontmatter. Used only as a fallback when the frontmatter
 * cannot be read/parsed, so a packaging glitch degrades the gate to a known-good
 * allowlist instead of crashing every plugin (the reader runs inside the shared
 * `Promise.all` plugin-init) or silently blocking the coordinator's own `mkdir`/`ls`.
 * The Task-7 sync test guards this constant against frontmatter drift.
 */
const FALLBACK_ALLOWLIST = ["mkdir", "ls", "./scripts/qa-preflight.sh"]

/** Read Perun's allowed bash programs from its agent markdown frontmatter (single source of truth). */
export function readCoordinatorBashAllowlist(): string[] {
  try {
    const perunMd = fileURLToPath(new URL("../../agents/perun.md", import.meta.url))
    const text = readFileSync(perunMd, "utf8")
    const line = text.match(/^allowed-tools:.*$/m)?.[0] ?? ""
    const programs = parseAllowedBashPrograms(line)
    if (programs.length === 0) {
      console.warn("[coordinator-policy] perun.md frontmatter yielded no Bash(...) programs; using fallback allowlist")
      return FALLBACK_ALLOWLIST
    }
    return programs
  } catch (err) {
    console.warn(`[coordinator-policy] could not read perun.md allowlist (${String(err)}); using fallback allowlist`)
    return FALLBACK_ALLOWLIST
  }
}
