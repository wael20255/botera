-- ============================================================================
-- Botera — Multi-tenant setup (v3)
-- Run this AFTER confirming customers, conversations, messages, and orders
-- already exist. This replaces the old single-tenant admin/employee setup.
-- ============================================================================

-- 1. Companies -----------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- 2. Add company_id to every business table -------------------------------
alter table public.customers add column if not exists company_id uuid references public.companies(id);
alter table public.conversations add column if not exists company_id uuid references public.companies(id);
alter table public.orders add column if not exists company_id uuid references public.companies(id);
-- messages inherit their company through conversation_id — no column needed.

-- 3. Profiles: multi-tenant + granular permissions -------------------------
-- If you already have the old v2 "profiles" table (with a "role" column),
-- drop it first — the shape changed too much for an in-place migration:
--   drop table if exists public.profiles cascade;
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id), -- null only for the platform owner
  full_name text not null,
  is_platform_owner boolean not null default false,
  can_view_conversations boolean not null default true,
  can_view_customers boolean not null default true,
  can_view_orders boolean not null default true,
  can_view_insights boolean not null default false,
  can_view_automation boolean not null default false,
  can_view_settings boolean not null default false,
  can_manage_team boolean not null default false,
  created_at timestamptz not null default now()
);

-- 4. Helper: current user's company_id (used everywhere below) -----------
create or replace function public.current_company_id()
returns uuid language sql stable security definer as $$
  select company_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_platform_owner()
returns boolean language sql stable security definer as $$
  select coalesce((select is_platform_owner from public.profiles where id = auth.uid()), false);
$$;

-- 5. Enable RLS everywhere -------------------------------------------------
alter table public.companies enable row level security;
alter table public.customers enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.orders enable row level security;
alter table public.profiles enable row level security;

-- 6. Read policies: strict company isolation --------------------------------
create policy "own company or platform owner - companies" on public.companies
  for select using (id = public.current_company_id() or public.is_platform_owner());

create policy "own company or platform owner - customers" on public.customers
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

create policy "own company or platform owner - conversations" on public.conversations
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

create policy "own company or platform owner - orders" on public.orders
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

-- messages: isolated through their parent conversation's company_id
create policy "own company or platform owner - messages" on public.messages
  for select using (
    public.is_platform_owner()
    or exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
      and c.company_id = public.current_company_id()
    )
  );

-- profiles: a user can read their own row, plus co-workers if they can manage the team
create policy "own profile" on public.profiles
  for select using (id = auth.uid());
create policy "teammates if can_manage_team" on public.profiles
  for select using (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.can_manage_team)
  );

-- 7. Write policies: same two allowed actions as v2, now company-scoped ----
create policy "update order status - own company" on public.orders
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

create policy "insert reply message - own company" on public.messages
  for insert with check (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
      and c.company_id = public.current_company_id()
    )
  );

create policy "update conversation on reply - own company" on public.conversations
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- Everything else (insert/update/delete on customers, companies, profiles,
-- and any DELETE anywhere) stays blocked by default. Do NOT add more policies.

-- ============================================================================
-- Onboarding a new company + its first user (manual, by the platform owner)
-- ============================================================================
-- 1. insert into public.companies (name) values ('Example Co.') returning id;
-- 2. Supabase Dashboard → Authentication → Add User (email + password)
-- 3. insert into public.profiles
--      (id, company_id, full_name, can_view_insights, can_view_settings, can_manage_team)
--    values
--      ('AUTH_USER_UID', 'COMPANY_ID_FROM_STEP_1', 'Owner Name', true, true, true);
-- 4. Repeat steps 2-3 for every employee in that company (with whichever
--    can_view_* flags they should have — defaults above are sane for a
--    regular employee: conversations/customers/orders yes, insights/settings no).
-- ============================================================================
