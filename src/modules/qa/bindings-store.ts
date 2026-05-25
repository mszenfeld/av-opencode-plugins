import { Secret } from "./secret.js"

export type BindingType = "secret" | "plain"
export type BindingSource = "minted-recipe" | "user-paste"

export interface BindingEntry {
  value: Secret
  type: BindingType
  source: BindingSource
  createdAt: number
}

export class BindingsStore {
  readonly #map = new Map<string, Map<string, BindingEntry>>()

  listForParent(parentID: string): Map<string, BindingEntry> {
    return this.#map.get(parentID) ?? new Map()
  }

  getBinding(parentID: string, name: string): BindingEntry | undefined {
    return this.#map.get(parentID)?.get(name)
  }
}
