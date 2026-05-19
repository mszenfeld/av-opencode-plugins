import { describe, expect, it, vi } from "vitest"
import type { ToolContext } from "@opencode-ai/plugin"
import { AppVerkCoordinatorPlugin } from "../src/index.js"
import type { SDKClient } from "../src/sdk-specialist.js"

/**
 * The OpenCode TUI's GenericTool renderer shows `{tool} {input(input)}`,
 * where the `input()` helper formats ONLY primitive top-level args. `tasks`
 * is an array, so without `summary` the call line collapses to a bare
 * `dispatch_parallel`. `summary` is the one inline knob we have.
 *
 * These tests also pin the secondary use of `summary`: it is mirrored into
 * `state.title` via `ToolContext.metadata` so richer UIs (desktop/web) that
 * consume `state.title` get the same label.
 */

function makeContext(
  metadataSpy: (input: { title?: string; metadata?: Record<string, unknown> }) => void,
): ToolContext {
  return {
    sessionID: "session-1",
    messageID: "msg-1",
    agent: "perun",
    directory: "/tmp",
    worktree: "/tmp",
    abort: new AbortController().signal,
    metadata: metadataSpy,
    ask: (): never => {
      throw new Error("ask not used in this test")
    },
  } as unknown as ToolContext
}

async function loadDispatchTool(client: SDKClient) {
  const hooks = await AppVerkCoordinatorPlugin({
    client,
    project: {} as never,
    directory: "/tmp",
    worktree: "/tmp",
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL("http://localhost"),
  } as never)
  const dispatch = hooks.tool?.["dispatch_parallel"]
  if (dispatch === undefined) throw new Error("dispatch_parallel not registered")
  return dispatch
}

/**
 * Failing-client setup. The metadata mirror must run BEFORE any registry
 * lookup or session spawn, so making `app.agents` throw lets us assert the
 * call happened without simulating successful dispatches.
 */
function makeFailingClient(): SDKClient {
  return {
    app: {
      async agents() {
        throw new Error("registry-load-fail")
      },
    },
  } as unknown as SDKClient
}

describe("dispatch_parallel summary surfacing", () => {
  it("mirrors `summary` into state.title via context.metadata", async () => {
    const metadataSpy = vi.fn()
    const dispatch = await loadDispatchTool(makeFailingClient())

    await expect(
      dispatch.execute(
        {
          summary: "qa-fe-tester, qa-be-tester — run 2026-05-19-login plan",
          tasks: [
            { name: "qa-fe-tester", prompt: "run FE" },
            { name: "qa-be-tester", prompt: "run BE" },
          ],
        },
        makeContext(metadataSpy),
      ),
    ).rejects.toThrow()

    expect(metadataSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "qa-fe-tester, qa-be-tester — run 2026-05-19-login plan",
      }),
    )
  })

  it("includes per-task name and prompt in metadata for diagnostics", async () => {
    const metadataSpy = vi.fn()
    const dispatch = await loadDispatchTool(makeFailingClient())

    await expect(
      dispatch.execute(
        {
          summary: "frontend-developer, qa-be-tester — login flow",
          tasks: [
            { name: "frontend-developer", prompt: "build login form" },
            { name: "qa-be-tester", prompt: "test /api/users" },
          ],
        },
        makeContext(metadataSpy),
      ),
    ).rejects.toThrow()

    expect(metadataSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          tasks: [
            { name: "frontend-developer", prompt: "build login form" },
            { name: "qa-be-tester", prompt: "test /api/users" },
          ],
        }),
      }),
    )
  })

  it("calls metadata BEFORE any registry lookup so the label survives downstream failures", async () => {
    const metadataSpy = vi.fn()
    const dispatch = await loadDispatchTool(makeFailingClient())

    // The failing client throws on registry load. If metadata were called
    // after the throw, the spy would never fire. Asserting at least one
    // call pins the ordering: metadata-first, work-second.
    await expect(
      dispatch.execute(
        {
          summary: "fix-auto — QA-003 missing CSRF token",
          tasks: [{ name: "fix-auto", prompt: "<issue body>" }],
        },
        makeContext(metadataSpy),
      ),
    ).rejects.toThrow()

    expect(metadataSpy).toHaveBeenCalledTimes(1)
    expect(metadataSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "fix-auto — QA-003 missing CSRF token",
      }),
    )
  })
})
