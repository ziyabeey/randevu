import app from './app.ts';
import { maintainNotificationState } from './notification-maintenance.ts';
import { dispatchNotificationBatch, reconcileNotificationDeliveryBatch } from './notifications.ts';
import type { NotificationEnv } from './notifications.ts';
import { recordStagingHeartbeat, type DeploymentEnv } from './deployment-health.ts';

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export default {
  fetch(request: Request, env: NotificationEnv, context: unknown) {
    return app.fetch(request, env, context as never);
  },
  scheduled(_controller: unknown, env: NotificationEnv & DeploymentEnv, context: WaitUntilContext) {
    context.waitUntil(recordStagingHeartbeat(env));
    context.waitUntil(maintainNotificationState(env));
    context.waitUntil(dispatchNotificationBatch(env));
    context.waitUntil(reconcileNotificationDeliveryBatch(env));
  },
};
