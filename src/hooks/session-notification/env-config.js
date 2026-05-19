export const DEFAULT_SESSION_NOTIFICATION_CONFIG = {
    title: "AppVerk",
    idleMessage: "Agent is ready for input",
    questionMessage: "Agent is asking a question",
    permissionMessage: "Agent needs permission",
    idleConfirmationDelayMs: 1500,
    playSound: false,
    soundPath: "/System/Library/Sounds/Glass.aiff",
};
export function readConfigFromEnv(env) {
    const config = { ...DEFAULT_SESSION_NOTIFICATION_CONFIG };
    if (typeof env.AV_PANTHEON_NOTIFY_TITLE === "string") {
        config.title = env.AV_PANTHEON_NOTIFY_TITLE;
    }
    if (typeof env.AV_PANTHEON_NOTIFY_IDLE_MSG === "string") {
        config.idleMessage = env.AV_PANTHEON_NOTIFY_IDLE_MSG;
    }
    if (typeof env.AV_PANTHEON_NOTIFY_QUESTION_MSG === "string") {
        config.questionMessage = env.AV_PANTHEON_NOTIFY_QUESTION_MSG;
    }
    if (typeof env.AV_PANTHEON_NOTIFY_PERMISSION_MSG === "string") {
        config.permissionMessage = env.AV_PANTHEON_NOTIFY_PERMISSION_MSG;
    }
    if (typeof env.AV_PANTHEON_NOTIFY_DELAY_MS === "string") {
        const parsed = Number.parseInt(env.AV_PANTHEON_NOTIFY_DELAY_MS, 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
            config.idleConfirmationDelayMs = parsed;
        }
        else {
            console.warn(`[pantheon/session-notification] invalid AV_PANTHEON_NOTIFY_DELAY_MS="${env.AV_PANTHEON_NOTIFY_DELAY_MS}"; using default ${DEFAULT_SESSION_NOTIFICATION_CONFIG.idleConfirmationDelayMs}ms`);
        }
    }
    if (env.AV_PANTHEON_NOTIFY_SOUND === "1") {
        config.playSound = true;
    }
    if (typeof env.AV_PANTHEON_NOTIFY_SOUND_PATH === "string") {
        config.soundPath = env.AV_PANTHEON_NOTIFY_SOUND_PATH;
    }
    return config;
}
