// services/orders-service — order reads, status updates, and UI editor writes.
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
    const customerOrderName = String(payload.order?.customer_order_name || "").trim();
    const orderData = {
      ...payload.order,
      // The customer name must match the name used on the order.
      name: customerOrderName || payload.customer?.name || "",
      customer_id: payload.customerId || "",
      phone: payload.customer?.phone || "",
      email: payload.customer?.email || "",
      country: payload.customer?.country || "",
      city: payload.customer?.city || "",
      address: payload.customer?.address || "",
      notes: payload.customer?.notes || "",
      items: payload.items || [],
    };

    const rpcName = payload.orderId ? "update_order_from_ui" : "create_order_from_ui";
    const rpcArgs = payload.orderId
      ? { p_order_id: payload.orderId, p_patch: orderData }
      : { p_order: orderData };

    const { data, error } = await supabaseClient.rpc(rpcName, rpcArgs);
    if (error) throw error;
    if (!data?.ok) throw new Error("تعذر حفظ الأوردر.");
    return data;
  }

  async function deleteOrder(orderId) {
    const { data, error } = await supabaseClient.rpc("delete_order_from_ui", {
      p_order_id: orderId,
    });
    if (error) throw error;
    if (!data?.ok) throw new Error("تعذر حذف الأوردر.");
    return data;
  }

  return { list, updateStatus, saveEditor, deleteOrder };
})();
