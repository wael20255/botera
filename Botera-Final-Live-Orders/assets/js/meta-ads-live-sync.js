// BOTERA_META_ADS_LIVE_BUILD=20260818-1205
// Live Meta Ads spend sync. Refresh-safe + 60-second polling.
(function () {
  if (window.__boteraMetaAdsLiveSyncStarted) return;
  window.__boteraMetaAdsLiveSyncStarted = true;

  const INTERVAL_MS = 60 * 1000;
  const LOCK_KEY = "botera:meta-ads-live-sync-v4";
  const LOCK_MS = 55 * 1000;
  let timer = null;
  let currentProfile = null;

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

  async function sync(profile, force = false) {
    // supabaseClient/useAuth are global lexical bindings in this classic-script app,
    // not window properties. The previous implementation therefore returned early.
    if (!profile?.company_id) return;
    if (typeof supabaseClient === "undefined" || !supabaseClient?.functions?.invoke) return;
    if (document.hidden && !force) return;
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

  async function getProfileAndSync(force = false) {
    try {
      if (!currentProfile) {
        if (typeof useAuth === "undefined" || !useAuth?.ensureAuthenticated) return;
        currentProfile = await useAuth.ensureAuthenticated();
      }
      if (!currentProfile?.company_id) return;
      await sync(currentProfile, force);
    } catch (error) {
      console.warn("Meta live spend sync refresh failed:", error);
    }
  }

  function start() {
    getProfileAndSync(true); // every fresh page load / hard refresh
    if (timer) clearInterval(timer);
    timer = window.setInterval(() => getProfileAndSync(false), INTERVAL_MS);

    window.addEventListener("pageshow", () => getProfileAndSync(true));
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) getProfileAndSync(true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
