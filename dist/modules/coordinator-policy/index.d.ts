import { Plugin, PluginInput } from '@opencode-ai/plugin';

type Client = PluginInput["client"];
/** Pure-ish handler factory (client + allowlist injected) so it is unit-testable. */
declare function makeBashGate(client: Client, allowed: string[]): (input: {
    tool: string;
    sessionID: string;
    callID: string;
}, output: {
    args: {
        command?: unknown;
    };
}) => Promise<void>;
declare const AppVerkCoordinatorPolicyPlugin: Plugin;

export { AppVerkCoordinatorPolicyPlugin, makeBashGate };
