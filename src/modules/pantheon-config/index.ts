import { loadFresh, type LoadResult } from "./loader.js"

export type { PantheonConfig } from "./schema.js"
export { validateConfigFile } from "./schema.js"
export { userGlobalPath, walkUpProjectPaths } from "./paths.js"
export { loadFresh } from "./loader.js"

/**
 * Module-scope cache. `loadPantheonConfig`, `getLoadErrors`, and
 * `pantheonConfigEmpty` share the same cached result so all three reflect
 * the same load attempt. The cache lives for the lifetime of the OpenCode
 * process — restart is required to pick up edits to pantheon.json.
 *
 * Tests must call `__resetCacheForTests()` in `beforeEach` to avoid
 * cross-test pollution.
 */
let cached: LoadResult | undefined

function ensureLoaded(): LoadResult {
  if (cached === undefined) {
    cached = loadFresh()
  }
  return cached
}

export function loadPantheonConfig() {
  return ensureLoaded().config
}

export function getLoadErrors(): string[] {
  return ensureLoaded().errors
}

export function pantheonConfigEmpty(): boolean {
  return Object.keys(ensureLoaded().config.agents).length === 0
}

/** Test-only: reset the cache between tests. Do not call in production code. */
export function __resetCacheForTests(): void {
  cached = undefined
}
