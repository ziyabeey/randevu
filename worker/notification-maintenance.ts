import type { NotificationEnv } from './notifications';

export async function maintainNotificationState(
  env: NotificationEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const secret = env.NOTIFICATION_DISPATCH_SECRET?.trim() ?? '';
  if (secret.length < 43 || secret.length > 256) return false;

  const headers = new Headers({
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });

  try {
    const response = await fetchImpl(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/maintain_notification_jobs`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_dispatch_secret: secret }),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}
