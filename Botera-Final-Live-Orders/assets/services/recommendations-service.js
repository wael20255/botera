// services/recommendations-service — rows are meant to be written by an
// n8n workflow, but the real RLS policies also allow the owning company's
// own users to update/delete their rows directly (confirmed against the
// live policies), which is what powers the "mark as done" checkbox.
const RecommendationsService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("automation_recommendations")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }
  async function setCompleted(id, completed) {
    const { error } = await supabaseClient
      .from("automation_recommendations")
      .update({ completed })
      .eq("id", id);
    if (error) throw error;
  }
  return { list, setCompleted };
})();
