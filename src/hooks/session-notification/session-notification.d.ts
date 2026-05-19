import { IdleScheduler } from "./idle-scheduler.js";
import { NotificationSender, type NotificationSenderContext } from "./notification-sender.js";
import { SessionTracker } from "./session-tracker.js";
export interface SessionNotificationConfig {
    title: string;
    idleMessage: string;
    questionMessage: string;
    permissionMessage: string;
    idleConfirmationDelayMs: number;
    playSound: boolean;
    soundPath: string;
}
export type SessionNotificationEvent = {
    type: string;
    properties?: unknown;
};
export interface SessionNotificationDeps {
    tracker?: SessionTracker;
    scheduler?: IdleScheduler;
    sender?: NotificationSender;
}
export declare function createSessionNotification(ctx: NotificationSenderContext, config: SessionNotificationConfig, deps?: SessionNotificationDeps): (input: {
    event: SessionNotificationEvent;
}) => Promise<void>;
