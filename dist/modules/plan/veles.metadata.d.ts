import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/** Canonical agent key for the Veles planning specialist. */
declare const VELES_AGENT_KEY: "veles";
declare const VELES_DESCRIPTION = "Planning specialist: authors QA test plans (and other work plans) from a diff or request. Dispatches read-only helpers (triglav) and returns a plan it saved \u2014 it does not execute the planned work.";
declare const velesSpecialistInfo: SpecialistInfo;

export { VELES_AGENT_KEY, VELES_DESCRIPTION, velesSpecialistInfo };
