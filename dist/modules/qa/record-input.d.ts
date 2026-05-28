import { BindingsStore } from './bindings-store.js';
import { QaRunState } from './qa-run-state.js';
import './secret.js';
import './binding-parser.js';
import './recipe-validator.js';

interface RecordInputHandlerDeps {
    store: BindingsStore;
    state: QaRunState;
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
