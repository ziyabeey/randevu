import { supabaseRequest, type AuthEnv } from './auth.ts';
import type { PublicAbuseIdentity } from './public-abuse.ts';

type Operation = 'business' | 'services' | 'staff' | 'profile' | 'media' | 'slots' | 'book'
  | 'group_slots' | 'group_book' | 'recover' | 'resolve'
  | 'manage_view' | 'manage_slots' | 'manage_reschedule' | 'manage_cancel'
  | 'manage_group_slots' | 'manage_group_reschedule' | 'manage_group_cancel';
type Result<T> = { ok: true; data: T; status: number }
  | { ok: false; data: { message: string }; status: number };

/**
 * Calls a public RPC with a strict result envelope so a committed transaction is not
 * mistaken for a successful booking just because the HTTP transport returned 200.
 */
// SQL errors are returned normally so the quota transaction can commit. Never
// interpret an HTTP 200 error envelope (or legacy array) as successful booking.
export async function boundedRpc<T extends unknown[]>(
  env: AuthEnv, name: 'execute_public_operation' | 'create_business_with_owner_guarded',
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
 * Wraps a named public operation with the abuse-gate identity required by the booking surface.
 */
export function publicOperation<T extends unknown[]>(
  env: AuthEnv, action: Operation, args: Record<string, unknown>, identity: PublicAbuseIdentity,
) {
  return boundedRpc<T>(env, 'execute_public_operation', {
    p_action: action, p_args: args, p_gate_secret: identity.gateSecret,
    p_actor_hash: identity.actorHash, p_network_hash: identity.networkHash,
  });
}
