import { describe, it, expect } from "vitest"
import { parseBindings } from "../../../src/modules/qa/binding-parser.js"

const SAMPLE_PLAN = `
# Test Plan

## Setup

**Required environment variables:**
- \`DATABASE_URL\`

**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — Supabase JWT for the test user
  - Inputs: \`$TEST_USER_EMAIL\`, \`$TEST_USER_PASSWORD\`, \`$SUPABASE_URL\`, \`$ANON_KEY\`
  - Egress: \`$SUPABASE_URL\`
  - Recipe:
    \`\`\`bash
    curl -sS "$SUPABASE_URL/auth/v1/token?grant_type=password" -H "apikey: $ANON_KEY" --data-urlencode "email=$TEST_USER_EMAIL" --data-urlencode "password=$TEST_USER_PASSWORD" | jq -er .access_token
    \`\`\`

- \`QA_BIND_CV_ID\` (plain) — Test CV
  - Inputs: \`$QA_BIND_TOKEN\`, \`$BASE_URL\`
  - Egress: \`$BASE_URL\`
  - Recipe:
    \`\`\`bash
    curl -sS -X POST "$BASE_URL/api/v1/cvs" -H "Authorization: Bearer $QA_BIND_TOKEN" --data-urlencode "name=Test" | jq -er .id
    \`\`\`

## BE Test Scenarios

### BE-01: Some test
- **Steps:** ...
`

describe("parseBindings", () => {
  it("extracts both bindings with correct fields", () => {
    const result = parseBindings(SAMPLE_PLAN)
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.bindings).toHaveLength(2)

    const token = result.bindings[0]!
    expect(token.name).toBe("QA_BIND_TOKEN")
    expect(token.type).toBe("secret")
    expect(token.inputs).toEqual(["TEST_USER_EMAIL", "TEST_USER_PASSWORD", "SUPABASE_URL", "ANON_KEY"])
    expect(token.egress).toBe("$SUPABASE_URL")
    expect(token.recipe).toContain("curl -sS")
    expect(token.recipe).toContain("jq -er .access_token")

    const cv = result.bindings[1]!
    expect(cv.name).toBe("QA_BIND_CV_ID")
    expect(cv.type).toBe("plain")
    expect(cv.inputs).toEqual(["QA_BIND_TOKEN", "BASE_URL"])
  })

  it("returns ok with empty bindings when no **Bindings:** subsection", () => {
    const result = parseBindings("# Plan\n\n## Setup\n\n**Required environment variables:**\n- \`X\`\n")
    expect(result.status).toBe("ok")
    if (result.status === "ok") {
      expect(result.bindings).toEqual([])
    }
  })

  it("rejects binding name not matching QA_BIND_*", () => {
    const plan = `
## Setup
**Bindings:**
- \`MY_TOKEN\` (secret) — bad
  - Inputs: \`$X\`
  - Egress: \`$X\`
  - Recipe:
    \`\`\`bash
    echo hi
    \`\`\`
`
    const result = parseBindings(plan)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toMatch(/QA_BIND_/)
    }
  })

  it("rejects recipe with $NAME not declared in Inputs", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$X\`
  - Egress: \`$X\`
  - Recipe:
    \`\`\`bash
    curl "$X/$UNDECLARED"
    \`\`\`
`
    const result = parseBindings(plan)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toMatch(/UNDECLARED/)
    }
  })

  it("rejects binding without Recipe block", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$X\`
  - Egress: \`$X\`
`
    const result = parseBindings(plan)
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toMatch(/[Rr]ecipe/)
    }
  })
})
