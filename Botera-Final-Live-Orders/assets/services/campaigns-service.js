// services/campaigns-service — ready for when an ad platform (Meta/TikTok/
// Google) is connected; starts empty for every company until then.
const CampaignsService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("campaigns")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  return { list };
})();
