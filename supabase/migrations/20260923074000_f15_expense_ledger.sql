begin;

create table public.expense_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  event_type text not null check (event_type in ('expense','reversal')),
  source_expense_event_id uuid,
  category text not null,
  description text,
  amount_minor integer not null check (amount_minor between 1 and 100000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  payment_method text not null check (payment_method in ('cash','card')),
  occurred_at timestamptz not null,
  business_date date not null,
  timezone_snapshot text not null,
  reason text,
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (business_id, id),
  constraint expense_events_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id),
  constraint expense_events_source_fk
    foreign key (business_id, source_expense_event_id)
    references public.expense_events(business_id, id),
  constraint expense_events_not_self_source
    check (source_expense_event_id is null or source_expense_event_id <> id),
  constraint expense_events_category_shape
    check (category = btrim(category) and char_length(category) between 1 and 80),
  constraint expense_events_description_shape
    check (description is null or (description = btrim(description) and char_length(description) between 2 and 240)),
  constraint expense_events_timezone_shape check (char_length(timezone_snapshot) between 1 and 64),
  constraint expense_events_reason_shape
    check (reason is null or (reason = btrim(reason) and char_length(reason) between 2 and 240)),
  constraint expense_events_shape
    check (
      (event_type='expense' and source_expense_event_id is null and reason is null)
      or
      (event_type='reversal' and source_expense_event_id is not null and reason is not null)
    )
);

create unique index expense_events_one_reversal_idx
  on public.expense_events(business_id, source_expense_event_id)
  where source_expense_event_id is not null;

create index expense_events_business_occurred_idx
  on public.expense_events(business_id, occurred_at desc, id desc);

create index expense_events_business_date_idx
  on public.expense_events(business_id, business_date, occurred_at desc, id desc);

create index expense_events_business_method_idx
  on public.expense_events(business_id, payment_method, occurred_at desc, id desc);

create table public.expense_commands (
  business_id uuid not null references public.businesses(id),
  actor_membership_id uuid not null,
  command text not null check (command in ('create_expense','reverse_expense','correct_expense')),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  result_payload jsonb,
  created_at timestamptz not null default now(),
  primary key (business_id, actor_membership_id, command, idempotency_key),
  constraint expense_commands_actor_fk
    foreign key (business_id, actor_membership_id)
    references public.memberships(business_id, id)
);

alter table public.expense_events enable row level security;
alter table public.expense_commands enable row level security;
alter table public.expense_events force row level security;
alter table public.expense_commands force row level security;

revoke all on table public.expense_events from public, anon, authenticated;
revoke all on table public.expense_commands from public, anon, authenticated;

create or replace function public.f15_reject_expense_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'EXPENSE_EVENT_IMMUTABLE';
end
$$;

create trigger expense_events_immutable
before update or delete on public.expense_events
for each row execute function public.f15_reject_expense_event_mutation();

create or replace function public.f15_reject_expense_command_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op='DELETE' then
    raise exception 'EXPENSE_COMMAND_IMMUTABLE';
  end if;
  if old.result_payload is not null or new.business_id<>old.business_id
     or new.actor_membership_id<>old.actor_membership_id or new.command<>old.command
     or new.idempotency_key<>old.idempotency_key or new.request_hash<>old.request_hash
     or new.created_at<>old.created_at or new.result_payload is null then
    raise exception 'EXPENSE_COMMAND_IMMUTABLE';
  end if;
  return new;
end
$$;

create trigger expense_commands_guard
before update or delete on public.expense_commands
for each row execute function public.f15_reject_expense_command_mutation();

create or replace function public.f15_expense_actor(p_business_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
begin
  perform public.f10_require_standard_session();

  select * into v_actor
  from public.memberships m
  where m.business_id=p_business_id
    and m.user_id=auth.uid()
    and m.active
  limit 1;

  if v_actor.id is null then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;

  if not public.has_financial_permission(
    p_business_id,
    'expenses_write'::public.financial_permission_key
  ) then
    raise exception 'EXPENSES_PERMISSION_REQUIRED' using errcode='42501';
  end if;

  return v_actor;
end
$$;

create or replace function public.f15_claim_expense_command(
  p_business_id uuid,
  p_actor_membership_id uuid,
  p_command text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_result jsonb;
begin
  if p_command not in ('create_expense','reverse_expense','correct_expense') then
    raise exception 'INVALID_EXPENSE_COMMAND';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_REQUEST_HASH';
  end if;

  insert into public.expense_commands(
    business_id,actor_membership_id,command,idempotency_key,request_hash
  ) values (
    p_business_id,p_actor_membership_id,p_command,p_idempotency_key,p_request_hash
  )
  on conflict (business_id,actor_membership_id,command,idempotency_key) do nothing;

  select c.request_hash,c.result_payload
  into v_hash,v_result
  from public.expense_commands c
  where c.business_id=p_business_id
    and c.actor_membership_id=p_actor_membership_id
    and c.command=p_command
    and c.idempotency_key=p_idempotency_key
  for update;

  if v_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT';
  end if;

  return v_result;
end
$$;

create or replace function public.f15_finish_expense_command(
  p_business_id uuid,
  p_actor_membership_id uuid,
  p_command text,
  p_idempotency_key text,
  p_result jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.expense_commands
  set result_payload=p_result
  where business_id=p_business_id
    and actor_membership_id=p_actor_membership_id
    and command=p_command
    and idempotency_key=p_idempotency_key
    and result_payload is null;

  if not found then
    raise exception 'EXPENSE_COMMAND_RESULT_CONFLICT';
  end if;
end
$$;

create or replace function public.f15_expense_event_projection(
  p_business_id uuid,
  p_event_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'eventId',e.id,
    'businessId',e.business_id,
    'eventType',e.event_type,
    'sourceExpenseEventId',e.source_expense_event_id,
    'category',e.category,
    'description',e.description,
    'amountMinor',e.amount_minor,
    'effectMinor',case when e.event_type='expense' then e.amount_minor else -e.amount_minor end,
    'currency',e.currency,
    'paymentMethod',e.payment_method,
    'occurredAt',e.occurred_at,
    'businessDate',e.business_date,
    'timezone',e.timezone_snapshot,
    'reason',e.reason,
    'actorMembershipId',e.actor_membership_id,
    'createdAt',e.created_at
  )
  from public.expense_events e
  where e.business_id=p_business_id and e.id=p_event_id
$$;

create or replace function public.list_expense_events_page(
  p_business_id uuid,
  p_limit integer,
  p_after_occurred_at timestamptz,
  p_after_id uuid
)
returns table (
  event jsonb,
  sort_occurred_at timestamptz,
  sort_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>101 then
    raise exception 'INVALID_PAGE';
  end if;
  if (p_after_occurred_at is null)<>(p_after_id is null) then
    raise exception 'INVALID_PAGE';
  end if;

  return query
  select
    public.f15_expense_event_projection(e.business_id,e.id),
    e.occurred_at,
    e.id
  from public.expense_events e
  where e.business_id=p_business_id
    and (
      p_after_occurred_at is null
      or (e.occurred_at,e.id)<(p_after_occurred_at,p_after_id)
    )
  order by e.occurred_at desc,e.id desc
  limit p_limit;
end
$$;

create or replace function public.create_expense_guarded(
  p_business_id uuid,
  p_category text,
  p_description text,
  p_amount_minor integer,
  p_currency text,
  p_payment_method text,
  p_occurred_local timestamp without time zone,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_timezone text;
  v_occurred_at timestamptz;
  v_category text:=btrim(coalesce(p_category,''));
  v_description text:=nullif(btrim(coalesce(p_description,'')),'');
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_event public.expense_events;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor:=public.f15_expense_actor(p_business_id);
  v_replay:=public.f15_claim_expense_command(
    p_business_id,v_actor.id,'create_expense',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
  if v_description is not null and char_length(v_description) not between 2 and 240 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
  if p_amount_minor is null or p_amount_minor not between 1 and 100000000 then raise exception 'INVALID_EXPENSE_AMOUNT'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if p_payment_method not in ('cash','card') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_occurred_local is null then raise exception 'INVALID_EXPENSE_TIME'; end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_occurred_at:=p_occurred_local at time zone v_timezone;

  insert into public.expense_events(
    business_id,event_type,source_expense_event_id,category,description,
    amount_minor,currency,payment_method,occurred_at,business_date,timezone_snapshot,
    reason,actor_membership_id
  ) values (
    p_business_id,'expense',null,v_category,v_description,
    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
    null,v_actor.id
  )
  returning * into v_event;

  v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
  perform public.f15_finish_expense_command(
    p_business_id,v_actor.id,'create_expense',p_idempotency_key,v_result
  );
  return v_result;
end
$$;

create or replace function public.reverse_expense_guarded(
  p_business_id uuid,
  p_source_event_id uuid,
  p_reason text,
  p_occurred_local timestamp without time zone,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_source public.expense_events;
  v_timezone text;
  v_occurred_at timestamptz;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_event public.expense_events;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor:=public.f15_expense_actor(p_business_id);
  v_replay:=public.f15_claim_expense_command(
    p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;
  if p_occurred_local is null then raise exception 'INVALID_EXPENSE_TIME'; end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_occurred_at:=p_occurred_local at time zone v_timezone;

  select * into v_source
  from public.expense_events e
  where e.business_id=p_business_id
    and e.id=p_source_event_id
    and e.event_type='expense'
  for update;

  if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.expense_events r
    where r.business_id=p_business_id
      and r.source_expense_event_id=p_source_event_id
      and r.event_type='reversal'
  ) then
    raise exception 'EXPENSE_ALREADY_REVERSED';
  end if;

  insert into public.expense_events(
    business_id,event_type,source_expense_event_id,category,description,
    amount_minor,currency,payment_method,occurred_at,business_date,timezone_snapshot,
    reason,actor_membership_id
  ) values (
    p_business_id,'reversal',v_source.id,v_source.category,v_source.description,
    v_source.amount_minor,v_source.currency,v_source.payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
    v_reason,v_actor.id
  )
  returning * into v_event;

  v_result:=public.f15_expense_event_projection(p_business_id,v_event.id);
  perform public.f15_finish_expense_command(
    p_business_id,v_actor.id,'reverse_expense',p_idempotency_key,v_result
  );
  return v_result;
end
$$;

create or replace function public.correct_expense_guarded(
  p_business_id uuid,
  p_source_event_id uuid,
  p_reason text,
  p_category text,
  p_description text,
  p_amount_minor integer,
  p_currency text,
  p_payment_method text,
  p_occurred_local timestamp without time zone,
  p_correction_occurred_local timestamp without time zone,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.memberships;
  v_source public.expense_events;
  v_timezone text;
  v_occurred_at timestamptz;
  v_correction_occurred_at timestamptz;
  v_reason text:=btrim(coalesce(p_reason,''));
  v_category text:=btrim(coalesce(p_category,''));
  v_description text:=nullif(btrim(coalesce(p_description,'')),'');
  v_currency text:=upper(btrim(coalesce(p_currency,'')));
  v_reversal public.expense_events;
  v_replacement public.expense_events;
  v_replay jsonb;
  v_result jsonb;
begin
  v_actor:=public.f15_expense_actor(p_business_id);
  v_replay:=public.f15_claim_expense_command(
    p_business_id,v_actor.id,'correct_expense',p_idempotency_key,p_request_hash
  );
  if v_replay is not null then return v_replay; end if;

  if char_length(v_reason) not between 2 and 240 then raise exception 'INVALID_EXPENSE_REASON'; end if;
  if char_length(v_category) not between 1 and 80 then raise exception 'INVALID_EXPENSE_CATEGORY'; end if;
  if v_description is not null and char_length(v_description) not between 2 and 240 then raise exception 'INVALID_EXPENSE_DESCRIPTION'; end if;
  if p_amount_minor is null or p_amount_minor not between 1 and 100000000 then raise exception 'INVALID_EXPENSE_AMOUNT'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'INVALID_CURRENCY'; end if;
  if p_payment_method not in ('cash','card') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
  if p_occurred_local is null or p_correction_occurred_local is null then raise exception 'INVALID_EXPENSE_TIME'; end if;

  select b.timezone into v_timezone from public.businesses b where b.id=p_business_id;
  if v_timezone is null then raise exception 'BUSINESS_NOT_FOUND'; end if;
  v_occurred_at:=p_occurred_local at time zone v_timezone;
  v_correction_occurred_at:=p_correction_occurred_local at time zone v_timezone;

  select * into v_source
  from public.expense_events e
  where e.business_id=p_business_id
    and e.id=p_source_event_id
    and e.event_type='expense'
  for update;

  if v_source.id is null then raise exception 'EXPENSE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.expense_events r
    where r.business_id=p_business_id
      and r.source_expense_event_id=p_source_event_id
      and r.event_type='reversal'
  ) then
    raise exception 'EXPENSE_ALREADY_REVERSED';
  end if;

  insert into public.expense_events(
    business_id,event_type,source_expense_event_id,category,description,
    amount_minor,currency,payment_method,occurred_at,business_date,timezone_snapshot,
    reason,actor_membership_id
  ) values (
    p_business_id,'reversal',v_source.id,v_source.category,v_source.description,
    v_source.amount_minor,v_source.currency,v_source.payment_method,v_correction_occurred_at,p_correction_occurred_local::date,v_timezone,
    v_reason,v_actor.id
  )
  returning * into v_reversal;

  insert into public.expense_events(
    business_id,event_type,source_expense_event_id,category,description,
    amount_minor,currency,payment_method,occurred_at,business_date,timezone_snapshot,
    reason,actor_membership_id
  ) values (
    p_business_id,'expense',null,v_category,v_description,
    p_amount_minor,v_currency,p_payment_method,v_occurred_at,p_occurred_local::date,v_timezone,
    null,v_actor.id
  )
  returning * into v_replacement;

  v_result:=jsonb_build_object(
    'reversal',public.f15_expense_event_projection(p_business_id,v_reversal.id),
    'replacement',public.f15_expense_event_projection(p_business_id,v_replacement.id)
  );
  perform public.f15_finish_expense_command(
    p_business_id,v_actor.id,'correct_expense',p_idempotency_key,v_result
  );
  return v_result;
end
$$;

revoke all on function public.f15_reject_expense_event_mutation() from public,anon,authenticated;
revoke all on function public.f15_reject_expense_command_mutation() from public,anon,authenticated;
revoke all on function public.f15_expense_actor(uuid) from public,anon,authenticated;
revoke all on function public.f15_claim_expense_command(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.f15_finish_expense_command(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.f15_expense_event_projection(uuid,uuid) from public,anon,authenticated;

revoke all on function public.list_expense_events_page(uuid,integer,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.create_expense_guarded(uuid,text,text,integer,text,text,timestamp without time zone,text,text) from public,anon,authenticated;
revoke all on function public.reverse_expense_guarded(uuid,uuid,text,timestamp without time zone,text,text) from public,anon,authenticated;
revoke all on function public.correct_expense_guarded(uuid,uuid,text,text,text,integer,text,text,timestamp without time zone,timestamp without time zone,text,text) from public,anon,authenticated;

grant execute on function public.list_expense_events_page(uuid,integer,timestamptz,uuid) to authenticated;
grant execute on function public.create_expense_guarded(uuid,text,text,integer,text,text,timestamp without time zone,text,text) to authenticated;
grant execute on function public.reverse_expense_guarded(uuid,uuid,text,timestamp without time zone,text,text) to authenticated;
grant execute on function public.correct_expense_guarded(uuid,uuid,text,text,text,integer,text,text,timestamp without time zone,timestamp without time zone,text,text) to authenticated;

commit;
