#!/usr/bin/env node
/**
 * Verifies that committed dist/ artifacts are in sync with src/.
 * Run this after `npm run build` in CI to prevent drift.
 */
import { execSync } from "node:child_process"
import process from "node:process"

const trackedDistPaths = [
  "src/index.js",
  "src/index.d.ts",
  "packages/commit/dist",
  "packages/python-developer/dist",
  "packages/code-review/dist",
  "packages/frontend-developer/dist",
  "packages/skill-utils/dist",
  "packages/skill-registry/dist",
  "packages/swift-developer/dist",
  "packages/coordinator/dist",
]

// Run build first
console.log("Running npm run build...")
try {
  execSync("npm run build", { stdio: "inherit" })
} catch {
  console.error("Build failed. Fix build errors before checking dist sync.")
  process.exit(1)
}

// Check for uncommitted changes in tracked dist paths
let changedFiles

try {
  const output = execSync("git status --short -- " + trackedDistPaths.join(" "), {
    encoding: "utf8",
  })
  changedFiles = output.trim()
} catch {
  console.error("Failed to run git status. Ensure this is a git repository.")
  process.exit(1)
}

if (changedFiles) {
  console.error("\n❌ DIST SYNC FAILED")
  console.error("The following built artifacts are out of sync with src/:")
  console.error(changedFiles)
  console.error("\nRun 'npm run build' locally and commit the updated dist/ files.")
  process.exit(1)
}

console.log("✅ dist/ is in sync with src/")
