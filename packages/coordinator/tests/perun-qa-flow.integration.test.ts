import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"
import { dispatchParallel, type DispatchSpecialist } from "../src/dispatch.js"
import { assignIssueIds, type Finding } from "../src/assign-issue-ids.js"
import type { PollerMessage } from "../src/poller.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function finishedMessage(content: string): PollerMessage {
  return { role: "assistant", content, finish_reason: "end_turn" }
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

const FE_FINDING = {
  severity: "MEDIUM",
  title: "Login error not visible",
  scenario: "FE-02",
  file: "src/Login.tsx",
  line: 42,
}

const BE_FINDING = {
  severity: "HIGH",
  title: "POST /api/users returns 500",
  scenario: "BE-01",
  file: "src/api/users.ts",
  line: 15,
}

const defaultRegistry = {
  "qa-fe-tester": { mode: "subagent" as const },
  "qa-be-tester": { mode: "subagent" as const },
}

describe("@perun QA flow integration", () => {
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

  it("dispatches FE and BE testers in parallel and combines findings with assigned IDs", async () => {
    const specialist: DispatchSpecialist = {
      startTask: vi.fn(async (agentName: string): Promise<string> => {
        if (agentName === "qa-fe-tester") return "fe-session"
        if (agentName === "qa-be-tester") return "be-session"
        throw new Error(`Unexpected agent: ${agentName}`)
      }),
      fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
        if (sessionId === "fe-session") {
          return [finishedMessage(JSON.stringify(FE_FINDING))]
        }
        if (sessionId === "be-session") {
          return [finishedMessage(JSON.stringify(BE_FINDING))]
        }
        return []
      }),
    }

    const results = await dispatchParallel({
      tasks: [
        { name: "qa-fe-tester", prompt: "<FE scenarios>" },
        { name: "qa-be-tester", prompt: "<BE scenarios>" },
      ],
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]?.status).toBe("success")
    expect(results[1]?.status).toBe("success")

    const rawFindings: Finding[] = results.map((r) => JSON.parse(r.result) as Finding)
    const sorted = sortBySeverity(rawFindings)

    expect(sorted[0]?.severity.toUpperCase()).toBe("HIGH")
    expect(sorted[1]?.severity.toUpperCase()).toBe("MEDIUM")

    const withIds = assignIssueIds({ findings: sorted, prefix: "QA" })

    expect(withIds).toHaveLength(2)
    expect(withIds[0]?.id).toBe("QA-001")
    expect(withIds[0]?.title).toBe("POST /api/users returns 500")
    expect(withIds[1]?.id).toBe("QA-002")
    expect(withIds[1]?.title).toBe("Login error not visible")
  })

  it("handles partial failure: BE specialist fails, FE succeeds", async () => {
    const specialist: DispatchSpecialist = {
      startTask: vi.fn(async (agentName: string): Promise<string> => {
        if (agentName === "qa-be-tester") {
          throw new Error("specialist crashed")
        }
        return "fe-session"
      }),
      fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
        if (sessionId === "fe-session") {
          return [finishedMessage(JSON.stringify(FE_FINDING))]
        }
        return []
      }),
    }

    const results = await dispatchParallel({
      tasks: [
        { name: "qa-fe-tester", prompt: "<FE scenarios>" },
        { name: "qa-be-tester", prompt: "<BE scenarios>" },
      ],
      agentRegistry: defaultRegistry,
      specialist,
      pollIntervalMs: 10,
    })

    expect(results).toHaveLength(2)
    expect(results[0]?.status).toBe("success")
    expect(results[1]?.status).toBe("error")
    expect(results[1]?.error).toBeTruthy()

    const feFindings: Finding[] = [JSON.parse(results[0]!.result) as Finding]
    const withIds = assignIssueIds({ findings: feFindings, prefix: "QA" })

    expect(withIds).toHaveLength(1)
    expect(withIds[0]?.id).toBe("QA-001")
    expect(withIds[0]?.title).toBe("Login error not visible")
  })

  it("assigns deterministic IDs across two runs", async () => {
    function makeSpecialist(): DispatchSpecialist {
      return {
        startTask: vi.fn(async (agentName: string): Promise<string> => {
          if (agentName === "qa-fe-tester") return "fe-session"
          if (agentName === "qa-be-tester") return "be-session"
          throw new Error(`Unexpected agent: ${agentName}`)
        }),
        fetchMessages: vi.fn(async (sessionId: string): Promise<PollerMessage[]> => {
          if (sessionId === "fe-session") {
            return [finishedMessage(JSON.stringify(FE_FINDING))]
          }
          if (sessionId === "be-session") {
            return [finishedMessage(JSON.stringify(BE_FINDING))]
          }
          return []
        }),
      }
    }

    async function runFlow(): Promise<string[]> {
      const results = await dispatchParallel({
        tasks: [
          { name: "qa-fe-tester", prompt: "<FE scenarios>" },
          { name: "qa-be-tester", prompt: "<BE scenarios>" },
        ],
        agentRegistry: defaultRegistry,
        specialist: makeSpecialist(),
        pollIntervalMs: 10,
      })
      const rawFindings: Finding[] = results
        .filter((r) => r.status === "success")
        .map((r) => JSON.parse(r.result) as Finding)
      const sorted = sortBySeverity(rawFindings)
      const withIds = assignIssueIds({ findings: sorted, prefix: "QA" })
      return withIds.map((f) => f.id)
    }

    const firstRun = await runFlow()
    const secondRun = await runFlow()

    expect(firstRun).toEqual(["QA-001", "QA-002"])
    expect(secondRun).toEqual(["QA-001", "QA-002"])
    expect(firstRun).toEqual(secondRun)
  })
})
