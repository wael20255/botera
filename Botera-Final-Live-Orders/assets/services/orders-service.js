// services/orders-service — order reads, status updates, and the transactional
// order editor write path backed by public.save_order_with_items().
const OrdersService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("orders")
      .select("*, customers(name, phone, address, city, country, email, notes), conversations(channel), order_items(id, product_id, product_name, sku, quantity, price, cost, total)")
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

  async function saveEditor(payload) {
    const { data, error } = await supabaseClient.rpc("save_order_with_items", {
      p_company_id: payload.companyId,
      p_order_id: payload.orderId || null,
      p_customer_id: payload.customerId || null,
      p_customer: payload.customer || {},
      p_order: payload.order || {},
      p_items: payload.items || [],
    });
    if (error) throw error;
    if (!data) throw new Error("تعذر حفظ الأوردر.");
    return data;
  }

  return { list, updateStatus, saveEditor };
})();
