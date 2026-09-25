import { Hono } from 'hono';
import { supabaseRequest, upstreamUnavailable, type AuthEnv } from './auth.ts';
import { requireStandardMember } from './tickets.ts';

// F16-08 account summary for the account menu: role, financial permissions and
// the business plan from real subscription data. The business always comes
// from the active membership.

const account = new Hono<{ Bindings: AuthEnv }>();

account.get('/account', async (context) => {
  const access = await requireStandardMember(context);
  if ('error' in access) return access.error;
  const result = await supabaseRequest<Record<string, unknown>>(
    context.env,
    'rest/v1/rpc/get_account_summary',
    { method: 'POST', body: JSON.stringify({ p_business_id: access.membership.business_id }) },
    access.auth.accessToken,
  );
  if (!result.ok || !result.data || typeof result.data !== 'object') {
    if (upstreamUnavailable(result.status)) {
      return context.json({ error: { code: 'ACCOUNT_UNAVAILABLE', message: 'Hesap bilgisi şu anda yüklenemedi. Lütfen tekrar deneyin.' } }, 503);
    }
    return context.json({ error: { code: 'ACCOUNT_READ_FAILED', message: 'Hesap bilgisi yüklenemedi.' } }, 403);
  }
  return context.json({
    account: {
      ...result.data,
      email: access.auth.user.email ?? null,
    },
  });
});

export default account;
