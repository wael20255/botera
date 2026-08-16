// services/notifications-service — read-only from the client, same as
// recommendations: meant to be written by a trusted server-side process.
const NotificationsService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("notifications")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw error;
    return data;
  }
  return { list };
})();
