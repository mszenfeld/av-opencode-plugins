import { Secret } from "./secret.js";
const QA_BIND_RE = /^QA_BIND_[A-Z][A-Z0-9_]*$/;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const NAME_DENYLIST = /* @__PURE__ */ new Set([
  "PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "IFS",
  "PS4",
  "SHELLOPTS",
  "PROMPT_COMMAND",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID"
]);
const DENYLIST_PREFIXES = ["AWS_", "GIT_SSH_", "GCP_", "AZURE_"];
function nameIsDenied(name) {
  if (NAME_DENYLIST.has(name)) return true;
  for (const prefix of DENYLIST_PREFIXES) {
    if (name.startsWith(prefix)) return true;
  }
  return false;
}
function valueIsValid(value) {
  if (value.length > 4096) {
    return { ok: false, reason: "value exceeds 4 KB size cap" };
  }
  const trimmed = value.endsWith("\n") ? value.slice(0, -1) : value;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charCodeAt(i);
    if (c < 32 || c === 127) {
      return { ok: false, reason: `value contains control byte 0x${c.toString(16).padStart(2, "0")} at position ${i}` };
    }
  }
  return { ok: true };
}
class BindingsStore {
  #map = /* @__PURE__ */ new Map();
  #pinCounts = /* @__PURE__ */ new Map();
  // parentID → name → count
  #snapshotIds = /* @__PURE__ */ new Map();
  #snapshotCounter = 0;
  listForParent(parentID) {
    return this.#map.get(parentID) ?? /* @__PURE__ */ new Map();
  }
  getBinding(parentID, name) {
    return this.#map.get(parentID)?.get(name);
  }
  pinSnapshot(parentID) {
    const live = this.#map.get(parentID) ?? /* @__PURE__ */ new Map();
    const snapshotEntries = new Map(live);
    const id = `snap-${++this.#snapshotCounter}`;
    let parentPinCounts = this.#pinCounts.get(parentID);
    if (parentPinCounts === void 0) {
      parentPinCounts = /* @__PURE__ */ new Map();
      this.#pinCounts.set(parentID, parentPinCounts);
    }
    const names = [];
    for (const name of snapshotEntries.keys()) {
      parentPinCounts.set(name, (parentPinCounts.get(name) ?? 0) + 1);
      names.push(name);
    }
    this.#snapshotIds.set(id, { parentID, names });
    return { id, entries: snapshotEntries };
  }
  releaseSnapshot(id) {
    const record = this.#snapshotIds.get(id);
    if (record === void 0) return;
    this.#snapshotIds.delete(id);
    const parentPinCounts = this.#pinCounts.get(record.parentID);
    if (parentPinCounts === void 0) return;
    for (const name of record.names) {
      const c = parentPinCounts.get(name);
      if (c === void 0) continue;
      if (c <= 1) {
        parentPinCounts.delete(name);
      } else {
        parentPinCounts.set(name, c - 1);
      }
    }
    if (parentPinCounts.size === 0) {
      this.#pinCounts.delete(record.parentID);
    }
  }
  isPinned(parentID, name) {
    return (this.#pinCounts.get(parentID)?.get(name) ?? 0) > 0;
  }
  writeBinding(parentID, name, value, type, source) {
    if (source === "minted-recipe") {
      if (!QA_BIND_RE.test(name)) {
        return { status: "error", reason: `minted bindings must match ^QA_BIND_[A-Z][A-Z0-9_]*$ (got '${name}')` };
      }
    } else {
      if (!ENV_NAME_RE.test(name)) {
        return { status: "error", reason: `name must match ^[A-Z_][A-Z0-9_]*$ (got '${name}')` };
      }
      if (nameIsDenied(name)) {
        return { status: "error", reason: `name '${name}' is in the process-control denylist` };
      }
    }
    const vCheck = valueIsValid(value);
    if (!vCheck.ok) {
      return { status: "error", reason: vCheck.reason };
    }
    const stored = value.endsWith("\n") ? value.slice(0, -1) : value;
    let parentMap = this.#map.get(parentID);
    if (parentMap === void 0) {
      parentMap = /* @__PURE__ */ new Map();
      this.#map.set(parentID, parentMap);
    }
    if (parentMap.has(name)) {
      return { status: "duplicate" };
    }
    parentMap.set(name, {
      value: new Secret(stored),
      type,
      source,
      createdAt: Date.now()
    });
    return { status: "ok" };
  }
}
export {
  BindingsStore
};
