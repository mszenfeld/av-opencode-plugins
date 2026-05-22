import { Plugin } from '@opencode-ai/plugin';
export { buildQATesterAgent } from './prompt-builder.js';
export { BE_TOOLS, FE_TOOLS, SHARED_TOOLS, toolsForVariant } from './allowed-tools.js';

declare const AppVerkQAPlugin: Plugin;

export { AppVerkQAPlugin, AppVerkQAPlugin as default };
