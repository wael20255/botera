// services/customers-service — every call is explicitly scoped to
// companyId on top of RLS (defense in depth: never rely on RLS alone).
const CustomersService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("customers")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  return { list };
})();
