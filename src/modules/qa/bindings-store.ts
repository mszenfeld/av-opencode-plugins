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

export interface BindingSnapshot {
  readonly id: string
  readonly entries: ReadonlyMap<string, BindingEntry>
}

const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/

const PER_PARENT_CAP = 32
const GLOBAL_CAP = 256

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
  readonly #pinCounts = new Map<string, Map<string, number>>()  // parentID → name → count
  readonly #snapshotIds = new Map<string, { parentID: string; names: string[] }>()
  #snapshotCounter = 0
  #globalCount = 0

  listForParent(parentID: string): ReadonlyMap<string, BindingEntry> {
    return this.#map.get(parentID) ?? new Map()
  }

  getBinding(parentID: string, name: string): BindingEntry | undefined {
    return this.#map.get(parentID)?.get(name)
  }

  pinSnapshot(parentID: string): BindingSnapshot {
    const live = this.#map.get(parentID) ?? new Map()
    const snapshotEntries = new Map(live)
    const id = `snap-${++this.#snapshotCounter}`

    let parentPinCounts = this.#pinCounts.get(parentID)
    if (parentPinCounts === undefined) {
      parentPinCounts = new Map()
      this.#pinCounts.set(parentID, parentPinCounts)
    }
    const names: string[] = []
    for (const name of snapshotEntries.keys()) {
      parentPinCounts.set(name, (parentPinCounts.get(name) ?? 0) + 1)
      names.push(name)
    }
    this.#snapshotIds.set(id, { parentID, names })
    return { id, entries: snapshotEntries }
  }

  releaseSnapshot(id: string): void {
    const record = this.#snapshotIds.get(id)
    if (record === undefined) return
    this.#snapshotIds.delete(id)
    const parentPinCounts = this.#pinCounts.get(record.parentID)
    if (parentPinCounts === undefined) return
    for (const name of record.names) {
      const c = parentPinCounts.get(name)
      if (c === undefined) continue
      if (c <= 1) {
        parentPinCounts.delete(name)
      } else {
        parentPinCounts.set(name, c - 1)
      }
    }
    if (parentPinCounts.size === 0) {
      this.#pinCounts.delete(record.parentID)
    }
  }

  isPinned(parentID: string, name: string): boolean {
    return (this.#pinCounts.get(parentID)?.get(name) ?? 0) > 0
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
    if (parentMap.size >= PER_PARENT_CAP) {
      return { status: "error", reason: `per-parent cap of ${PER_PARENT_CAP} reached` }
    }
    if (this.#globalCount >= GLOBAL_CAP) {
      return { status: "error", reason: `global cap of ${GLOBAL_CAP} reached` }
    }
    parentMap.set(name, {
      value: new Secret(stored),
      type,
      source,
      createdAt: Date.now(),
    })
    this.#globalCount++
    return { status: "ok" }
  }

  /**
   * Purge entries older than TTL (excluding pinned). Returns count purged.
   * Called periodically from the plugin sweep timer.
   */
  sweepExpired(nowMs: number, ttlMs: number): number {
    let purged = 0
    for (const [parentID, parentMap] of this.#map.entries()) {
      for (const [name, entry] of parentMap.entries()) {
        if (this.isPinned(parentID, name)) continue
        if (nowMs - entry.createdAt < ttlMs) continue
        parentMap.delete(name)
        purged++
        this.#globalCount--
      }
      if (parentMap.size === 0) {
        this.#map.delete(parentID)
      }
    }
    return purged
  }

  /**
   * Purge all bindings for a parent session (called on session.deleted /
   * QA-run completion / abort). Pinned entries are still purged — the caller
   * has decided the parent's lifecycle is over.
   */
  clearParent(parentID: string): number {
    const parentMap = this.#map.get(parentID)
    if (parentMap === undefined) return 0
    const purged = parentMap.size
    this.#globalCount -= purged
    this.#map.delete(parentID)
    // Also clear any lingering pin counts for safety.
    this.#pinCounts.delete(parentID)
    return purged
  }
}
