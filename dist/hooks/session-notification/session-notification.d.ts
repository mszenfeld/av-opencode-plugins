import { IdleScheduler } from './idle-scheduler.js';
import { NotificationSender, NotificationSenderContext } from './notification-sender.js';
import { SessionTracker } from './session-tracker.js';

interface SessionNotificationConfig {
    title: string;
    idleMessage: string;
    questionMessage: string;
    permissionMessage: string;
    idleConfirmationDelayMs: number;
    playSound: boolean;
    soundPath: string;
}
type SessionNotificationEvent = {
    type: string;
    properties?: unknown;
};
interface SessionNotificationDeps {
    tracker?: SessionTracker;
    scheduler?: IdleScheduler;
    sender?: NotificationSender;
}
declare function createSessionNotification(ctx: NotificationSenderContext, config: SessionNotificationConfig, deps?: SessionNotificationDeps): (input: {
    event: SessionNotificationEvent;
}) => Promise<void>;

export { type SessionNotificationConfig, type SessionNotificationDeps, type SessionNotificationEvent, createSessionNotification };
