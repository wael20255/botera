// services/team-service — team members. Listing + permission edits go
// straight through Supabase (RLS-protected, see
// supabase/07-fixes-team-products.sql: "team manager can update
// teammates"). Creating a brand-new login has to go through the
// create-team-member Edge Function instead, since that needs the
// service_role key (see that function's own comments for why).
const TeamService = (function () {
  const SELECT_COLUMNS = "id, full_name, role, can_view_conversations, can_view_customers, can_view_orders, can_view_insights, can_view_automation, can_view_settings, can_manage_team, created_at";

  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select(SELECT_COLUMNS)
      .eq("company_id", companyId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  // permissions: any subset of the can_view_*/can_manage_team booleans.
  async function updatePermissions(memberId, permissions) {
    const { error } = await supabaseClient
      .from("profiles")
      .update(permissions)
      .eq("id", memberId);
    if (error) throw error;
  }

  // { fullName, email, password, permissions } -> creates the auth login
  // + their profile row, in the caller's own company.
  async function invite({ fullName, email, password, permissions }) {
    const { data, error } = await supabaseClient.functions.invoke("create-team-member", {
      body: { full_name: fullName, email, password, permissions },
    });
    if (error) {
      // supabase-js surfaces a FunctionsHttpError whose real message is
      // inside the response body, not error.message — read it back out so
      // the person sees the actual reason ("already registered", etc.)
      // instead of a generic "Edge Function returned a non-2xx status".
      let detail = null;
      try { detail = (await error.context?.json?.())?.error; } catch { /* ignore */ }
      throw new Error(detail || data?.error || error.message || "تعذر إضافة العضو.");
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  return { list, updatePermissions, invite };
})();
