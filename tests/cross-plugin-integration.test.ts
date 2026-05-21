import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  CATEGORY_PREFIX_MAPPING,
  VALID_PREFIXES,
  VALID_CATEGORIES,
} from "../packages/skill-utils/dist/index.js"

const rootDirectory = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

function readPackageFile(packageName: string, relativePath: string): string {
  const filePath = path.resolve(
    rootDirectory,
    "packages",
    packageName,
    "src",
    relativePath,
  )
  return readFileSync(filePath, "utf8")
}

function readSrcFile(relativePath: string): string {
  const filePath = path.resolve(rootDirectory, "src", relativePath)
  return readFileSync(filePath, "utf8")
}

describe("Cross-plugin Category→Prefix mapping consistency", () => {
  it("shared mapping contains all expected categories and prefixes", () => {
    expect(CATEGORY_PREFIX_MAPPING).toEqual({
      Security: "SEC",
      Performance: "PERF",
      Architecture: "ARCH",
      Maintainability: "MAINT",
      Documentation: "DOC",
      Testing: "QA",
    })
    expect(VALID_PREFIXES).toEqual(["SEC", "PERF", "ARCH", "MAINT", "DOC", "QA"])
  })

  it("code-review review.md contains the full canonical mapping table", () => {
    const reviewMd = readPackageFile("code-review", "commands/review.md")

    for (const [category, prefix] of Object.entries(CATEGORY_PREFIX_MAPPING)) {
      // Look for the table row: | <Category> | <Prefix> |
      const rowRegex = new RegExp(
        `\\|\\s*${category}\\s*\\|\\s*${prefix}\\s*\\|`,
        "i",
      )
      expect(reviewMd).toMatch(rowRegex)
    }
  })

  it("code-review fix.md ID pattern includes all valid prefixes", () => {
    const fixMd = readPackageFile("code-review", "commands/fix.md")

    const idPatternMatch = fixMd.match(
      /\^\(SEC\|PERF\|ARCH\|MAINT\|DOC\|QA\)-\\d\{3\}\$/,
    )
    expect(idPatternMatch).toBeTruthy()

    for (const prefix of VALID_PREFIXES) {
      expect(fixMd).toContain(prefix)
    }
  })

  it("code-review fix.md routes QA prefix to docs/testing/reports/", () => {
    const fixMd = readPackageFile("code-review", "commands/fix.md")

    expect(fixMd).toContain('QA) target_dir="docs/testing/reports"')
    expect(fixMd).toContain("docs/testing/reports/")
  })

  it("qa report-format skill references Testing category and QA prefix", () => {
    const reportFormatMd = readSrcFile("skills/qa/report-format/SKILL.md")

    expect(reportFormatMd).toContain("**Testing**")
    expect(reportFormatMd).toContain("**QA**")
    expect(reportFormatMd).toContain("Category:** Testing")

    // Verify the canonical table is present in the skill
    for (const [category, prefix] of Object.entries(CATEGORY_PREFIX_MAPPING)) {
      const rowRegex = new RegExp(
        `\\|\\s*\\*?\\*?${category}\\*?\\*?\\s*\\|\\s*\\*?\\*?${prefix}\\*?\\*?\\s*\\|`,
        "i",
      )
      expect(reportFormatMd).toMatch(rowRegex)
    }
  })

  it("all plugins agree on the number of categories", () => {
    const reviewMd = readPackageFile("code-review", "commands/review.md")
    const reportFormatMd = readSrcFile("skills/qa/report-format/SKILL.md")

    // Narrow match: look for rows where both cells are valid category/prefix values
    const reviewRows = reviewMd.match(/\|\s*\w+\s*\|\s*\w+\s*\|/g) ?? []
    const reportRows =
      reportFormatMd.match(/\|\s*\*?\*?\w+\*?\*?\s*\|\s*\*?\*?\w+\*?\*?\s*\|/g) ??
      []

    // Only count rows where the first cell is a known category and second is a known prefix
    const reviewDataRows = reviewRows.filter((r) => {
      const cells = r.split("|").map((c) => c.trim())
      const category = cells.find((c) => VALID_CATEGORIES.includes(c))
      const prefix = cells.find((c) => VALID_PREFIXES.includes(c))
      return category && prefix
    })
    const reportDataRows = reportRows.filter((r) => {
      const cells = r.split("|").map((c) => c.trim().replace(/^\*+|\*+$/g, ""))
      const category = cells.find((c) => VALID_CATEGORIES.includes(c))
      const prefix = cells.find((c) => VALID_PREFIXES.includes(c))
      return category && prefix
    })

    expect(reviewDataRows.length).toBe(Object.keys(CATEGORY_PREFIX_MAPPING).length)
    expect(reportDataRows.length).toBe(Object.keys(CATEGORY_PREFIX_MAPPING).length)
  })
})
