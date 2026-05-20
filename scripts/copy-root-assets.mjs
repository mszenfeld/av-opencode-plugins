#!/usr/bin/env node
/**
 * Copies markdown assets from src/ to dist/ preserving relative paths.
 * Used by the root build pipeline after tsup runs.
 */
import { existsSync, mkdirSync, readdirSync, lstatSync, copyFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sourceRoots = ["commands", "agents", "skills"]
let copiedCount = 0

function copyMarkdownRecursive(sourceDir, destDir) {
  if (!existsSync(sourceDir)) return

  mkdirSync(destDir, { recursive: true })

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destPath = path.join(destDir, entry.name)
    const stats = lstatSync(sourcePath)

    if (stats.isSymbolicLink()) continue

    if (stats.isDirectory()) {
      copyMarkdownRecursive(sourcePath, destPath)
    } else if (stats.isFile() && entry.name.endsWith(".md")) {
      copyFileSync(sourcePath, destPath)
      copiedCount++
    }
  }
}

for (const root of sourceRoots) {
  copyMarkdownRecursive(
    path.join(repoRoot, "src", root),
    path.join(repoRoot, "dist", root),
  )
}

console.log(`Done. ${copiedCount} asset(s) copied.`)
