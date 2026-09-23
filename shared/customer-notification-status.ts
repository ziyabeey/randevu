export type CustomerNotificationStatusCode =
  | 'not_requested'
  | 'queued'
  | 'sending'
  | 'accepted'
  | 'failed'
  | 'unknown';

export type CustomerNotificationStatus = {
  channel: 'email';
  status: CustomerNotificationStatusCode;
};

function validStatus(value: unknown): value is CustomerNotificationStatusCode {
  return value === 'not_requested'
    || value === 'queued'
    || value === 'sending'
    || value === 'accepted'
    || value === 'failed'
    || value === 'unknown';
}

export function customerNotificationStatus(value: unknown): CustomerNotificationStatus {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const candidate = value as { channel?: unknown; status?: unknown };
    if (candidate.channel === 'email' && validStatus(candidate.status)) {
      return { channel: 'email', status: candidate.status };
    }
  }
  return { channel: 'email', status: 'unknown' };
}
