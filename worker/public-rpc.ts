import { supabaseRequest, type AuthEnv } from './auth.ts';
import type { PublicAbuseIdentity } from './public-abuse.ts';

type Operation = 'business' | 'services' | 'services_v2' | 'staff' | 'profile' | 'media' | 'slots' | 'book'
  | 'group_slots' | 'group_book' | 'recover' | 'resolve'
  | 'manage_view' | 'manage_slots' | 'manage_reschedule' | 'manage_cancel'
  | 'manage_group_slots' | 'manage_group_reschedule' | 'manage_group_cancel';
type Result<T> = { ok: true; data: T; status: number }
  | { ok: false; data: { message: string }; status: number };

/**
 * Calls a guarded RPC with a strict result envelope so an HTTP 200 error envelope
 * is not mistaken for a successful operation. Used by both public and authenticated flows.
 */
// SQL errors are returned normally so the quota transaction can commit. Never
// interpret an HTTP 200 error envelope (or legacy array) as successful booking.
export async function boundedRpc<T extends unknown[]>(
  env: AuthEnv, name: 'execute_public_operation' | 'execute_public_feedback_operation' | 'execute_public_promo_operation' | 'create_business_with_owner_guarded',
  args: Record<string, unknown>, accessToken?: string,
): Promise<Result<T>> {
  const result = await supabaseRequest<unknown>(env, `rest/v1/rpc/${name}`, {
    method: 'POST', body: JSON.stringify(args),
  }, accessToken);
  const body = result.data;
  if (result.ok && body && typeof body === 'object' && !Array.isArray(body)) {
    const envelope = body as { ok?: unknown; data?: unknown; error?: { message?: unknown } };
    if (envelope.ok === true && Array.isArray(envelope.data)) {
      return { ok: true, data: envelope.data as T, status: result.status };
    }
    if (envelope.ok === false && typeof envelope.error?.message === 'string') {
      return { ok: false, data: { message: envelope.error.message }, status: result.status };
    }
  }
  // Transport failure may follow a committed write: callers preserve the same
  // command key and recovery proof. No fallback to an unbounded legacy RPC.
  return { ok: false, data: { message: 'PUBLIC_OPERATION_UNAVAILABLE' }, status: result.status };
}

/**
 * Wraps a named externally reachable operation with the abuse-gate identity used by
 * booking, public profile/media, and management-capability surfaces.
 */
export function publicOperation<T extends unknown[]>(
  env: AuthEnv, action: Operation, args: Record<string, unknown>, identity: PublicAbuseIdentity,
) {
  return boundedRpc<T>(env, 'execute_public_operation', {
    p_action: action, p_args: args, p_gate_secret: identity.gateSecret,
    p_actor_hash: identity.actorHash, p_network_hash: identity.networkHash,
  });
}

type FeedbackOperation = 'reviews' | 'manage_feedback_view' | 'manage_feedback_submit';

/**
 * F16-04 sibling gate: the same gate secret and S04 rate classes, with a closed
 * feedback/review action list so the booking gateway is not widened.
 */
export function feedbackOperation<T extends unknown[]>(
  env: AuthEnv, action: FeedbackOperation, args: Record<string, unknown>, identity: PublicAbuseIdentity,
) {
  return boundedRpc<T>(env, 'execute_public_feedback_operation', {
    p_action: action, p_args: args, p_gate_secret: identity.gateSecret,
    p_actor_hash: identity.actorHash, p_network_hash: identity.networkHash,
  });
}

type PromoOperation = 'promo_preview' | 'manage_promo_view' | 'manage_promo_attach';

/**
 * F16-06 sibling gate for promo codes: the same gate secret and S04 rate
 * classes with a closed promo action list; the booking gateway is not widened.
 */
export function promoOperation<T extends unknown[]>(
  env: AuthEnv, action: PromoOperation, args: Record<string, unknown>, identity: PublicAbuseIdentity,
) {
  return boundedRpc<T>(env, 'execute_public_promo_operation', {
    p_action: action, p_args: args, p_gate_secret: identity.gateSecret,
    p_actor_hash: identity.actorHash, p_network_hash: identity.networkHash,
  });
}
