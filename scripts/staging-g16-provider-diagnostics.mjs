// This is a diagnostic boundary, not provider or delivery acceptance.
const fixedFailureClasses = new Set([
  'netgsm_whatsapp_30',
  'netgsm_whatsapp_60',
  'netgsm_whatsapp_70',
  'netgsm_whatsapp_80',
  'netgsm_whatsapp_100',
  'netgsm_whatsapp_send_timeout',
  'netgsm_whatsapp_send_network_error',
  'netgsm_whatsapp_not_configured_or_invalid_phone',
]);

/** Return a bounded class only; never serialize the result or remote details. */
export function formatG16ProviderFailure(result) {
  if (result?.status !== 'failed') return 'unexpected_provider_code';
  const value = result.errorClass;
  if (typeof value !== 'string') return 'provider_request_failed';
  if (fixedFailureClasses.has(value)) return value;
  const http = /^netgsm_whatsapp_http_([1-5][0-9]{2})$/.exec(value);
  // Exact matching also rejects a trailing newline, which JS $ can overlook.
  if (http?.[0] === value) return `netgsm_whatsapp_http_${http[1]}`;
  return 'provider_request_failed';
}
