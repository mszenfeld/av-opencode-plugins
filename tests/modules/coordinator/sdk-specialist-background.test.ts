import { describe, expect, it, vi } from "vitest"
import { createSDKSpecialist } from "../../../src/modules/coordinator/sdk-specialist.js"

function fakeClient(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      create: vi.fn(async () => ({ data: { id: "child-1" } })),
      promptAsync: vi.fn(async () => ({ data: undefined })),
      prompt: vi.fn(async () => ({ data: undefined })),
      messages: vi.fn(async () => ({ data: [] })),
      abort: vi.fn(async () => ({ data: undefined })),
      ...overrides,
    },
  } as never
}

describe("createSDKSpecialist.startBackground", () => {
  it("creates a session and fires promptAsync (not prompt), returning the id", async () => {
    const client = fakeClient()
    const specialist = createSDKSpecialist(client, "parent-1")
    const id = await specialist.startBackground("triglav", "explore X")
    expect(id).toBe("child-1")
    // It uses the async (fire-and-forget) endpoint, NOT the blocking prompt.
    expect((client as never as { session: { promptAsync: ReturnType<typeof vi.fn> } }).session.promptAsync).toHaveBeenCalledTimes(1)
    expect((client as never as { session: { prompt: ReturnType<typeof vi.fn> } }).session.prompt).not.toHaveBeenCalled()
  })

  it("throws when session creation yields no id", async () => {
    const client = fakeClient({ create: vi.fn(async () => ({ data: { id: "" } })) })
    const specialist = createSDKSpecialist(client, "parent-1")
    await expect(specialist.startBackground("triglav", "x")).rejects.toThrow(/no session id/)
  })
})
