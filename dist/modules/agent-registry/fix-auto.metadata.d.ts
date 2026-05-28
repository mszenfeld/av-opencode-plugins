import { SpecialistInfo } from './agent-metadata.js';

/**
 * Explicit src-side entry for `fix-auto`, which lives in `packages/code-review`
 * (a separate build unit that cannot import the registry bridge during the
 * plugins->harness migration — see spec). Registered from the coordinator factory.
 */
declare const fixAutoSpecialistInfo: SpecialistInfo;

export { fixAutoSpecialistInfo };
