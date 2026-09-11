begin;

-- Phase 9: durable delivery receipts for public booking confirmation e-mail.
-- The management bearer token is intentionally NOT persisted here. The Worker
-- receives it transiently during capability provisioning and may place it in
-- the outbound e-mail, while PostgreSQL stores only provider delivery metadata.

create table if not exists public.appointment_notification_deliveries (
  appointment_id uuid not null,
  business_id uuid not null,
  kind text not null check (kind in ('public_booking_confirmation')),
  channel text not null check (channel in ('email')),
  recipient text not null check (char_length(recipient) between 3 and 254),
  provider text not null check (provider in ('resend')),
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (appointment_id, kind, channel),
  foreign key (business_id, appointment_id)
    references public.appointments(business_id, id)
    on delete cascade,
  unique (provider, provider_message_id)
);

alter table public.appointment_notification_deliveries enable row level security;
alter table public.appointment_notification_deliveries force row level security;
revoke all on public.appointment_notification_deliveries from anon;
revoke all on public.appointment_notification_deliveries from authenticated;

-- Resolve only the appointment that belongs to the original public-create
-- idempotency command. This is the same ownership proof used by Phase 7
-- capability provisioning and avoids exposing arbitrary appointment PII.
create or replace function public.get_public_booking_email_payload(
  p_appointment_id uuid,
  p_booking_idempotency_key text
)
returns table(
  business_id uuid,
  business_name text,
  customer_name text,
  customer_email text,
  starts_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  already_delivered boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_appointment_id is null
     or p_booking_idempotency_key is null
     or char_length(p_booking_idempotency_key) < 8
     or char_length(p_booking_idempotency_key) > 128 then
    raise exception 'INVALID_NOTIFICATION_BOOTSTRAP';
  end if;

  if not exists (
    select 1
    from public.booking_commands bc
    join public.appointments a
      on a.business_id = bc.business_id
     and a.id = bc.appointment_id
     and a.source = 'public'
    where bc.appointment_id = p_appointment_id
      and bc.idempotency_key = p_booking_idempotency_key
      and bc.command = 'public_create'
      and bc.source = 'public'
  ) then
    raise exception 'INVALID_NOTIFICATION_BOOTSTRAP';
  end if;

  return query
  select
    a.business_id,
    b.name,
    a.customer_name_snapshot,
    a.customer_email_snapshot,
    a.starts_at,
    a.timezone,
    a.service_name_snapshot,
    a.staff_name_snapshot,
    a.price_minor_snapshot,
    a.currency_snapshot,
    exists (
      select 1
      from public.appointment_notification_deliveries d
      where d.appointment_id = a.id
        and d.kind = 'public_booking_confirmation'
        and d.channel = 'email'
    )
  from public.appointments a
  join public.businesses b on b.id = a.business_id
  where a.id = p_appointment_id
  limit 1;
end
$$;

create or replace function public.record_public_booking_email_delivery(
  p_appointment_id uuid,
  p_booking_idempotency_key text,
  p_provider_message_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_recipient text;
begin
  if p_provider_message_id is null
     or char_length(p_provider_message_id) < 1
     or char_length(p_provider_message_id) > 200 then
    raise exception 'INVALID_PROVIDER_MESSAGE_ID';
  end if;

  select a.business_id, a.customer_email_snapshot
  into v_business_id, v_recipient
  from public.booking_commands bc
  join public.appointments a
    on a.business_id = bc.business_id
   and a.id = bc.appointment_id
   and a.source = 'public'
  where bc.appointment_id = p_appointment_id
    and bc.idempotency_key = p_booking_idempotency_key
    and bc.command = 'public_create'
    and bc.source = 'public'
  limit 1;

  if v_business_id is null then
    raise exception 'INVALID_NOTIFICATION_BOOTSTRAP';
  end if;
  if v_recipient is null or btrim(v_recipient) = '' then
    raise exception 'NOTIFICATION_EMAIL_MISSING';
  end if;

  insert into public.appointment_notification_deliveries(
    appointment_id, business_id, kind, channel, recipient, provider, provider_message_id
  ) values (
    p_appointment_id, v_business_id, 'public_booking_confirmation', 'email',
    v_recipient, 'resend', p_provider_message_id
  )
  on conflict (appointment_id, kind, channel) do nothing;

  return true;
end
$$;

revoke all on function public.get_public_booking_email_payload(uuid,text) from public;
revoke all on function public.record_public_booking_email_delivery(uuid,text,text) from public;
grant execute on function public.get_public_booking_email_payload(uuid,text) to anon;
grant execute on function public.record_public_booking_email_delivery(uuid,text,text) to anon;

commit;
