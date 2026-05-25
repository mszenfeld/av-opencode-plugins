function makeRecordInputHandler(deps) {
  return async (args, ctx) => {
    const parentID = await deps.resolveParentID(ctx.sessionID) ?? ctx.sessionID;
    const write = deps.store.writeBinding(parentID, args.name, args.value, "secret", "user-paste");
    if (write.status === "ok") return { status: "ok" };
    if (write.status === "duplicate") return { status: "ok" };
    return { status: "rejected", reason: write.reason };
  };
}
export {
  makeRecordInputHandler
};
