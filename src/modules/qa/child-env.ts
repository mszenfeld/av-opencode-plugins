// Child-process env allowlist for recipe execution.
//
// The recipe executor spawns `bash -c <recipe>` inside the OpenCode plugin
// host. Inheriting the full `process.env` exposes the recipe to every secret
// the host holds — `ANTHROPIC_API_KEY`, `AWS_*`, `KUBECONFIG`, GitHub PAT,
// session tokens, etc. — which is far broader than the recipe needs.
//
// Recipes only need:
//   1. The composed inputs (binding values + minted/recorded values), which
//      `execute_recipe` has already resolved into `composedEnv`.
//   2. A minimal set of host-env vars required for any CLI to run: `PATH`,
//      `HOME`, locale (`LANG`, `LC_*`), `TZ`. Without `PATH` we can't even
//      find `curl`; without `HOME` some tools (curl/psql/sqlite3) fail to
//      resolve their config dirs.
//
// Anything else is dropped. If a recipe legitimately needs another host var
// it should be listed in the binding's `Inputs:` so it flows through the
// composed env path (which has explicit user / parse_plan authorisation).

const HOST_ENV_ALLOWLIST = new Set([
  "PATH",
  "HOME",
  "LANG",
  "TZ",
  // SHELL/USER/LOGNAME are read by some CLIs (psql) for default values; safe
  // to inherit as they are not credentials.
  "SHELL",
  "USER",
  "LOGNAME",
])

// LC_* prefix is allowlisted as a family — there are many (LC_ALL, LC_CTYPE,
// LC_NUMERIC, LC_TIME, …) and they only affect locale/formatting.
function isLocaleVar(name: string): boolean {
  return name.startsWith("LC_")
}

/**
 * Build the env passed to `spawn("bash", ["-c", recipe], { env })`.
 *
 * - host env vars are filtered through `HOST_ENV_ALLOWLIST` (+ `LC_*`); all
 *   others are dropped.
 * - composed env (recipe inputs + minted bindings) is layered on top so that
 *   any collision is resolved in favour of the binding/input value — this
 *   mirrors the pre-existing `{ ...process.env, ...env }` precedence.
 * - undefined host-env entries (which `process.env` can legitimately produce
 *   for unset names) are skipped; the returned record only contains string
 *   values, which is what `child_process.spawn` accepts.
 */
export function buildChildEnv(
  hostEnv: Record<string, string | undefined>,
  composedEnv: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(hostEnv)) {
    if (value === undefined) continue
    if (!HOST_ENV_ALLOWLIST.has(name) && !isLocaleVar(name)) continue
    out[name] = value
  }
  for (const [name, value] of Object.entries(composedEnv)) {
    out[name] = value
  }
  return out
}
