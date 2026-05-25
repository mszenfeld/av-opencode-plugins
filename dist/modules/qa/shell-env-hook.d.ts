import { BindingsStore } from './bindings-store.js';
import './secret.js';

declare class SessionAgentRegistry {
    #private;
    register(sessionID: string, agent: string): void;
    unregister(sessionID: string): void;
    lookup(sessionID: string): string | undefined;
}
interface ShellEnvHookDeps {
    store: BindingsStore;
    registry: SessionAgentRegistry;
    resolveParentID: (sessionID: string) => Promise<string | undefined>;
}
interface ShellEnvHookInput {
    sessionID?: string;
    cwd: string;
    callID?: string;
}
interface ShellEnvHookOutput {
    env: Record<string, string>;
}
declare function makeShellEnvHook(deps: ShellEnvHookDeps): (i: ShellEnvHookInput, o: ShellEnvHookOutput) => Promise<void>;

export { SessionAgentRegistry, type ShellEnvHookDeps, type ShellEnvHookInput, type ShellEnvHookOutput, makeShellEnvHook };
