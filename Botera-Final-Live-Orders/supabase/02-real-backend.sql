-- ============================================================================
-- Botera — Real Supabase Auth + new services (run AFTER supabase/setup.sql)
-- ============================================================================
-- What changed vs. setup.sql:
--   1. Self-serve company registration now goes through real Supabase Auth
--      (supabase.auth.signUp), so `companies` and `profiles` need INSERT
--      policies they didn't have before (previously accounts were only ever
--      created manually from the dashboard by a human).
--   2. Four new tables for the services requested: notifications, products,
--      campaigns, automation_recommendations — all company-isolated, all
--      read-only from the client (nothing to insert from the UI yet; these
--      are meant to be populated by n8n workflows going forward).
--   3. `orders.cost_total` — lets Profit be a real, honest number
--      (revenue − cost_total) instead of a mock. It defaults to 0, so until
--      real cost data is entered, profit will simply equal revenue — which
--      is the honest state, not a fabricated one.
-- ============================================================================

-- 1. Real self-serve registration ------------------------------------------
-- A freshly signed-up auth user has no profile/company yet, so they must be
-- allowed to create exactly their own company and their own profile row.
create policy "authenticated user can create a company" on public.companies
  for insert to authenticated with check (true);

create policy "user can create own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- 2. orders.cost_total -------------------------------------------------------
alter table public.orders add column if not exists cost_total numeric not null default 0;

-- 3. notifications ------------------------------------------------------------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  type text not null,             -- e.g. 'order', 'message', 'system', 'automation'
  title text not null,
  body text,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "own company or platform owner - notifications" on public.notifications
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

-- 4. products ------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  sku text,
  price numeric not null default 0,
  cost numeric not null default 0,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "own company or platform owner - products" on public.products
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

-- 5. campaigns ------------------------------------------------------------------
-- Ready for later ad-platform integration (Meta/TikTok/Google) — not
-- connected yet, so this table will start out empty for every company.
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  platform text,             -- 'meta' | 'tiktok' | 'google' | ...
  status text not null default 'draft',
  budget numeric not null default 0,
  spend numeric not null default 0,
  revenue numeric not null default 0,
  roas numeric,
  start_date date,
  end_date date,
  created_at timestamptz not null default now()
);
alter table public.campaigns enable row level security;
create policy "own company or platform owner - campaigns" on public.campaigns
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

-- 6. automation_recommendations --------------------------------------------
-- Populated by n8n workflows going forward. Starts empty for every company —
-- the Automation Recommendations page must show a real empty state until
-- workflows are connected, not mock cards.
create table if not exists public.automation_recommendations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  title text not null,
  priority text not null check (priority in ('Critical', 'High', 'Medium', 'Low')),
  category text not null,
  recommendation text not null,
  reason text,
  impact text,
  status text not null default 'Pending' check (status in ('Pending', 'Applied', 'Dismissed')),
  confidence int check (confidence between 0 and 100),
  created_at timestamptz not null default now()
);
alter table public.automation_recommendations enable row level security;
create policy "own company or platform owner - recommendations" on public.automation_recommendations
  for select using (company_id = public.current_company_id() or public.is_platform_owner());

-- No INSERT/UPDATE/DELETE policies on the four tables above — they are
-- meant to be written by a trusted server-side process (an n8n workflow
-- using the service_role key, never the public anon key) or added here
-- later once that integration exists.
