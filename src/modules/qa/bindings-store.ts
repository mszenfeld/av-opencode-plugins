import { Secret } from "./secret.js"

export type BindingType = "secret" | "plain"
export type BindingSource = "minted-recipe" | "user-paste"

export interface BindingEntry {
  value: Secret
  type: BindingType
  source: BindingSource
  createdAt: number
}

export type WriteResult =
  | { status: "ok" }
  | { status: "duplicate" }
  | { status: "error"; reason: string }

const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/

/**
 * Process-control env names that are NEVER acceptable as binding names —
 * overriding any of these would compromise the host shell environment for
 * subsequent Zmora bash invocations.
 */
const NAME_DENYLIST = new Set([
  "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH",
  "NODE_OPTIONS", "BASH_ENV", "ENV", "IFS", "PS4", "SHELLOPTS",
  "PROMPT_COMMAND", "HOME", "USER", "LOGNAME", "TMPDIR", "TEMP", "TMP",
  "SSH_AUTH_SOCK", "SSH_AGENT_PID",
])

const DENYLIST_PREFIXES = ["AWS_", "GIT_SSH_", "GCP_", "AZURE_"]

function nameIsDenied(name: string): boolean {
  if (NAME_DENYLIST.has(name)) return true
  for (const prefix of DENYLIST_PREFIXES) {
    if (name.startsWith(prefix)) return true
  }
  return false
}

function valueIsValid(value: string): { ok: true } | { ok: false; reason: string } {
  if (value.length > 4096) {
    return { ok: false, reason: "value exceeds 4 KB size cap" }
  }
  // Forbid control bytes except a single trailing newline (which is trimmed
  // before storage). Tab (0x09), CR (0x0D), and LF (0x0A) anywhere else are
  // rejected as they can break header / JSON-payload framing.
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i)
    if (c < 0x20 || c === 0x7f) {
      return { ok: false, reason: `value contains control byte 0x${c.toString(16).padStart(2, "0")} at position ${i}` }
    }
  }
  return { ok: true }
}

export class BindingsStore {
  readonly #map = new Map<string, Map<string, BindingEntry>>()

  listForParent(parentID: string): ReadonlyMap<string, BindingEntry> {
    return this.#map.get(parentID) ?? new Map()
  }

  getBinding(parentID: string, name: string): BindingEntry | undefined {
    return this.#map.get(parentID)?.get(name)
  }

  writeBinding(
    parentID: string,
    name: string,
    value: string,
    type: BindingType,
    source: BindingSource,
  ): WriteResult {
    if (source === "minted-recipe") {
      if (!QA_BIND_RE.test(name)) {
        return { status: "error", reason: `minted bindings must match ^QA_BIND_[A-Z][A-Z0-9_]*$ (got '${name}')` }
      }
    } else {
      if (!ENV_NAME_RE.test(name)) {
        return { status: "error", reason: `name must match ^[A-Z_][A-Z0-9_]*$ (got '${name}')` }
      }
      if (nameIsDenied(name)) {
        return { status: "error", reason: `name '${name}' is in the process-control denylist` }
      }
    }

    const vCheck = valueIsValid(value)
    if (!vCheck.ok) {
      return { status: "error", reason: vCheck.reason }
    }

    const stored = value.endsWith("\n") ? value.slice(0, -1) : value
    let parentMap = this.#map.get(parentID)
    if (parentMap === undefined) {
      parentMap = new Map()
      this.#map.set(parentID, parentMap)
    }
    if (parentMap.has(name)) {
      return { status: "duplicate" }
    }
    parentMap.set(name, {
      value: new Secret(stored),
      type,
      source,
      createdAt: Date.now(),
    })
    return { status: "ok" }
  }
}
