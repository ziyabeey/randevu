begin;

-- S03 notification event_version counts only confirmation lifecycle events:
-- created=1, then each reschedule increments by one. Appointment audit versions
-- also include other lifecycle mutations, so event_version itself is NOT the
-- group version. Map each notification event to the corresponding historical
-- appointment audit event and copy that event's already-backfilled group_version.
with mapped as (
  select
    j.id as job_id,
    case
      when j.event_reason = 'created' then (
        select e.group_version
        from public.appointment_events e
        where e.business_id = j.business_id
          and e.appointment_id = j.appointment_id
          and e.event_type = 'created'
        order by e.created_at, e.id
        limit 1
      )
      when j.event_reason = 'rescheduled' then (
        select e.group_version
        from public.appointment_events e
        where e.business_id = j.business_id
          and e.appointment_id = j.appointment_id
          and e.event_type = 'rescheduled'
        order by e.created_at, e.id
        offset greatest(j.event_version - 2, 0)
        limit 1
      )
      else null
    end as group_version
  from public.appointment_notification_jobs j
  where j.group_id is not null
    and j.group_version is null
)
update public.appointment_notification_jobs j
set group_version = m.group_version
from mapped m
where m.job_id = j.id
  and m.group_version is not null;

do $$
begin
  if exists (
    select 1
    from public.appointment_notification_jobs j
    where j.group_id is not null
      and j.group_version is null
  ) then
    raise exception 'F11_NOTIFICATION_GROUP_VERSION_BACKFILL_FAILED';
  end if;
end
$$;

commit;
