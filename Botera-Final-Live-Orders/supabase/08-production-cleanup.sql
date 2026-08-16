-- Botera production cleanup / compatibility migration
-- Safe changes only: fix the UI's authenticated read of integration_status
-- and remove redundant non-unique indexes that duplicate unique indexes.
-- Legacy role tables are intentionally NOT dropped: profiles.role/role_id
-- and historical database objects may still depend on them.

grant usage on schema public to authenticated;
grant select on public.integration_status to authenticated;
revoke insert, update, delete on public.integration_status from anon, authenticated;

-- The unique constraints already provide these indexes; the extra plain
-- indexes only duplicate the same leading keys.
drop index if exists public.idx_permissions_code;
drop index if exists public.idx_roles_name;
drop index if exists public.integration_accounts_company_idx;
