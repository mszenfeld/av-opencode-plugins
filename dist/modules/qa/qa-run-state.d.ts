import { ParsedBinding } from './binding-parser.js';

declare class QaRunState {
    #private;
    storePlan(parentID: string, bindings: ParsedBinding[]): void;
    getBindings(parentID: string): ParsedBinding[] | undefined;
    getDialogRound(parentID: string): number;
    incrementDialogRound(parentID: string): number;
    getRecipeAttempts(parentID: string, bindingName: string): number;
    incrementRecipeAttempt(parentID: string, bindingName: string): number;
    clearRun(parentID: string): void;
}

export { QaRunState };
