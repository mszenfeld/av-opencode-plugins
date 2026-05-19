import { readConfigFromEnv } from "./env-config.js";
import { createSessionNotification } from "./session-notification.js";
export const AppVerkPantheonPlugin = async (ctx) => {
    if (process.env.AV_PANTHEON_NOTIFY === "0") {
        return {};
    }
    const config = readConfigFromEnv(process.env);
    // OpenCode's PluginInput.$ is Bun's `$`, whose parameter type is tighter
    // than our structural ShellTag. The cast is safe at runtime — both shapes
    // expose the same tagged-template shell with `.quiet()` / `.nothrow()`.
    const handler = createSessionNotification(ctx, config);
    return { event: handler };
};
