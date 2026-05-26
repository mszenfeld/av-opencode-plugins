import { ParsedBinding } from './binding-parser.js';
import './bindings-store.js';
import './secret.js';

/**
 * Maximum number of mid-run dialog rounds per QA run. After the 3rd round
 * `record_input` refuses further pastes and Perun must abort. Mirrors the
 * "max 3 rounds per QA run" rule in `src/agents/perun.md`. Enforced
 * deterministically in code so the cap holds even if the LLM miscounts.
 */
declare const MAX_DIALOG_ROUNDS = 3;
declare class QaRunState {
    #private;
    storePlan(parentID: string, bindings: ParsedBinding[]): void;
    getBindings(parentID: string): ParsedBinding[] | undefined;
    getDialogRound(parentID: string): number;
    incrementDialogRound(parentID: string): number;
    /**
     * Increment the dialog round counter exactly once per logical round —
     * the first `record_input` call after either run start or the previous
     * round being ended by `endDialogRound`. Subsequent calls within the
     * same round return the current counter without incrementing it.
     *
     * Returns the dialog round number the caller is now part of. Callers
     * compare against `MAX_DIALOG_ROUNDS` to decide whether to refuse the
     * write.
     */
    incrementDialogRoundOnFirstInput(parentID: string): number;
    /**
     * Mark the current dialog round as ended. The next `record_input` call
     * will start a new round (and increment the counter). Called by
     * `execute_recipe` because re-dispatching to zmora-setup is the natural
     * signal that the round has concluded.
     *
     * No-op when no round is in progress or the parent has no state. Safe
     * to call repeatedly.
     */
    endDialogRound(parentID: string): void;
    getRecipeAttempts(parentID: string, bindingName: string): number;
    incrementRecipeAttempt(parentID: string, bindingName: string): number;
    clearRun(parentID: string): void;
}

export { MAX_DIALOG_ROUNDS, QaRunState };
