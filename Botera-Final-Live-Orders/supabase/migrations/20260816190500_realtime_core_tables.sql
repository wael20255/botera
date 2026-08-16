-- Botera live UI: publish core company-scoped tables to Supabase Realtime.
do $$ begin
  begin alter publication supabase_realtime add table public.conversations; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.customers; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.order_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.products; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.ad_expenses; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shipping_expenses; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.shipping_settings; exception when duplicate_object then null; end;
end $$;
