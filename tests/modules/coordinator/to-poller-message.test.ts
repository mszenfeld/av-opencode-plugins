import { describe, expect, it } from "vitest"
import type { AssistantMessage, Message, UserMessage } from "@opencode-ai/sdk"
import { toPollerMessage } from "../../../src/modules/coordinator/index.js"

function makeAssistant(overrides: Partial<AssistantMessage> = {}): AssistantMessage {
  return {
    id: "msg-1",
    sessionID: "sess-1",
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
    ...overrides,
  }
}

function makeUser(overrides: Partial<UserMessage> = {}): UserMessage {
  return {
    id: "msg-u",
    sessionID: "sess-1",
    role: "user",
    time: { created: 1700000000 },
    ...overrides,
  } as UserMessage
}

describe("toPollerMessage (SDK adapter)", () => {
  it("maps assistant message with finish to finish_reason", () => {
    const raw: { info: Message; parts: Array<{ type: string; text?: string }> } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("Hello world")
    expect(result.finish_reason).toBe("end_turn")
  })

  it("returns null finish_reason when assistant has no finish field", () => {
    const raw: { info: Message; parts: Array<{ type: string; text?: string }> } = {
      info: makeAssistant({ finish: undefined }),
      parts: [{ type: "text", text: "partial" }],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("assistant")
    expect(result.content).toBe("partial")
    expect(result.finish_reason).toBeNull()
  })

  it("returns null finish_reason for non-assistant roles", () => {
    const raw: { info: Message; parts: Array<{ type: string; text?: string }> } = {
      info: makeUser(),
      parts: [{ type: "text", text: "user input" }],
    }

    const result = toPollerMessage(raw)

    expect(result.role).toBe("user")
    expect(result.content).toBe("user input")
    expect(result.finish_reason).toBeNull()
  })

  it("ignores non-text parts when assembling content", () => {
    const raw: { info: Message; parts: Array<{ type: string; text?: string }> } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [
        { type: "text", text: "answer" },
        { type: "tool", text: "ignored" },
        { type: "reasoning" },
      ],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("answer")
    expect(result.finish_reason).toBe("end_turn")
  })

  it("handles missing part text safely", () => {
    const raw: { info: Message; parts: Array<{ type: string; text?: string }> } = {
      info: makeAssistant({ finish: "end_turn" }),
      parts: [{ type: "text" }, { type: "text", text: "ok" }],
    }

    const result = toPollerMessage(raw)

    expect(result.content).toBe("ok")
    expect(result.finish_reason).toBe("end_turn")
  })
})
