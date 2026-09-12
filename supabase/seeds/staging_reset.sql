\set ON_ERROR_STOP on

begin;

delete from public.businesses
where id in (
  'f1700000-0000-4000-8000-000000000001'::uuid,
  'f1700000-0000-4000-8000-000000000002'::uuid
);

commit;
