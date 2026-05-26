import { SessionNotificationConfig } from './session-notification.js';
import './idle-scheduler.js';
import './notification-sender.js';
import './session-tracker.js';

declare const DEFAULT_SESSION_NOTIFICATION_CONFIG: SessionNotificationConfig;
declare function readConfigFromEnv(env: Record<string, string | undefined>): SessionNotificationConfig;

export { DEFAULT_SESSION_NOTIFICATION_CONFIG, readConfigFromEnv };
