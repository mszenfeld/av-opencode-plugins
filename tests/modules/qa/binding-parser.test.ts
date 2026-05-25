import { describe, it, expect } from "vitest"
import { parseBindings, validateRecipe } from "../../../src/modules/qa/binding-parser.js"

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

describe("validateRecipe — single-statement constraint (Rule 1)", () => {
  it("accepts a single-pipe pipeline", () => {
    expect(validateRecipe(`curl "$URL" | jq -er .x`, "$URL").status).toBe("ok")
  })
  it("rejects ; chained statements", () => {
    expect(validateRecipe(`curl "$URL"; rm /tmp/x`, "$URL").status).toBe("error")
  })
  it("rejects && chained statements", () => {
    expect(validateRecipe(`curl "$URL" && curl "http://evil"`, "$URL").status).toBe("error")
  })
  it("rejects || chained statements", () => {
    expect(validateRecipe(`curl "$URL" || curl "http://evil"`, "$URL").status).toBe("error")
  })
  it("rejects newline-separated statements", () => {
    expect(validateRecipe(`curl "$URL"\ncurl "http://evil"`, "$URL").status).toBe("error")
  })
  it("accepts \\<newline> line continuation as single statement", () => {
    expect(validateRecipe(`curl "$URL" \\\n  -H "X: y" | jq -er .x`, "$URL").status).toBe("ok")
  })
})

describe("validateRecipe — operator allowlist (Rule 2)", () => {
  it("rejects $() command substitution", () => {
    expect(validateRecipe(`curl "$URL" -d "$(cat /etc/passwd)"`, "$URL").status).toBe("error")
  })
  it("rejects backticks", () => {
    expect(validateRecipe('curl "$URL" -d "`cat /etc/passwd`"', "$URL").status).toBe("error")
  })
  it("rejects heredoc <<", () => {
    expect(validateRecipe(`cat <<EOF\nx\nEOF`, "$URL").status).toBe("error")
  })
  it("rejects > redirect to non-/dev/null", () => {
    expect(validateRecipe(`curl "$URL" > /tmp/leak`, "$URL").status).toBe("error")
  })
  it("accepts 2>/dev/null", () => {
    expect(validateRecipe(`curl "$URL" 2>/dev/null | jq -er .x`, "$URL").status).toBe("ok")
  })
  it("rejects & background", () => {
    expect(validateRecipe(`curl "$URL" &`, "$URL").status).toBe("error")
  })
})

describe("validateRecipe — command allowlist (Rule 3)", () => {
  it("rejects unknown command (wget)", () => {
    expect(validateRecipe(`wget "$URL"`, "$URL").status).toBe("error")
  })
  it("rejects bash invocation", () => {
    expect(validateRecipe(`bash -c "curl $URL"`, "$URL").status).toBe("error")
  })
  it("accepts curl + jq pipeline", () => {
    expect(validateRecipe(`curl "$URL" | jq -er .x`, "$URL").status).toBe("ok")
  })
})

describe("validateRecipe — curl flag denylist", () => {
  it("rejects --upload-file", () => {
    expect(validateRecipe(`curl --upload-file /etc/passwd "$URL"`, "$URL").status).toBe("error")
  })
  it("rejects -T file", () => {
    expect(validateRecipe(`curl -T /etc/passwd "$URL"`, "$URL").status).toBe("error")
  })
  it("rejects -d @file", () => {
    expect(validateRecipe(`curl -d @/etc/passwd "$URL"`, "$URL").status).toBe("error")
  })
  it("rejects --data @file", () => {
    expect(validateRecipe(`curl --data @secrets.txt "$URL"`, "$URL").status).toBe("error")
  })
  it("rejects -o non-null", () => {
    expect(validateRecipe(`curl -o /tmp/x "$URL"`, "$URL").status).toBe("error")
  })
  it("accepts -o /dev/null", () => {
    expect(validateRecipe(`curl -o /dev/null "$URL"`, "$URL").status).toBe("ok")
  })
  it("accepts --data-urlencode 'inline'", () => {
    expect(validateRecipe(`curl --data-urlencode "email=$X" "$URL"`, "$URL").status).toBe("ok")
  })
})

describe("validateRecipe — Egress URL match (Rule 4)", () => {
  it("accepts curl to declared Egress host", () => {
    expect(validateRecipe(`curl "$URL/path" | jq -er .x`, "$URL").status).toBe("ok")
  })
  it("rejects curl to a different literal host", () => {
    expect(validateRecipe(`curl "https://evil.example/path"`, "$URL").status).toBe("error")
  })
  it("rejects curl to a different $VAR host when Egress is $URL", () => {
    expect(validateRecipe(`curl "$OTHER/path"`, "$URL").status).toBe("error")
  })
})

describe("parseBindings + validateRecipe integration", () => {
  it("parseBindings rejects plan with invalid recipe", () => {
    const plan = `
## Setup
**Bindings:**
- \`QA_BIND_TOKEN\` (secret) — bad
  - Inputs: \`$URL\`
  - Egress: \`$URL\`
  - Recipe:
    \`\`\`bash
    curl "$URL" && wget "http://evil"
    \`\`\`
`
    const result = parseBindings(plan)
    expect(result.status).toBe("error")
  })
})
