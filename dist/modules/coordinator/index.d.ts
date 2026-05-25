import { Plugin } from '@opencode-ai/plugin';
export { deriveReportPath, neutralizeUntrustedOutput, normalizeVariantSuffix } from './sanitize.js';
export { createSDKSpecialist, loadAgentRegistry, toPollerMessage } from './sdk-specialist.js';
import '@opencode-ai/sdk';
import './dispatch.js';
import '../qa/shell-env-hook.js';
import '../qa/bindings-store.js';
import '../qa/secret.js';
import './poller.js';

declare const AppVerkCoordinatorPlugin: Plugin;

export { AppVerkCoordinatorPlugin };
