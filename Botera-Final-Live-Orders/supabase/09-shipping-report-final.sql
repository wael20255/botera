-- Final Botera finance/report migration.
-- Adds shipping charge mode and keeps historical order values unchanged.
alter table public.shipping_settings add column if not exists charge_to_customer boolean not null default false;
