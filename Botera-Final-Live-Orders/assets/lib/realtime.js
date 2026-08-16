// Botera realtime bridge: one authenticated Supabase Realtime channel per page.
// Page scripts listen for `boterarealtimechange` and refresh only their data.
(function () {
  if (window.__boteraRealtimeStarted) return;
  window.__boteraRealtimeStarted = true;
  window.__boteraRealtime = null;
  window.startBoteraRealtime = function (profile) {
    if (!profile?.company_id || !window.supabaseClient) return;
    if (window.__boteraRealtime) window.__boteraRealtime.unsubscribe();
    const companyId = profile.company_id;
    const channel = supabaseClient.channel(`botera-live-${companyId}-${Math.random().toString(36).slice(2)}`);
    const dispatch = (payload) => window.dispatchEvent(new CustomEvent("boterarealtimechange", { detail: payload }));
    [
      ["conversations", "company_id"],
      ["customers", "company_id"],
      ["orders", "company_id"],
      ["order_items", "company_id"],
      ["products", "company_id"],
      ["ad_expenses", "company_id"],
      ["shipping_expenses", "company_id"],
      ["shipping_settings", "company_id"],
    ].forEach(([table, column]) => {
      channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `${column}=eq.${companyId}` }, dispatch);
    });
    // Messages inherit company scope through their conversation, so the
    // table itself has no company_id. Supabase Realtime + RLS still controls
    // which rows are delivered to the authenticated client.
    channel.on("postgres_changes", { event: "*", schema: "public", table: "messages" }, dispatch);
    channel.subscribe((status) => dispatch({ event: "SUBSCRIBED", status }));
    window.__boteraRealtime = channel;
  };
})();
