-- ============================================================================
-- Botera — automation_recommendations: exactly 3 categories (run AFTER
-- 04-message-attachments.sql)
-- ============================================================================
-- The Automation page is now organized into exactly 3 sections, and each
-- recommendation belongs to exactly one of them via the `category` column.
-- This adds a CHECK constraint (same style as the existing `priority` and
-- `status` columns on this same table) so any workflow/agent writing into
-- this table is forced to use one of the 3 values the UI actually
-- understands — no silent typos, no recommendation quietly not showing up
-- anywhere.
--
-- When you connect your n8n workflow (or any other agent) to write into
-- `automation_recommendations`, set `category` to exactly one of:
--   'Ads'       -> shows in "توصيات الإعلانات" (ad spend, targeting, creatives...)
--   'Growth'    -> shows in "توصيات نمو المشروع" (pricing, offers, ops, funnel...)
--   'Customers' -> shows in "توصيات العملاء" (specific customers/segments and
--                  what to do about their current stage/status)
-- ============================================================================

alter table public.automation_recommendations
  drop constraint if exists automation_recommendations_category_check;

alter table public.automation_recommendations
  add constraint automation_recommendations_category_check
  check (category in ('Ads', 'Growth', 'Customers'));
