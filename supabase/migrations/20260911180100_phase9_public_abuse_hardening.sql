begin;

-- Guarded public booking must stay public even if an upstream server request ever
-- carries an authenticated JWT context. Phase 6 derives booking_commands.source
-- from auth.uid(), so temporarily clear only that claim while entering the
-- existing public-create transaction, then restore it before returning.
create or replace function public.create_public_appointment_with_recovery_guarded(
  p_slug text,
  p_idempotency_key text,
  p_customer_name text,
  p_service_id uuid,
  p_staff_id uuid,
  p_starts_at timestamptz,
  p_management_token_hash text,
  p_recovery_id uuid,
  p_recovery_secret_hash text,
  p_management_token_ciphertext text,
  p_management_token_iv text,
  p_key_version smallint,
  p_gate_secret text,
  p_actor_hash text,
  p_network_hash text,
  p_customer_phone text default null,
  p_customer_email text default null,
  p_notes text default null
)
returns table(
  appointment_id uuid,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  recovery_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_safe_retry boolean := false;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    raise exception 'PUBLIC_BOOKING_GATE_UNAVAILABLE';
  end if;

  select b.id into v_business_id
  from public.businesses b
  where lower(b.slug) = lower(trim(p_slug))
  limit 1;

  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;

  select exists (
    select 1
    from public.public_booking_recoveries r
    where r.business_id = v_business_id
      and r.idempotency_key = p_idempotency_key
      and r.recovery_id = p_recovery_id
      and r.management_token_hash = p_management_token_hash
      and r.recovery_secret_hash is not distinct from p_recovery_secret_hash
      and r.appointment_id is not null
  ) into v_safe_retry;

  if not v_safe_retry then
    perform public.enforce_public_booking_rate(
      'create', p_actor_hash, p_network_hash, v_business_id
    );
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  begin
    return query
    select *
    from public.create_public_appointment_with_recovery(
      p_slug,
      p_idempotency_key,
      p_customer_name,
      p_service_id,
      p_staff_id,
      p_starts_at,
      p_management_token_hash,
      p_recovery_id,
      p_recovery_secret_hash,
      p_management_token_ciphertext,
      p_management_token_iv,
      p_key_version,
      p_customer_phone,
      p_customer_email,
      p_notes
    );
  exception when others then
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    raise;
  end;

  perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
end
$$;

revoke all on function public.create_public_appointment_with_recovery_guarded(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text
) from public;
grant execute on function public.create_public_appointment_with_recovery_guarded(
  text,text,text,uuid,uuid,timestamptz,text,uuid,text,text,text,smallint,text,text,text,text,text,text
) to anon;

commit;
