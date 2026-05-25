import { describe, it, expect } from "vitest"
import { BindingsStore } from "../../../src/modules/qa/bindings-store.js"
import { scrubSecrets } from "../../../src/modules/qa/scrubber.js"

describe("scrubSecrets", () => {
  it("returns input unchanged when no bindings for parent", () => {
    const store = new BindingsStore()
    expect(scrubSecrets("hello world", "unknown", store)).toBe("hello world")
  })

  it("redacts exact full-value match", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "QA_BIND_TOKEN", "eyJabcdef1234567890hunter", "secret", "minted-recipe")
    const out = scrubSecrets("token=eyJabcdef1234567890hunter all done", "p1", store)
    expect(out).toBe("token=[REDACTED:QA_BIND_TOKEN] all done")
  })

  it("redacts long-segment partial (≥16 chars, high-entropy substring)", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "QA_BIND_TOKEN", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9-LONG-RANDOM-PAYLOAD-XYZ", "secret", "minted-recipe")
    const out = scrubSecrets("Successfully registered, value starts with eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 etc.", "p1", store)
    expect(out).toContain("[REDACTED:QA_BIND_TOKEN]")
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9")
  })

  it("does NOT redact low-entropy 16+ char substring", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "QA_BIND_X", "test_user_admin_account_lowercase_x", "secret", "user-paste")
    const out = scrubSecrets("The test_user_admin_account is configured.", "p1", store)
    expect(out).toBe("The test_user_admin_account is configured.")
  })

  it("redacts user-paste values too (default type=secret)", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "TEST_USER_PASSWORD", "Hunter22-VeryLong-Hi3hEntr0py-Pwd", "secret", "user-paste")
    const out = scrubSecrets("Password Hunter22-VeryLong-Hi3hEntr0py-Pwd was used", "p1", store)
    expect(out).toContain("[REDACTED:TEST_USER_PASSWORD]")
  })

  it("does NOT redact plain-type bindings", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "QA_BIND_CV_ID", "uuid-123-abc-veryyyyyyy-long", "plain", "minted-recipe")
    const out = scrubSecrets("CV id: uuid-123-abc-veryyyyyyy-long", "p1", store)
    expect(out).toBe("CV id: uuid-123-abc-veryyyyyyy-long")
  })

  it("operates on a pinned snapshot, immune to concurrent mutations", () => {
    const store = new BindingsStore()
    store.writeBinding("p1", "QA_BIND_TOKEN", "eyJsecretValue1234567890", "secret", "minted-recipe")
    const snap = store.pinSnapshot("p1")
    store.writeBinding("p1", "QA_BIND_X", "another", "plain", "minted-recipe")
    const out = scrubSecrets("contains eyJsecretValue1234567890 token", "p1", store, snap)
    expect(out).toContain("[REDACTED:QA_BIND_TOKEN]")
    store.releaseSnapshot(snap.id)
  })
})
