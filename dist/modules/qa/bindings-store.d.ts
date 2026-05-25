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
}

export { type BindingEntry, type BindingSnapshot, type BindingSource, type BindingType, BindingsStore, type WriteResult };
