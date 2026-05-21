import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { Agent, Message } from "@opencode-ai/sdk"
import type { ToolContext } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../src/index.js"
import type { SDKClient } from "../src/sdk-specialist.js"
import type { DispatchResult } from "../src/dispatch.js"
import { assignIssueIds, type Finding } from "../src/assign-issue-ids.js"

/**
 * End-to-end integration test for the coordinator plugin. Exercises the public
 * entry point — `AppVerkCoordinatorPlugin(input)` → `hooks.tool.dispatch_parallel.execute(args, ctx)`
 * — against a fake `OpencodeClient` so the test verifies the wiring between
 * the plugin shell, the SDK adapter, and `dispatchParallel`, not just the
 * lower-level helpers in isolation.
 *
 * The fake client follows the same "fakes over mocks" pattern used in
 * `sdk-specialist.test.ts`: a plain recorder over the four SDK methods the
 * adapter touches (`session.create`, `session.prompt`, `session.messages`,
 * `app.agents`), cast through `unknown` to `SDKClient`.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url))

interface FakeClientCalls {
  sessionCreate: Array<Record<string, unknown>>
  sessionPrompt: Array<Record<string, unknown>>
  sessionMessages: Array<Record<string, unknown>>
  sessionAbort: Array<Record<string, unknown>>
  appAgents: Array<Record<string, unknown> | undefined>
}

interface FakeClientConfig {
  agents: Agent[]
  // Map of agentName → { sessionId, finalText } describing what each child
  // session will look like when polled.
  sessions: Record<string, { sessionId: string; finalText: string }>
}

interface FakeClient {
  client: SDKClient
  calls: FakeClientCalls
}

function makeAgent(name: string, mode: Agent["mode"]): Agent {
  return {
    name,
    mode,
    description: undefined,
    builtIn: false,
    permission: { edit: "ask", bash: {} },
    tools: {},
    options: {},
  }
}

function finishedAssistant(text: string): { info: Message; parts: Array<{ type: string; text?: string }> } {
  const info: Message = {
    id: `msg-${text.slice(0, 6)}`,
    sessionID: "ignored",
    role: "assistant",
    time: { created: 1700000000 },
    parentID: "parent-1",
    modelID: "model-1",
    providerID: "provider-1",
    mode: "default",
    path: { cwd: "/tmp", root: "/" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    finish: "end_turn",
  } as Message
  return { info, parts: [{ type: "text", text }] }
}

function makeFakeClient(config: FakeClientConfig): FakeClient {
  const calls: FakeClientCalls = {
    sessionCreate: [],
    sessionPrompt: [],
    sessionMessages: [],
    sessionAbort: [],
    appAgents: [],
  }

  // Map title-suffix (the agent name from the dispatch title) → sessionId.
  // We resolve session ids deterministically by inspecting the title the
  // coordinator passes to session.create: "[perun] dispatch to <agentName>".
  function resolveSessionId(title: string): string {
    for (const [agentName, cfg] of Object.entries(config.sessions)) {
      if (title.endsWith(`dispatch to ${agentName}`)) return cfg.sessionId
    }
    return "unmapped-session"
  }

  const fake = {
    session: {
      async create(options: { body: { parentID: string; title: string } }) {
        calls.sessionCreate.push(options)
        const id = resolveSessionId(options.body.title)
        return { data: { id } }
      },
      async prompt(options: Record<string, unknown>) {
        calls.sessionPrompt.push(options)
        return { data: {} }
      },
      async messages(options: { path: { id: string } }) {
        calls.sessionMessages.push(options)
        const entry = Object.values(config.sessions).find(
          (s) => s.sessionId === options.path.id,
        )
        if (entry === undefined) return { data: [] }
        return { data: [finishedAssistant(entry.finalText)] }
      },
      async abort(options: { path: { id: string } }) {
        calls.sessionAbort.push(options)
        return { data: true }
      },
    },
    app: {
      async agents(options?: Record<string, unknown>) {
        calls.appAgents.push(options)
        return { data: config.agents }
      },
    },
  }

  return {
    client: fake as unknown as SDKClient,
    calls,
  }
}

/**
 * Build a minimal `ToolContext`. The dispatch_parallel tool reads only
 * `sessionID`; everything else is satisfied with no-op stubs so the cast is
 * type-safe under strict TS.
 */
function makeToolContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: "msg-1",
    agent: "perun",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata() {
      /* noop */
    },
    ask() {
      throw new Error("ask not implemented in test")
    },
  } as unknown as ToolContext
}

async function invokePlugin(
  client: SDKClient,
): Promise<{
  dispatchParallel: (
    args: {
      agent: string
      summary: string
      tasks: Array<{ name: string; prompt: string; context?: string }>
    },
    context: ToolContext,
  ) => Promise<string>
  assignIssueIds: (
    args: { findings: Finding[]; prefix: string; startAt?: number },
    context: ToolContext,
  ) => Promise<string>
}> {
  const hooks = await AppVerkCoordinatorPlugin({
    client,
    // The plugin only ever reads `client` from PluginInput; the rest is stubbed
    // to satisfy the type without exercising any unrelated wiring.
    project: {} as never,
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://localhost"),
    // BunShell type is not used by the plugin; cast through unknown.
  } as never)

  const dispatch = hooks.tool?.["dispatch_parallel"]
  const assign = hooks.tool?.["assign_issue_ids"]
  if (dispatch === undefined || assign === undefined) {
    throw new Error("plugin did not register expected tools")
  }

  return {
    dispatchParallel: async (args, context) => {
      const result = await dispatch.execute(args, context)
      return typeof result === "string" ? result : result.output
    },
    assignIssueIds: async (args, context) => {
      const result = await assign.execute(args, context)
      return typeof result === "string" ? result : result.output
    },
  }
}

const FE_FINDING: Finding = {
  severity: "MEDIUM",
  title: "Login error not visible",
  scenario: "FE-02",
  file: "src/Login.tsx",
  line: 42,
}

const BE_FINDING: Finding = {
  severity: "HIGH",
  title: "POST /api/users returns 500",
  scenario: "BE-01",
  file: "src/api/users.ts",
  line: 15,
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
}

function sortBySeverity(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity.toUpperCase()] ?? 99
    const bOrder = SEVERITY_ORDER[b.severity.toUpperCase()] ?? 99
    return aOrder - bOrder
  })
}

describe("@perun QA flow integration (plugin entry point)", () => {
  it("reads sample-plan.md fixture and finds FE and BE sections", () => {
    const content = readFileSync(
      path.resolve(__dirname, "fixtures/sample-plan.md"),
      "utf8",
    )

    expect(content).toContain("## FE Test Scenarios")
    expect(content).toContain("## BE Test Scenarios")
    expect(content).toMatch(/FE-0\d/)
    expect(content).toMatch(/BE-0\d/)
  })

  it("dispatches one qa-tester variant per scenario via plugin.tool.dispatch_parallel.execute and combines findings with assigned IDs", async () => {
    // Post-Task-2 shape: Perun dispatches per-scenario tasks, routing each
    // FE-XX scenario to qa-tester-fe and each BE-XX scenario to qa-tester-be.
    // Both variants reuse a single session id in this test because the fake
    // client maps session by title suffix `dispatch to <agent>`.
    const fake = makeFakeClient({
      agents: [
        makeAgent("qa-tester-fe", "subagent"),
        makeAgent("qa-tester-be", "subagent"),
        makeAgent("perun", "primary"),
      ],
      sessions: {
        "qa-tester-fe": { sessionId: "fe-session", finalText: JSON.stringify(FE_FINDING) },
        "qa-tester-be": { sessionId: "be-session", finalText: JSON.stringify(BE_FINDING) },
      },
    })

    const plugin = await invokePlugin(fake.client)
    const ctx = makeToolContext("perun-parent-session")

    // Three scenarios: two FE, one BE — total 3 per-scenario tasks. The
    // `agent` label uses the logical-name exception (`qa-tester ×3`), never
    // a comma-joined `qa-tester-fe ×2, qa-tester-be`.
    const rawResults = await plugin.dispatchParallel(
      {
        agent: "qa-tester ×3",
        summary: "integration test plan",
        tasks: [
          { name: "qa-tester-fe", prompt: "<FE-01 scenario block>" },
          { name: "qa-tester-fe", prompt: "<FE-02 scenario block>" },
          { name: "qa-tester-be", prompt: "<BE-01 scenario block>" },
        ],
      },
      ctx,
    )

    const results = JSON.parse(rawResults) as DispatchResult[]

    // Result shape: ordered, with status/result/duration_ms. Three tasks ⇒
    // three results in input order.
    expect(results).toHaveLength(3)
    expect(results[0]?.name).toBe("qa-tester-fe")
    expect(results[0]?.status).toBe("success")
    expect(results[1]?.name).toBe("qa-tester-fe")
    expect(results[1]?.status).toBe("success")
    expect(results[2]?.name).toBe("qa-tester-be")
    expect(results[2]?.status).toBe("success")

    // SDK wiring assertions: registry was loaded once, three sessions were
    // created with the perun parent ID, and each session was prompted with
    // its bound variant.
    expect(fake.calls.appAgents).toHaveLength(1)
    expect(fake.calls.sessionCreate).toHaveLength(3)
    expect(fake.calls.sessionCreate[0]).toEqual({
      body: {
        parentID: "perun-parent-session",
        title: "[perun] dispatch to qa-tester-fe",
      },
    })
    expect(fake.calls.sessionCreate[2]).toEqual({
      body: {
        parentID: "perun-parent-session",
        title: "[perun] dispatch to qa-tester-be",
      },
    })
    expect(fake.calls.sessionPrompt).toHaveLength(3)
    expect(fake.calls.sessionPrompt[0]).toMatchObject({
      body: { agent: "qa-tester-fe" },
    })
    expect(fake.calls.sessionPrompt[2]).toMatchObject({
      body: { agent: "qa-tester-be" },
    })

    // Functional assertions: ID assignment routes through the public path
    // (assign_issue_ids tool) and produces the same deterministic ordering.
    // The FE finding repeats twice because both FE tasks return the same
    // canned response; the BE finding appears once.
    const rawFindings: Finding[] = results.map((r) => JSON.parse(r.result) as Finding)
    const sorted = sortBySeverity(rawFindings)

    const rawWithIds = await plugin.assignIssueIds(
      { findings: sorted, prefix: "QA" },
      ctx,
    )
    const withIds = JSON.parse(rawWithIds) as Array<Finding & { id: string }>

    expect(withIds).toHaveLength(3)
    // BE finding is HIGH, so it lands first after sortBySeverity.
    expect(withIds[0]?.id).toBe("QA-001")
    expect(withIds[0]?.title).toBe("POST /api/users returns 500")
    expect(withIds[1]?.id).toBe("QA-002")
    expect(withIds[2]?.id).toBe("QA-003")
  })

  it("handles partial failure routed through the plugin: BE specialist session id missing, FE succeeds", async () => {
    // Configure the fake so that the BE variant's session.create resolves to
    // an empty session id, which the SDK adapter must surface as a per-task
    // error.
    const fake = makeFakeClient({
      agents: [
        makeAgent("qa-tester-fe", "subagent"),
        makeAgent("qa-tester-be", "subagent"),
      ],
      sessions: {
        "qa-tester-fe": { sessionId: "fe-session", finalText: JSON.stringify(FE_FINDING) },
      },
    })

    // Override session.create to return an empty id specifically for the BE variant.
    const originalCreate = fake.client.session.create.bind(fake.client.session)
    fake.client.session.create = (async (options: { body: { parentID: string; title: string } }) => {
      if (options.body.title.endsWith("dispatch to qa-tester-be")) {
        fake.calls.sessionCreate.push(options)
        return { data: { id: "" } }
      }
      return originalCreate(options)
    }) as typeof fake.client.session.create

    const plugin = await invokePlugin(fake.client)
    const ctx = makeToolContext("perun-parent-session")

    const rawResults = await plugin.dispatchParallel(
      {
        agent: "qa-tester ×2",
        summary: "partial failure path",
        tasks: [
          { name: "qa-tester-fe", prompt: "<FE-01 scenario block>" },
          { name: "qa-tester-be", prompt: "<BE-01 scenario block>" },
        ],
      },
      ctx,
    )
    const results = JSON.parse(rawResults) as DispatchResult[]

    expect(results).toHaveLength(2)
    expect(results[0]?.status).toBe("success")
    expect(results[1]?.status).toBe("error")
    expect(results[1]?.error).toMatch(/no session id/i)

    const feFinding = JSON.parse(results[0]!.result) as Finding
    const rawWithIds = await plugin.assignIssueIds(
      { findings: [feFinding], prefix: "QA" },
      ctx,
    )
    const withIds = JSON.parse(rawWithIds) as Array<Finding & { id: string }>
    expect(withIds).toHaveLength(1)
    expect(withIds[0]?.id).toBe("QA-001")
    expect(withIds[0]?.title).toBe("Login error not visible")
  })

  it("assigns deterministic IDs across two runs through the plugin entry point", async () => {
    async function runFlow(): Promise<string[]> {
      const fake = makeFakeClient({
        agents: [
          makeAgent("qa-tester-fe", "subagent"),
          makeAgent("qa-tester-be", "subagent"),
        ],
        sessions: {
          "qa-tester-fe": { sessionId: "fe-session", finalText: JSON.stringify(FE_FINDING) },
          "qa-tester-be": { sessionId: "be-session", finalText: JSON.stringify(BE_FINDING) },
        },
      })
      const plugin = await invokePlugin(fake.client)
      const ctx = makeToolContext("perun-parent-session")

      const rawResults = await plugin.dispatchParallel(
        {
          agent: "qa-tester ×2",
          summary: "determinism check",
          tasks: [
            { name: "qa-tester-fe", prompt: "<FE-01 scenario block>" },
            { name: "qa-tester-be", prompt: "<BE-01 scenario block>" },
          ],
        },
        ctx,
      )
      const results = JSON.parse(rawResults) as DispatchResult[]
      const rawFindings: Finding[] = results
        .filter((r) => r.status === "success")
        .map((r) => JSON.parse(r.result) as Finding)
      const sorted = sortBySeverity(rawFindings)

      // Use the local helper (same algorithm as the tool) — going through
      // the tool here too is redundant since determinism is a property of
      // the algorithm, not the wiring. The previous assertion already
      // covers the public assign_issue_ids tool surface.
      const withIds = assignIssueIds({ findings: sorted, prefix: "QA" })
      return withIds.map((f) => f.id)
    }

    const firstRun = await runFlow()
    const secondRun = await runFlow()

    expect(firstRun).toEqual(["QA-001", "QA-002"])
    expect(secondRun).toEqual(["QA-001", "QA-002"])
    expect(firstRun).toEqual(secondRun)
  })

  it("rejects unknown agents at the plugin entry point before creating any session", async () => {
    const fake = makeFakeClient({
      agents: [makeAgent("qa-tester-fe", "subagent")],
      sessions: {},
    })
    const plugin = await invokePlugin(fake.client)
    const ctx = makeToolContext("perun-parent-session")

    await expect(
      plugin.dispatchParallel(
        {
          agent: "ghost-agent",
          summary: "anti-recursion negative test",
          tasks: [{ name: "ghost-agent", prompt: "noop" }],
        },
        ctx,
      ),
    ).rejects.toThrow("Unknown agent: ghost-agent")

    // Registry load happened, but no session was created.
    expect(fake.calls.appAgents).toHaveLength(1)
    expect(fake.calls.sessionCreate).toHaveLength(0)
    expect(fake.calls.sessionPrompt).toHaveLength(0)
  })

  it("rejects primary-mode agents at the plugin entry point (anti-recursion)", async () => {
    const fake = makeFakeClient({
      agents: [
        makeAgent("qa-tester-fe", "subagent"),
        makeAgent("perun", "primary"),
      ],
      sessions: {},
    })
    const plugin = await invokePlugin(fake.client)
    const ctx = makeToolContext("perun-parent-session")

    await expect(
      plugin.dispatchParallel(
        {
          agent: "perun",
          summary: "primary-mode rejection",
          tasks: [{ name: "perun", prompt: "recurse" }],
        },
        ctx,
      ),
    ).rejects.toThrow("Cannot dispatch primary agent: perun")
    expect(fake.calls.sessionCreate).toHaveLength(0)
  })

  // Path B coverage (per Task 2 implementation choice): dependency parsing,
  // cycle detection, and wave computation live in Perun's prompt (perun.md),
  // not as exported TS helpers. The end-to-end behaviour Perun is contracted
  // to drive is exercised here through fixture-driven calls into the public
  // dispatch_parallel tool — one `dispatchParallel` invocation per wave is
  // what Perun emits when a plan declares `**Depends-on:**`. These tests
  // assert the dispatcher behaviour Perun depends on (per-scenario tasks per
  // wave, deterministic ordering, isolated failures) without binding to the
  // prompt-level parser.
  describe("dependency-aware dispatch (Path B: fixture-driven)", () => {
    it("runs each wave as its own dispatch_parallel call with per-scenario tasks", async () => {
      // Simulate Perun's two-wave behaviour for a plan with
      // BE-01 (no deps) → BE-02 [depends-on: BE-01].
      const fake = makeFakeClient({
        agents: [
          makeAgent("qa-tester-fe", "subagent"),
          makeAgent("qa-tester-be", "subagent"),
        ],
        sessions: {
          "qa-tester-fe": { sessionId: "fe-session", finalText: JSON.stringify(FE_FINDING) },
          "qa-tester-be": { sessionId: "be-session", finalText: JSON.stringify(BE_FINDING) },
        },
      })
      const plugin = await invokePlugin(fake.client)
      const ctx = makeToolContext("perun-parent-session")

      // Wave 1: BE-01 only.
      const wave1Raw = await plugin.dispatchParallel(
        {
          agent: "qa-tester",
          summary: "deps plan (wave 1/2)",
          tasks: [{ name: "qa-tester-be", prompt: "<BE-01 scenario block>" }],
        },
        ctx,
      )
      const wave1 = JSON.parse(wave1Raw) as DispatchResult[]
      expect(wave1).toHaveLength(1)
      expect(wave1[0]?.status).toBe("success")

      // Wave 2: BE-02 (depends on BE-01, which completed in wave 1).
      const wave2Raw = await plugin.dispatchParallel(
        {
          agent: "qa-tester",
          summary: "deps plan (wave 2/2)",
          tasks: [{ name: "qa-tester-be", prompt: "<BE-02 scenario block>" }],
        },
        ctx,
      )
      const wave2 = JSON.parse(wave2Raw) as DispatchResult[]
      expect(wave2).toHaveLength(1)
      expect(wave2[0]?.status).toBe("success")

      // Two distinct dispatch_parallel calls ⇒ two separate session-create
      // batches. Total session.create calls across both waves = 2.
      expect(fake.calls.sessionCreate).toHaveLength(2)
    })

    it("fans out within a single wave when scenarios share a common predecessor", async () => {
      // Simulate Perun's fan-out shape: BE-01 in wave 0, BE-02 + BE-03 (each
      // depends-on BE-01) in wave 1. Wave 1 is a single dispatch_parallel
      // call with two tasks in parallel.
      const fake = makeFakeClient({
        agents: [
          makeAgent("qa-tester-fe", "subagent"),
          makeAgent("qa-tester-be", "subagent"),
        ],
        sessions: {
          "qa-tester-be": { sessionId: "be-session", finalText: JSON.stringify(BE_FINDING) },
        },
      })
      const plugin = await invokePlugin(fake.client)
      const ctx = makeToolContext("perun-parent-session")

      const rawResults = await plugin.dispatchParallel(
        {
          agent: "qa-tester ×2",
          summary: "deps plan (wave 2/2)",
          tasks: [
            { name: "qa-tester-be", prompt: "<BE-02 scenario block>" },
            { name: "qa-tester-be", prompt: "<BE-03 scenario block>" },
          ],
        },
        ctx,
      )
      const results = JSON.parse(rawResults) as DispatchResult[]

      expect(results).toHaveLength(2)
      expect(results[0]?.status).toBe("success")
      expect(results[1]?.status).toBe("success")
      // Both fan-out tasks dispatched in the same wave ⇒ one session.create
      // batch with two entries.
      expect(fake.calls.sessionCreate).toHaveLength(2)
    })

    it("isolates predecessor failure: dependent wave still runs after wave 0 returns error", async () => {
      // Perun's documented semantics: predecessor failure does NOT block
      // dependents. The dispatcher cannot model that semantic on its own (it
      // has no knowledge of waves), so Perun is responsible for emitting the
      // next wave regardless of wave 0's status. This test asserts the
      // dispatcher honours both calls independently.
      const fake = makeFakeClient({
        agents: [makeAgent("qa-tester-be", "subagent")],
        sessions: {
          "qa-tester-be": { sessionId: "be-session", finalText: JSON.stringify(BE_FINDING) },
        },
      })

      // Wave 0: force an empty session id so the BE task errors out.
      const originalCreate = fake.client.session.create.bind(fake.client.session)
      let calls = 0
      fake.client.session.create = (async (options: { body: { parentID: string; title: string } }) => {
        calls += 1
        if (calls === 1) {
          fake.calls.sessionCreate.push(options)
          return { data: { id: "" } }
        }
        return originalCreate(options)
      }) as typeof fake.client.session.create

      const plugin = await invokePlugin(fake.client)
      const ctx = makeToolContext("perun-parent-session")

      const wave0Raw = await plugin.dispatchParallel(
        {
          agent: "qa-tester",
          summary: "deps plan (wave 1/2)",
          tasks: [{ name: "qa-tester-be", prompt: "<BE-01 scenario block>" }],
        },
        ctx,
      )
      const wave0 = JSON.parse(wave0Raw) as DispatchResult[]
      expect(wave0[0]?.status).toBe("error")

      // Perun, per the spec, still dispatches wave 1 — dependents run
      // regardless of predecessor failure.
      const wave1Raw = await plugin.dispatchParallel(
        {
          agent: "qa-tester",
          summary: "deps plan (wave 2/2)",
          tasks: [{ name: "qa-tester-be", prompt: "<BE-02 scenario block>" }],
        },
        ctx,
      )
      const wave1 = JSON.parse(wave1Raw) as DispatchResult[]
      expect(wave1[0]?.status).toBe("success")
    })
  })
})
