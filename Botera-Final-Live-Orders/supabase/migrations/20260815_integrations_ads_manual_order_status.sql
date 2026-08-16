-- Keep the application schema in sync with the live Supabase project.
alter table public.integration_accounts add column if not exists app_secret text;
alter table public.campaigns add column if not exists impressions bigint not null default 0;
alter table public.campaigns add column if not exists clicks bigint not null default 0;
alter table public.campaigns add column if not exists ctr numeric;
alter table public.campaigns add column if not exists cpc numeric;
alter table public.campaigns add column if not exists cpm numeric;
alter table public.campaigns add column if not exists conversions numeric not null default 0;
alter table public.campaigns add column if not exists ad_account_id text;
