-- Botera: restore configurable return-shipping cost and wire it to returned orders.
-- Existing order values are preserved; the trigger only fills the return cost
-- when an order first becomes refunded and no explicit value was already stored.

alter table public.shipping_settings
  add column if not exists return_shipping_cost numeric not null default 0;

alter table public.orders
  add column if not exists return_shipping_cost numeric not null default 0;

create or replace function public.apply_return_shipping_cost()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_return_cost numeric := 0;
begin
  if new.status = 'refunded'
     and (tg_op = 'INSERT' or coalesce(old.status, '') <> 'refunded')
     and coalesce(new.return_shipping_cost, 0) <= 0 then
    select coalesce(return_shipping_cost, 0)
      into v_return_cost
    from public.shipping_settings
    where company_id = new.company_id
    limit 1;

    new.return_shipping_cost := coalesce(v_return_cost, 0);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_apply_return_shipping_cost on public.orders;

create trigger trg_apply_return_shipping_cost
before insert or update of status, return_shipping_cost
on public.orders
for each row
execute function public.apply_return_shipping_cost();
