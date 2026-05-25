import { createOpencodeClient, Message } from '@opencode-ai/sdk';
import { DispatchSpecialist, AgentInfo } from './dispatch.js';
import { PollerMessage } from './poller.js';
import '../qa/shell-env-hook.js';
import '../qa/bindings-store.js';
import '../qa/secret.js';

/**
 * SDK adapter layer: bridges the strongly-typed OpenCode SDK client into the
 * plain `DispatchSpecialist` / `AgentInfo` shapes that `dispatchParallel`
 * consumes. Extracting this here keeps `index.ts` thin and — crucially — makes
 * the adapter independently unit-testable with a fake `OpencodeClient` (see
 * `tests/sdk-specialist.test.ts`).
 */
type SDKClient = ReturnType<typeof createOpencodeClient>;
declare function createSDKSpecialist(client: SDKClient, parentSessionID: string): DispatchSpecialist;
declare function toPollerMessage(raw: {
    info: Message;
    parts: Array<{
        type: string;
        text?: string;
    }>;
}): PollerMessage;
/**
 * TTL for the agent-registry cache (60 s). The registry only changes when the
 * OpenCode server reloads plugins, which is rare relative to dispatch volume —
 * but we keep a TTL (rather than caching forever) so a hot-reloaded plugin's
 * new agents are picked up within a minute without restarting the coordinator.
 */
declare const AGENT_REGISTRY_TTL_MS = 60000;
declare function loadAgentRegistry(client: SDKClient): Promise<Record<string, AgentInfo>>;

export { AGENT_REGISTRY_TTL_MS, type SDKClient, createSDKSpecialist, loadAgentRegistry, toPollerMessage };
