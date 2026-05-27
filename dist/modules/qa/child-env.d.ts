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
declare function buildChildEnv(hostEnv: Record<string, string | undefined>, composedEnv: Record<string, string>): Record<string, string>;

export { buildChildEnv };
