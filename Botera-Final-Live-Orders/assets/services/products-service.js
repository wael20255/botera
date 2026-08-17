// services/products-service — managed from Settings > Products. Every call
// is explicitly scoped to companyId on top of RLS (defense in depth: never
// rely on RLS alone), same pattern as every other service in the app. See
// supabase/07-fixes-team-products.sql for the insert/update/delete
// policies that make writes here actually possible (they used to be
// select-only).
const ProductsService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("products")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // product: { name, sku, price, cost, image_url }
  async function create(companyId, product) {
    const { data, error } = await supabaseClient
      .from("products")
      .insert({ company_id: companyId, status: "active", ...product })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function update(productId, changes) {
    const { data, error } = await supabaseClient
      .from("products")
      .update(changes)
      .eq("id", productId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function remove(productId) {
    // Keep historical Order Items intact; an actual DELETE is blocked by the
    // order_items FK. Removing a product from the catalog therefore archives
    // it by status so it disappears from Settings without corrupting history.
    const { error } = await supabaseClient
      .from("products")
      .update({ status: "inactive", updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (error) throw error;
  }

  return { list, create, update, remove };
})();
