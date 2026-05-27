import type { ParsedBinding } from "./binding-parser.js"

/**
 * Maximum number of mid-run dialog rounds per QA run. After the 3rd round
 * `record_input` refuses further pastes and Perun must abort. Mirrors the
 * "max 3 rounds per QA run" rule in `src/agents/perun.md`. Enforced
 * deterministically in code so the cap holds even if the LLM miscounts.
 */
export const MAX_DIALOG_ROUNDS = 3

interface RunRecord {
  plan: ParsedBinding[]
  dialogRound: number
  /**
   * True while a dialog round is "in progress" — i.e. the user has pasted
   * at least one NAME=value pair and Perun has not yet re-dispatched
   * (signalled by the next `execute_recipe` call). Used by
   * `incrementDialogRoundOnFirstInput` to count one round per user reply
   * even when the reply carries multiple NAME=value pairs.
   */
  dialogRoundInProgress: boolean
  recipeAttempts: Map<string, number>
}

function makeEmptyRecord(plan: ParsedBinding[] = []): RunRecord {
  return {
    plan,
    dialogRound: 0,
    dialogRoundInProgress: false,
    recipeAttempts: new Map(),
  }
}

export class QaRunState {
  readonly #map = new Map<string, RunRecord>()

  storePlan(parentID: string, bindings: ParsedBinding[]): void {
    const existing = this.#map.get(parentID)
    if (existing !== undefined) {
      existing.plan = bindings
      return
    }
    this.#map.set(parentID, makeEmptyRecord(bindings))
  }

  getBindings(parentID: string): ParsedBinding[] | undefined {
    return this.#map.get(parentID)?.plan
  }

  getDialogRound(parentID: string): number {
    return this.#map.get(parentID)?.dialogRound ?? 0
  }

  incrementDialogRound(parentID: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    r.dialogRound++
    return r.dialogRound
  }

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
  incrementDialogRoundOnFirstInput(parentID: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    if (!r.dialogRoundInProgress) {
      r.dialogRound++
      r.dialogRoundInProgress = true
    }
    return r.dialogRound
  }

  /**
   * Mark the current dialog round as ended. The next `record_input` call
   * will start a new round (and increment the counter). Called by
   * `execute_recipe` because re-dispatching to zmora-setup is the natural
   * signal that the round has concluded.
   *
   * No-op when no round is in progress or the parent has no state. Safe
   * to call repeatedly.
   */
  endDialogRound(parentID: string): void {
    const r = this.#map.get(parentID)
    if (r === undefined) return
    r.dialogRoundInProgress = false
  }

  getRecipeAttempts(parentID: string, bindingName: string): number {
    return this.#map.get(parentID)?.recipeAttempts.get(bindingName) ?? 0
  }

  incrementRecipeAttempt(parentID: string, bindingName: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = makeEmptyRecord()
      this.#map.set(parentID, r)
    }
    const next = (r.recipeAttempts.get(bindingName) ?? 0) + 1
    r.recipeAttempts.set(bindingName, next)
    return next
  }

  clearRun(parentID: string): void {
    this.#map.delete(parentID)
  }
}
