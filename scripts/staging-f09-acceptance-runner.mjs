const acceptanceKey = process.env.RESEND_ACCEPTANCE_API_KEY?.trim();
if (!acceptanceKey) {
  throw new Error('F09 acceptance requires the GitHub staging secret RESEND_ACCEPTANCE_API_KEY');
}

const preflight = await fetch('https://api.resend.com/emails?limit=1', {
  headers: {
    Authorization: `Bearer ${acceptanceKey}`,
    Accept: 'application/json',
  },
});

if (!preflight.ok) {
  const scopeHint = preflight.status === 401 || preflight.status === 403
    ? ' The key must use Resend full_access permission; the Worker RESEND_API_KEY remains sending-only.'
    : '';
  throw new Error(`Resend acceptance read-key preflight failed with HTTP ${preflight.status}.${scopeHint}`);
}

// Keep the broad read credential inside this acceptance process only. The deployed
// Worker still receives the narrower RESEND_API_KEY from its temporary secret bundle.
process.env.RESEND_API_KEY = acceptanceKey;
await import('./staging-f09-acceptance.mjs');
