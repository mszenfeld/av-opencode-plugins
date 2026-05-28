import { SpecialistInfo } from './agent-metadata.js';

declare const PERUN_PLACEHOLDERS: readonly ["SPECIALISTS_TABLE", "KEY_TRIGGERS", "DELEGATION_TABLE"];
declare function buildSpecialistsTable(registry: SpecialistInfo[]): string;
declare function buildKeyTriggersSection(registry: SpecialistInfo[]): string;
declare function buildDelegationTable(registry: SpecialistInfo[]): string;
declare function buildUseAvoidSection(agentName: string, registry: SpecialistInfo[]): string;
declare function buildPerunPrompt(template: string, registry: SpecialistInfo[]): string;

export { PERUN_PLACEHOLDERS, buildDelegationTable, buildKeyTriggersSection, buildPerunPrompt, buildSpecialistsTable, buildUseAvoidSection };
