import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/**
 * Canonical agent key for the Triglav exploration specialist. Centralised so
 * the literal `"triglav"` is not duplicated across registration, config
 * injection, tests, and docs — mirrors the convention used for `zmora` variants
 * and Perun's coordinator name. Use this constant whenever referencing the
 * agent key programmatically (config.agent[…], pantheon.json agents.<key>).
 */
declare const TRIGLAV_AGENT_KEY: "triglav";
declare const TRIGLAV_DESCRIPTION = "Read-only codebase explorer: maps structure, finds definitions/references/patterns via serena LSP (Grep/Glob fallback). Returns a synthesized answer, not edits.";
declare const triglavSpecialistInfo: SpecialistInfo;

export { TRIGLAV_AGENT_KEY, TRIGLAV_DESCRIPTION, triglavSpecialistInfo };
