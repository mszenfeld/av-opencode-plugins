export * from "./agent-metadata.js";
import {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection
} from "./perun-prompt-builder.js";
const registry = [];
function registerAgentMetadata(info) {
  const existing = registry.find((a) => a.name === info.name);
  if (existing !== void 0) {
    if (JSON.stringify(existing) === JSON.stringify(info)) return;
    throw new Error(`Duplicate agent metadata: ${info.name}`);
  }
  registry.push(info);
}
function getAgentMetadataRegistry() {
  return [...registry].sort((a, b) => a.name.localeCompare(b.name));
}
function clearAgentMetadataRegistry() {
  registry.length = 0;
}
export {
  PERUN_PLACEHOLDERS,
  buildDelegationTable,
  buildKeyTriggersSection,
  buildPerunPrompt,
  buildSpecialistsTable,
  buildUseAvoidSection,
  clearAgentMetadataRegistry,
  getAgentMetadataRegistry,
  registerAgentMetadata
};
