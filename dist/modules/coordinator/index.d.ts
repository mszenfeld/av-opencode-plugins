import { Plugin } from '@opencode-ai/plugin';
export { deriveReportPath, neutralizeUntrustedOutput, normalizeVariantSuffix } from './sanitize.js';
export { createSDKSpecialist, loadAgentRegistry, toPollerMessage } from './sdk-specialist.js';
import '@opencode-ai/sdk';
import './dispatch.js';
import '../_shared/session-agent-registry.js';
import './poller.js';

/**
 * Coordinator-provided tools that MUST appear in perun.md's `allowed-tools`
 * frontmatter. Kept as an exported constant so a test can enforce the sync that
 * is otherwise manual (there is no programmatic link between tool registration
 * and the agent frontmatter).
 */
declare const PERUN_TOOLS: readonly ["dispatch_parallel", "assign_issue_ids", "compute_waves", "dispatch_background", "poll_background", "wait_background"];
declare const AppVerkCoordinatorPlugin: Plugin;

export { AppVerkCoordinatorPlugin, PERUN_TOOLS };
