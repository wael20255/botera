# Botera Production Audit

## Fixed in this package

1. Removed the unused `integration_status` read from `settings.js`.
   The UI now relies on `integration_accounts` for connection status.
2. Removed the now-dead `integration-status-service.js` browser dependency.
3. Added `supabase/08-production-cleanup.sql` to grant authenticated read access to
   `integration_status` and remove safe redundant indexes.
4. Added the current production Edge Function sources:
   - create-team-member
   - messaging-gateway
   - save-integration-credentials-v2
   - validate-facebook-connection-v2
   - facebook-webhook-v2
   - sync-workflow-messages
5. Removed the obsolete packaged `validate-facebook-connection` function so the
   downloadable project has one canonical Facebook validator.

## Live Supabase findings

- Project is ACTIVE_HEALTHY.
- Facebook webhook verification for `facebook-webhook-v2` returned HTTP 200.
- Latest `save-integration-credentials-v2` calls returned HTTP 200.
- The repeated red error on Settings was correlated with browser requests to
  `integration_status` returning HTTP 403 due missing table SELECT privilege.
- The current live `sync-workflow-messages` endpoint has historical 400/500 failures
  from earlier n8n experiments. It is not required for the new Meta App → webhook
  architecture; the existing n8n reply workflow remains separate.

## Database cleanup decision

The legacy role/permission tables are kept. They are not referenced by the current
browser code, but they may be referenced by historical profile role relationships or
database objects. Destructive deletion without a full dependency graph would be unsafe.

## Important security note

Credentials that were previously pasted into chat/workflow JSON should be rotated.
This package contains no live Meta Page Token or Supabase service-role secret.

## 2026-08-16 final patch

- Restored the Settings > Products tab and the product content/description field.
- Restored Settings > Shipping & Ads as a separate tab.
- Shipping is stored as a single default per-order cost in `shipping_settings` and is copied into each new order by `save_order_from_chat`.
- Manual ad expenses are stored in `ad_expenses` with an explicit date; this is the canonical manual ledger for dashboard expense calculations.
- Fixed the Dashboard crash caused by missing legacy growth/profit elements and an undefined previous-shipping variable.
- Fixed company message loading when a company has zero conversations.
- Facebook webhook now stores Meta echo events as `agent` messages in the customer's existing conversation, so replies sent from the Facebook Page appear in Botera.
- Facebook validation now subscribes to `message_echoes`.
- Facebook/WhatsApp/Instagram incoming customer messages can attempt automatic order creation when the message contains structured name, phone, address and a matching product; the DB function remains the final source of order totals and shipping cost.
