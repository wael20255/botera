-- ============================================================================
-- Botera — real integration connection status (run AFTER
-- 05-recommendation-categories.sql)
-- ============================================================================
-- The Settings > Integrations tab currently shows every integration except
-- Supabase as a permanently hard-coded "غير متصل" (not connected) — there is
-- no real signal behind it. This table gives each n8n automation somewhere
-- to report "I ran successfully just now" (a heartbeat), so the page can
-- show real status: connected / stale (hasn't reported in a while) / never
-- connected — instead of a fixed label.
--
-- Each automation upserts exactly one row here every time it runs
-- successfully, matched on `integration` (a fixed key per automation type —
-- see the list below). No new row per run; the same row's `last_run_at`
-- just gets bumped forward.
--
-- Suggested `integration` key per automation (pick whichever you use in the
-- n8n Supabase node's "Create a row" — must match exactly, lowercase):
--   'whatsapp_bot'    -> the sales/reply automation (WhatsApp channel runs)
--   'facebook_bot'    -> the sales/reply automation (Facebook channel runs)
--   'instagram_bot'   -> the sales/reply automation (Instagram channel runs)
--   'ads_report'      -> the ads-report automation
--   'shipping'        -> the shipping automation
-- ============================================================================

create table if not exists public.integration_status (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  integration text not null,
  last_run_at timestamptz not null default now(),
  last_status text not null default 'ok' check (last_status in ('ok', 'error')),
  last_error text,
  created_at timestamptz not null default now(),
  unique (company_id, integration)
);

alter table public.integration_status enable row level security;

-- Anyone in the company (or the platform owner) can read their own
-- integration status — this is what the Settings page queries. Uses a
-- direct subquery against profiles rather than the current_company_id()
-- helper function, since that function already turned out to be missing
-- in this exact database once before (see supabase/04-message-attachments.sql).
create policy "own company or platform owner - integration_status" on public.integration_status
  for select using (
    company_id = (select company_id from public.profiles where id = auth.uid())
    or exists (select 1 from public.profiles where id = auth.uid() and is_platform_owner)
  );

-- No insert/update/select policy for anon/authenticated is granted here on
-- purpose — writes come from n8n's Supabase node using the service_role
-- key (which bypasses RLS entirely), the same trust model already used for
-- automation_recommendations and notifications in this project.
