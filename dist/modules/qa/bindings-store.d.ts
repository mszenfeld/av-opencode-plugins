import { Secret } from './secret.js';

type BindingType = "secret" | "plain";
type BindingSource = "minted-recipe" | "user-paste";
interface BindingEntry {
    value: Secret;
    type: BindingType;
    source: BindingSource;
    createdAt: number;
}
type WriteResult = {
    status: "ok";
} | {
    status: "duplicate";
} | {
    status: "error";
    reason: string;
};
interface BindingSnapshot {
    readonly id: string;
    readonly entries: ReadonlyMap<string, BindingEntry>;
}
declare class BindingsStore {
    #private;
    listForParent(parentID: string): ReadonlyMap<string, BindingEntry>;
    getBinding(parentID: string, name: string): BindingEntry | undefined;
    pinSnapshot(parentID: string): BindingSnapshot;
    releaseSnapshot(id: string): void;
    isPinned(parentID: string, name: string): boolean;
    writeBinding(parentID: string, name: string, value: string, type: BindingType, source: BindingSource): WriteResult;
    /**
     * Purge entries older than TTL (excluding pinned). Returns count purged.
     * Called periodically from the plugin sweep timer.
     */
    sweepExpired(nowMs: number, ttlMs: number): number;
    /**
     * Purge all bindings for a parent session (called on session.deleted /
     * QA-run completion / abort). Pinned entries are still purged — the caller
     * has decided the parent's lifecycle is over.
     */
    clearParent(parentID: string): number;
}

export { type BindingEntry, type BindingSnapshot, type BindingSource, type BindingType, BindingsStore, type WriteResult };
