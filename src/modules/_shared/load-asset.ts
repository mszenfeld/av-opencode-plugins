import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/**
 * Resolve and read a sibling asset (markdown, prompt section, etc.) relative
 * to the caller's compiled location.
 *
 * The root build uses tsup with `bundle: false`, so every source file is
 * emitted as a standalone module that mirrors the `src/` layout. That means a
 * caller in `src/modules/<name>/foo.ts` resolves to:
 *   - Production:                dist/modules/<name>/foo.js
 *   - Dev (tests against src):   src/modules/<name>/foo.ts
 * Asset siblings (e.g. `agents/`, `commands/`, `prompt-sections/`) are copied
 * into the same dist layout by `scripts/copy-root-assets.mjs`, so the SAME
 * `relativePath` works in both dev and production.
 *
 * If a read fails it means the build asset-copy step is broken or someone
 * moved the assets — fix the layout, not the resolver.
 *
 * @param callerUrl    Pass `import.meta.url` from the caller.
 * @param relativePath Path to the asset, relative to the caller's directory.
 */
export function loadModuleAsset(callerUrl: string, relativePath: string): string {
  const moduleDir = path.dirname(fileURLToPath(callerUrl))
  const filePath = path.resolve(moduleDir, relativePath)
  return readFileSync(filePath, "utf8")
}
