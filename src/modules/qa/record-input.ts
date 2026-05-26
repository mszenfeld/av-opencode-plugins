import type { BindingsStore } from "./bindings-store.js"
import { MAX_DIALOG_ROUNDS, type QaRunState } from "./qa-run-state.js"

export interface RecordInputHandlerDeps {
  store: BindingsStore
  state: QaRunState
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

    // Enforce the mid-run dialog round cap deterministically (MAINT-002).
    // The spec in `src/agents/perun.md` caps Perun's NAME=value request loop
    // at 3 rounds; counting in code (rather than only in the prompt) means
    // the cap holds even if the LLM miscounts or is jailbroken into trying
    // again. A round is defined as: one or more `record_input` calls between
    // the last `endDialogRound` (signalled by `execute_recipe`) and the next.
    const round = deps.state.incrementDialogRoundOnFirstInput(parentID)
    if (round > MAX_DIALOG_ROUNDS) {
      return {
        status: "rejected",
        reason: `dialog_round_exceeded: max ${MAX_DIALOG_ROUNDS} rounds per QA run`,
      }
    }

    const write = deps.store.writeBinding(parentID, args.name, args.value, "secret", "user-paste")
    if (write.status === "ok") return { status: "ok" }
    if (write.status === "duplicate") return { status: "ok" }
    return { status: "rejected", reason: write.reason }
  }
}
