import { SpecialistInfo } from '../agent-registry/agent-metadata.js';

/**
 * One logical entry for the three physical `zmora-fe` / `zmora-be` /
 * `zmora-setup` variants registered in `qa/index.ts`. The variant suffix is an
 * internal detail; Perun's table shows only `zmora`.
 */
declare const zmoraSpecialistInfo: SpecialistInfo;

export { zmoraSpecialistInfo };
