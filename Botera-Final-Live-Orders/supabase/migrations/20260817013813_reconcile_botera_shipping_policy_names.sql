do $$
begin
  if to_regclass('public.shipping_settings') is not null then
    execute 'drop policy if exists shipping_settings_select on public.shipping_settings';
    execute 'drop policy if exists shipping_settings_write on public.shipping_settings';
  end if;
  if to_regclass('public.shipping_expenses') is not null then
    execute 'drop policy if exists shipping_expenses_select on public.shipping_expenses';
    execute 'drop policy if exists shipping_expenses_write on public.shipping_expenses';
  end if;
  if to_regclass('public.ad_expenses') is not null then
    execute 'drop policy if exists ad_expenses_select on public.ad_expenses';
    execute 'drop policy if exists ad_expenses_write on public.ad_expenses';
  end if;
end $$;