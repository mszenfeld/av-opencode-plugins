import { MAX_DIALOG_ROUNDS } from "./qa-run-state.js";
function makeRecordInputHandler(deps) {
  return async (args, ctx) => {
    const parentID = await deps.resolveParentID(ctx.sessionID) ?? ctx.sessionID;
    const round = deps.state.incrementDialogRoundOnFirstInput(parentID);
    if (round > MAX_DIALOG_ROUNDS) {
      return {
        status: "rejected",
        reason: `dialog_round_exceeded: max ${MAX_DIALOG_ROUNDS} rounds per QA run`
      };
    }
    const write = deps.store.writeBinding(parentID, args.name, args.value, "secret", "user-paste");
    if (write.status === "ok") return { status: "ok" };
    if (write.status === "duplicate") return { status: "ok" };
    return { status: "rejected", reason: write.reason };
  };
}
export {
  makeRecordInputHandler
};
