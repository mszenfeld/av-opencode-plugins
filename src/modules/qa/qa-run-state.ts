import type { ParsedBinding } from "./binding-parser.js"

interface RunRecord {
  plan: ParsedBinding[]
  dialogRound: number
  recipeAttempts: Map<string, number>
}

export class QaRunState {
  readonly #map = new Map<string, RunRecord>()

  storePlan(parentID: string, bindings: ParsedBinding[]): void {
    const existing = this.#map.get(parentID)
    if (existing !== undefined) {
      existing.plan = bindings
      return
    }
    this.#map.set(parentID, { plan: bindings, dialogRound: 0, recipeAttempts: new Map() })
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
      r = { plan: [], dialogRound: 0, recipeAttempts: new Map() }
      this.#map.set(parentID, r)
    }
    r.dialogRound++
    return r.dialogRound
  }

  getRecipeAttempts(parentID: string, bindingName: string): number {
    return this.#map.get(parentID)?.recipeAttempts.get(bindingName) ?? 0
  }

  incrementRecipeAttempt(parentID: string, bindingName: string): number {
    let r = this.#map.get(parentID)
    if (r === undefined) {
      r = { plan: [], dialogRound: 0, recipeAttempts: new Map() }
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
