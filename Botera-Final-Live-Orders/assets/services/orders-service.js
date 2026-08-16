// services/orders-service — orders + the one write action the app allows:
// updating an order's status (see supabase/setup.sql for the RLS policy).
//
// Schema note: orders has no `channel` or `items` column of its own —
// channel lives on the linked conversation, and line items live in a
// separate order_items table. Both are pulled here via embeds so the rest
// of the app can just read order.conversations?.channel and
// order.order_items (a real array, not JSON that needs parsing).
const OrdersService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("*, customers(name, phone), conversations(channel), order_items(product_name, sku, quantity, price, cost, total)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async function updateStatus(orderId, status) {
    const { data, error } = await supabaseClient
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", orderId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  return { list, updateStatus };
})();
