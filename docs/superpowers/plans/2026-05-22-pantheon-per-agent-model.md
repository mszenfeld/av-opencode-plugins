# Pantheon Per-Agent Model Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-agent model selection via `pantheon.json` (user-global + per-project walk-up, closest-wins merge), rename `qa-tester` → `zmora`, and rewrite README.md harness-first.

**Architecture:** A new harness-resident library `src/modules/pantheon-config/` loads JSONC config files, validates schema, merges per-agent with closest-wins. Existing plugins (`coordinator`, `qa`) call it in their `config` hooks and inject the resolved model into `AgentConfig`. Coordinator additionally registers an `event` hook that fires a one-time TUI toast when no config exists. The rename is an atomic breaking change touching source, tests, prompts, commands, and legacy docs in lockstep.

**Tech Stack:** TypeScript (ES2022, NodeNext, strict), tsup, vitest, jsonc-parser, OpenCode plugin SDK v1.

**Spec:** [`docs/superpowers/specs/2026-05-22-pantheon-per-agent-model-design.md`](../specs/2026-05-22-pantheon-per-agent-model-design.md)

**Notes for executor:**
- This repo blocks direct `git commit`. Use either `/commit` slash command OR `AV_COMMIT_SKILL=1 git commit -m ...`. Plan steps below use the env-var form for reproducibility.
- All `tsc`/build paths follow the `bundle: false` convention. After src/ changes, `npm run build:root` (or `npm run test`, which builds first) regenerates `dist/`.
- Run a targeted vitest like `npx vitest run tests/modules/pantheon-config/schema.test.ts -t "<title>"` while iterating.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `src/modules/pantheon-config/schema.ts` | Types (`PantheonConfig`, `ValidationResult`) + `validateConfigFile(raw, sourcePath)`. Pure: no I/O, no globals. |
| `src/modules/pantheon-config/paths.ts` | `userGlobalPath(homedir?)`, `walkUpProjectPaths(startDir, homedir?)`. Pure: no I/O. |
| `src/modules/pantheon-config/loader.ts` | `loadFresh(options)` reads files via fs, parses JSONC, validates per file, merges closest-wins. Internal — no cache. |
| `src/modules/pantheon-config/index.ts` | Public API: `loadPantheonConfig()`, `getLoadErrors()`, `pantheonConfigEmpty()`, `__resetCacheForTests()`. Module-scope cache lives here. |
| `tests/modules/pantheon-config/schema.test.ts` | ~6 cases (valid, empty, invalid, regex). |
| `tests/modules/pantheon-config/paths.test.ts` | ~5 cases (walk boundary, ordering). |
| `tests/modules/pantheon-config/loader.test.ts` | ~12 cases using real fs + `mkdtempSync` fixtures. |
| `tests/modules/coordinator/perun-model-injection.test.ts` | Asserts `config.agent["Perun - Coordinator"].model` is set/unset based on fixture config. |
| `tests/modules/qa/zmora-model-injection.test.ts` | Asserts model set on BOTH `zmora-fe` and `zmora-be`. |
| `tests/modules/coordinator/notify-on-empty-config.test.ts` | Toast fires once on first `session.created`; second event no-op. |
| `docs/configuring-agents.md` | User-facing config reference. |

### Modified

| Path | Why |
|---|---|
| `package.json` (root) | Add `jsonc-parser` dep; bump version `0.2.16` → `0.3.0`. |
| `packages/code-review/package.json`, `packages/frontend-developer/package.json`, `packages/python-developer/package.json`, `packages/skill-registry/package.json`, `packages/skill-utils/package.json`, `packages/swift-developer/package.json` | Bump version `0.2.16` → `0.3.0`. |
| `src/modules/coordinator/sanitize.ts` | Functional regex rename. |
| `src/modules/coordinator/dispatch.ts` | Comment rename. |
| `src/modules/coordinator/index.ts` | Tool description rename + model injection + event hook for toast. |
| `src/modules/qa/index.ts` | Variant key rename + model injection. |
| `src/modules/qa/prompt-builder.ts` | Frontmatter `name` rename. |
| `src/modules/qa/allowed-tools.ts` | Comment rename. |
| `src/modules/qa/prompt-sections/core.md` | One mention (line 3). |
| `src/agents/perun.md` | Specialist table + workflow references. |
| `src/commands/run-qa.md` | 5 mentions. |
| `tests/modules/coordinator/sanitize.test.ts` | Fixture + assertion rename. |
| `tests/modules/coordinator/dispatch.test.ts` | Assertion rename. |
| `tests/modules/coordinator/perun-qa-flow.test.ts` | Assertion rename. |
| `tests/modules/qa/plugin.test.ts` | Assertion rename + add model-injection tests. |
| `tests/root-plugin.test.ts` | Add `dist/modules/pantheon-config/*.js` assertions in packaging check. |
| `AGENTS.md` | Layout row added; QA row updated; documentation checklist relaxed. |
| `docs/plugins/qa.md` | Legacy rename. |
| `docs/plugins/coordinator.md` | Legacy rename (16 mentions). |
| `docs/plugins/pantheon.md` | Legacy rename (1 mention). |
| `README.md` | Full rewrite from scratch. |
| `.opencode/opencode.json` | Bump plugin ref to `#v0.3.0`. |
| `scripts/verify-dist-sync.mjs` | Tracked paths comment update (no new path needed — `dist` covers `dist/modules/pantheon-config/`). |

---

## Phase A — `pantheon-config` module (TDD)

### Task A1: Install `jsonc-parser` dependency

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add dependency**

```bash
npm install jsonc-parser
```

Expected: `package.json` `dependencies` gains `"jsonc-parser": "^3.x.y"`; `package-lock.json` updated.

- [ ] **Step 2: Verify install**

```bash
npm ls jsonc-parser
```

Expected: tree shows `jsonc-parser@3.x.y` listed under top-level dependencies.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add package.json package-lock.json && git commit -m "chore(deps): add jsonc-parser for pantheon.json support

Refs: spec"
```

---

### Task A2: `schema.ts` — types + validation (TDD)

**Files:**
- Create: `src/modules/pantheon-config/schema.ts`
- Create: `tests/modules/pantheon-config/schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/pantheon-config/schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { validateConfigFile } from "../../../src/modules/pantheon-config/schema.js"

describe("validateConfigFile", () => {
  it("accepts a valid full config", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.config).toEqual({
      agents: { perun: { model: "anthropic/claude-opus-4-7" } },
    })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty object as empty config", () => {
    const result = validateConfigFile({})
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("accepts an empty agents map", () => {
    const result = validateConfigFile({ agents: {} })
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors).toEqual([])
  })

  it("rejects non-object top level", () => {
    const result = validateConfigFile("nope")
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors[0]).toMatch(/top-level must be object/i)
  })

  it("rejects model without slash", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "no-slash-here" } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model "no-slash-here"/)
  })

  it("rejects model with more than one slash", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "a/b/c" } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model "a\/b\/c"/)
  })

  it("rejects non-string model", () => {
    const result = validateConfigFile({
      agents: { perun: { model: 42 } },
    })
    expect(result.config.agents).toEqual({})
    expect(result.errors[0]).toMatch(/invalid model/)
  })

  it("preserves valid agents alongside invalid ones", () => {
    const result = validateConfigFile({
      agents: {
        perun: { model: "anthropic/claude-opus-4-7" },
        broken: { model: "no-slash" },
      },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors).toHaveLength(1)
  })

  it("warns on unknown top-level section but does not fail", () => {
    const result = validateConfigFile({ dispatch: { maxParallel: 4 } })
    expect(result.config).toEqual({ agents: {} })
    expect(result.errors.some((e) => /unknown section "dispatch"/.test(e))).toBe(true)
  })

  it("warns on unknown field under agent but keeps model", () => {
    const result = validateConfigFile({
      agents: { perun: { model: "anthropic/claude-opus-4-7", temperature: 0.5 } },
    })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
    })
    expect(result.errors.some((e) => /unknown field "agents\.perun\.temperature"/.test(e))).toBe(true)
  })

  it("includes sourcePath in error messages when provided", () => {
    const result = validateConfigFile("nope", "/etc/example.json")
    expect(result.errors[0]).toContain("/etc/example.json")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/modules/pantheon-config/schema.test.ts
```

Expected: ALL fail — `Cannot find module '../../../src/modules/pantheon-config/schema.js'`.

- [ ] **Step 3: Implement schema.ts**

Create `src/modules/pantheon-config/schema.ts`:

```typescript
/**
 * Schema validation for pantheon.json files. Pure functions — no I/O, no globals.
 *
 * Returns `{ config, errors }` rather than throwing so a single bad agent does
 * not invalidate the whole file. The caller (loader.ts) accumulates `errors`
 * across all source files for diagnostic display.
 */

export type PantheonConfig = {
  agents: { [name: string]: { model: string } }
}

export type ValidationResult = {
  config: PantheonConfig
  errors: string[]
}

const MODEL_REGEX = /^[^/]+\/[^/]+$/

const KNOWN_TOP_LEVEL = new Set(["agents"])
const KNOWN_AGENT_FIELDS = new Set(["model"])

function prefix(sourcePath?: string): string {
  return sourcePath !== undefined ? `[pantheon] ${sourcePath}: ` : "[pantheon] "
}

export function validateConfigFile(raw: unknown, sourcePath?: string): ValidationResult {
  const errors: string[] = []
  const out: PantheonConfig = { agents: {} }

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${prefix(sourcePath)}top-level must be object`)
    return { config: out, errors }
  }

  const obj = raw as Record<string, unknown>

  for (const key of Object.keys(obj)) {
    if (!KNOWN_TOP_LEVEL.has(key)) {
      errors.push(`${prefix(sourcePath)}unknown section "${key}" — ignoring`)
    }
  }

  const agents = obj.agents
  if (agents === undefined) {
    return { config: out, errors }
  }

  if (agents === null || typeof agents !== "object" || Array.isArray(agents)) {
    errors.push(`${prefix(sourcePath)}agents must be object — ignoring`)
    return { config: out, errors }
  }

  for (const [name, agentRaw] of Object.entries(agents as Record<string, unknown>)) {
    if (agentRaw === null || typeof agentRaw !== "object" || Array.isArray(agentRaw)) {
      errors.push(`${prefix(sourcePath)}agents.${name} must be object — ignoring`)
      continue
    }
    const agent = agentRaw as Record<string, unknown>

    for (const field of Object.keys(agent)) {
      if (!KNOWN_AGENT_FIELDS.has(field)) {
        errors.push(`${prefix(sourcePath)}unknown field "agents.${name}.${field}"`)
      }
    }

    const model = agent.model
    if (model === undefined) {
      continue
    }
    if (typeof model !== "string" || !MODEL_REGEX.test(model)) {
      const shown = typeof model === "string" ? `"${model}"` : String(model)
      errors.push(
        `${prefix(sourcePath)}invalid model ${shown} for agent "${name}" — must match <providerID>/<modelID>`,
      )
      continue
    }

    out.agents[name] = { model }
  }

  return { config: out, errors }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/modules/pantheon-config/schema.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/pantheon-config/schema.ts tests/modules/pantheon-config/schema.test.ts && git commit -m "feat(pantheon-config): add schema validation for pantheon.json

Refs: spec"
```

---

### Task A3: `paths.ts` — locations + walk-up (TDD)

**Files:**
- Create: `src/modules/pantheon-config/paths.ts`
- Create: `tests/modules/pantheon-config/paths.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/pantheon-config/paths.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import path from "node:path"
import {
  userGlobalPath,
  walkUpProjectPaths,
} from "../../../src/modules/pantheon-config/paths.js"

describe("userGlobalPath", () => {
  it("returns ~/.config/opencode/pantheon.json under the given homedir", () => {
    expect(userGlobalPath("/Users/alice")).toBe(
      path.join("/Users/alice", ".config", "opencode", "pantheon.json"),
    )
  })
})

describe("walkUpProjectPaths", () => {
  it("returns closest-first ordering from cwd up to homedir", () => {
    const result = walkUpProjectPaths("/Users/alice/work/repo/sub", "/Users/alice")
    expect(result).toEqual([
      path.join("/Users/alice/work/repo/sub", ".opencode", "pantheon.json"),
      path.join("/Users/alice/work/repo", ".opencode", "pantheon.json"),
      path.join("/Users/alice/work", ".opencode", "pantheon.json"),
      path.join("/Users/alice", ".opencode", "pantheon.json"),
    ])
  })

  it("stops at homedir even if cwd === homedir", () => {
    const result = walkUpProjectPaths("/Users/alice", "/Users/alice")
    expect(result).toEqual([
      path.join("/Users/alice", ".opencode", "pantheon.json"),
    ])
  })

  it("walks to filesystem root when cwd is outside homedir", () => {
    const result = walkUpProjectPaths("/tmp/work/repo", "/Users/alice")
    // walk continues until dirname loop detects root (dirname(x) === x)
    expect(result[0]).toBe(path.join("/tmp/work/repo", ".opencode", "pantheon.json"))
    expect(result[result.length - 1]).toBe(path.join("/", ".opencode", "pantheon.json"))
  })

  it("resolves a relative cwd against process.cwd()", () => {
    const result = walkUpProjectPaths(".", "/Users/alice")
    // first entry must be absolute and end with /.opencode/pantheon.json
    expect(path.isAbsolute(result[0]!)).toBe(true)
    expect(result[0]!.endsWith(path.join(".opencode", "pantheon.json"))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/modules/pantheon-config/paths.test.ts
```

Expected: fails — module not found.

- [ ] **Step 3: Implement paths.ts**

Create `src/modules/pantheon-config/paths.ts`:

```typescript
import os from "node:os"
import path from "node:path"

/**
 * Pure path resolution for pantheon.json discovery. No I/O happens here —
 * callers (loader.ts) are responsible for actually checking existence and
 * reading content.
 */

export function userGlobalPath(homedir: string = os.homedir()): string {
  return path.join(homedir, ".config", "opencode", "pantheon.json")
}

/**
 * Returns the ordered list of `.opencode/pantheon.json` paths from `startDir`
 * walking up to `homedir` (inclusive). Output is closest-first — the first
 * entry is the most specific. If `startDir` is outside `homedir`, walks to
 * the filesystem root (where `dirname(x) === x`).
 */
export function walkUpProjectPaths(
  startDir: string,
  homedir: string = os.homedir(),
): string[] {
  const paths: string[] = []
  let cur = path.resolve(startDir)
  const stopAt = path.resolve(homedir)

  while (true) {
    paths.push(path.join(cur, ".opencode", "pantheon.json"))
    if (cur === stopAt) break
    const parent = path.dirname(cur)
    if (parent === cur) break // filesystem root
    cur = parent
  }

  return paths
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/modules/pantheon-config/paths.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/pantheon-config/paths.ts tests/modules/pantheon-config/paths.test.ts && git commit -m "feat(pantheon-config): add path resolution and walk-up discovery

Refs: spec"
```

---

### Task A4: `loader.ts` — fs read, JSONC parse, merge (TDD)

**Files:**
- Create: `src/modules/pantheon-config/loader.ts`
- Create: `tests/modules/pantheon-config/loader.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/modules/pantheon-config/loader.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { loadFresh } from "../../../src/modules/pantheon-config/loader.js"

describe("loadFresh", () => {
  let tmpHome: string
  let projectDir: string

  beforeEach(() => {
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-loader-"))
    projectDir = path.join(tmpHome, "work", "repo")
    mkdirSync(projectDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true })
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  function writeProject(dir: string, content: string): void {
    const sub = path.join(dir, ".opencode")
    mkdirSync(sub, { recursive: true })
    writeFileSync(path.join(sub, "pantheon.json"), content)
  }

  it("returns empty config and no errors when nothing exists", () => {
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents).toEqual({})
    expect(result.errors).toEqual([])
  })

  it("loads user-global only", () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
  })

  it("loads project-only", () => {
    writeProject(projectDir, `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.zmora).toEqual({ model: "anthropic/claude-sonnet-4-6" })
  })

  it("merges user-global + project per-agent (project wins on collision)", () => {
    writeUserGlobal(`{ "agents": {
      "perun": { "model": "anthropic/claude-opus-4-7" },
      "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
    } }`)
    writeProject(projectDir, `{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents).toEqual({
      perun: { model: "anthropic/claude-opus-4-7" },
      zmora: { model: "anthropic/claude-sonnet-4-6" },
    })
  })

  it("closest project file wins over farther one", () => {
    const outer = path.join(tmpHome, "work")
    writeProject(outer, `{ "agents": { "perun": { "model": "anthropic/from-outer" } } }`)
    writeProject(projectDir, `{ "agents": { "perun": { "model": "anthropic/from-inner" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun!.model).toBe("anthropic/from-inner")
  })

  it("parses JSONC with comments and trailing commas", () => {
    writeProject(
      projectDir,
      `{
        // perun gets opus
        "agents": {
          "perun": { "model": "anthropic/claude-opus-4-7", },
        },
      }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors).toEqual([])
  })

  it("records error and skips file on malformed JSON", () => {
    writeProject(projectDir, `{ this is : not json`)
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.errors.some((e) => /failed to parse/.test(e))).toBe(true)
    // user-global still applied
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
  })

  it("records error on non-object top-level and continues", () => {
    writeProject(projectDir, `["not", "an", "object"]`)
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.errors.some((e) => /top-level must be object/.test(e))).toBe(true)
    expect(result.config.agents).toEqual({})
  })

  it("skips invalid model but keeps valid ones in the same file", () => {
    writeProject(
      projectDir,
      `{ "agents": {
        "perun": { "model": "anthropic/claude-opus-4-7" },
        "broken": { "model": "no-slash" }
      } }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.config.agents.broken).toBeUndefined()
    expect(result.errors.some((e) => /invalid model "no-slash"/.test(e))).toBe(true)
  })

  it("warns on unknown top-level section but still applies known ones", () => {
    writeProject(
      projectDir,
      `{
        "dispatch": { "maxParallel": 4 },
        "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } }
      }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors.some((e) => /unknown section "dispatch"/.test(e))).toBe(true)
  })

  it("warns on unknown agent field but keeps model", () => {
    writeProject(
      projectDir,
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7", "temperature": 0.5 } } }`,
    )
    const result = loadFresh({ startDir: projectDir, homedir: tmpHome })
    expect(result.config.agents.perun).toEqual({ model: "anthropic/claude-opus-4-7" })
    expect(result.errors.some((e) => /unknown field "agents\.perun\.temperature"/.test(e))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/modules/pantheon-config/loader.test.ts
```

Expected: fails — module not found.

- [ ] **Step 3: Implement loader.ts**

Create `src/modules/pantheon-config/loader.ts`:

```typescript
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import * as jsoncParser from "jsonc-parser"
import { type PantheonConfig, validateConfigFile } from "./schema.js"
import { userGlobalPath, walkUpProjectPaths } from "./paths.js"

/**
 * No-cache, side-effect-explicit loader. `loadPantheonConfig` in index.ts
 * wraps this with a module-scope cache. Tests call `loadFresh` directly so
 * each test starts from a clean slate.
 *
 * Reads user-global first (base), then project paths from furthest to
 * closest. Closest entry wins per agent.
 */

export type LoadFreshOptions = {
  /** Defaults to process.cwd(). */
  startDir?: string
  /** Defaults to os.homedir(). */
  homedir?: string
}

export type LoadResult = {
  config: PantheonConfig
  errors: string[]
}

export function loadFresh(options: LoadFreshOptions = {}): LoadResult {
  const startDir = options.startDir ?? process.cwd()
  const homedir = options.homedir ?? os.homedir()

  // Order: user-global (base), then project paths from FURTHEST → CLOSEST.
  // walkUpProjectPaths returns closest-first, so reverse it.
  const projectAscending = walkUpProjectPaths(startDir, homedir).slice().reverse()
  const ordered = [userGlobalPath(homedir), ...projectAscending]

  const result: PantheonConfig = { agents: {} }
  const errors: string[] = []

  for (const filePath of ordered) {
    if (!existsSync(filePath)) continue

    let raw: string
    try {
      raw = readFileSync(filePath, "utf8")
    } catch (err) {
      errors.push(
        `[pantheon] ${filePath}: failed to read — ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }

    const parseErrors: jsoncParser.ParseError[] = []
    const parsed = jsoncParser.parse(raw, parseErrors, { allowTrailingComma: true })

    if (parseErrors.length > 0) {
      const detail = parseErrors
        .map((e) => `${jsoncParser.printParseErrorCode(e.error)}@${e.offset}`)
        .join(", ")
      errors.push(`[pantheon] ${filePath}: failed to parse — ${detail}`)
      continue
    }

    const { config, errors: fileErrors } = validateConfigFile(parsed, filePath)
    for (const e of fileErrors) errors.push(e)

    for (const [name, agent] of Object.entries(config.agents)) {
      result.agents[name] = agent
    }
  }

  return { config: result, errors }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/modules/pantheon-config/loader.test.ts
```

Expected: all 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/pantheon-config/loader.ts tests/modules/pantheon-config/loader.test.ts && git commit -m "feat(pantheon-config): add loader with JSONC parsing and closest-wins merge

Refs: spec"
```

---

### Task A5: `index.ts` — public API with module-scope cache

**Files:**
- Create: `src/modules/pantheon-config/index.ts`
- Modify: `tests/modules/pantheon-config/loader.test.ts` (add cache test using public API)

- [ ] **Step 1: Implement index.ts**

Create `src/modules/pantheon-config/index.ts`:

```typescript
import { loadFresh, type LoadResult } from "./loader.js"

export type { PantheonConfig } from "./schema.js"
export { validateConfigFile } from "./schema.js"
export { userGlobalPath, walkUpProjectPaths } from "./paths.js"
export { loadFresh } from "./loader.js"

/**
 * Module-scope cache. `loadPantheonConfig`, `getLoadErrors`, and
 * `pantheonConfigEmpty` share the same cached result so all three reflect
 * the same load attempt. The cache lives for the lifetime of the OpenCode
 * process — restart is required to pick up edits to pantheon.json.
 *
 * Tests must call `__resetCacheForTests()` in `beforeEach` to avoid
 * cross-test pollution.
 */
let cached: LoadResult | undefined

function ensureLoaded(): LoadResult {
  if (cached === undefined) {
    cached = loadFresh()
  }
  return cached
}

export function loadPantheonConfig() {
  return ensureLoaded().config
}

export function getLoadErrors(): string[] {
  return ensureLoaded().errors
}

export function pantheonConfigEmpty(): boolean {
  return Object.keys(ensureLoaded().config.agents).length === 0
}

/** Test-only: reset the cache between tests. Do not call in production code. */
export function __resetCacheForTests(): void {
  cached = undefined
}
```

- [ ] **Step 2: Add cache test to loader.test.ts**

Append to `tests/modules/pantheon-config/loader.test.ts`:

```typescript
import {
  __resetCacheForTests,
  loadPantheonConfig,
  pantheonConfigEmpty,
} from "../../../src/modules/pantheon-config/index.js"

describe("module-scope cache (index.ts)", () => {
  beforeEach(() => {
    __resetCacheForTests()
  })

  it("caches the loaded config across calls", () => {
    const a = loadPantheonConfig()
    const b = loadPantheonConfig()
    expect(a).toBe(b) // same object reference
  })

  it("reflects emptiness via pantheonConfigEmpty()", () => {
    // No pantheon.json anywhere under tmp — but the real cwd could have one.
    // We assert the API exists and returns a boolean; the strict empty check
    // lives in tests that control startDir via loadFresh.
    expect(typeof pantheonConfigEmpty()).toBe("boolean")
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run tests/modules/pantheon-config/
```

Expected: all tests (schema + paths + loader + cache) PASS.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/pantheon-config/index.ts tests/modules/pantheon-config/loader.test.ts && git commit -m "feat(pantheon-config): expose public API with module-scope cache

Refs: spec"
```

---

## Phase B — Rename `qa-tester` → `zmora` (atomic per file group)

> Each task in Phase B updates source AND tests in lockstep, then commits. Tests are updated FIRST (to assert the new names), then source is updated to make them pass — TDD style for renames.

### Task B1: Update `sanitize.ts` (functional regex)

**Files:**
- Modify: `src/modules/coordinator/sanitize.ts:94,100,76-90` (regex literal + replacement + doc comments)
- Modify: `tests/modules/coordinator/sanitize.test.ts` (fixture rename)

- [ ] **Step 1: Inspect current state**

```bash
grep -n "qa-tester" src/modules/coordinator/sanitize.ts tests/modules/coordinator/sanitize.test.ts
```

Note the line numbers — there's a doc-block (lines ~76-90), the regex literal (`VARIANT_SUFFIX_PATTERN`), and the replacement string `"qa-tester"`.

- [ ] **Step 2: Update test fixtures first (will fail until source changes)**

In `tests/modules/coordinator/sanitize.test.ts`, replace every `qa-tester` with `zmora` in fixtures and assertions. Use:

```bash
grep -n "qa-tester" tests/modules/coordinator/sanitize.test.ts
```

For each match, edit the line replacing `qa-tester-fe`/`qa-tester-be` with `zmora-fe`/`zmora-be`, and bare `qa-tester` with `zmora`.

- [ ] **Step 3: Run sanitize tests — expect failures**

```bash
npx vitest run tests/modules/coordinator/sanitize.test.ts
```

Expected: tests for `normalizeVariantSuffix` FAIL (production code still says `qa-tester`).

- [ ] **Step 4: Update source `sanitize.ts`**

In `src/modules/coordinator/sanitize.ts`:

Replace the regex literal:
```typescript
const VARIANT_SUFFIX_PATTERN = /\bqa-tester-(?:fe|be)\b/g
```
with:
```typescript
const VARIANT_SUFFIX_PATTERN = /\bzmora-(?:fe|be)\b/g
```

Replace the replacement string (currently `s.replace(VARIANT_SUFFIX_PATTERN, "qa-tester")`):
```typescript
return s.replace(VARIANT_SUFFIX_PATTERN, "zmora")
```

Update the doc-block (lines ~76-90). Currently it says things like *"Rewrites the internal `qa-tester` variant suffix into the logical agent name"*. Rewrite to:

```typescript
/**
 * Rewrites the internal `zmora` variant suffix into the logical agent name
 * before it surfaces in user-facing output. Internally Zmora is two
 * subagents — `zmora-fe` and `zmora-be` — but `docs/configuring-agents.md`
 * and the Perun prompt both promise that only the logical `zmora` name
 * appears in reports, dispatch labels, and report paths.
 *
 * The variant suffix is internal scaffolding; sanitization is what keeps
 * that promise. We still validate the un-rewritten variant names
 * (`zmora-fe` / `zmora-be`) against the agent registry — only the
 * stringification for human eyes is normalized here.
 */
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/modules/coordinator/sanitize.test.ts
```

Expected: all sanitize tests PASS.

- [ ] **Step 6: Run full coordinator suite (others may still reference qa-tester — that's OK, fixed in later tasks)**

```bash
npx vitest run tests/modules/coordinator/sanitize.test.ts
```

Expected: this specific file PASS. Other coordinator tests are addressed in Task B2/B3.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/sanitize.ts tests/modules/coordinator/sanitize.test.ts && git commit -m "refactor(coordinator)!: rename qa-tester variant suffix to zmora in sanitize

BREAKING CHANGE: normalizeVariantSuffix now rewrites zmora-fe/zmora-be
instead of qa-tester-fe/qa-tester-be. Must be merged in the same release
as the registry-key rename.

Refs: spec"
```

---

### Task B2: Update `dispatch.ts` and `coordinator/index.ts` non-functional references

**Files:**
- Modify: `src/modules/coordinator/dispatch.ts:133,135` (comments)
- Modify: `src/modules/coordinator/index.ts:83` (tool description string)
- Modify: `tests/modules/coordinator/dispatch.test.ts` (assertions)
- Modify: `tests/modules/coordinator/perun-qa-flow.test.ts` (assertions)

- [ ] **Step 1: Update test assertions first**

```bash
grep -n "qa-tester" tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/perun-qa-flow.test.ts
```

For each match in the assertions, replace `qa-tester-fe`/`qa-tester-be` → `zmora-fe`/`zmora-be`, and bare `qa-tester` → `zmora`.

- [ ] **Step 2: Run those test files — expect failures**

```bash
npx vitest run tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/perun-qa-flow.test.ts
```

Expected: tests that interact with `dispatch_parallel` tool description or use `qa-tester*` names FAIL.

- [ ] **Step 3: Update `dispatch.ts` comments**

In `src/modules/coordinator/dispatch.ts`, around lines 133–135, replace the comment:
```typescript
// as the original variants (qa-tester-fe / qa-tester-be); only the OUTPUT
// ...
// injection cannot leak `qa-tester-fe` / `qa-tester-be` into reports.
```
with:
```typescript
// as the original variants (zmora-fe / zmora-be); only the OUTPUT
// ...
// injection cannot leak `zmora-fe` / `zmora-be` into reports.
```

(Preserve the surrounding sentences — only swap the variant names.)

- [ ] **Step 4: Update `coordinator/index.ts` tool description**

In `src/modules/coordinator/index.ts` around line 83, the `dispatch_parallel` tool description has:

```typescript
"Exception for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `qa-tester` → `qa-tester-fe` + `qa-tester-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent's prompt."
```

Replace with:

```typescript
"Exception for logical agents with multiple variants: when a logical agent is implemented as multiple registered names (e.g. `zmora` → `zmora-fe` + `zmora-be`), use the logical name in `agent`, not the variant names. Document the mapping in the dispatching agent's prompt."
```

- [ ] **Step 5: Run coordinator tests to verify they pass**

```bash
npx vitest run tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/perun-qa-flow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/dispatch.ts src/modules/coordinator/index.ts tests/modules/coordinator/dispatch.test.ts tests/modules/coordinator/perun-qa-flow.test.ts && git commit -m "refactor(coordinator)!: rename qa-tester to zmora in dispatch and tool description

Refs: spec"
```

---

### Task B3: Update `qa/` module source + tests

**Files:**
- Modify: `src/modules/qa/index.ts` (variant key `qa-tester-${stack}` → `zmora-${stack}`, description)
- Modify: `src/modules/qa/prompt-builder.ts` (`frontmatter.name`, description)
- Modify: `src/modules/qa/allowed-tools.ts` (header comment)
- Modify: `tests/modules/qa/plugin.test.ts` (fixtures, expected agent names)

- [ ] **Step 1: Update test expectations first**

In `tests/modules/qa/plugin.test.ts`:

Replace the `EXPECTED_VARIANTS` and `REMOVED_AGENTS` arrays:
```typescript
const EXPECTED_VARIANTS = ["zmora-fe", "zmora-be"]
const REMOVED_AGENTS = ["qa-tester-fe", "qa-tester-be", "qa-tester", "qa-fe-tester", "qa-be-tester"]
```

Find any other `qa-tester*` literal — replace with `zmora*` for kept names, leave the old names in REMOVED_AGENTS so the test guards against accidental regression.

- [ ] **Step 2: Run qa test file — expect failures**

```bash
npx vitest run tests/modules/qa/plugin.test.ts
```

Expected: `registers zmora-fe variant` FAILS (plugin still registers `qa-tester-fe`).

- [ ] **Step 3: Update `src/modules/qa/index.ts`**

Edit the agent registration loop. Replace:
```typescript
for (const stack of VARIANTS) {
  let cached: string | undefined
  config.agent[`qa-tester-${stack}`] = {
    description: `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`,
    get prompt() {
      cached ??= buildQATesterAgent(stack).prompt
      return cached
    },
    mode: "subagent",
  }
}
```
with:
```typescript
for (const stack of VARIANTS) {
  let cached: string | undefined
  config.agent[`zmora-${stack}`] = {
    description: `Zmora — ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`,
    get prompt() {
      cached ??= buildQATesterAgent(stack).prompt
      return cached
    },
    mode: "subagent",
  }
}
```

- [ ] **Step 4: Update `src/modules/qa/prompt-builder.ts`**

Replace:
```typescript
export function buildQATesterAgent(stack: QaTesterStack): BuiltAgent {
  const tools = toolsForVariant(stack).join(", ")
  const description = `QA tester — ${stack.toUpperCase()} scenarios (internal variant of qa-tester)`
  const frontmatter = [
    "---",
    `name: qa-tester-${stack}`,
    ...
```
with:
```typescript
export function buildQATesterAgent(stack: QaTesterStack): BuiltAgent {
  const tools = toolsForVariant(stack).join(", ")
  const description = `Zmora — ${stack.toUpperCase()} QA scenarios (internal variant of zmora)`
  const frontmatter = [
    "---",
    `name: zmora-${stack}`,
    ...
```

> Note: the **function name** `buildQATesterAgent` stays unchanged. Renaming a function across the codebase increases scope without value; the user-facing name (in frontmatter) is what matters.

- [ ] **Step 5: Update `src/modules/qa/allowed-tools.ts` header comment**

Replace lines 1-3 (currently):
```typescript
// Per-variant tool allowlists for qa-tester variants. Splitting at this layer
// keeps the runtime tool-allowlist as the security boundary: one variant
// cannot exec the other variant's tools regardless of prompt content.
```
with:
```typescript
// Per-variant tool allowlists for zmora variants. Splitting at this layer
// keeps the runtime tool-allowlist as the security boundary: one variant
// cannot exec the other variant's tools regardless of prompt content.
```

- [ ] **Step 6: Run qa tests**

```bash
npx vitest run tests/modules/qa/plugin.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/index.ts src/modules/qa/prompt-builder.ts src/modules/qa/allowed-tools.ts tests/modules/qa/plugin.test.ts && git commit -m "refactor(qa)!: rename qa-tester variants to zmora-fe/zmora-be

BREAKING CHANGE: agent registry keys changed from qa-tester-fe/qa-tester-be
to zmora-fe/zmora-be. Slash commands /create-qa-plan and /run-qa are
unchanged.

Refs: spec"
```

---

### Task B4: Update prompts and command templates

**Files:**
- Modify: `src/agents/perun.md` (specialist table, workflow references)
- Modify: `src/commands/run-qa.md` (5 mentions)
- Modify: `src/modules/qa/prompt-sections/core.md` (1 mention)
- Verify: `src/commands/create-qa-plan.md` (grep should find 0 mentions)

- [ ] **Step 1: Locate mentions**

```bash
grep -nE "qa-tester|qa tester|QA tester" src/agents/perun.md src/commands/run-qa.md src/modules/qa/prompt-sections/core.md src/commands/create-qa-plan.md
```

Inspect each match in context.

- [ ] **Step 2: Update `src/modules/qa/prompt-sections/core.md`**

Find the line: *"3. Load the matching skill: FE prefix → `skill(name: "fe-testing")`; BE prefix → `skill(name: "be-testing")`."*

Above it line 3 reads `"qa-tester received scenario without recognised FE-/BE- prefix"`. Replace with `"zmora received scenario without recognised FE-/BE- prefix"`.

Also replace any other "qa-tester" or "QA Tester" (heading) — match casing:
- `# QA Tester` heading → `# Zmora (QA Tester)`
- bare `qa-tester` → `zmora`

- [ ] **Step 3: Update `src/agents/perun.md`**

In the "Available Specialists" table, change:
- `qa-tester` → `zmora`
- All references to `qa-tester-fe` / `qa-tester-be` → `zmora-fe` / `zmora-be`

In Workflow 1 (per-scenario dispatch), update every `name: "qa-tester-fe"` / `name: "qa-tester-be"` to the new names. The FE/BE prefix routing logic is unchanged — only the target agent names change.

Use grep + targeted edits:
```bash
grep -n "qa-tester" src/agents/perun.md
```
Edit each occurrence.

- [ ] **Step 4: Update `src/commands/run-qa.md`**

```bash
grep -n "qa-tester" src/commands/run-qa.md
```

5 mentions — edit each:
- bare `qa-tester` → `zmora`
- `qa-tester-fe` → `zmora-fe`
- `qa-tester-be` → `zmora-be`

- [ ] **Step 5: Verify `src/commands/create-qa-plan.md` is clean**

```bash
grep -c "qa-tester" src/commands/create-qa-plan.md
```

Expected: `0`. If non-zero, edit accordingly.

- [ ] **Step 6: Build + run all tests (the prompt content gets cached and compared in plugin.test.ts)**

```bash
npm run test
```

Expected: green across the suite. If `tests/modules/qa/plugin.test.ts` has assertions on prompt body content (e.g. `expect(prompt).toContain("...")`), update those too.

- [ ] **Step 7: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/agents/perun.md src/commands/run-qa.md src/modules/qa/prompt-sections/core.md && git commit -m "refactor(qa,perun)!: rename qa-tester to zmora in prompts and commands

Refs: spec"
```

---

### Task B5: Grep guard — verify no `qa-tester` remains in src/ or tests/

**Files:** none modified — verification only.

- [ ] **Step 1: Grep**

```bash
grep -rn "qa-tester" src/ tests/ 2>/dev/null
```

Expected: **zero output**. If there are hits, edit them and re-run grep until clean. Re-run `npm run test` after any edit.

- [ ] **Step 2: Confirm full test suite passes**

```bash
npm run test
```

Expected: all green. If anything fails, fix before continuing.

- [ ] **Step 3: No commit needed** (verification step). If you had to fix a stray reference, commit it with:
```bash
AV_COMMIT_SKILL=1 git add -A && git commit -m "refactor: clean up stray qa-tester references

Refs: spec"
```

---

## Phase C — Wire `pantheon-config` into agent registration

### Task C1: Inject Perun model in `coordinator/index.ts` (TDD)

**Files:**
- Create: `tests/modules/coordinator/perun-model-injection.test.ts`
- Modify: `src/modules/coordinator/index.ts` (config hook)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/coordinator/perun-model-injection.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkCoordinatorPlugin model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-coord-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("sets model on 'Perun - Coordinator' when pantheon.json provides perun.model", async () => {
    writeUserGlobal(`{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`)
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBe("anthropic/claude-opus-4-7")
  })

  it("leaves model unset when no pantheon.json exists", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBeUndefined()
  })

  it("leaves model unset when perun key is absent", async () => {
    writeUserGlobal(`{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const plugin = await AppVerkCoordinatorPlugin({ client: {} } as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["Perun - Coordinator"]!.model).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/modules/coordinator/perun-model-injection.test.ts
```

Expected: FAIL — `config.agent["Perun - Coordinator"]!.model` is `undefined` because the plugin doesn't read pantheon-config yet.

- [ ] **Step 3: Modify `src/modules/coordinator/index.ts`**

Add an import near the top with the other imports:

```typescript
import { loadPantheonConfig } from "../pantheon-config/index.js"
```

Inside the returned plugin, in the `config: async (config) => { ... }` block, after the `config.agent["Perun - Coordinator"] = { ... }` assignment, add:

```typescript
const perunModel = loadPantheonConfig().agents.perun?.model
if (perunModel !== undefined) {
  config.agent["Perun - Coordinator"]!.model = perunModel
}
```

Place this immediately after the existing agent registration block but inside the same `config` hook.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/modules/coordinator/perun-model-injection.test.ts
```

Expected: all 3 cases PASS.

- [ ] **Step 5: Run full coordinator suite for regressions**

```bash
npx vitest run tests/modules/coordinator/
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/index.ts tests/modules/coordinator/perun-model-injection.test.ts && git commit -m "feat(coordinator): inject Perun model from pantheon.json

Refs: spec"
```

---

### Task C2: Inject Zmora model in `qa/index.ts` (TDD)

**Files:**
- Create: `tests/modules/qa/zmora-model-injection.test.ts`
- Modify: `src/modules/qa/index.ts` (config hook)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/qa/zmora-model-injection.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkQAPlugin Zmora model injection", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-qa-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
  })

  function writeUserGlobal(content: string): void {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), content)
  }

  it("sets model on BOTH zmora-fe and zmora-be when zmora.model is configured", async () => {
    writeUserGlobal(`{ "agents": { "zmora": { "model": "anthropic/claude-sonnet-4-6" } } }`)
    const plugin = await AppVerkQAPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["zmora-fe"]!.model).toBe("anthropic/claude-sonnet-4-6")
    expect(config.agent!["zmora-be"]!.model).toBe("anthropic/claude-sonnet-4-6")
  })

  it("leaves both variant models unset when no pantheon.json", async () => {
    const plugin = await AppVerkQAPlugin({} as never)
    const config: Config = { agent: {} }
    await plugin.config?.(config)
    expect(config.agent!["zmora-fe"]!.model).toBeUndefined()
    expect(config.agent!["zmora-be"]!.model).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test — expect failure**

```bash
npx vitest run tests/modules/qa/zmora-model-injection.test.ts
```

Expected: FAIL — model is undefined.

- [ ] **Step 3: Modify `src/modules/qa/index.ts`**

Add at the top with other imports:

```typescript
import { loadPantheonConfig } from "../pantheon-config/index.js"
```

Inside the `config` hook, after the variant-registration loop, add:

```typescript
const zmoraModel = loadPantheonConfig().agents.zmora?.model
if (zmoraModel !== undefined) {
  for (const stack of VARIANTS) {
    config.agent[`zmora-${stack}`]!.model = zmoraModel
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/modules/qa/zmora-model-injection.test.ts
```

Expected: both cases PASS.

- [ ] **Step 5: Run full qa suite**

```bash
npx vitest run tests/modules/qa/
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/qa/index.ts tests/modules/qa/zmora-model-injection.test.ts && git commit -m "feat(qa): inject Zmora model from pantheon.json on both variants

Refs: spec"
```

---

## Phase D — Toast notification

### Task D1: Add `event` hook in `coordinator/index.ts` for first-session toast (TDD)

**Files:**
- Create: `tests/modules/coordinator/notify-on-empty-config.test.ts`
- Modify: `src/modules/coordinator/index.ts` (add `event` hook)

- [ ] **Step 1: Write the failing test**

Create `tests/modules/coordinator/notify-on-empty-config.test.ts`:

```typescript
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator/index.js"
import { __resetCacheForTests } from "../../../src/modules/pantheon-config/index.js"

describe("AppVerkCoordinatorPlugin toast notification", () => {
  let tmpHome: string
  let origHome: string | undefined
  let origCwd: string
  let showToast: ReturnType<typeof vi.fn>
  let client: { tui: { showToast: typeof showToast } }

  beforeEach(() => {
    __resetCacheForTests()
    tmpHome = mkdtempSync(path.join(tmpdir(), "pantheon-toast-"))
    origHome = process.env.HOME
    process.env.HOME = tmpHome
    origCwd = process.cwd()
    const projectDir = path.join(tmpHome, "project")
    mkdirSync(projectDir, { recursive: true })
    process.chdir(projectDir)
    showToast = vi.fn().mockResolvedValue(true)
    client = { tui: { showToast } }
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (origHome === undefined) delete process.env.HOME
    else process.env.HOME = origHome
    rmSync(tmpHome, { recursive: true, force: true })
    __resetCacheForTests()
  })

  it("fires info toast on first session.created when no pantheon.json exists", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
    const arg = showToast.mock.calls[0]![0]
    expect(arg.body.variant).toBe("info")
    expect(arg.body.title).toBe("Pantheon")
    expect(arg.body.message).toMatch(/not found|default models/i)
  })

  it("does not retrigger on subsequent session.created events", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
  })

  it("fires warning toast on parse error", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, "pantheon.json"), `{ malformed`)
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast.mock.calls[0]![0].body.variant).toBe("warning")
  })

  it("does not toast when config is valid and non-empty", async () => {
    const dir = path.join(tmpHome, ".config", "opencode")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "pantheon.json"),
      `{ "agents": { "perun": { "model": "anthropic/claude-opus-4-7" } } }`,
    )
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.created" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("ignores non-session.created events", async () => {
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await plugin.event?.({ event: { type: "session.idle" } } as never)
    await plugin.event?.({ event: { type: "session.deleted" } } as never)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("does not throw when showToast itself rejects", async () => {
    showToast.mockRejectedValueOnce(new Error("TUI unavailable"))
    const plugin = await AppVerkCoordinatorPlugin({ client } as never)
    await expect(
      plugin.event?.({ event: { type: "session.created" } } as never),
    ).resolves.not.toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect failures**

```bash
npx vitest run tests/modules/coordinator/notify-on-empty-config.test.ts
```

Expected: FAIL — plugin has no `event` hook yet.

- [ ] **Step 3: Add the event hook in `src/modules/coordinator/index.ts`**

Inside `AppVerkCoordinatorPlugin`, at the top of the function body (after `const { client } = input`), declare a module-scope-equivalent flag:

```typescript
let toastShown = false
```

(Closure-scoped because the plugin factory runs once per OpenCode process — equivalent to module scope for our needs.)

Then add an `event` field to the returned object alongside `config` and `tool`:

```typescript
event: async ({ event }) => {
  if (event.type !== "session.created") return
  if (toastShown) return
  toastShown = true

  const errors = getLoadErrors()
  try {
    if (errors.length > 0) {
      await client.tui.showToast({
        body: {
          variant: "warning",
          title: "Pantheon",
          message: "pantheon.json parse error — check console for details",
        },
      })
    } else if (pantheonConfigEmpty()) {
      await client.tui.showToast({
        body: {
          variant: "info",
          title: "Pantheon",
          message: "pantheon.json not found — using default models",
        },
      })
    }
  } catch {
    // best-effort: headless / non-TUI OpenCode invocations must not crash
  }
},
```

Update the import to include the new symbols:

```typescript
import {
  getLoadErrors,
  loadPantheonConfig,
  pantheonConfigEmpty,
} from "../pantheon-config/index.js"
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/modules/coordinator/notify-on-empty-config.test.ts
```

Expected: all 6 cases PASS.

- [ ] **Step 5: Run full suite for regressions**

```bash
npm run test
```

Expected: green.

- [ ] **Step 6: Commit**

```bash
AV_COMMIT_SKILL=1 git add src/modules/coordinator/index.ts tests/modules/coordinator/notify-on-empty-config.test.ts && git commit -m "feat(coordinator): toast once on first session when pantheon.json missing or broken

Refs: spec"
```

---

## Phase E — Documentation

### Task E1: Create `docs/configuring-agents.md`

**Files:**
- Create: `docs/configuring-agents.md`

- [ ] **Step 1: Write the doc**

Create `docs/configuring-agents.md` with the following content:

````markdown
# Configuring Pantheon Agents

Pantheon agents (Perun, Zmora) can be assigned specific Anthropic models via a `pantheon.json` configuration file. This document is the canonical reference for that file.

## TL;DR

Create `~/.config/opencode/pantheon.json`:

```jsonc
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

Restart OpenCode. Perun will run on Opus, Zmora on Sonnet.

## Where the file lives

Pantheon looks in two places, in this order:

1. **User-global:** `~/.config/opencode/pantheon.json` — applies to every project.
2. **Per-project walk-up:** starting at the current working directory, Pantheon checks each ancestor for `<dir>/.opencode/pantheon.json`, walking upward and **stopping at your home directory**. The closest file wins.

### Closest wins (per agent)

If both files exist, they are merged per agent name. The **closer** file's entry replaces the user-global entry for the same agent — but agents only present in the user-global file are still applied.

Example:

```jsonc
// ~/.config/opencode/pantheon.json (user-global)
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-haiku-4-5-20251001" }
  }
}
```

```jsonc
// /my-project/.opencode/pantheon.json (project-local)
{
  "agents": {
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

Effective configuration when running inside `/my-project`:

| Agent | Model | Source |
|---|---|---|
| `perun` | `anthropic/claude-opus-4-7` | user-global |
| `zmora` | `anthropic/claude-sonnet-4-6` | project-local (overrides user-global) |

## Available agents

| Pantheon key | Registered as | Description |
|---|---|---|
| `perun` | `Perun - Coordinator` (primary) | The coordinator. Delegates work to specialists. |
| `zmora` | `zmora-fe` + `zmora-be` (subagents) | QA tester. Both variants share the same model — set once via `zmora`. |

> Internal variants of Zmora (`zmora-fe`, `zmora-be`) are subagents dispatched by Perun. They are not user-facing, but the model you set under `zmora` applies to both.

## Schema

```typescript
{
  "agents": {
    [agentName: string]: {
      "model": string  // "<providerID>/<modelID>", e.g. "anthropic/claude-opus-4-7"
    }
  }
}
```

Model strings follow OpenCode's native convention: `<providerID>/<modelID>` (exactly one slash). The same value you would put in `opencode.json` `agent.<name>.model`.

JSONC support: comments (`//` and `/* */`) and trailing commas are allowed.

## Precedence vs. `opencode.json`

OpenCode resolves an agent's effective model from several layers:

1. OpenCode built-in default (`config.model`)
2. **`pantheon.json` via the Pantheon plugin** ← this file
3. User-supplied `agent.<name>.model` in `opencode.json` ← **highest**

If you set the same agent's model in both `pantheon.json` and `opencode.json`, `opencode.json` wins. This is by design — `pantheon.json` is an opinionated layer, not a hard override.

## When no config exists

Pantheon falls back to OpenCode's default model. The first time you open a session after starting OpenCode without `pantheon.json`, you'll see a one-time TUI toast:

> **Pantheon** — pantheon.json not found — using default models

If your `pantheon.json` exists but fails to parse, you'll see a warning toast instead. Check the OpenCode console output for the specific parse error.

## Restart required

Changes to `pantheon.json` only take effect after restarting OpenCode. There is no hot-reload in the current version.

## FAQ

**Q: What model strings are valid?**
A: Anything in the form `<providerID>/<modelID>` with exactly one slash. Examples:
- `anthropic/claude-opus-4-7`
- `anthropic/claude-sonnet-4-6`
- `anthropic/claude-haiku-4-5-20251001`

**Q: I set `agent.zmora.model` in `opencode.json` but it's not used. Why?**
A: The OpenCode registry key is `zmora-fe` / `zmora-be`, not `zmora`. The `zmora` key only exists inside `pantheon.json` as the logical agent name. To override in `opencode.json`, set `agent."zmora-fe".model` and `agent."zmora-be".model` separately.

**Q: I added a section like `dispatch` or `logging` to `pantheon.json`. What happens?**
A: The current loader ignores unknown top-level sections (with a debug log). Future Pantheon versions may add such sections — your file is forward-compatible.

**Q: The walk-up scares me. Will Pantheon read configs from outside my home directory?**
A: No. The walk stops at your home directory. If your `cwd` is outside `$HOME` entirely (uncommon), the walk continues to the filesystem root — in that case, audit the paths it would visit before adding any sensitive content.

## See also

- [Spec — Pantheon Per-Agent Model Configuration](superpowers/specs/2026-05-22-pantheon-per-agent-model-design.md)
- `AGENTS.md` — repository contributor guide
````

- [ ] **Step 2: Verify it renders sanely**

```bash
wc -l docs/configuring-agents.md
```

Expected: roughly 130–180 lines.

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/configuring-agents.md && git commit -m "docs: add user-facing pantheon configuration reference

Refs: spec"
```

---

### Task E2: Update legacy `docs/plugins/*` for consistency

**Files:**
- Modify: `docs/plugins/qa.md`
- Modify: `docs/plugins/coordinator.md` (16 mentions)
- Modify: `docs/plugins/pantheon.md` (1 mention)

- [ ] **Step 1: Locate mentions**

```bash
grep -n "qa-tester" docs/plugins/qa.md docs/plugins/coordinator.md docs/plugins/pantheon.md
```

- [ ] **Step 2: Edit each file**

For each mention, apply the rename:
- `qa-tester-fe` → `zmora-fe`
- `qa-tester-be` → `zmora-be`
- bare `qa-tester` → `zmora`
- `QA Tester` (heading) → `Zmora (QA Tester)` (preserves discoverability while introducing the new name)

Pay special attention to `docs/plugins/coordinator.md` — 16 mentions, several inside code samples, dispatch labels, and "Logical Agents with Variants" subsection. Do not edit any text that explains the historical concept; only update names.

- [ ] **Step 3: Verify clean**

```bash
grep -rn "qa-tester" docs/plugins/
```

Expected: zero hits.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add docs/plugins/qa.md docs/plugins/coordinator.md docs/plugins/pantheon.md && git commit -m "docs(legacy): rename qa-tester to zmora in docs/plugins/*

Refs: spec"
```

---

### Task E3: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update the monorepo-layout table**

In `AGENTS.md`, find the table starting with `| Path | Role |`. Update the `src/modules/qa/` row to replace `qa-tester` mentions with `zmora`. The row should describe Zmora as a logical agent with `zmora-fe` and `zmora-be` variants.

Add a NEW row for `src/modules/pantheon-config/`:

```markdown
| `src/modules/pantheon-config/` | Harness-resident **library** (no plugin export) — reads `pantheon.json` (user-global + per-project walk-up, closest-wins merge) and exposes `loadPantheonConfig()` / `getLoadErrors()` / `pantheonConfigEmpty()`. Consumed by `coordinator/` and `qa/` in their `config` hooks. Tests: `tests/modules/pantheon-config/`. Built into `dist/modules/pantheon-config/`. |
```

- [ ] **Step 2: Relax the "Documentation Checklist"**

Find the section under `## Documentation Checklist` → `### README.md (root)`. Replace the existing 6-item list with:

```markdown
### `README.md` (root)

The README is harness-first (Pantheon agents + configuration). When you add a new piece:

1. **If it is user-facing in the harness** (a new primary agent, a new subagent surfaced through Perun, or a new configuration surface), add a short entry under "What you get today" and link to its detailed reference under `docs/`.
2. **If it is plumbing** (a new library module like `pantheon-config`, a new dispatch primitive, a hook), update `AGENTS.md`'s monorepo-layout table — do not add to the README. The README is not a system-architecture diagram.

Do **not** maintain a plugin badge, a comprehensive command/agent table, or per-plugin marketing copy. Those constructs were retired with the harness pivot.
```

Find the section `### docs/plugins/<name>.md (per-plugin guide)`. Replace its contents with:

```markdown
### `docs/<topic>.md` (harness reference)

For user-facing harness concerns (e.g. configuration, agent reference, workflow guides), write a dedicated topic doc directly under `docs/`. `docs/configuring-agents.md` is the first of these.

> Do **not** add new files under `docs/plugins/`. That tree is legacy and will be removed once the harness migration completes.
```

- [ ] **Step 3: Add a brief subsection linking to the config doc**

Find a spot near the top of AGENTS.md (after the "Monorepo Layout" section feels natural). Insert:

```markdown
## Pantheon harness configuration

Per-agent model selection lives in `pantheon.json`. See [`docs/configuring-agents.md`](docs/configuring-agents.md) for the user-facing reference; see [`docs/superpowers/specs/2026-05-22-pantheon-per-agent-model-design.md`](docs/superpowers/specs/2026-05-22-pantheon-per-agent-model-design.md) for the design rationale.
```

- [ ] **Step 4: Verify no stray qa-tester**

```bash
grep -n "qa-tester" AGENTS.md
```

Expected: zero hits.

- [ ] **Step 5: Commit**

```bash
AV_COMMIT_SKILL=1 git add AGENTS.md && git commit -m "docs: update AGENTS.md for pantheon-config module and harness-first README

Refs: spec"
```

---

### Task E4: Rewrite `README.md` from scratch

**Files:**
- Modify: `README.md` (full rewrite)

- [ ] **Step 1: Replace the entire file content**

Overwrite `README.md` with:

````markdown
# Pantheon — Agent Harness

> **Status:** Early / WIP. Migrating from a bundle of OpenCode plugins to a dedicated agent harness. The surface described here is the supported one; legacy plugins remain in the repository but are not documented here.

Pantheon is an OpenCode-based harness for orchestrating AI agents on AppVerk workflows. The harness today provides a coordinator agent that delegates work to specialists, a QA agent for executing test plans, and per-agent model configuration.

## What you get today

- **`@perun`** — the Pantheon coordinator. Primary agent. Delegates work to specialist subagents, computes dispatch waves with dependency awareness, and synthesizes results.
- **`@zmora`** — QA tester. Executes a single QA scenario (FE or BE). Internally split into two subagent variants (`zmora-fe`, `zmora-be`) routed by scenario prefix; users interact with the logical `zmora` name via Perun.
- **`pantheon.json`** — per-agent model configuration. User-global and per-project, closest-wins. See [Configuring agents](#configuring-agents).

The QA workflow is exposed via two slash commands:

- `/create-qa-plan` — analyzes recent changes and generates a structured QA plan.
- `/run-qa` — executes a plan via Perun, dispatching each scenario to the appropriate Zmora variant.

## Installation

Add to your OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "av-opencode-plugins@git+https://github.com/AppVerk/av-opencode-plugins.git#v0.3.0"
  ]
}
```

Restart OpenCode after installation or any config change.

## Quick start

```text
/create-qa-plan
/run-qa
```

Perun reads the most recent plan from `docs/testing/plans/`, dispatches each FE/BE scenario to the right Zmora variant, and aggregates results into `docs/testing/reports/`.

## Configuring agents

Per-agent model selection lives in `pantheon.json`:

```jsonc
// ~/.config/opencode/pantheon.json
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
```

The full reference (locations, precedence, schema, FAQ) is in [`docs/configuring-agents.md`](docs/configuring-agents.md).

## Documentation

- [`docs/configuring-agents.md`](docs/configuring-agents.md) — per-agent model configuration via `pantheon.json`.
- [`AGENTS.md`](AGENTS.md) — repository contributor guide.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — design specs.
- [`docs/superpowers/plans/`](docs/superpowers/plans/) — implementation plans.

## Repository layout

- `src/agents/` — agent prompts (e.g. `perun.md`).
- `src/modules/coordinator/` — Perun plugin: `dispatch_parallel`, `assign_issue_ids`, `compute_waves` tools.
- `src/modules/qa/` — Zmora plugin (`zmora-fe`, `zmora-be` variants); `/create-qa-plan`, `/run-qa` commands.
- `src/modules/pantheon-config/` — library: `pantheon.json` loader and merge logic.
- `src/hooks/session-notification/` — macOS desktop notifications for session events.
- `packages/*` — legacy workspace plugins still bundled (pending removal as the harness matures).
````

- [ ] **Step 2: Verify the README is the new shape**

```bash
wc -l README.md
head -1 README.md
grep -c "Plugins" README.md
```

Expected:
- `wc -l` reports `~70–80` lines (down from 327)
- `head -1` shows `# Pantheon — Agent Harness`
- `grep -c "Plugins"` → 0 (badge removed)

- [ ] **Step 3: Commit**

```bash
AV_COMMIT_SKILL=1 git add README.md && git commit -m "docs: rewrite README harness-first (Perun + Zmora + pantheon.json)

The previous README was a 327-line plugin-marketing artifact. This version
describes only the harness surface: Perun, Zmora, pantheon.json, and the
QA workflow. Legacy workspace plugins (python/frontend/swift/review/etc.)
are intentionally not documented here and will be removed as the harness
matures.

Refs: spec"
```

---

## Phase F — Versioning, dist-sync, smoke test

### Task F1: Bump versions to `0.3.0`

**Files:**
- Modify: `package.json` (root) — `version: "0.3.0"`
- Modify: `packages/code-review/package.json` — `version: "0.3.0"`
- Modify: `packages/frontend-developer/package.json` — `version: "0.3.0"`
- Modify: `packages/python-developer/package.json` — `version: "0.3.0"`
- Modify: `packages/skill-registry/package.json` — `version: "0.3.0"`
- Modify: `packages/skill-utils/package.json` — `version: "0.3.0"`
- Modify: `packages/swift-developer/package.json` — `version: "0.3.0"`

- [ ] **Step 1: Bump root version**

Edit `package.json`: change `"version": "0.2.16"` → `"version": "0.3.0"`.

- [ ] **Step 2: Bump every workspace**

For each path in the list above, change `"version": "0.2.16"` → `"version": "0.3.0"`.

- [ ] **Step 3: Verify**

```bash
grep -r '"version"' package.json packages/*/package.json | grep -v node_modules
```

Expected: every line shows `0.3.0`.

- [ ] **Step 4: Commit**

```bash
AV_COMMIT_SKILL=1 git add package.json packages/*/package.json && git commit -m "chore(release)!: bump version to 0.3.0

BREAKING CHANGE: qa-tester agent renamed to zmora (zmora-fe / zmora-be).
Users referencing qa-tester-fe / qa-tester-be in opencode.json must
update to zmora-fe / zmora-be.

Refs: spec"
```

---

### Task F2: Update `.opencode/opencode.json` plugin reference

**Files:**
- Modify: `.opencode/opencode.json`

- [ ] **Step 1: Inspect current**

```bash
cat .opencode/opencode.json
```

Current shape (or similar):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///Users/mef1st0/Projects/AppVerk/av-opencode-plugins"
  ]
}
```

If the reference is a `file://` path (local dev), leave it as is — local plugin loading does not pin to a tag. If it pins to a git ref like `#v0.2.16`, update to `#v0.3.0`.

- [ ] **Step 2: Edit if necessary**

If a git tag reference exists, replace `#v0.2.16` with `#v0.3.0`.

- [ ] **Step 3: Commit (only if changed)**

```bash
AV_COMMIT_SKILL=1 git add .opencode/opencode.json && git commit -m "chore: pin .opencode plugin ref to v0.3.0

Refs: spec"
```

---

### Task F3: Update `scripts/verify-dist-sync.mjs`

**Files:**
- Modify: `scripts/verify-dist-sync.mjs`

- [ ] **Step 1: Verify current `trackedDistPaths` covers `dist/modules/pantheon-config/`**

The current array contains `"dist"` as the first entry, which is the **root** dist. Since the build emits `dist/modules/pantheon-config/*` under that tree, no new entry is needed — the existing `"dist"` covers it. However, this is worth documenting.

- [ ] **Step 2: Add a comment in the script**

In `scripts/verify-dist-sync.mjs`, above the `const trackedDistPaths` declaration, insert:

```javascript
// Root `dist/` covers `dist/modules/*` (commit, qa, coordinator, pantheon-config),
// `dist/agents/`, `dist/commands/`, `dist/skills/`, `dist/hooks/` — everything
// the root tsup config emits. Per-package paths are listed individually below.
```

- [ ] **Step 3: Run the script to confirm dist sync**

```bash
node scripts/verify-dist-sync.mjs
```

Expected: builds, then `✅ dist/ is in sync with src/` (or shows diff if dist hasn't been rebuilt yet — if so, the script will exit non-zero and instruct you to commit dist changes).

- [ ] **Step 4: If dist changed, commit it**

```bash
AV_COMMIT_SKILL=1 git add dist scripts/verify-dist-sync.mjs && git commit -m "build(dist): regenerate after pantheon-config addition and zmora rename

Refs: spec"
```

---

### Task F4: Run full `npm run check` and address any drift

**Files:** none — verification.

- [ ] **Step 1: Run the full check**

```bash
npm run check
```

This runs typecheck + test + build across root and all workspaces.

Expected: green. Common failures and remedies:

| Failure | Likely cause | Fix |
|---|---|---|
| `Cannot find module '../pantheon-config/index.js'` | Coordinator or QA module imports the new module but build order missed it | The root tsup builds everything under `src/` in one pass — re-run `npm run build:root`. If the issue persists, inspect `tsup.root.config.ts`. |
| `tests/root-plugin.test.ts` packaging assertion fails on `dist/modules/pantheon-config/` | `npm pack --dry-run` doesn't include the new module | Add `dist/modules/pantheon-config/*.js` and `*.d.ts` to the root `package.json` `files` field if it's path-listed. Inspect what `files` already contains — if it's `["dist", ...]`, the entire tree is already published and nothing more needs adding. |
| `verify-dist-sync.mjs` reports drift | Committed dist not regenerated | Run `npm run build` then `git add dist/ && git commit ...`. |

- [ ] **Step 2: If `tests/root-plugin.test.ts` has an explicit list of expected files, update it**

```bash
grep -n "qa-tester\|zmora\|pantheon-config" tests/root-plugin.test.ts
```

Adjust assertions to include new paths under `dist/modules/pantheon-config/`. If the test uses a directory-prefix include (e.g. `dist/modules/`), no change is needed.

- [ ] **Step 3: Commit any fixes**

```bash
AV_COMMIT_SKILL=1 git add -A && git commit -m "test: ensure pantheon-config is covered by root packaging assertions

Refs: spec"
```

---

### Task F5: Manual smoke test (executor + user)

**Files:** none — runtime verification.

This task cannot be fully automated; it produces evidence that the integration actually works against a live OpenCode TUI. The executor walks the user through it.

- [ ] **Step 1: Build everything fresh**

```bash
npm run build
```

- [ ] **Step 2: Create a test pantheon.json**

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/pantheon.json <<'EOF'
{
  "agents": {
    "perun": { "model": "anthropic/claude-opus-4-7" },
    "zmora": { "model": "anthropic/claude-sonnet-4-6" }
  }
}
EOF
```

- [ ] **Step 3: Restart OpenCode and start a Perun session**

```text
@perun hello
```

Observation checkpoint: Perun should respond using `claude-opus-4-7`. Visually confirm by checking OpenCode's session-info display or model-switcher.

- [ ] **Step 4: Run a small QA flow**

```text
/create-qa-plan
/run-qa
```

Observation checkpoint: dispatched `zmora-fe` / `zmora-be` sessions should use `claude-sonnet-4-6`.

- [ ] **Step 5: Remove the config and restart**

```bash
rm ~/.config/opencode/pantheon.json
```

Restart OpenCode and open a session. Observation checkpoint: an info toast appears once with title "Pantheon" and message about default models. Subsequent sessions in the same OpenCode process do not show another toast.

- [ ] **Step 6: Create a malformed config**

```bash
mkdir -p ~/.config/opencode
echo '{ malformed' > ~/.config/opencode/pantheon.json
```

Restart OpenCode and open a session. Observation checkpoint: a warning toast appears once with parse-error message. Console (OpenCode logs) shows the `[pantheon] ...` parse error detail.

- [ ] **Step 7: Cleanup**

```bash
rm ~/.config/opencode/pantheon.json
```

- [ ] **Step 8: Tag v0.3.0 (deferred — only after merge to master)**

After this branch is merged to `master`:

```bash
git tag v0.3.0
git push origin v0.3.0
```

This step is **not** done during plan execution — it's listed here as a reminder for the release workflow.

---

## Self-Review Checklist (run after writing the plan; no commit needed)

- [ ] Every spec section has at least one task implementing it.
- [ ] No `TBD` / `TODO` / "add error handling" / "similar to Task N" placeholders.
- [ ] Function/type names match across tasks: `loadPantheonConfig`, `getLoadErrors`, `pantheonConfigEmpty`, `__resetCacheForTests`, `validateConfigFile`, `loadFresh`, `userGlobalPath`, `walkUpProjectPaths`, `PantheonConfig`, `ValidationResult`.
- [ ] Every TDD task: write test → run → see fail → implement → run → see pass → commit.
- [ ] Every commit message follows Conventional Commits and includes `Refs: spec`.
- [ ] Breaking-change commits use `!` in the type prefix.
- [ ] No task references a slash command interactively from a subagent context (we use env-var commits).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-22-pantheon-per-agent-model.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with isolated context per step.

**2. Inline Execution** — I execute tasks in this session using `executing-plans`, with batched checkpoints for review.

Which approach?
