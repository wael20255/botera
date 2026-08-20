// Botera realtime bridge: one authenticated Supabase Realtime channel per page.
// All live project pages listen for `boterarealtimechange` and refresh their own data.
// BUILD: live-sync-20260821-ad-spend-cairo
(function () {
  if (window.__boteraRealtimeStarted) return;
  window.__boteraRealtimeStarted = true;
  window.__boteraRealtime = null;
  window.__boteraAdsLiveSyncTimer = null;

  const AD_SYNC_INTERVAL_MS = 60 * 1000;
  const AD_SYNC_LOCK_MS = 55 * 1000;
  const AD_SYNC_LOCK_KEY = "botera:meta-ads-live-sync";

  // The dashboard/reporting dates are Cairo-local. Using UTC here makes the
  // live Meta spend land on the previous day after midnight in Egypt.
  const todayIso = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  function acquireAdSyncLock(companyId) {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(AD_SYNC_LOCK_KEY);
      const current = raw ? JSON.parse(raw) : null;
      if (current?.companyId === companyId && now - Number(current.at || 0) < AD_SYNC_LOCK_MS) return false;
      localStorage.setItem(AD_SYNC_LOCK_KEY, JSON.stringify({ companyId, at: now }));
      return true;
    } catch (_) {
      return true;
    }
  }

  async function syncMetaAdsSpend(companyId) {
    if (!companyId || document.hidden || !window.supabaseClient?.functions?.invoke) return;
    if (!acquireAdSyncLock(companyId)) return;

    try {
      const day = todayIso();
      const result = await supabaseClient.functions.invoke("sync-meta-ads-spend-v2", {
        body: { company_id: companyId, since: day, until: day },
      });

      if (result?.error || !result?.data?.ok) {
        console.warn("Meta live spend sync failed:", result?.error || result?.data);
        return;
      }

      window.dispatchEvent(new CustomEvent("boterarealtimechange", {
        detail: {
          source: "meta-ads-live-sync",
          spend: result.data.spend,
          currency: result.data.currency,
          last_sync_at: result.data.last_sync_at,
        },
      }));
    } catch (error) {
      console.warn("Meta live spend sync failed:", error);
    }
  }

  window.startBoteraRealtime = function (profile) {
    if (!profile?.company_id || !window.supabaseClient) return;

    if (window.__boteraRealtime) window.__boteraRealtime.unsubscribe();
    if (window.__boteraAdsLiveSyncTimer) clearInterval(window.__boteraAdsLiveSyncTimer);

    const companyId = profile.company_id;
    const channel = supabaseClient.channel(`botera-live-${companyId}-${Math.random().toString(36).slice(2)}`);
    const dispatch = (payload) => window.dispatchEvent(new CustomEvent("boterarealtimechange", { detail: payload }));

    [
      ["conversations", "company_id"],
      ["customers", "company_id"],
      ["orders", "company_id"],
      ["order_items", "company_id"],
      ["products", "company_id"],
      ["campaigns", "company_id"],
      ["ad_expenses", "company_id"],
      ["shipping_expenses", "company_id"],
      ["shipping_settings", "company_id"],
      ["notifications", "company_id"],
    ].forEach(([table, column]) => {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
        filter: `${column}=eq.${companyId}`,
      }, dispatch);
    });

    channel.on("postgres_changes", { event: "*", schema: "public", table: "messages" }, dispatch);
    channel.subscribe((status) => dispatch({ event: "SUBSCRIBED", status }));
    window.__boteraRealtime = channel;

    const runMetaSync = () => syncMetaAdsSpend(companyId);
    runMetaSync();
    window.__boteraAdsLiveSyncTimer = window.setInterval(runMetaSync, AD_SYNC_INTERVAL_MS);
    window.addEventListener("pageshow", runMetaSync);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) runMetaSync();
    });
  };
})();
