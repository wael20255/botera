-- Safety fix: avoid referencing OLD during INSERT trigger execution.
create or replace function public.apply_return_shipping_cost()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_return_cost numeric := 0;
begin
  if new.status = 'refunded' and coalesce(new.return_shipping_cost, 0) <= 0 then
    if tg_op = 'INSERT' or old.status is distinct from 'refunded' then
      select coalesce(return_shipping_cost, 0)
        into v_return_cost
      from public.shipping_settings
      where company_id = new.company_id
      limit 1;

      new.return_shipping_cost := coalesce(v_return_cost, 0);
    end if;
  end if;

  return new;
end;
$$;
