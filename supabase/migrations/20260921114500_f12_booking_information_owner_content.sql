begin;

alter table public.business_public_profiles
  add column if not exists kvkk_notice_text text,
  add column if not exists kvkk_notice_url text,
  add column if not exists privacy_policy_url text,
  add column if not exists booking_terms_text text,
  add column if not exists booking_terms_url text;

alter table public.business_public_profiles
  drop constraint if exists business_public_profiles_kvkk_notice_text_len,
  drop constraint if exists business_public_profiles_kvkk_notice_url_https,
  drop constraint if exists business_public_profiles_privacy_policy_url_https,
  drop constraint if exists business_public_profiles_booking_terms_text_len,
  drop constraint if exists business_public_profiles_booking_terms_url_https;

alter table public.business_public_profiles
  add constraint business_public_profiles_kvkk_notice_text_len
    check (kvkk_notice_text is null or char_length(kvkk_notice_text) <= 12000),
  add constraint business_public_profiles_kvkk_notice_url_https
    check (kvkk_notice_url is null or (char_length(kvkk_notice_url) <= 1000 and kvkk_notice_url ~ '^https://')),
  add constraint business_public_profiles_privacy_policy_url_https
    check (privacy_policy_url is null or (char_length(privacy_policy_url) <= 1000 and privacy_policy_url ~ '^https://')),
  add constraint business_public_profiles_booking_terms_text_len
    check (booking_terms_text is null or char_length(booking_terms_text) <= 8000),
  add constraint business_public_profiles_booking_terms_url_https
    check (booking_terms_url is null or (char_length(booking_terms_url) <= 1000 and booking_terms_url ~ '^https://'));

create or replace function public.f12_public_information_ready(
  p_kvkk_notice_text text,
  p_kvkk_notice_url text,
  p_privacy_policy_url text,
  p_booking_terms_text text
)
returns boolean
language sql
immutable
as $$
  select
    (nullif(trim(coalesce(p_kvkk_notice_text,'')),'') is not null
      or nullif(trim(coalesce(p_kvkk_notice_url,'')),'') is not null)
    and nullif(trim(coalesce(p_privacy_policy_url,'')),'') is not null
    and nullif(trim(coalesce(p_booking_terms_text,'')),'') is not null;
$$;

revoke all on function public.f12_public_information_ready(text,text,text,text)
  from public, anon, authenticated;

create or replace function public.get_business_public_information(p_business_id uuid)
returns table(
  business_id uuid,
  kvkk_notice_text text,
  kvkk_notice_url text,
  privacy_policy_url text,
  booking_terms_text text,
  booking_terms_url text
)
language plpgsql
stable
security definer
set search_path=public
as $$
begin
  perform public.f10_require_standard_session();
  if not public.is_active_member(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;
  return query
  select p_business_id,p.kvkk_notice_text,p.kvkk_notice_url,p.privacy_policy_url,p.booking_terms_text,p.booking_terms_url
  from (select 1) seed
  left join public.business_public_profiles p on p.business_id=p_business_id;
end
$$;

revoke all on function public.get_business_public_information(uuid)
  from public, anon, authenticated;
grant execute on function public.get_business_public_information(uuid) to authenticated;

create or replace function public.f12_require_public_information()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_required boolean;
  v_old_ready boolean;
  v_new_ready boolean;
begin
  perform 1 from public.businesses b where b.id=new.business_id for update;
  if not found then raise exception 'BUSINESS_NOT_FOUND'; end if;

  v_new_ready:=public.f12_public_information_ready(
    new.kvkk_notice_text,new.kvkk_notice_url,new.privacy_policy_url,new.booking_terms_text
  );
  if tg_op='INSERT' or v_new_ready then return new; end if;

  v_old_ready:=public.f12_public_information_ready(
    old.kvkk_notice_text,old.kvkk_notice_url,old.privacy_policy_url,old.booking_terms_text
  );
  if not v_old_ready then return new; end if;

  select
    exists(select 1 from public.public_booking_settings s where s.business_id=new.business_id and s.enabled)
    or exists(
      select 1 from public.appointments a
      where a.business_id=new.business_id
        and a.source='public'
        and a.status in ('scheduled','confirmed')
        and a.ends_at>now()
    )
  into v_required;

  if v_required then raise exception 'PUBLIC_INFORMATION_REQUIRED'; end if;
  return new;
end
$$;

revoke all on function public.f12_require_public_information()
  from public, anon, authenticated;

drop trigger if exists f12_public_information_guard on public.business_public_profiles;
create trigger f12_public_information_guard
before insert or update of
  kvkk_notice_text,kvkk_notice_url,privacy_policy_url,booking_terms_text,booking_terms_url
on public.business_public_profiles
for each row execute function public.f12_require_public_information();

create or replace function public.update_business_public_information(
  p_business_id uuid,
  p_kvkk_notice_text text,
  p_kvkk_notice_url text,
  p_privacy_policy_url text,
  p_booking_terms_text text,
  p_booking_terms_url text
)
returns table(
  business_id uuid,
  kvkk_notice_text text,
  kvkk_notice_url text,
  privacy_policy_url text,
  booking_terms_text text,
  booking_terms_url text
)
language plpgsql
volatile
security definer
set search_path=public
as $$
declare
  v_notice_text text:=nullif(trim(coalesce(p_kvkk_notice_text,'')),'');
  v_notice_url text:=nullif(trim(coalesce(p_kvkk_notice_url,'')),'');
  v_privacy_url text:=nullif(trim(coalesce(p_privacy_policy_url,'')),'');
  v_terms_text text:=nullif(trim(coalesce(p_booking_terms_text,'')),'');
  v_terms_url text:=nullif(trim(coalesce(p_booking_terms_url,'')),'');
begin
  perform public.f10_require_standard_session();
  if not public.can_manage_business(p_business_id) then
    raise exception 'NOT_ALLOWED' using errcode='42501';
  end if;

  if (v_notice_text is not null and char_length(v_notice_text)>12000)
     or (v_notice_url is not null and (char_length(v_notice_url)>1000 or v_notice_url !~ '^https://'))
     or (v_privacy_url is not null and (char_length(v_privacy_url)>1000 or v_privacy_url !~ '^https://'))
     or (v_terms_text is not null and char_length(v_terms_text)>8000)
     or (v_terms_url is not null and (char_length(v_terms_url)>1000 or v_terms_url !~ '^https://')) then
    raise exception 'INVALID_PUBLIC_INFORMATION';
  end if;

  perform 1 from public.businesses b where b.id=p_business_id for update;
  if not found then raise exception 'NOT_ALLOWED' using errcode='42501'; end if;

  insert into public.business_public_profiles(
    business_id,kvkk_notice_text,kvkk_notice_url,privacy_policy_url,booking_terms_text,booking_terms_url
  ) values (
    p_business_id,v_notice_text,v_notice_url,v_privacy_url,v_terms_text,v_terms_url
  )
  on conflict (business_id) do update
  set kvkk_notice_text=excluded.kvkk_notice_text,
      kvkk_notice_url=excluded.kvkk_notice_url,
      privacy_policy_url=excluded.privacy_policy_url,
      booking_terms_text=excluded.booking_terms_text,
      booking_terms_url=excluded.booking_terms_url;

  return query
  select p.business_id,p.kvkk_notice_text,p.kvkk_notice_url,p.privacy_policy_url,p.booking_terms_text,p.booking_terms_url
  from public.business_public_profiles p
  where p.business_id=p_business_id;
end
$$;

revoke all on function public.update_business_public_information(uuid,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.update_business_public_information(uuid,text,text,text,text,text)
  to authenticated;

create or replace function public.get_public_business_profile_v2(p_slug text)
returns table(
  public_name text,
  short_description text,
  long_description text,
  public_phone text,
  public_email text,
  public_website text,
  public_whatsapp text,
  address_text text,
  show_work_hours boolean,
  cover_media_id uuid,
  work_hours jsonb,
  media jsonb,
  kvkk_notice_text text,
  kvkk_notice_url text,
  privacy_policy_url text,
  booking_terms_text text,
  booking_terms_url text
)
language sql
stable
security definer
set search_path=public
as $$
  select
    s.public_name,s.short_description,s.long_description,s.public_phone,
    s.public_email,s.public_website,s.public_whatsapp,s.address_text,
    s.show_work_hours,s.cover_media_id,s.work_hours,s.media,
    p.kvkk_notice_text,p.kvkk_notice_url,p.privacy_policy_url,p.booking_terms_text,p.booking_terms_url
  from public.businesses b
  join public.public_booking_settings pbs on pbs.business_id=b.id and pbs.enabled
  cross join lateral public.business_public_profile_snapshot_internal(b.id) s
  cross join lateral public.business_onboarding_readiness_internal(b.id) r
  left join public.business_public_profiles p on p.business_id=b.id
  where lower(b.slug)=lower(trim(p_slug))
    and r.publishable
  limit 1;
$$;

revoke all on function public.get_public_business_profile_v2(text)
  from public, anon, authenticated;

create or replace function public.execute_public_operation(
  p_action text,p_args jsonb,p_gate_secret text,p_actor_hash text,p_network_hash text
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
  v_group_payload jsonb;
  v_business_id uuid;
  v_recovery_id uuid;
  v_safe_retry boolean := false;
  v_prior_sub text := current_setting('request.jwt.claim.sub',true);
  v_prior_claims text := current_setting('request.jwt.claims',true);
begin
  if not public.public_booking_gate_authorized(p_gate_secret) then
    return public.public_operation_error('PUBLIC_BOOKING_GATE_UNAVAILABLE');
  end if;

  v_class := case p_action
    when 'business' then 'read' when 'services' then 'read' when 'services_v2' then 'read' when 'staff' then 'read'
    when 'profile' then 'read' when 'media' then 'read'
    when 'slots' then 'slot' when 'group_slots' then 'slot'
    when 'book' then 'request' when 'group_book' then 'request'
    when 'recover' then 'recover' when 'resolve' then 'recover'
    when 'manage_view' then 'manage_read' when 'manage_slots' then 'manage_slot'
    when 'manage_group_slots' then 'manage_slot'
    when 'manage_reschedule' then 'manage_change' when 'manage_cancel' then 'manage_cancel'
    when 'manage_group_reschedule' then 'manage_change'
    when 'manage_group_cancel' then 'manage_cancel'
    else null end;
  if v_class is null then return public.public_operation_error('INVALID_PUBLIC_OPERATION'); end if;

  begin
    perform public.enforce_public_booking_rate(v_class,p_actor_hash,p_network_hash);
  exception when others then return public.public_operation_error(sqlerrm);
  end;
  begin perform public.prune_public_booking_rate_counters(); exception when others then null; end;

  if p_args is null or jsonb_typeof(p_args)<>'object' or octet_length(p_args::text)>16384 then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  end if;

  if p_action in ('book','group_book') then
    begin
      v_recovery_id := (p_args->>'p_recovery_id')::uuid;
      if v_recovery_id is null then raise exception 'INVALID_BOOKING_RECOVERY_BOOTSTRAP'; end if;
      perform pg_advisory_xact_lock(hashtextextended(v_recovery_id::text,0));
      select b.id into v_business_id
      from public.businesses b
      where b.slug=lower(trim(p_args->>'p_slug')) limit 1;
      if v_business_id is null then raise exception 'PUBLIC_BOOKING_NOT_FOUND'; end if;
      select exists(
        select 1 from public.public_booking_recoveries r
        where r.business_id=v_business_id and r.recovery_id=v_recovery_id
          and r.idempotency_key=p_args->>'p_idempotency_key'
          and r.management_token_hash=p_args->>'p_management_token_hash'
          and r.recovery_secret_hash=p_args->>'p_recovery_secret_hash'
          and r.appointment_id is not null
      ) into v_safe_retry;
    exception when invalid_text_representation then
      return public.public_operation_error('INVALID_BOOKING_RECOVERY_BOOTSTRAP');
    when others then return public.public_operation_error(sqlerrm);
    end;
    if not v_safe_retry then
      begin
        perform public.enforce_public_booking_rate('create',p_actor_hash,p_network_hash,v_business_id);
      exception when others then return public.public_operation_error(sqlerrm);
      end;
    end if;
  end if;

  begin
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','{}',true);
    case p_action
      when 'business' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_business((p_args->>'p_slug')::text) r;
      when 'services' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_services((p_args->>'p_slug')::text) r;
      when 'services_v2' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_services_v2((p_args->>'p_slug')::text) r;
      when 'staff' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_booking_staff(
          (p_args->>'p_slug')::text,(p_args->>'p_service_id')::uuid
        ) r;
      when 'profile' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_business_profile_v2((p_args->>'p_slug')::text) r;
      when 'media' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_media_object((p_args->>'p_media_id')::uuid) r;
      when 'slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_booking_slots(
          (p_args->>'p_slug')::text,(p_args->>'p_service_id')::uuid,
          (p_args->>'p_date')::date,(p_args->>'p_staff_id')::uuid
        ) r;
      when 'group_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_group_availability_slots(
          (p_args->>'p_slug')::text,(p_args->>'p_date')::date,p_args->'p_lines'
        ) r;
      when 'book' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.create_public_appointment_with_recovery(
          (p_args->>'p_slug')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_customer_name')::text,(p_args->>'p_service_id')::uuid,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz,
          (p_args->>'p_management_token_hash')::text,(p_args->>'p_recovery_id')::uuid,
          (p_args->>'p_recovery_secret_hash')::text,
          (p_args->>'p_management_token_ciphertext')::text,
          (p_args->>'p_management_token_iv')::text,(p_args->>'p_key_version')::smallint,
          (p_args->>'p_customer_phone')::text,(p_args->>'p_customer_email')::text,
          (p_args->>'p_notes')::text
        ) r;
      when 'group_book' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.create_public_appointment_group_with_recovery(
          (p_args->>'p_slug')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_customer_name')::text,p_args->'p_lines',
          (p_args->>'p_starts_at')::timestamptz,
          (p_args->>'p_management_token_hash')::text,(p_args->>'p_recovery_id')::uuid,
          (p_args->>'p_recovery_secret_hash')::text,
          (p_args->>'p_management_token_ciphertext')::text,
          (p_args->>'p_management_token_iv')::text,(p_args->>'p_key_version')::smallint,
          (p_args->>'p_customer_phone')::text,(p_args->>'p_customer_email')::text,
          (p_args->>'p_notes')::text
        ) r;
      when 'recover' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.recover_public_appointment(
          (p_args->>'p_recovery_id')::uuid,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_recovery_secret_hash')::text
        ) r;
      when 'resolve' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.resolve_public_booking_intent_v2(
          (p_args->>'p_recovery_id')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_recovery_secret_hash')::text
        ) r;
      when 'manage_view' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.get_public_managed_appointment((p_args->>'p_token')::text) r;
        if jsonb_array_length(v_data)>0 then
          v_group_payload:=public.f11_public_managed_group_payload((p_args->>'p_token')::text);
          if v_group_payload is not null then
            v_data:=jsonb_set(v_data,'{0}',
              (v_data->0)||jsonb_build_object('group_payload',v_group_payload));
          end if;
        end if;
      when 'manage_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          (p_args->>'p_staff_id')::uuid
        ) r;
      when 'manage_group_slots' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.compute_public_group_management_slots(
          (p_args->>'p_token')::text,(p_args->>'p_date')::date,
          coalesce((p_args->>'p_step_minutes')::integer,15)
        ) r;
      when 'manage_reschedule' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.reschedule_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_staff_id')::uuid,(p_args->>'p_starts_at')::timestamptz
        ) r;
      when 'manage_group_reschedule' then
        v_group_payload:=public.reschedule_public_managed_group(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_expected_version')::integer,(p_args->>'p_starts_at')::timestamptz
        );
        v_data:=jsonb_build_array(jsonb_build_object('group_payload',v_group_payload));
      when 'manage_cancel' then
        select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into v_data
        from public.cancel_public_managed_appointment(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_reason')::text
        ) r;
      when 'manage_group_cancel' then
        v_group_payload:=public.cancel_public_managed_group(
          (p_args->>'p_token')::text,(p_args->>'p_idempotency_key')::text,
          (p_args->>'p_expected_version')::integer,(p_args->>'p_reason')::text
        );
        v_data:=jsonb_build_array(jsonb_build_object('group_payload',v_group_payload));
    end case;

    -- Only an already authenticated recovery result may acquire the group
    -- projection. Absence/expired-link responses retain their PII-free shape;
    -- legacy single-service JSON is unchanged (no extra null group field).
    if p_action in ('recover','resolve')
       and v_data #>> '{0,appointment_id}' is not null then
      select public.f11_group_payload(r.business_id,r.group_id)
      into v_group_payload
      from public.public_booking_recoveries r
      join public.booking_commands bc
        on bc.business_id=r.business_id and bc.idempotency_key=r.idempotency_key
       and bc.appointment_id=r.appointment_id and bc.group_id=r.group_id
      where r.recovery_id=(p_args->>'p_recovery_id')::uuid
        and r.idempotency_key=p_args->>'p_idempotency_key'
        and r.appointment_id=(v_data#>>'{0,appointment_id}')::uuid
        and bc.command='public_create_group' and bc.source='public';
      if found then
        if v_group_payload is null then
          raise exception 'IDEMPOTENCY_RESULT_MISSING';
        end if;
        v_data:=jsonb_set(v_data,'{0}',
          (v_data->0)||jsonb_build_object('group_payload',v_group_payload));
      end if;
    end if;
    perform set_config('request.jwt.claim.sub',coalesce(v_prior_sub,''),true);
    perform set_config('request.jwt.claims',coalesce(v_prior_claims,''),true);
  exception when invalid_text_representation or datetime_field_overflow then
    return public.public_operation_error('INVALID_PUBLIC_OPERATION');
  when others then
    return public.public_operation_error(sqlerrm);
  end;

  return jsonb_build_object('ok',true,'data',v_data);
end
$$;

revoke all on function public.execute_public_operation(text,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.execute_public_operation(text,jsonb,text,text,text) to anon;


drop function public.get_public_managed_appointment(text);

create function public.get_public_managed_appointment(p_token text)
returns table(
  appointment_id uuid,
  business_name text,
  status text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  service_name text,
  staff_name text,
  price_minor integer,
  currency text,
  can_reschedule boolean,
  can_cancel boolean,
  local_date date,
  max_date date,
  support_slug text,
  support_phone text,
  support_email text,
  support_website text,
  support_whatsapp text,
  support_address text,
  kvkk_notice_text text,
  kvkk_notice_url text,
  privacy_policy_url text,
  booking_terms_text text,
  booking_terms_url text
)
language plpgsql
stable
security definer
set search_path=public
as $$
declare v_hash text;
begin
  v_hash:=public.management_token_hash(p_token);
  return query
  select
    a.id,b.name,a.status,a.starts_at,a.ends_at,a.timezone,
    a.service_name_snapshot,a.staff_name_snapshot,a.price_minor_snapshot,a.currency_snapshot,
    (a.status in ('scheduled','confirmed') and a.starts_at>now()),
    (a.status in ('scheduled','confirmed') and a.starts_at>now()),
    (now() at time zone b.timezone)::date,
    (now() at time zone b.timezone)::date+pbs.horizon_days,
    b.slug,
    p.public_phone,p.public_email,p.public_website,p.public_whatsapp,p.address_text,
    p.kvkk_notice_text,p.kvkk_notice_url,p.privacy_policy_url,p.booking_terms_text,p.booking_terms_url
  from public.appointment_management_capabilities cap
  join public.appointments a on a.business_id=cap.business_id and a.id=cap.appointment_id
  join public.businesses b on b.id=a.business_id
  join public.public_booking_settings pbs on pbs.business_id=b.id
  left join public.business_public_profiles p on p.business_id=b.id
  where cap.token_hash=v_hash and cap.revoked_at is null
  limit 1;
end
$$;

revoke all on function public.get_public_managed_appointment(text)
  from public, anon, authenticated;

commit;
