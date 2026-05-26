import { describe, it, expect, beforeAll, afterEach } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { AppVerkQAPlugin } from "../../../src/modules/qa/index.js"
import { buildQATesterAgent } from "../../../src/modules/qa/prompt-builder.js"
import { FE_TOOLS, BE_TOOLS } from "../../../src/modules/qa/allowed-tools.js"
import {
  clearDispatchExtensions,
  getDispatchExtensions,
} from "../../../src/modules/_shared/dispatch-extensions.js"

describe("AppVerkQAPlugin", () => {
  let pluginResult: Awaited<ReturnType<typeof AppVerkQAPlugin>>

  beforeAll(async () => {
    pluginResult = await AppVerkQAPlugin({} as never)
  })

  it("exports a plugin factory", () => {
    expect(typeof AppVerkQAPlugin).toBe("function")
  })

  const EXPECTED_VARIANTS = ["zmora-fe", "zmora-be"]
  const REMOVED_AGENTS = ["qa-tester-fe", "qa-tester-be", "qa-tester", "qa-fe-tester", "qa-be-tester"]
  const EXPECTED_COMMANDS = ["create-qa-plan", "run-qa"]

  it.each(EXPECTED_VARIANTS)("registers %s variant", async (name) => {
    const config: Config = { agent: {} }
    await pluginResult.config?.(config)
    expect(config.agent![name]).toBeDefined()
    expect(config.agent![name]!.mode).toBe("subagent")
    expect(typeof config.agent![name]!.prompt).toBe("string")
  })

  it.each(REMOVED_AGENTS)("does not register %s (old or unsuffixed)", async (name) => {
    const config: Config = { agent: {} }
    await pluginResult.config?.(config)
    expect(config.agent![name]).toBeUndefined()
  })

  it.each(EXPECTED_COMMANDS)("registers %s command", async (name) => {
    const config: Config = { command: {} }
    await pluginResult.config?.(config)
    expect(config.command![name]).toBeDefined()
    expect(typeof config.command![name]!.template).toBe("string")
  })
})

describe("buildQATesterAgent", () => {
  it("produces fe variant with FE tools and no BE tools", () => {
    const { prompt } = buildQATesterAgent("fe")
    expect(prompt).toContain("name: zmora-fe")
    expect(prompt).toContain("mode: subagent")
    for (const t of FE_TOOLS) expect(prompt).toContain(t)
    for (const t of BE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("FE variant — Playwright")
    expect(prompt).not.toContain("BE variant — HTTP + DB")
  })

  it("produces be variant with BE tools and no FE tools", () => {
    const { prompt } = buildQATesterAgent("be")
    expect(prompt).toContain("name: zmora-be")
    for (const t of BE_TOOLS) expect(prompt).toContain(t)
    for (const t of FE_TOOLS) expect(prompt).not.toContain(t)
    expect(prompt).toContain("BE variant — HTTP + DB")
    expect(prompt).not.toContain("FE variant — Playwright")
  })
})

/**
 * Regression: SessionAgentRegistry must be cleaned for BOTH parent and child
 * session IDs. Child (zmora-*) sessions die independently of their parent in
 * long-lived OpenCode processes; without explicit cleanup, the registry —
 * which maps childSessionID → agent name — would grow unbounded for the
 * process lifetime. Since the registry gates the `shell.env` hook (which
 * materialises secret bindings into the child env), a stale entry plus a
 * recycled SDK session ID could in principle leak credentials into the wrong
 * session. The `session.deleted` handler must therefore call
 * `registry.unregister(deletedID)` unconditionally — not just when the
 * deleted ID happens to be a parent.
 */
describe("session.deleted cleanup", () => {
  afterEach(() => {
    // The plugin singletons live for the OpenCode process lifetime; tests
    // must reset the cross-module dispatch extensions registration.
    clearDispatchExtensions()
  })

  it("unregisters child session entry when a child session.deleted event fires", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    const ext = getDispatchExtensions()
    expect(ext.sessionAgentRegistry).toBeDefined()
    const registry = ext.sessionAgentRegistry!

    // Simulate dispatch_parallel registering a child session → agent mapping.
    const childSessionID = "zmora-be-child-arch003"
    registry.register(childSessionID, "zmora-be")
    expect(registry.lookup(childSessionID)).toBe("zmora-be")

    // Child session dies independently of its parent (long-lived process).
    await pluginResult.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: childSessionID } },
      },
    } as never)

    // The credential-mapping entry MUST be gone.
    expect(registry.lookup(childSessionID)).toBeUndefined()
  })

  it("unregisters parent session entry when a parent session.deleted event fires", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    const ext = getDispatchExtensions()
    const registry = ext.sessionAgentRegistry!

    // Defense in depth: if a parent ever ends up registered (e.g. through a
    // future code path), parent deletion must also drop its entry.
    const parentSessionID = "perun-parent-arch003"
    registry.register(parentSessionID, "perun")
    expect(registry.lookup(parentSessionID)).toBe("perun")

    await pluginResult.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: parentSessionID } },
      },
    } as never)

    expect(registry.lookup(parentSessionID)).toBeUndefined()
  })

  it("ignores session.deleted events without an info.id", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    const ext = getDispatchExtensions()
    const registry = ext.sessionAgentRegistry!

    registry.register("survivor-child", "zmora-be")

    // Malformed event must not throw and must not affect unrelated entries.
    await expect(
      pluginResult.event?.({
        event: { type: "session.deleted", properties: {} },
      } as never),
    ).resolves.not.toThrow()

    expect(registry.lookup("survivor-child")).toBe("zmora-be")
  })
})

/**
 * Regression for ARCH-004: the dispatch scrubber must operate on a snapshot
 * pinned at dispatch start, not on live BindingsStore state. Otherwise a
 * binding minted/cleared mid-dispatch by another agent (record_input,
 * execute_recipe, session.deleted purge) creates a race window where a
 * just-written secret can leak through the scrubber, or a just-cleared
 * binding can no longer be redacted from in-flight specialist output.
 *
 * The plugin registers a `scrubberFactory`, not a live-read `scrubber` — this
 * suite exercises the factory's snapshot lifecycle:
 *
 *   - Pre-pin write: a binding present BEFORE the factory runs is redacted
 *     even after the live store is mutated.
 *   - Post-pin write: a binding written AFTER the snapshot is pinned is NOT
 *     visible to that scrub session (snapshot isolation), but is visible
 *     once `release()` is called and the next dispatch pins a fresh snapshot.
 *   - Mid-scrub clearParent: purging the parent during scrub does NOT remove
 *     pinned entries — the in-flight scrub still completes correctly.
 */
describe("ARCH-004 scrubberFactory snapshot lifecycle", () => {
  afterEach(() => {
    clearDispatchExtensions()
  })

  it("registers scrubberFactory (race-safe) instead of the legacy live-read scrubber", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    await AppVerkQAPlugin(pluginInput)

    const ext = getDispatchExtensions()
    // The QA plugin's scrubberFactory is the only race-safe path; the legacy
    // `scrubber` field is intentionally left unset so the dispatcher can't
    // accidentally fall back to live reads.
    expect(ext.scrubberFactory).toBeDefined()
    expect(ext.scrubber).toBeUndefined()
  })

  it("scrub still redacts a pinned binding even after a concurrent write+clearParent mid-dispatch", async () => {
    // The plugin closes over a private BindingsStore — reach it through the
    // public tool surface (record_input) and the scrubberFactory it registers.
    const pluginInput = {
      client: {
        session: {
          // resolveParentID returns undefined for the seed session — the plugin
          // falls back to ctx.sessionID, which is what we want here.
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    const parentID = "perun-arch004"
    const tokenValue = "eyJhbGciOiJIUzI1NiJ9-PinnedSnapshotValue-XYZ-LONG-PAYLOAD"

    // Seed the store via the public record_input tool, exactly as Perun would.
    const recordInputTool = pluginResult.tool?.record_input
    expect(recordInputTool).toBeDefined()
    const ctx = {
      sessionID: parentID,
      messageID: "",
      agent: "Perun - Coordinator",
      directory: process.cwd(),
      worktree: process.cwd(),
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    } as never
    const seedResult = await recordInputTool!.execute(
      { name: "QA_BIND_TOKEN", value: tokenValue },
      ctx,
    )
    expect(seedResult).toContain('"status":"ok"')

    const ext = getDispatchExtensions()
    expect(ext.scrubberFactory).toBeDefined()

    // Pin the snapshot — this is what dispatchParallel does at wave start.
    const session = ext.scrubberFactory!(parentID)
    expect(session).toBeDefined()

    // Adversarial mid-scrub mutations: simulate another agent in the same
    // OpenCode process racing against the dispatch wave.
    //
    //  a) record_input writes a NEW binding under a different name — the
    //     pinned session must NOT see it (snapshot isolation).
    //  b) The session.deleted handler clears the parent — the pinned entries
    //     survive (clearParent skips pinned names) so the scrub completes.
    const lateValue = "LateBoundValue-WouldLeakIfLiveRead-HiEntropyZZZ"
    await recordInputTool!.execute(
      { name: "QA_BIND_LATE", value: lateValue },
      ctx,
    )
    await pluginResult.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: parentID } },
      },
    } as never)

    // Scrub now: the ORIGINAL token must still be redacted (pinned snapshot
    // contains it even after clearParent), and the LATE binding must NOT be
    // redacted (snapshot was pinned before that write).
    const input = `result with token=${tokenValue} and late=${lateValue}`
    const scrubbed = session!.scrub(input)
    expect(scrubbed).toContain("[REDACTED:QA_BIND_TOKEN]")
    expect(scrubbed).not.toContain(tokenValue)
    expect(scrubbed).toContain(lateValue) // late binding was not in the snapshot

    // Release pins so a subsequent sweep can reclaim them. Idempotent re-
    // invocation must not throw.
    session!.release()
    expect(() => session!.release()).not.toThrow()
  })

  it("scrubberFactory pins entries during scrub and releases the pin afterward (clearParent can then reclaim)", async () => {
    const pluginInput = {
      client: {
        session: {
          get: async () => ({ data: { parentID: undefined } }),
        },
      },
    } as never
    const pluginResult = await AppVerkQAPlugin(pluginInput)

    const parentID = "perun-arch004-pin-release"
    const recordInputTool = pluginResult.tool?.record_input
    const ctx = {
      sessionID: parentID,
      messageID: "",
      agent: "Perun - Coordinator",
      directory: process.cwd(),
      worktree: process.cwd(),
      abort: new AbortController().signal,
      metadata: () => undefined,
      ask: async () => undefined,
    } as never
    const seedValue = "eyJhbGc-ReleaseMe-HighEntropy-1234567890"
    await recordInputTool!.execute(
      { name: "QA_BIND_TEMP", value: seedValue },
      ctx,
    )

    const ext = getDispatchExtensions()
    const session = ext.scrubberFactory!(parentID)!

    // While pinned, clearParent must NOT reclaim the entry. We can observe
    // this indirectly: a second scrub on the SAME session still redacts.
    await pluginResult.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: parentID } },
      },
    } as never)
    expect(session.scrub(`contains ${seedValue} here`))
      .toContain("[REDACTED:QA_BIND_TEMP]")

    // Release the pin. A subsequent session.deleted event must now reclaim
    // the (previously pinned) entry — proving the release decremented the
    // pin count to 0. Without `release()` running, this clearParent would be
    // a no-op for `QA_BIND_TEMP`.
    session.release()
    await pluginResult.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: parentID } },
      },
    } as never)

    // A fresh factory call now sees an empty snapshot — the new scrub leaves
    // the value untouched.
    const next = ext.scrubberFactory!(parentID)!
    const stillRedacted = next.scrub(`contains ${seedValue} here`)
    expect(stillRedacted).not.toContain("[REDACTED:QA_BIND_TEMP]")
    next.release()
  })
})
