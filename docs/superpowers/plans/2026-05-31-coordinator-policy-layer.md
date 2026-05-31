# Coordinator Policy Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Perun's strict-orchestrator role a code-enforced workflow rail (close the coordinator's git/bash + skill channels), via a reusable agent-keyed policy layer, with violation telemetry the eval can read and instructive rejections.

**Architecture:** A **stateless** session-identity resolver in the shared `@appverk/opencode-skill-utils` package answers "is this session the coordinator?" from `sessionID` + the plugin `client` (no shared mutable state, so it crosses the packages↔src boundary cleanly). Two consumers use it: a new `tool.execute.before` bash gate in `src/modules/coordinator-policy` (fail-**open** on identity uncertainty), and the existing `experimental.chat.system.transform` in `packages/skill-registry` (fail-**closed**: suppress skill-activation injection for the coordinator). Perun's config additionally disables the skill-loading tools. Rejections throw an instructive `Error` whose message carries a structured payload that surfaces in `info.error` (what the eval harness captures).

**Tech Stack:** TypeScript, OpenCode plugin SDK (`@opencode-ai/plugin`/`@opencode-ai/sdk` 1.15.11, v1 surface), tsup per-package builds, Bun test runner.

**Reference spec:** `docs/superpowers/specs/2026-05-31-coordinator-policy-layer-design.md`

---

## File Structure

- **Create** `packages/skill-utils/src/session-identity.ts` — stateless resolver (`getSessionAgent`, `getSessionParentID`, `isCoordinatorSession`, `COORDINATOR_AGENT_NAME`).
- **Create** `packages/skill-utils/src/coordinator-bash-policy.ts` — pure primitives (`parseAllowedBashPrograms`, `classifyCoordinatorBash`, `buildViolationError`).
- **Modify** `packages/skill-utils/src/index.ts` — export the new modules.
- **Create** `src/modules/coordinator-policy/index.ts` — the bash-gate Plugin (`tool.execute.before`).
- **Modify** `src/index.ts` — register the coordinator-policy plugin.
- **Modify** `src/modules/coordinator/index.ts` — add `tools: { skill: false, load_appverk_skill: false }` to Perun's config.
- **Modify** `packages/skill-registry/src/index.ts` — factory takes `client`; transform suppresses injection for the coordinator.
- **Create** `tests/modules/coordinator-policy/*.test.ts`, `packages/skill-utils/test/*.test.ts`, `packages/skill-registry/test/*.test.ts`.
- **Create** `docs/eval/scenarios/perun/{README.md,role-discipline.md}` — eval landing zone counting rail-rejections.
- **Modify** `src/agents/perun.md` — correct the aspirational MCP-gate prose (line ~32).

---

## Task 1: Verification spikes (no production code)

This task resolves the two genuine runtime unknowns. Record the findings inline in this plan file (edit the "Outcome" lines), then proceed; downstream tasks branch on them.

**Files:** none committed (throwaway probe only).

- [ ] **Step 1a — Does `tools: { skill: false }` block the NATIVE `skill` tool on the installed runtime?**

The installed v1 `PermissionConfig` has no `skill` key (`node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts`); v2 does. Empirically verify: in a scratch OpenCode session, register a temporary agent with `tools: { skill: false }` and attempt a `skill(name: "...")` call; observe whether the runtime refuses it.

Method (headless, mirrors the eval playbook): start `opencode serve`, create a session with a temp agent config carrying `tools: { skill: false }`, prompt it to load any skill, inspect the resulting message for a tool-rejection vs a successful skill load.

**Decision rule:**
- **Honored →** Task 5 keeps `skill: false` as the hard backstop for the native tool.
- **Not honored →** Task 5 still sets `skill: false` (harmless, future-proof for v2) but documents that the native `skill` tool stays callable on 1.15.x; the working backstops become `load_appverk_skill: false` (reliably gated) + the Task 6 injection suppression. Do NOT claim "physically cannot load any skill."

> **Outcome (2026-05-31, resolved from the installed runtime bundle — no paid model turn needed):** **HONORED.** Method: the installed `opencode` is the Homebrew **1.15.10** standalone binary (`/opt/homebrew/Cellar/opencode/1.15.10/bin/opencode`, a Bun-compiled Mach-O that embeds its full JS source); extracted via `strings` and traced the skill-invocation + permission paths. (Note: tech-stack line says 1.15.11; the runtime here is 1.15.10 — same v1 surface, no material difference for this spike.)
>
> **The runtime honors `tools:{skill:false}` for the native `skill` tool on TWO independent layers:**
> 1. **Toolset filtering (primary).** The agent-config normalizer turns `tools:{skill:false}` into an object-form permission entry `skill:"deny"` (loop `for(let[K0,I0]of Object.entries(T.tools)){let T0=I0?"allow":"deny"; ...; r[K0]=T0} T.permission=x6(r,...)`). `Permission.fromConfig` (`function Ur($){... if(typeof Y==="string"){Z.push({permission:X,action:Y,pattern:"*"})}}`) converts `{skill:"deny"}` into a ruleset rule `{permission:"skill",pattern:"*",action:"deny"}`. The tool-list builder then computes `Permission.disabled(Object.keys(A.tools), merge(agent.permission, session.permission))` and does `JB.filter(A.tools,(r,e)=>A.user.tools?.[e]!==!1 && !disabledSet.has(e))`. `Permission.disabled` (`function Xr($,Z){return new Set($.filter((X)=>{...z=Z.findLast(rule matching X); return z?.pattern==="*"&&z.action==="deny"}))}`) puts `skill` in the disabled set, so **the `skill` tool is removed from the toolset before the model ever sees it.**
> 2. **Execute-time deny (defense-in-depth).** The native skill tool's `execute` calls `e.ask({permission:"skill",patterns:[r.name],always:[r.name],...})`. `Permission.ask` evaluates `yQ("skill", skillName, ruleset, approved)` → `PermissionV2.evaluate` (`function $r($,Z,...X){return X.flat().findLast((Y)=>g7.match($,Y.permission)&&g7.match(Z,Y.pattern)) ?? {action:"ask",...}}`) → finds the `skill`/`*`/`deny` rule → `action:"deny"` → `Permission.ask` does `if(I.action==="deny")return yield*new hQ(...)` where `hQ` is `PermissionDeniedError` ("The user has specified a rule which prevents you from using this specific tool call.") — i.e. the call fails.
>
> Caveat on the SDK-type gap: the **v1 `PermissionConfig` TYPE** in `node_modules/@opencode-ai/sdk/dist/gen/types.gen.d.ts` (lines 857–876, keys `edit`/`bash`/`webfetch`/`doom_loop`/`external_directory`) has no `skill` key — but the runtime's permission engine is **string-keyed and pattern-based (PermissionV2)** and does NOT restrict permission names to that typed enum. The typed-SDK omission is cosmetic; arbitrary keys including `skill` are honored at runtime. The `AgentConfig.tools` index signature is `{[key:string]:boolean}` (line 840), so `tools:{skill:false}` is type-valid regardless.
>
> Bonus observation (informs Task 6): the runtime gates its OWN skill-availability system-prompt injection on the same permission — `if(Permission.disabled(["skill"],agent.permission).has("skill")) return;` — so when `skill` is denied, opencode itself already suppresses its built-in skill prompt. (The harness's Task-6 suppression targets the *skill-registry plugin's* `activationRules` injection, which is separate.)
>
> **Decision applied:** Task 5 keeps `tools:{skill:false}` and it IS a real backstop for the native `skill` tool on 1.15.x (not merely v2 future-proofing). The plan MAY state the coordinator cannot invoke the native `skill` tool. The other backstops (`load_appverk_skill:false` + Task-6 injection suppression) remain necessary because they cover the *plugin* skill-loader and the *skill-registry plugin's* injected activation rules, which the native-`skill` permission does not touch. Do NOT broaden the claim to "physically cannot load any skill" — the plugin tool `load_appverk_skill` is a separate channel gated by Task 5's `load_appverk_skill:false`.

- [ ] **Step 1b — On the coordinator's FIRST prompt, can `experimental.chat.system.transform` resolve the agent, and what is the exact `.info.agent` value for a Perun session?**

The transform hook fires before the turn; `client.session.messages(sessionID)` may be empty on turn 1. Probe: temporarily log, inside the skill-registry transform, `input.sessionID` and the result of `client.session.messages({ path: { id: input.sessionID } })` for (a) the Perun primary session and (b) a dispatched specialist, on their first prompt. Record the exact `.info.agent` string for Perun (is it `"Perun - Coordinator"` or a slug?).

**Decision rule for Task 6:**
- **Agent resolvable on turn 1 →** suppress when `getSessionAgent === COORDINATOR_AGENT_NAME`.
- **Empty on turn 1 →** use the `getSessionParentID` fallback: suppress when `parentID === undefined` (parentless ⇒ coordinator / user-switched primary planner; dispatched specialists have a parentID and keep injection). Record this as the chosen path.

Also pin `COORDINATOR_AGENT_NAME` (Task 2) to the observed Perun `.info.agent` value (cross-checked against the `config.agent[...]` key in `src/modules/coordinator/index.ts:352`).

> **Outcome (2026-05-31, resolved from the runtime bundle):** **`UserMessage.info.agent` for a Perun session is exactly `"Perun - Coordinator"` — the verbatim `config.agent[...]` key, NO slugification.** Evidence (1.15.10 binary):
> - Config→registry merge uses the key verbatim as the agent name: `for(let[i,h]of Object.entries(w.agent??{})){... if(!s)s=d[i]={name:i, mode:"all", ...}}` — `i` is the `config.agent` key (`"Perun - Coordinator"`) and becomes `name:i` directly. No lowercasing / dash-collapsing.
> - The `UserMessage` info object is built with `agent:bA.name` (`Z={id,role:"user",sessionID,time,tools:Y.tools, agent:bA.name, model:{...}, ...}`), where `bA` is the agent resolved from the prompt's `body.agent` via `Agent.get(P.agent)` (a verbatim by-name lookup; the not-found path lists agents by their `.name`).
> - Cross-check: `src/modules/coordinator/sdk-specialist.ts` dispatches specialists with `body:{agent:agentName}` where `agentName` is the registered display name (`"Veles - Planner"`, `"zmora-fe"`); the same `Agent.get(body.agent)` → `agent:bA.name` path stamps that exact string onto each specialist's `UserMessage.agent`. So Perun's primary session and dispatched specialists both carry their verbatim registered names.
>
> **⇒ Pin `COORDINATOR_AGENT_NAME = "Perun - Coordinator"` (Task 2).** This already matches the constant in the Task 2 / Task 6 / Task 7 sample code (`"Perun - Coordinator"`); no change required. The Task 7 sync test (`expect(src).toContain('"' + COORDINATOR_AGENT_NAME + '"')`) will pass against `src/modules/coordinator/index.ts:352`.
>
> **Turn-1 resolvability — NOT independently verified here (would need a live session).** The bundle proves the *value* but not whether `client.session.messages(sessionID)` already contains the user message at the instant `experimental.chat.system.transform` fires on turn 1. Because the message-build code above stamps `agent` onto the `UserMessage` as part of creating it, the agent is known at session/prompt creation — but the transform hook's timing relative to message persistence is a runtime-ordering question this static read cannot settle with certainty. **Recommendation for Task 6: implement the fail-closed `getSessionParentID` fallback (path B) as the primary signal** — it does not depend on the first user message being queryable yet, suppresses for the parentless coordinator primary, and keeps injection for dispatched specialists (which always have a `parentID`). If a cheap/free live probe later confirms `getSessionAgent` resolves on turn 1, path A can be used instead; until then path B is the safe choice. (Path B over-suppresses for a parentless planner-as-primary, which the plan already notes is acceptable.)

- [ ] **Step 1c — Commit the findings into the plan file.**

```bash
git add docs/superpowers/plans/2026-05-31-coordinator-policy-layer.md
AV_COMMIT_SKILL=1 git commit -m "docs(plan): record coordinator-policy verification-spike outcomes"
```

---

## Task 2: Stateless session-identity resolver (skill-utils)

**Files:**
- Create: `packages/skill-utils/src/session-identity.ts`
- Modify: `packages/skill-utils/src/index.ts`
- Test: `packages/skill-utils/test/session-identity.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/skill-utils/test/session-identity.test.ts
import { describe, expect, it } from "bun:test"
import {
  COORDINATOR_AGENT_NAME,
  getSessionAgent,
  getSessionParentID,
  isCoordinatorSession,
} from "../src/session-identity"

// Minimal fake of the bits of the OpenCode client the resolver touches.
function fakeClient(opts: {
  parentID?: string
  agent?: string
  throwOn?: "get" | "messages"
}) {
  return {
    session: {
      get: async () => {
        if (opts.throwOn === "get") throw new Error("boom")
        return { data: { id: "s1", parentID: opts.parentID } }
      },
      messages: async () => {
        if (opts.throwOn === "messages") throw new Error("boom")
        return {
          data: opts.agent
            ? [{ info: { role: "user", agent: opts.agent }, parts: [] }]
            : [],
        }
      },
    },
  } as never
}

describe("getSessionParentID", () => {
  it("returns the parentID for a dispatched child", async () => {
    expect(await getSessionParentID("s1", fakeClient({ parentID: "parent" }))).toBe("parent")
  })
  it("returns undefined for a parentless session", async () => {
    expect(await getSessionParentID("s1", fakeClient({}))).toBeUndefined()
  })
  it("returns undefined (not throw) on client error", async () => {
    expect(await getSessionParentID("s1", fakeClient({ throwOn: "get" }))).toBeUndefined()
  })
})

describe("getSessionAgent", () => {
  it("returns the first user message's agent", async () => {
    expect(await getSessionAgent("s1", fakeClient({ agent: COORDINATOR_AGENT_NAME }))).toBe(
      COORDINATOR_AGENT_NAME,
    )
  })
  it("returns undefined when no messages yet (turn 1)", async () => {
    expect(await getSessionAgent("s1", fakeClient({}))).toBeUndefined()
  })
  it("returns undefined (not throw) on client error", async () => {
    expect(await getSessionAgent("s1", fakeClient({ throwOn: "messages" }))).toBeUndefined()
  })
})

describe("isCoordinatorSession", () => {
  it("true when the resolved agent is the coordinator", async () => {
    expect(await isCoordinatorSession("s1", fakeClient({ agent: COORDINATOR_AGENT_NAME }))).toBe(true)
  })
  it("false for a dispatched specialist", async () => {
    expect(await isCoordinatorSession("s1", fakeClient({ agent: "zmora-be", parentID: "p" }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify it fails.** `cd packages/skill-utils && bun test test/session-identity.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
// packages/skill-utils/src/session-identity.ts
import type { PluginInput } from "@opencode-ai/plugin"

type Client = PluginInput["client"]

/**
 * The agent identifier the coordinator (Perun) session runs under.
 * Pinned in Task 1b to the observed `UserMessage.info.agent` value and kept in
 * sync with the `config.agent[...]` key in src/modules/coordinator/index.ts via
 * the sync test in Task 7.
 */
export const COORDINATOR_AGENT_NAME = "Perun - Coordinator"

/** Parent session id, or undefined for a parentless (top/primary) session. Never throws. */
export async function getSessionParentID(sessionID: string, client: Client): Promise<string | undefined> {
  try {
    const res = await client.session.get({ path: { id: sessionID } })
    return res.data?.parentID
  } catch {
    return undefined
  }
}

/** The agent a session runs under, from its first user message. Undefined if unknown. Never throws. */
export async function getSessionAgent(sessionID: string, client: Client): Promise<string | undefined> {
  try {
    const res = await client.session.messages({ path: { id: sessionID } })
    const msgs = res.data ?? []
    const firstUser = msgs.find((m) => m.info?.role === "user")?.info as { agent?: string } | undefined
    return firstUser?.agent
  } catch {
    return undefined
  }
}

/** True only when the session is positively identified as the coordinator. */
export async function isCoordinatorSession(sessionID: string, client: Client): Promise<boolean> {
  return (await getSessionAgent(sessionID, client)) === COORDINATOR_AGENT_NAME
}
```

- [ ] **Step 4: Export** from `packages/skill-utils/src/index.ts` (add `export * from "./session-identity"`).

- [ ] **Step 5: Run tests, verify pass.** `cd packages/skill-utils && bun test` → PASS.

- [ ] **Step 6: Commit.**
```bash
git add packages/skill-utils/src/session-identity.ts packages/skill-utils/src/index.ts packages/skill-utils/test/session-identity.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(skill-utils): stateless session-identity resolver for coordinator detection"
```

---

## Task 3: Coordinator bash-policy primitives (skill-utils)

Pure, I/O-free functions — easy to test exhaustively.

**Files:**
- Create: `packages/skill-utils/src/coordinator-bash-policy.ts`
- Modify: `packages/skill-utils/src/index.ts`
- Test: `packages/skill-utils/test/coordinator-bash-policy.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/skill-utils/test/coordinator-bash-policy.test.ts
import { describe, expect, it } from "bun:test"
import {
  buildViolationError,
  classifyCoordinatorBash,
  parseAllowedBashPrograms,
} from "../src/coordinator-bash-policy"

const FRONTMATTER =
  "allowed-tools: Read, Write, Bash(mkdir:*), Bash(ls:*), Bash(./scripts/qa-preflight.sh:*), Glob"

describe("parseAllowedBashPrograms", () => {
  it("extracts the Bash(<prog>:*) programs incl. the path form", () => {
    expect(parseAllowedBashPrograms(FRONTMATTER)).toEqual(["mkdir", "ls", "./scripts/qa-preflight.sh"])
  })
})

describe("classifyCoordinatorBash", () => {
  const allowed = ["mkdir", "ls", "./scripts/qa-preflight.sh"]
  it("allows an allowlisted program", () => {
    expect(classifyCoordinatorBash("ls -la docs", allowed).allowed).toBe(true)
    expect(classifyCoordinatorBash("./scripts/qa-preflight.sh foo", allowed).allowed).toBe(true)
  })
  it("denies git", () => {
    const r = classifyCoordinatorBash("git log --oneline", allowed)
    expect(r.allowed).toBe(false)
    expect(r.program).toBe("git")
  })
  it("denies compound commands even if the first program is allowed", () => {
    expect(classifyCoordinatorBash("mkdir x && git log", allowed).allowed).toBe(false)
    expect(classifyCoordinatorBash("ls; curl http://x", allowed).allowed).toBe(false)
    expect(classifyCoordinatorBash('bash -c "git log"', allowed).allowed).toBe(false)
  })
})

describe("buildViolationError", () => {
  it("carries a structured payload AND the instructive redirect", () => {
    const err = buildViolationError({ tool: "bash", command: "git log", reason: "not-allowlisted" })
    expect(err.message).toContain("COORDINATOR_POLICY_VIOLATION")
    expect(err.message).toContain("git log")
    expect(err.message).toMatch(/Veles|Triglav/)
  })
})
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement.**

```ts
// packages/skill-utils/src/coordinator-bash-policy.ts

/** Parse `Bash(<prog>:*)` programs out of an agent's `allowed-tools` frontmatter line. */
export function parseAllowedBashPrograms(frontmatter: string): string[] {
  const out: string[] = []
  const re = /Bash\(([^:)]+):\*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(frontmatter)) !== null) out.push(m[1].trim())
  return out
}

const COMPOUND = /(\|\||&&|;|\||`|\$\(|\bbash\b|\bsh\b|\beval\b)/

export interface BashClassification {
  allowed: boolean
  program: string | null
}

/** Decide whether a coordinator bash command is permitted (allowlist + no compounds). */
export function classifyCoordinatorBash(command: string, allowedPrograms: string[]): BashClassification {
  const trimmed = command.trim()
  if (COMPOUND.test(trimmed)) return { allowed: false, program: null }
  const program = trimmed.split(/\s+/)[0] ?? ""
  return { allowed: allowedPrograms.includes(program), program }
}

export interface ViolationInfo {
  tool: string
  command?: string
  skill?: string
  reason: string
}

/**
 * Build the rejection error. The message embeds a machine-readable marker + JSON
 * (so it surfaces in `info.error`, which the eval reads) and a human/LLM redirect (G).
 */
export function buildViolationError(info: ViolationInfo): Error {
  const payload = JSON.stringify({ marker: "COORDINATOR_POLICY_VIOLATION", ...info })
  const subject = info.command ? `\`${info.command.split(/\s+/)[0]}\`` : info.skill ? `skill \`${info.skill}\`` : "that"
  return new Error(
    `${payload}\nThe coordinator may not run ${subject}. ` +
      `Dispatch Veles (planning) or Triglav (exploration) to inspect the repository instead.`,
  )
}
```

- [ ] **Step 4: Export** from `packages/skill-utils/src/index.ts`.

- [ ] **Step 5: Run tests, verify pass.**

- [ ] **Step 6: Commit.**
```bash
git add packages/skill-utils/src/coordinator-bash-policy.ts packages/skill-utils/src/index.ts packages/skill-utils/test/coordinator-bash-policy.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(skill-utils): pure coordinator bash-policy primitives"
```

---

## Task 4: Coordinator bash-gate plugin (src)

**Files:**
- Create: `src/modules/coordinator-policy/index.ts`
- Create: `src/modules/coordinator-policy/read-allowlist.ts` (reads perun.md frontmatter once)
- Modify: `src/index.ts` (register the plugin)
- Test: `tests/modules/coordinator-policy/bash-gate.test.ts`

- [ ] **Step 1: Write the failing test** (drives the hook handler against a fake client).

```ts
// tests/modules/coordinator-policy/bash-gate.test.ts
import { describe, expect, it } from "bun:test"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"
import { makeBashGate } from "../../../src/modules/coordinator-policy"

function client(agent: string | undefined) {
  return {
    session: {
      messages: async () => ({ data: agent ? [{ info: { role: "user", agent }, parts: [] }] : [] }),
      get: async () => ({ data: { parentID: agent ? undefined : "p" } }),
    },
  } as never
}
const ALLOW = ["mkdir", "ls", "./scripts/qa-preflight.sh"]

describe("coordinator bash gate", () => {
  it("throws for a coordinator git call", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "git log" } }),
    ).rejects.toThrow(/COORDINATOR_POLICY_VIOLATION/)
  })
  it("passes an allowlisted coordinator command", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "ls docs" } }),
    ).resolves.toBeUndefined()
  })
  it("passes through for a dispatched specialist (fail-open)", async () => {
    const gate = makeBashGate(client("zmora-be"), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "git log" } }),
    ).resolves.toBeUndefined()
  })
  it("passes through on unresolved identity (fail-open)", async () => {
    const gate = makeBashGate(client(undefined), ALLOW)
    await expect(
      gate({ tool: "bash", sessionID: "s", callID: "c" }, { args: { command: "git log" } }),
    ).resolves.toBeUndefined()
  })
  it("ignores non-bash tools", async () => {
    const gate = makeBashGate(client(COORDINATOR_AGENT_NAME), ALLOW)
    await expect(
      gate({ tool: "read", sessionID: "s", callID: "c" }, { args: {} }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement** the handler factory + plugin.

```ts
// src/modules/coordinator-policy/index.ts
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import {
  buildViolationError,
  classifyCoordinatorBash,
  getSessionAgent,
  COORDINATOR_AGENT_NAME,
} from "@appverk/opencode-skill-utils"
import { readCoordinatorBashAllowlist } from "./read-allowlist"

type Client = PluginInput["client"]

/** Pure-ish handler factory (client + allowlist injected) so it is unit-testable. */
export function makeBashGate(client: Client, allowed: string[]) {
  return async (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => {
    if (input.tool !== "bash") return
    // Fail-OPEN: only enforce when positively identified as the coordinator.
    if ((await getSessionAgent(input.sessionID, client)) !== COORDINATOR_AGENT_NAME) return
    const command = String(output.args?.command ?? "")
    const verdict = classifyCoordinatorBash(command, allowed)
    if (!verdict.allowed) throw buildViolationError({ tool: "bash", command, reason: "not-allowlisted" })
  }
}

export const AppVerkCoordinatorPolicyPlugin: Plugin = async ({ client }) => {
  const allowed = readCoordinatorBashAllowlist()
  const gate = makeBashGate(client, allowed)
  return {
    "tool.execute.before": gate,
  }
}
```

```ts
// src/modules/coordinator-policy/read-allowlist.ts
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
```

- [ ] **Step 4: Register** the plugin in `src/index.ts` (add `AppVerkCoordinatorPolicyPlugin` alongside the other exported plugins; match the existing export/registration pattern).

- [ ] **Step 5: Run tests, verify pass.** `bun test tests/modules/coordinator-policy/`

- [ ] **Step 6: Commit.**
```bash
git add src/modules/coordinator-policy/ src/index.ts tests/modules/coordinator-policy/
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator-policy): code-enforced bash rail for the coordinator (fail-open, instructive)"
```

---

## Task 5: Gate skill-loading tools in Perun's config (src)

**Files:**
- Modify: `src/modules/coordinator/index.ts` (lines ~346–366, Perun's `config.agent[...]`)
- Test: `tests/modules/coordinator/perun-skill-tools.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// tests/modules/coordinator/perun-skill-tools.test.ts
import { describe, expect, it } from "bun:test"
// Build a minimal config object and run the coordinator plugin's `config` hook,
// then assert Perun's tools dict disables the skill loaders.
import { AppVerkCoordinatorPlugin } from "../../../src/modules/coordinator"

describe("Perun config gates skill loaders", () => {
  it("disables `skill` and `load_appverk_skill`", async () => {
    const config: any = { agent: {} }
    const hooks = await AppVerkCoordinatorPlugin({ client: {} } as never)
    await hooks.config?.(config)
    expect(config.agent["Perun - Coordinator"].tools).toMatchObject({
      skill: false,
      load_appverk_skill: false,
    })
  })
})
```

> If the coordinator plugin sets the agent config somewhere other than a `config` hook, adapt the test to that surface; the assertion (Perun's `tools` dict disables both keys) is the contract.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement** — add the `tools` dict to Perun's config object:

```ts
config.agent["Perun - Coordinator"] = {
  description: "...",            // unchanged
  mode: "primary",              // unchanged
  get prompt() { return getPerunPrompt() },  // unchanged
  tools: { skill: false, load_appverk_skill: false },  // NEW — partial override
}
```

- [ ] **Step 4: Apply the Task-1a decision.** If Step 1a found the native `skill` tool is NOT honored on 1.15.x, add a code comment above the `tools` dict noting it is future-proofing for v2 and that injection-suppression (Task 6) + `load_appverk_skill` are the effective backstops today.

- [ ] **Step 5: Run tests, verify pass.**

- [ ] **Step 6: Commit.**
```bash
git add src/modules/coordinator/index.ts tests/modules/coordinator/perun-skill-tools.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(coordinator): disable skill-loading tools for Perun"
```

---

## Task 6: Suppress skill-activation injection for the coordinator (skill-registry)

**Files:**
- Modify: `packages/skill-registry/src/index.ts` (factory → `async ({ client }) =>`; transform suppresses for coordinator)
- Test: `packages/skill-registry/test/injection-suppression.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// packages/skill-registry/test/injection-suppression.test.ts
import { describe, expect, it } from "bun:test"
import { AppVerkSkillRegistryPlugin } from "../src/index"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"

function client(coordinator: boolean, empty = false) {
  return {
    session: {
      messages: async () => ({ data: empty ? [] : [{ info: { role: "user", agent: coordinator ? COORDINATOR_AGENT_NAME : "zmora-be" }, parts: [] }] }),
      get: async () => ({ data: { parentID: coordinator || empty ? undefined : "p" } }),
    },
  } as never
}

async function runTransform(c: never, sessionID: string | undefined) {
  const hooks = await AppVerkSkillRegistryPlugin({ client: c } as never)
  const out = { system: [] as string[] }
  await hooks["experimental.chat.system.transform"]?.({ sessionID, model: {} as never }, out)
  return out.system
}

describe("skill-activation injection suppression", () => {
  it("suppresses for the coordinator", async () => {
    expect(await runTransform(client(true), "s")).toHaveLength(0)
  })
  it("injects for a dispatched specialist", async () => {
    expect((await runTransform(client(false), "s")).length).toBeGreaterThan(0)
  })
  it("suppresses (fail-closed) when sessionID is undefined", async () => {
    expect(await runTransform(client(false), undefined)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement.** Change the factory signature and gate the push. Use the Task-1b decision for the resolution signal:

```ts
// packages/skill-registry/src/index.ts  (relevant parts)
import { getSessionAgent, getSessionParentID, COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"

export const AppVerkSkillRegistryPlugin: Plugin = async ({ client }) => {
  // ...existing catalog/loader/activationRules setup...
  return {
    config: async (config: any) => { /* unchanged */ },
    tool: { load_appverk_skill: /* unchanged */ },
    "experimental.chat.system.transform": async (input, output) => {
      // Fail-CLOSED: no session → suppress (the Agent.generate path needs no skill rules).
      if (!input.sessionID) return
      // Task-1b path A (agent resolvable on turn 1):
      if ((await getSessionAgent(input.sessionID, client)) === COORDINATOR_AGENT_NAME) return
      // Task-1b path B (messages empty on turn 1) — use instead of the line above:
      //   if ((await getSessionParentID(input.sessionID, client)) === undefined) return
      output.system.push(activationRules)
    },
  }
}
```

> Keep exactly one of path A / path B per the Step 1b outcome; delete the other. Path B also suppresses for parentless planner primaries (e.g. Veles-as-primary), which is acceptable — the activation rules are executor coding-standards, irrelevant to planners.

- [ ] **Step 4: Run tests, verify pass.** `cd packages/skill-registry && bun test`

- [ ] **Step 5: Commit.**
```bash
git add packages/skill-registry/src/index.ts packages/skill-registry/test/injection-suppression.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(skill-registry): suppress skill-activation injection for the coordinator"
```

---

## Task 7: Eval landing zone + identity sync test

**Files:**
- Create: `docs/eval/scenarios/perun/README.md`
- Create: `docs/eval/scenarios/perun/role-discipline.md`
- Create: `tests/modules/coordinator/coordinator-name-sync.test.ts`

- [ ] **Step 1: Write the sync test** guarding `COORDINATOR_AGENT_NAME` against the real config key.

```ts
// tests/modules/coordinator/coordinator-name-sync.test.ts
import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"

describe("coordinator name stays in sync with the registered agent key", () => {
  it("COORDINATOR_AGENT_NAME appears as the agent key in the coordinator module", () => {
    const src = readFileSync("src/modules/coordinator/index.ts", "utf8")
    expect(src).toContain(`"${COORDINATOR_AGENT_NAME}"`)
  })
})
```

- [ ] **Step 2: Run, verify it passes** (it should already, given Task 2's constant — if not, fix the constant to the value pinned in Task 1b).

- [ ] **Step 3: Author the eval scenario** `docs/eval/scenarios/perun/role-discipline.md` following the `docs/eval/scenarios/<agent>/` convention (h1 title, `**Agent:**`, `## Query`, `## Expected coverage`, `## Quality signals`, `## What this discriminates`). The discriminator: give Perun a free-form "review the changes and test them" request; **Quality signal** = count `COORDINATOR_POLICY_VIOLATION` markers appearing in assistant message `info.error` across iterations — a model that triggers many rail-rejections is escaping its role. Write a short `README.md` mirroring the triglav/veles READMEs.

- [ ] **Step 4: Commit.**
```bash
git add docs/eval/scenarios/perun/ tests/modules/coordinator/coordinator-name-sync.test.ts
AV_COMMIT_SKILL=1 git commit -m "feat(eval): perun role-discipline scenario + coordinator-name sync test"
```

---

## Task 8: Integration, full verification, and prose cleanup

**Files:**
- Modify: `src/agents/perun.md` (~line 32 MCP-gate prose)

- [ ] **Step 1: Correct the aspirational MCP claim.** `perun.md:~32` states the runtime gate will reject MCP tools. The bash rail does NOT cover MCP. Either soften the prose to "MCP tools are not in `allowed-tools` and should not be used" (no false runtime-enforcement claim) or, if desired, extend the Task-4 handler to also reject MCP tool names for the coordinator (out of current scope — prefer the prose fix).

- [ ] **Step 2: Full build + typecheck + test** from repo root (this is the gate before claiming done):

```bash
bun run build && bun run typecheck && bun test
```
Expected: exit 0; all suites pass. Note `skill-utils` builds before `skill-registry` and `src` (root `package.json` build order) — the new `skill-utils` exports must be built first.

- [ ] **Step 3: Manual smoke (mirrors the original incident).** With the built plugins active, run Perun on a weak model and send "review the changes on this branch and test them manually." Confirm: a `git` attempt is rejected with the instructive message; the rejection appears in `info.error`; Perun cannot load `be-testing`; activation rules are not injected into Perun's prompt. Record the observation.

- [ ] **Step 4: Commit.**
```bash
git add src/agents/perun.md
AV_COMMIT_SKILL=1 git commit -m "docs(perun): correct aspirational MCP-gate prose to match enforced scope"
```

- [ ] **Step 5: Final review.** Dispatch a code-quality review over the whole change set against the spec's "Testing approach" and "What this does NOT fix" sections; confirm no claim is over-stated in code comments.

---

## Self-Review (author checklist — completed)

- **Spec coverage:** A → Tasks 3–4; C-lever-1 → Task 5; C-lever-2 → Task 6; E (reusable agent-keyed layer) → Tasks 2–3 (shared skill-utils primitives, agent-keyed); F → Tasks 3 (`buildViolationError`) + 7 (eval scenario reads `info.error`); G → Task 3 (`buildViolationError` redirect text). Resolver/identity → Tasks 1–2. Boundary cleanup (perun.md:32) → Task 8.
- **Placeholder scan:** the only branch points (native-`skill` honored? transform sees agent on turn 1?) are isolated to Task 1 and both downstream branches carry complete code (Tasks 5 & 6) — no "fill in later".
- **Type consistency:** `COORDINATOR_AGENT_NAME`, `getSessionAgent`, `getSessionParentID`, `classifyCoordinatorBash`, `buildViolationError`, `makeBashGate` names are used identically across tasks.
