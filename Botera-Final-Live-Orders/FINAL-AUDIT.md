# Botera Final Finance / Dashboard Audit

## Fixed
- Dashboard KPIs render independently from optional charts so a secondary error cannot blank the real numbers.
- Dashboard uses real orders/customers/conversations and manual ad expenses from Supabase.
- Reports include product cost, shipping cost, manual ad spend, revenue, AOV, order cost and net profit.
- Reports now correctly load previous-period ad expenses.
- Product cost is sourced from `order_items.cost` / `orders.cost_total`.
- Shipping has two modes:
  1. Company absorbs shipping: shipping is a cost and is not added to customer Total.
  2. Customer pays shipping: shipping is added to customer Total and remains a cost in profitability calculations.
- New orders receive the configured default shipping cost automatically.
- Existing historical orders are not rewritten automatically; their recorded shipping value remains authoritative.
- Settings → Products supports product name, SKU, sale price, product cost and full product content/description.
- Settings → Shipping & Ads supports persistent shipping cost and dated manual ad expenses.

## Current production data check
- Existing order revenue: EGP 1,100.
- Existing order product cost: EGP 520.
- Existing recorded shipping: EGP 0 (historical value preserved).
- Manual ad spend recorded: EGP 500.

These values are read from the live Supabase database; the UI must not invent missing values.
