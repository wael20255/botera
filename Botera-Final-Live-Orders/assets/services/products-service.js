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
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  // product: { name, sku, price, cost, image_url }
  async function create(companyId, product) {
    const { data, error } = await supabaseClient
      .from("products")
      .insert({ company_id: companyId, ...product })
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
    const { error } = await supabaseClient.from("products").delete().eq("id", productId);
    if (error) throw error;
  }

  return { list, create, update, remove };
})();
