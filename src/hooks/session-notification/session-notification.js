import { IdleScheduler } from "./idle-scheduler.js";
import { NotificationSender } from "./notification-sender.js";
import { SessionTracker } from "./session-tracker.js";
const QUESTION_TOOL_PATTERN = /^(question|ask_user_question|askuserquestion)$/i;
const PERMISSION_EVENT_TYPES = new Set([
    "permission.ask",
    "permission.asked",
    "permission.requested",
    "permission.updated",
]);
const ACTIVITY_EVENT_TYPES = new Set([
    "message.updated",
    "message.part.updated",
    "message.part.delta",
]);
function readSessionId(properties) {
    if (typeof properties !== "object" || properties === null)
        return undefined;
    const obj = properties;
    if (typeof obj.sessionID === "string")
        return obj.sessionID;
    if (typeof obj.sessionId === "string")
        return obj.sessionId;
    const info = obj.info;
    if (typeof info === "object" && info !== null) {
        const i = info;
        if (typeof i.sessionID === "string")
            return i.sessionID;
        if (typeof i.sessionId === "string")
            return i.sessionId;
    }
    return undefined;
}
function readToolName(properties) {
    if (typeof properties !== "object" || properties === null)
        return undefined;
    const obj = properties;
    if (typeof obj.tool === "string")
        return obj.tool;
    if (typeof obj.toolName === "string")
        return obj.toolName;
    return undefined;
}
const handleSessionCreated = async ({ sessionId, tracker }) => {
    // TODO(pantheon-v2): wire parentSessionID detection through markAsSubagent
    if (sessionId !== undefined)
        tracker.registerSession(sessionId);
};
const handleSessionDeleted = async ({ sessionId, tracker, scheduler }) => {
    if (sessionId === undefined)
        return;
    tracker.deleteSession(sessionId);
    scheduler.cancel(sessionId);
};
const handleSessionIdle = async ({ sessionId, tracker, scheduler }) => {
    if (sessionId === undefined)
        return;
    if (tracker.isMain(sessionId))
        scheduler.schedule(sessionId);
};
const handleActivity = async ({ sessionId, scheduler }) => {
    if (sessionId === undefined)
        return;
    scheduler.markActivity(sessionId);
};
const handleToolExecuteBefore = async ({ event, sessionId, tracker, scheduler, sender, config }) => {
    if (sessionId === undefined)
        return;
    const toolName = readToolName(event.properties);
    if (toolName !== undefined && QUESTION_TOOL_PATTERN.test(toolName)) {
        if (tracker.isMain(sessionId)) {
            await sender.send({ title: config.title, message: config.questionMessage });
            if (config.playSound)
                await sender.playSound(config.soundPath);
        }
        return;
    }
    scheduler.markActivity(sessionId);
};
const handlePermission = async ({ sessionId, tracker, sender, config }) => {
    if (sessionId === undefined)
        return;
    if (tracker.isMain(sessionId)) {
        await sender.send({ title: config.title, message: config.permissionMessage });
        if (config.playSound)
            await sender.playSound(config.soundPath);
    }
};
function buildHandlerTable() {
    const table = {
        "session.created": handleSessionCreated,
        "session.deleted": handleSessionDeleted,
        "session.idle": handleSessionIdle,
        "tool.execute.before": handleToolExecuteBefore,
        "tool.execute.after": handleActivity,
    };
    for (const type of ACTIVITY_EVENT_TYPES)
        table[type] = handleActivity;
    for (const type of PERMISSION_EVENT_TYPES)
        table[type] = handlePermission;
    return table;
}
const HANDLERS = buildHandlerTable();
export function createSessionNotification(ctx, config, deps = {}) {
    const tracker = deps.tracker ?? new SessionTracker();
    const sender = deps.sender ?? new NotificationSender(ctx);
    const scheduler = deps.scheduler ??
        new IdleScheduler(config.idleConfirmationDelayMs, async () => {
            await sender.send({ title: config.title, message: config.idleMessage });
            if (config.playSound)
                await sender.playSound(config.soundPath);
        });
    return async ({ event }) => {
        try {
            const handler = HANDLERS[event.type];
            if (handler === undefined)
                return;
            const sessionId = readSessionId(event.properties);
            await handler({ event, sessionId, tracker, scheduler, sender, config });
        }
        catch (err) {
            console.error("[pantheon/session-notification]", err);
        }
    };
}
