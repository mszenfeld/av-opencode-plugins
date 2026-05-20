import { readConfigFromEnv } from "./env-config.js";
import { createSessionNotification } from "./session-notification.js";
const AppVerkPantheonPlugin = async (ctx) => {
  if (process.env.AV_PANTHEON_NOTIFY === "0") {
    return {};
  }
  const config = readConfigFromEnv(process.env);
  const handler = createSessionNotification(ctx, config);
  return { event: handler };
};
export {
  AppVerkPantheonPlugin
};
