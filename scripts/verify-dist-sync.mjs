#!/usr/bin/env node
/**
 * Verifies that committed dist/ artifacts are in sync with src/.
 * Run this after `bun run build` in CI to prevent drift.
 */
import { execFileSync, execSync } from "node:child_process"
import process from "node:process"

// Root `dist/` covers `dist/modules/*` (commit, qa, coordinator,
// pantheon-config), `dist/agents/`, `dist/commands/`, `dist/skills/`,
// `dist/hooks/` — everything the root tsup config emits. Per-package paths
// are listed individually below.
const trackedDistPaths = [
  "dist",
  "packages/python-developer/dist",
  "packages/code-review/dist",
  "packages/frontend-developer/dist",
  "packages/skill-utils/dist",
  "packages/skill-registry/dist",
  "packages/swift-developer/dist",
]

// Run build first
console.log("Running bun run build...")
try {
  execSync("bun run build", { stdio: "inherit" })
} catch (err) {
  console.error("Build failed (exit", err.status ?? err.signal ?? "unknown", "). Fix build errors before checking dist sync.")
  process.exit(1)
}

// Check for uncommitted changes in tracked dist paths
let changedFiles

try {
  const output = execFileSync(
    "git",
    ["status", "--short", "--", ...trackedDistPaths],
    { encoding: "utf8" },
  )
  changedFiles = output.trim()
} catch (err) {
  console.error("Failed to run git status:", err.message)
  console.error("Ensure this is a git repository.")
  process.exit(1)
}

if (changedFiles) {
  console.error("\n❌ DIST SYNC FAILED")
  console.error("The following built artifacts are out of sync with src/:")
  console.error(changedFiles)
  console.error("\nRun 'bun run build' locally and commit the updated dist/ files.")
  process.exit(1)
}

console.log("✅ dist/ is in sync with src/")
