-- ============================================================================
-- Botera — critical fixes + team management + products (run AFTER
-- 06-integration-status.sql)
-- ============================================================================
-- This file fixes two real bugs found in the live schema, and adds the
-- write access needed for two new features (team management, products).
--
-- BUG FIX #1 (critical — this is why "creating a new company does nothing"):
--   register.js / auth-service.js send { name, logo, industry, country,
--   timezone, currency, language } to the register_company() SQL function
--   (supabase/03-register-transaction.sql), which inserts all seven fields
--   into public.companies. But supabase/setup.sql only ever created
--   companies with (id, name, created_at) — the other six columns never
--   existed. Every single call to register_company() was failing on
--   "column ... does not exist", the whole transaction was rolling back,
--   and the user just saw a generic error with nothing created anywhere.
--   This adds the missing columns so the existing registration code (which
--   was already correct) finally has somewhere to write.
--
-- BUG FIX #2: assets/js/automation.js and services/recommendations-service.js
--   read/write a boolean `completed` column on automation_recommendations
--   for the "mark as done" checkbox — but that column was never created
--   (only `status` exists), and there was no UPDATE policy for it either.
--   Every click silently failed (caught and only console.error'd — see
--   automation.js toggleCompleted). This adds the column and a policy that
--   lets a company's own users toggle their own recommendations.
--
-- NEW FEATURE: owner/team-manager can create teammates + edit their
--   permissions (see supabase/functions/create-team-member for the part
--   that needs a service_role key — creating an auth user can't be done
--   with an anon key or a plain SQL policy).
--
-- NEW FEATURE: products become writable from Settings (previously
--   select-only — see products-service.js).
-- ============================================================================

-- 1. Fix companies — add every column register_company() already expects ---
alter table public.companies add column if not exists logo text;
alter table public.companies add column if not exists industry text;
alter table public.companies add column if not exists country text;
alter table public.companies add column if not exists timezone text;
alter table public.companies add column if not exists currency text not null default 'EGP';
alter table public.companies add column if not exists language text not null default 'ar';

-- 2. Fix automation_recommendations — add the missing `completed` column
--    used by the "mark as done" checkbox, and let a company's own users
--    toggle it (n8n/service_role can still write everything else).
alter table public.automation_recommendations add column if not exists completed boolean not null default false;

drop policy if exists "own company can toggle completed - recommendations" on public.automation_recommendations;
create policy "own company can toggle completed - recommendations" on public.automation_recommendations
  for update using (company_id = public.current_company_id())
  with check (company_id = public.current_company_id());

-- 3. orders.shipping_cost — insights.js already sums this into real cost/
--    profit calculations (costOf/totalCostOf/netProfitOf); the column just
--    never existed, so it silently contributed 0 everywhere. Adding it
--    makes that number real instead of permanently zero.
alter table public.orders add column if not exists shipping_cost numeric not null default 0;

-- 4. Team management -----------------------------------------------------
-- A user with can_manage_team = true (or the platform owner) may update
-- teammates' role/can_view_*/can_manage_team columns within their own
-- company. The client (assets/services/team-service.js) only ever sends
-- those specific columns — never id/company_id — but this policy is the
-- real enforcement boundary regardless of what the client sends.
drop policy if exists "team manager can update teammates" on public.profiles;
create policy "team manager can update teammates" on public.profiles
  for update using (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.can_manage_team)
  )
  with check (
    company_id = public.current_company_id()
  );

-- Creating the actual teammate (an auth.users row + their profile row) is
-- NOT done here — see supabase/functions/create-team-member. Inserting an
-- auth user requires the admin API (service_role), which must never run in
-- the browser, so that step is a Supabase Edge Function instead of a
-- client-side insert + RLS policy.

-- 5. Fix Orders page visibility: order_items was missing a SELECT policy.
-- OrdersService embeds order_items in its main query; without this policy
-- PostgREST can reject the whole orders query, which also made Settings
-- incorrectly report the database as "غير متصل" because it tests OrdersService.

grant select on public.order_items to authenticated;
drop policy if exists "own company - order_items" on public.order_items;
create policy "own company - order_items" on public.order_items
  for select to authenticated
  using (company_id = public.current_company_id());

-- 6. Products become writable from Settings ------------------------------
-- Previously select-only (see the original comment in 02-real-backend.sql).
-- Gated on can_view_settings, same permission that already gates the
-- Settings page itself where the Products tab lives.
drop policy if exists "settings users can insert - products" on public.products;
create policy "settings users can insert - products" on public.products
  for insert to authenticated with check (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.can_view_settings or p.is_platform_owner))
  );

drop policy if exists "settings users can update - products" on public.products;
create policy "settings users can update - products" on public.products
  for update using (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.can_view_settings or p.is_platform_owner))
  )
  with check (company_id = public.current_company_id());

drop policy if exists "settings users can delete - products" on public.products;
create policy "settings users can delete - products" on public.products
  for delete using (
    company_id = public.current_company_id()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.can_view_settings or p.is_platform_owner))
  );
