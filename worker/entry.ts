import app from './app';
import { maintainNotificationState } from './notification-maintenance';
import { dispatchNotificationBatch } from './notifications';
import type { NotificationEnv } from './notifications';

type WaitUntilContext = {
  waitUntil(promise: Promise<unknown>): void;
};

export default {
  fetch(request: Request, env: NotificationEnv, context: unknown) {
    return app.fetch(request, env, context as never);
  },
  scheduled(_controller: unknown, env: NotificationEnv, context: WaitUntilContext) {
    context.waitUntil((async () => {
      await maintainNotificationState(env);
      await dispatchNotificationBatch(env);
    })());
  },
};
