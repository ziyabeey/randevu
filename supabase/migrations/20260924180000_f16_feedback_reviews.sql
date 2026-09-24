begin;

-- F16-04: appointment-bound customer feedback, business moderation and public
-- reviews. The only customer authority is the existing management capability
-- (`/m#token`); a review cannot be created for a guessed or foreign appointment.
-- Private feedback is never public until an owner/manager publishes it, and a
-- review can only be published when the customer consented. Public output uses
-- a masked display name ("Ayşe D."), never phone/e-mail/full name.

create table if not exists public.appointment_feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  appointment_group_id uuid not null,
  customer_id uuid not null,
  rating smallint not null check (rating between 1 and 5),
  comment text check (comment is null or char_length(comment) between 1 and 1000),
  publish_consent boolean not null,
  display_name text not null check (char_length(display_name) between 1 and 60),
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  moderated_by_membership_id uuid,
  moderated_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_feedback_business_id_key unique (business_id, id),
  constraint appointment_feedback_one_per_group unique (business_id, appointment_group_id),
  constraint appointment_feedback_group_fk
    foreign key (business_id, appointment_group_id)
    references public.appointment_groups(business_id, id) on delete cascade,
  constraint appointment_feedback_customer_fk
    foreign key (business_id, customer_id)
    references public.customers(business_id, id),
  constraint appointment_feedback_moderator_fk
    foreign key (business_id, moderated_by_membership_id)
    references public.memberships(business_id, id),
  constraint appointment_feedback_publish_requires_consent
    check (status <> 'published' or publish_consent),
  constraint appointment_feedback_published_at_shape
    check ((status = 'published') = (published_at is not null)),
  constraint appointment_feedback_moderation_shape
    check ((moderated_by_membership_id is null) = (moderated_at is null))
);

create index if not exists appointment_feedback_business_status_idx
  on public.appointment_feedback(business_id, status, created_at desc, id desc);
create index if not exists appointment_feedback_published_idx
  on public.appointment_feedback(business_id, published_at desc, id desc)
  where status = 'published';

alter table public.appointment_feedback enable row level security;
alter table public.appointment_feedback force row level security;
revoke all on public.appointment_feedback from public, anon, authenticated;

drop trigger if exists appointment_feedback_touch_updated_at on public.appointment_feedback;
create trigger appointment_feedback_touch_updated_at
before update on public.appointment_feedback
for each row execute function public.touch_updated_at();

-- Helpers -------------------------------------------------------------------

create or replace function public.f16_feedback_display_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');
  v_first text;
  v_last text;
begin
  v_first := left(coalesce(v_parts[1], ''), 30);
  if v_first = '' then return 'Müşteri'; end if;
  if array_length(v_parts, 1) > 1 then
    v_last := v_parts[array_length(v_parts, 1)];
    return v_first || ' ' || upper(left(v_last, 1)) || '.';
  end if;
  return v_first;
end
$$;

create or replace function public.f16_feedback_ref(p_token text)
returns table(
  business_id uuid,
  group_id uuid,
  customer_id uuid,
  group_status text,
  customer_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select ref.business_id, ref.group_id, g.customer_id, g.status, c.name
  from public.f11_public_management_group_ref(p_token) ref
  join public.appointment_groups g on g.business_id = ref.business_id and g.id = ref.group_id
  join public.customers c on c.business_id = g.business_id and c.id = g.customer_id
  limit 1;
$$;

revoke all on function public.f16_feedback_display_name(text) from public, anon, authenticated;
revoke all on function public.f16_feedback_ref(text) from public, anon, authenticated;

-- Customer (management capability) surface --------------------------------------

create or replace function public.get_public_managed_feedback(p_token text)
returns table(
  eligible boolean,
  reason text,
  rating smallint,
  comment text,
  publish_consent boolean,
  status text,
  submitted_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_feedback public.appointment_feedback;
begin
  select * into v_ref from public.f16_feedback_ref(p_token);
  if not found then
    raise exception 'MANAGEMENT_NOT_FOUND';
  end if;
  select * into v_feedback from public.appointment_feedback f
  where f.business_id = v_ref.business_id and f.appointment_group_id = v_ref.group_id;
  if v_feedback.id is not null then
    return query select false, 'submitted'::text, v_feedback.rating, v_feedback.comment,
      v_feedback.publish_consent, v_feedback.status, v_feedback.created_at;
    return;
  end if;
  return query select v_ref.group_status = 'completed',
    case when v_ref.group_status = 'completed' then null::text else 'not_completed'::text end,
    null::smallint, null::text, null::boolean, null::text, null::timestamptz;
end
$$;

create or replace function public.submit_public_managed_feedback(
  p_token text,
  p_rating integer,
  p_comment text,
  p_publish_consent boolean
)
returns table(
  eligible boolean,
  reason text,
  rating smallint,
  comment text,
  publish_consent boolean,
  status text,
  submitted_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ref record;
  v_existing public.appointment_feedback;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_hash text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5
     or p_publish_consent is null
     or (v_comment is not null and char_length(v_comment) > 1000) then
    raise exception 'INVALID_FEEDBACK';
  end if;

  select * into v_ref from public.f16_feedback_ref(p_token);
  if not found then
    raise exception 'MANAGEMENT_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f16:feedback:' || v_ref.group_id::text, 0));
  v_hash := encode(extensions.digest(convert_to(
    jsonb_build_object('rating', p_rating, 'comment', v_comment, 'consent', p_publish_consent)::text, 'UTF8'), 'sha256'), 'hex');

  select * into v_existing from public.appointment_feedback f
  where f.business_id = v_ref.business_id and f.appointment_group_id = v_ref.group_id;
  if v_existing.id is not null then
    if v_existing.request_hash <> v_hash then
      raise exception 'FEEDBACK_ALREADY_SUBMITTED';
    end if;
  else
    if v_ref.group_status <> 'completed' then
      raise exception 'FEEDBACK_NOT_ELIGIBLE';
    end if;
    insert into public.appointment_feedback(
      business_id, appointment_group_id, customer_id, rating, comment, publish_consent,
      display_name, request_hash
    ) values (
      v_ref.business_id, v_ref.group_id, v_ref.customer_id, p_rating, v_comment, p_publish_consent,
      public.f16_feedback_display_name(v_ref.customer_name), v_hash
    )
    returning * into v_existing;
  end if;

  return query select false, 'submitted'::text, v_existing.rating, v_existing.comment,
    v_existing.publish_consent, v_existing.status, v_existing.created_at;
end
$$;

-- Public reviews (masked, published only, publishable salons only) --------------

create or replace function public.get_public_business_reviews(p_slug text, p_limit integer default 20)
returns table(
  display_name text,
  rating smallint,
  comment text,
  published_at timestamptz,
  total_count bigint,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
  v_limit integer := coalesce(p_limit, 20);
begin
  if v_limit < 1 or v_limit > 50 then
    raise exception 'INVALID_PUBLIC_OPERATION';
  end if;
  select b.id into v_business_id
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id = b.id and pbs.enabled
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  where lower(b.slug) = lower(btrim(coalesce(p_slug, ''))) and r.publishable
  limit 1;
  if v_business_id is null then
    raise exception 'PUBLIC_BOOKING_NOT_FOUND';
  end if;
  return query
  select f.display_name, f.rating, f.comment, f.published_at,
         count(*) over (), round(avg(f.rating) over (), 1)
  from public.appointment_feedback f
  where f.business_id = v_business_id and f.status = 'published'
  order by f.published_at desc, f.id desc
  limit v_limit;
end
$$;

revoke all on function public.get_public_managed_feedback(text) from public, anon, authenticated;
revoke all on function public.submit_public_managed_feedback(text, integer, text, boolean) from public, anon, authenticated;
revoke all on function public.get_public_business_reviews(text, integer) from public, anon, authenticated;

create or replace function public.f16_feedback_operation_error(p_message text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', false, 'error', jsonb_build_object('message',
    case when p_message ~ '^PUBLIC_BOOKING_RATE_LIMITED:[0-9]{1,5}$' then p_message
    when p_message = any(array[
      'PUBLIC_BOOKING_GATE_UNAVAILABLE','PUBLIC_BOOKING_GATE_INVALID_PROOF',
      'PUBLIC_BOOKING_NOT_FOUND','MANAGEMENT_NOT_FOUND','INVALID_MANAGEMENT_TOKEN',
      'FEEDBACK_NOT_ELIGIBLE','FEEDBACK_ALREADY_SUBMITTED','INVALID_FEEDBACK',
      'INVALID_PUBLIC_OPERATION'
    ]) then p_message else 'PUBLIC_OPERATION_UNAVAILABLE' end));
$$;

revoke all on function public.f16_feedback_operation_error(text) from public, anon, authenticated;

-- A narrow sibling of execute_public_operation: same gate secret, the same S04
-- rate classes (read / manage_read / manage_change) and a closed action list.
create or replace function public.execute_public_feedback_operation(
  p_action text, p_args jsonb, p_gate_secret text, p_actor_hash text, p_network_hash text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_class text;
  v_data jsonb;
  v_prior_sub text := current_setting('request.jwt.claim.sub', true);
  v_prior_claims text := current_setting('request.jwt.claims', true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.f16_feedback_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;

  v_class := case p_action
    when 'reviews' then 'read'
    when 'manage_feedback_view' then 'manage_read'
    when 'manage_feedback_submit' then 'manage_change'
    else null end;
  if v_class is null then return public.f16_feedback_operation_error('INVALID_PUBLIC_OPERATION'); end if;

  begin
    perform public.enforce_public_booking_rate(v_class, p_actor_hash, p_network_hash);
  exception when others then return public.f16_feedback_operation_error(sqlerrm);
  end;
  begin perform public.prune_public_booking_rate_counters(); exception when others then null; end;

  if p_args is null or jsonb_typeof(p_args) <> 'object' or octet_length(p_args::text) > 4096 then
    return public.f16_feedback_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  begin
    perform set_config('request.jwt.claim.sub', '', true);
    perform set_config('request.jwt.claims', '{}', true);
    case p_action
      when 'reviews' then
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.get_public_business_reviews((p_args->>'p_slug')::text, coalesce((p_args->>'p_limit')::integer, 20)) r;
      when 'manage_feedback_view' then
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.get_public_managed_feedback((p_args->>'p_token')::text) r;
      when 'manage_feedback_submit' then
        if jsonb_typeof(p_args->'p_rating') <> 'number' or jsonb_typeof(p_args->'p_publish_consent') <> 'boolean'
           or (p_args ? 'p_comment' and jsonb_typeof(p_args->'p_comment') not in ('string','null')) then
          raise exception 'INVALID_FEEDBACK';
        end if;
        select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_data
        from public.submit_public_managed_feedback(
          (p_args->>'p_token')::text, (p_args->>'p_rating')::integer,
          (p_args->>'p_comment')::text, (p_args->>'p_publish_consent')::boolean
        ) r;
    end case;
    perform set_config('request.jwt.claim.sub', coalesce(v_prior_sub, ''), true);
    perform set_config('request.jwt.claims', coalesce(v_prior_claims, ''), true);
  exception when invalid_text_representation or numeric_value_out_of_range then
    return public.f16_feedback_operation_error('INVALID_FEEDBACK');
  when others then
    return public.f16_feedback_operation_error(sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'data', v_data);
end
$$;

revoke all on function public.execute_public_feedback_operation(text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.execute_public_feedback_operation(text, jsonb, text, text, text) to anon;

-- Business (authenticated member) surface --------------------------------------

create or replace function public.list_business_feedback(
  p_business_id uuid,
  p_status text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 25
)
returns table(
  id uuid,
  appointment_group_id uuid,
  customer_name text,
  display_name text,
  rating smallint,
  comment text,
  publish_consent boolean,
  status text,
  created_at timestamptz,
  published_at timestamptz,
  moderated_at timestamptz,
  appointment_starts_at timestamptz,
  service_names text,
  can_moderate boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.membership_role;
  v_limit integer := coalesce(p_limit, 25);
begin
  perform public.f10_require_standard_session();
  v_role := public.current_membership_role(p_business_id);
  if v_role is null then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_limit < 1 or v_limit > 100
     or (p_status is not null and p_status not in ('pending','published','hidden'))
     or (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'INVALID_FEEDBACK';
  end if;
  return query
  select f.id, f.appointment_group_id, c.name, f.display_name, f.rating, f.comment,
         f.publish_consent, f.status, f.created_at, f.published_at, f.moderated_at,
         lines.starts_at, lines.names, v_role in ('owner','manager')
  from public.appointment_feedback f
  join public.customers c on c.business_id = f.business_id and c.id = f.customer_id
  cross join lateral (
    select min(a.starts_at) as starts_at, string_agg(s.name, ', ' order by a.line_ordinal) as names
    from public.appointments a
    join public.services s on s.business_id = a.business_id and s.id = a.service_id
    where a.business_id = f.business_id and a.group_id = f.appointment_group_id
  ) lines
  where f.business_id = p_business_id
    and (p_status is null or f.status = p_status)
    and (p_before_created_at is null or (f.created_at, f.id) < (p_before_created_at, p_before_id))
  order by f.created_at desc, f.id desc
  limit v_limit;
end
$$;

create or replace function public.moderate_business_feedback(
  p_business_id uuid,
  p_feedback_id uuid,
  p_action text,
  p_expected_status text
)
returns table(id uuid, status text, published_at timestamptz, moderated_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_row public.appointment_feedback;
begin
  perform public.f10_require_standard_session();
  select * into v_actor from public.memberships m
  where m.business_id = p_business_id and m.user_id = auth.uid() and m.active
  limit 1;
  if v_actor.id is null or v_actor.role not in ('owner','manager') then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_action not in ('publish','hide') or p_expected_status not in ('pending','published','hidden') then
    raise exception 'INVALID_FEEDBACK';
  end if;
  select * into v_row from public.appointment_feedback f
  where f.business_id = p_business_id and f.id = p_feedback_id
  for update;
  if v_row.id is null then
    raise exception 'FEEDBACK_NOT_FOUND';
  end if;
  if v_row.status <> p_expected_status then
    raise exception 'FEEDBACK_STATE_CONFLICT';
  end if;
  if p_action = 'publish' then
    if not v_row.publish_consent then raise exception 'FEEDBACK_CONSENT_MISSING'; end if;
    if v_row.status = 'published' then raise exception 'FEEDBACK_STATE_CONFLICT'; end if;
    update public.appointment_feedback
    set status = 'published', published_at = clock_timestamp(),
        moderated_by_membership_id = v_actor.id, moderated_at = clock_timestamp()
    where business_id = p_business_id and appointment_feedback.id = p_feedback_id
    returning * into v_row;
  else
    if v_row.status = 'hidden' then raise exception 'FEEDBACK_STATE_CONFLICT'; end if;
    update public.appointment_feedback
    set status = 'hidden', published_at = null,
        moderated_by_membership_id = v_actor.id, moderated_at = clock_timestamp()
    where business_id = p_business_id and appointment_feedback.id = p_feedback_id
    returning * into v_row;
  end if;
  return query select v_row.id, v_row.status, v_row.published_at, v_row.moderated_at;
end
$$;

revoke all on function public.list_business_feedback(uuid, text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.moderate_business_feedback(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.list_business_feedback(uuid, text, timestamptz, uuid, integer) to authenticated;
grant execute on function public.moderate_business_feedback(uuid, uuid, text, text) to authenticated;

commit;
