// services/orders-service — orders + the one write action the app allows:
// updating an order's status (see supabase/setup.sql for the RLS policy).
const OrdersService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("*, customers(name, phone, address, city, country), conversations(channel), order_items(product_name, sku, quantity, price, cost, total)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async function updateStatus(orderId, status) {
    const patch = { status, updated_at: new Date().toISOString() };
    if (status === "delivered") patch.shipping_status = "delivered";
    if (status === "refunded") patch.shipping_status = "returned";
    const { data, error } = await supabaseClient
      .from("orders")
      .update(patch)
      .eq("id", orderId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }
  return { list, updateStatus };
})();
