import { Plugin } from '@opencode-ai/plugin';

declare const SHARED_TOOLS: string[];
declare const FE_TOOLS: string[];
declare const BE_TOOLS: string[];
type QaTesterStack = "fe" | "be";
declare function toolsForVariant(stack: QaTesterStack): string[];

interface BuiltAgent {
    /** Full markdown (frontmatter + body) ready for `config.agent[].prompt`. */
    prompt: string;
    /** Stack tag (for tests and diagnostics). */
    stack: QaTesterStack;
}
declare function buildQATesterAgent(stack: QaTesterStack): BuiltAgent;

declare const AppVerkQAPlugin: Plugin;

export { AppVerkQAPlugin, BE_TOOLS, FE_TOOLS, SHARED_TOOLS, buildQATesterAgent, AppVerkQAPlugin as default, toolsForVariant };
