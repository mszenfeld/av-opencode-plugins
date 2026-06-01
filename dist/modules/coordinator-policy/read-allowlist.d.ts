/**
 * Canonical coordinator bash allowlist — mirrors the `Bash(...)` entries in
 * `src/agents/perun.md` frontmatter. Used only as a fallback when the frontmatter
 * cannot be read/parsed, so a packaging glitch degrades the gate to a known-good
 * allowlist instead of crashing every plugin (the reader runs inside the shared
 * `Promise.all` plugin-init) or silently blocking the coordinator's own `mkdir`/`ls`.
 * `read-allowlist.test.ts` guards this constant against `perun.md` frontmatter drift.
 */
declare const FALLBACK_ALLOWLIST: string[];
/** Read Perun's allowed bash programs from its agent markdown frontmatter (single source of truth). */
declare function readCoordinatorBashAllowlist(): string[];

export { FALLBACK_ALLOWLIST, readCoordinatorBashAllowlist };
