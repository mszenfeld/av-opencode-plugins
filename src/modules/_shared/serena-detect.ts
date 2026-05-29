// Advisory-only: this powers a one-time warning toast. Triglav is correct
// WITHOUT detection because the prompt falls back to Grep/Glob when serena is
// absent — so the blast radius of a wrong config shape is "no toast", never a
// broken agent. Structural ConfigLike avoids depending on the exact SDK type.

export interface ConfigLike {
  // Entries carry SDK-specific fields (e.g. `type: "local"`) we don't model;
  // an index signature keeps the shape open so a real config literal type-checks
  // while we only read the one field we care about. The value is `unknown` because
  // user-authored opencode.json can supply a malformed entry (null / non-object).
  mcp?: Record<string, unknown>
}

export function isSerenaAvailable(config: ConfigLike): boolean {
  const entry = config.mcp?.serena
  if (entry === null || typeof entry !== "object") return false
  const { enabled } = entry as { enabled?: unknown }
  return enabled !== false
}
