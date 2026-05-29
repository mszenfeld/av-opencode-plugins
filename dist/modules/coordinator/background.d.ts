import { DispatchSpecialist, AgentInfo } from './dispatch.js';
import { BackgroundTaskStore } from './background-store.js';
import '../_shared/session-agent-registry.js';
import './poller.js';

/** Per-parent cap on concurrent background tasks. Mirrors DISPATCH_CONCURRENCY;
 *  bounds spawn count (cost-DoS). Separate from the synchronous worker pool. */
declare const BACKGROUND_MAX_CONCURRENT = 4;
interface StartBackgroundInput {
    store: BackgroundTaskStore;
    specialist: DispatchSpecialist;
    agentRegistry: Record<string, AgentInfo>;
    parentSessionId: string;
    agent: string;
    prompt: string;
    context?: string;
    /** Caller's mode — see dispatch.ts DispatchParallelInput.callerMode. */
    callerMode?: AgentInfo["mode"];
}
interface StartBackgroundResult {
    id: string;
    agent: string;
    status: "running";
}
declare function startBackgroundTask(input: StartBackgroundInput): Promise<StartBackgroundResult>;
interface CollectBackgroundInput {
    store: BackgroundTaskStore;
    specialist: DispatchSpecialist;
    ids: string[];
    block: boolean;
    timeoutMs?: number;
    pollIntervalMs?: number;
    resultMaxBytes?: number;
    signal?: AbortSignal;
    scrubber?: (text: string, parentSessionID: string) => string;
    parentSessionId?: string;
}
interface BackgroundCollectResult {
    id: string;
    agent: string;
    status: "running" | "success" | "timeout" | "aborted" | "error" | "not_found";
    result?: string;
    duration_ms?: number;
    error?: string;
}
declare function collectBackground(input: CollectBackgroundInput): Promise<BackgroundCollectResult[]>;

export { BACKGROUND_MAX_CONCURRENT, type BackgroundCollectResult, type CollectBackgroundInput, type StartBackgroundInput, type StartBackgroundResult, collectBackground, startBackgroundTask };
