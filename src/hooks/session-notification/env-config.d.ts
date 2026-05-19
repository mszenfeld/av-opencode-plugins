import type { SessionNotificationConfig } from "./session-notification.js";
export declare const DEFAULT_SESSION_NOTIFICATION_CONFIG: SessionNotificationConfig;
export declare function readConfigFromEnv(env: Record<string, string | undefined>): SessionNotificationConfig;
