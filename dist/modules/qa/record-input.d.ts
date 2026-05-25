import { BindingsStore } from './bindings-store.js';
import './secret.js';

interface RecordInputHandlerDeps {
    store: BindingsStore;
    resolveParentID: (sessionID: string) => Promise<string | undefined>;
}
interface RecordInputArgs {
    name: string;
    value: string;
}
type RecordInputResult = {
    status: "ok";
} | {
    status: "rejected";
    reason: string;
};
interface RecordInputContext {
    sessionID: string;
    agent?: string;
}
declare function makeRecordInputHandler(deps: RecordInputHandlerDeps): (args: RecordInputArgs, ctx: RecordInputContext) => Promise<RecordInputResult>;

export { type RecordInputArgs, type RecordInputContext, type RecordInputHandlerDeps, type RecordInputResult, makeRecordInputHandler };
