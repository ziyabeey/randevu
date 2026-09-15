do $$
declare
  v_service public.services;
  v_price integer;
  v_currency text;
begin
  select * into strict v_service
  from public.services
  where id = 'c1230000-0000-4000-8000-000000000001';

  if v_service.price_minor <> 12345
     or v_service.price_type <> 'fixed'
     or v_service.price_min_minor <> 12345
     or v_service.price_max_minor <> 12345
     or v_service.price_policy_version <> 1
     or v_service.currency <> 'TRY'
     or v_service.category <> 'Genel' then
    raise exception 'legacy fixed service was not backfilled losslessly';
  end if;

  select price_minor_snapshot, currency_snapshot
    into strict v_price, v_currency
  from public.appointments
  where id = 'c1260000-0000-4000-8000-000000000001';

  if v_price <> 12345 or v_currency <> 'TRY' then
    raise exception 'historical appointment snapshot changed during F12-03 upgrade';
  end if;
end
$$;
