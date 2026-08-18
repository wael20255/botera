// BOTERA_META_ADS_LIVE_BUILD=20260818-1148
// Live Meta Ads spend sync. Runs independently of page-specific realtime wiring.
(function () {
  if (window.__boteraMetaAdsLiveSyncStarted) return;
  window.__boteraMetaAdsLiveSyncStarted = true;

  const INTERVAL_MS = 60 * 1000;
  const LOCK_KEY = "botera:meta-ads-live-sync-v2";
  const LOCK_MS = 55 * 1000;

  const today = () => new Date().toISOString().slice(0, 10);

  function lock(companyId) {
    try {
      const now = Date.now();
      const current = JSON.parse(localStorage.getItem(LOCK_KEY) || "null");
      if (current?.companyId === companyId && now - Number(current.at || 0) < LOCK_MS) return false;
      localStorage.setItem(LOCK_KEY, JSON.stringify({ companyId, at: now }));
      return true;
    } catch (_) {
      return true;
    }
  }

  async function sync(profile) {
    if (!profile?.company_id || document.hidden || !window.supabaseClient?.functions?.invoke) return;
    if (!lock(profile.company_id)) return;

    try {
      const day = today();
      const result = await supabaseClient.functions.invoke("sync-meta-ads-spend-v2", {
        body: { since: day, until: day },
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

  async function boot() {
    try {
      const profile = await window.useAuth?.ensureAuthenticated?.();
      if (!profile?.company_id) return;

      await sync(profile);
      window.setInterval(() => sync(profile), INTERVAL_MS);
    } catch (error) {
      console.warn("Meta live spend sync boot failed:", error);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
