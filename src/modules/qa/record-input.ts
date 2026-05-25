import type { BindingsStore } from "./bindings-store.js"

export interface RecordInputHandlerDeps {
  store: BindingsStore
  resolveParentID: (sessionID: string) => Promise<string | undefined>
}

export interface RecordInputArgs {
  name: string
  value: string
}

export type RecordInputResult =
  | { status: "ok" }
  | { status: "rejected"; reason: string }

export interface RecordInputContext {
  sessionID: string
  agent?: string
}

export function makeRecordInputHandler(
  deps: RecordInputHandlerDeps,
): (args: RecordInputArgs, ctx: RecordInputContext) => Promise<RecordInputResult> {
  return async (args, ctx) => {
    const parentID = (await deps.resolveParentID(ctx.sessionID)) ?? ctx.sessionID
    const write = deps.store.writeBinding(parentID, args.name, args.value, "secret", "user-paste")
    if (write.status === "ok") return { status: "ok" }
    if (write.status === "duplicate") return { status: "ok" }
    return { status: "rejected", reason: write.reason }
  }
}
