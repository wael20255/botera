-- ============================================================================
-- Botera — atomic company registration (run AFTER setup.sql and
-- 02-real-backend.sql)
-- ============================================================================
-- Why this file exists: creating a company row and its owner's profile row
-- as two separate INSERT calls from the browser leaves a real window for a
-- partial failure (company created, profile insert fails on a dropped
-- connection, etc.) with no way to clean it up from the client — the app
-- has no DELETE policy anywhere, on purpose (see supabase/setup.sql).
--
-- The fix is to do both inserts inside ONE Postgres function. Postgres
-- functions are transactional: if anything inside raises, EVERYTHING the
-- function did is rolled back automatically — no client-side cleanup logic
-- needed, and no DELETE policy required either.
-- ============================================================================

-- `role` is a simple, top-level label ('owner' | 'employee') alongside the
-- existing granular can_view_* flags — the two are independent: `role`
-- answers "are they the company's owner", the can_view_* columns answer
-- "which pages can they open".
alter table public.profiles add column if not exists role text not null default 'employee' check (role in ('owner', 'employee'));

create or replace function public.register_company(p_company jsonb, p_full_name text)
returns uuid
language plpgsql
security invoker  -- runs as the calling user, so the existing RLS insert
                   -- policies on companies/profiles still apply as-is.
as $$
declare
  v_company_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  insert into public.companies (name, logo, industry, country, timezone, currency, language)
  values (
    p_company->>'name', p_company->>'logo', p_company->>'industry',
    p_company->>'country', p_company->>'timezone', p_company->>'currency', p_company->>'language'
  )
  returning id into v_company_id;

  insert into public.profiles (
    id, company_id, full_name, role, is_platform_owner,
    can_view_conversations, can_view_customers, can_view_orders,
    can_view_insights, can_view_automation, can_view_settings, can_manage_team
  ) values (
    auth.uid(), v_company_id, p_full_name, 'owner', false,
    true, true, true, true, true, true, true
  );

  return v_company_id;
end;
$$;

-- Anyone signed in may call this — it only ever acts on their own auth.uid(),
-- and the RLS insert policies still gate what it's allowed to write.
grant execute on function public.register_company(jsonb, text) to authenticated;
