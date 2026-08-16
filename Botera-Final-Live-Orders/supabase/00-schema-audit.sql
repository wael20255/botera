-- ============================================================================
-- Botera — schema audit (READ-ONLY, safe to run anytime)
-- ============================================================================
-- Run this whole file in Supabase SQL Editor and share the results (all 3
-- result tabs) back. This shows the REAL, current shape of your database —
-- exact column names/types on every table, plus how many rows each table
-- actually has. Nothing here changes any data.
-- ============================================================================

-- 1) Every column on every one of your public tables, in order.
select table_name, ordinal_position as "#", column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- 2) Row count per table — tells us which tables actually have data
--    (and roughly how much), including whatever test data is in there now.
select 'companies' as table_name, count(*) from public.companies
union all select 'profiles', count(*) from public.profiles
union all select 'customers', count(*) from public.customers
union all select 'conversations', count(*) from public.conversations
union all select 'messages', count(*) from public.messages
union all select 'orders', count(*) from public.orders
union all select 'notifications', count(*) from public.notifications
union all select 'products', count(*) from public.products
union all select 'campaigns', count(*) from public.campaigns
union all select 'automation_recommendations', count(*) from public.automation_recommendations
union all select 'integration_status', count(*) from public.integration_status
order by 1;

-- 3) A sample of the actual rows in the two tables most likely to contain
--    manually-entered test data, so we can eyeball what looks fake.
select * from public.orders order by created_at desc limit 40;
