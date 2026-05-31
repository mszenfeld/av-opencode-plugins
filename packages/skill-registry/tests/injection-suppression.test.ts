import { describe, expect, it } from "vitest"
import { COORDINATOR_AGENT_NAME } from "@appverk/opencode-skill-utils"
import { AppVerkSkillRegistryPlugin } from "../src/index.js"

function fakeClient(agent: string | undefined) {
  return {
    session: {
      messages: async () => ({
        data: agent ? [{ info: { role: "user", agent }, parts: [] }] : [],
      }),
    },
  } as never
}

async function runTransform(client: never, sessionID: string | undefined) {
  const plugin = await AppVerkSkillRegistryPlugin({ client } as never)
  const output = { system: [] as string[] }
  await plugin["experimental.chat.system.transform"]?.(
    { sessionID, model: {} as never } as never,
    output as never,
  )
  return output.system
}

describe("skill-activation injection suppression", () => {
  it("suppresses for the coordinator (Perun)", async () => {
    const system = await runTransform(fakeClient(COORDINATOR_AGENT_NAME), "s1")
    expect(system).toHaveLength(0)
  })

  it("injects for a dispatched specialist", async () => {
    const system = await runTransform(fakeClient("zmora-be"), "s1")
    expect(system.length).toBeGreaterThan(0)
  })

  it("suppresses (fail-closed) when sessionID is undefined", async () => {
    const system = await runTransform(fakeClient("zmora-be"), undefined)
    expect(system).toHaveLength(0)
  })
})
