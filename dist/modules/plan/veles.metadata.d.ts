import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/**
 * Registered agent name for the Veles planning specialist — also its dispatch
 * identifier (used by `DISPATCHABLE_ALL_AGENTS` and Perun's no-plan dispatch).
 *
 * Mirrors Perun's "Name - Role" display-name convention (see
 * `coordinator/index.ts`): OpenCode has no separate display field, so the
 * `config.agent` KEY is what the TUI shows in the /agents picker, status bar,
 * and session label. Use space-dash-space — NEVER parentheses, which break the
 * `x-opencode-agent-name` HTTP header.
 *
 * NOTE: this is distinct from the pantheon.json config slug, which stays
 * lowercase `agents.veles.model` (read literally in `plan/index.ts`), exactly
 * as Perun's display key "Perun - Coordinator" pairs with `agents.perun`.
 */
declare const VELES_AGENT_KEY: "Veles - Planner";
declare const VELES_DESCRIPTION = "Planning specialist: authors QA test plans (and other work plans) from a diff or request. Dispatches read-only helpers (triglav) and returns a plan it saved \u2014 it does not execute the planned work.";
declare const velesSpecialistInfo: SpecialistInfo;

export { VELES_AGENT_KEY, VELES_DESCRIPTION, velesSpecialistInfo };
