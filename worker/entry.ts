import app from './app';
import { maintainNotificationState } from './notification-maintenance';
import { dispatchNotificationBatch } from './notifications';
import type { NotificationEnv } from './notifications';
import { recordStagingHeartbeat, type DeploymentEnv } from './deployment-health';

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export default {
  fetch(request: Request, env: NotificationEnv, context: unknown) {
    return app.fetch(request, env, context as never);
  },
  scheduled(_controller: unknown, env: NotificationEnv & DeploymentEnv, context: WaitUntilContext) {
    context.waitUntil(recordStagingHeartbeat(env));
    context.waitUntil((async () => {
      await maintainNotificationState(env);
      await dispatchNotificationBatch(env);
    })());
  },
};
