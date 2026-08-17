do $$
begin
  begin alter publication supabase_realtime add table public.campaigns; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.integration_accounts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.integration_status; exception when duplicate_object then null; end;
end $$;