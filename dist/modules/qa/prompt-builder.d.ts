import { QaTesterStack } from './allowed-tools.js';

interface BuiltAgent {
    /** Full markdown (frontmatter + body) ready for `config.agent[].prompt`. */
    prompt: string;
    /** Stack tag (for tests and diagnostics). */
    stack: QaTesterStack;
}
declare function buildQATesterAgent(stack: QaTesterStack): BuiltAgent;

export { type BuiltAgent, buildQATesterAgent };
