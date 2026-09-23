begin;

alter type public.stock_movement_kind add value if not exists 'sale';
alter type public.stock_movement_kind add value if not exists 'return';

commit;
