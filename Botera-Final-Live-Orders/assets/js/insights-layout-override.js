// Insights KPI presentation + live Meta Ads synchronization.
// Required order: ads + orders, then revenue + net profit, then all remaining cards.
(function () {
  const rootSelector = "#reportsMetrics";
  const labels = { ad: "صرف الإعلانات", orders: "عدد الأوردرات", revenue: "الإيرادات", profit: "صافي الربح", aov: "متوسط قيمة الطلب" };
  let lastMetaSync = 0;

  function cairoToday() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  }

  async function syncMetaLive() {
    const now = Date.now();
    if (now - lastMetaSync < 60000) return;
    lastMetaSync = now;
    try {
      const day = cairoToday();
      const { error } = await supabaseClient.functions.invoke("sync-meta-ads-spend-v2", {
        body: { since: day, until: day }
      });
      if (error) console.error("Meta live spend sync failed:", error);
    } catch (error) {
      console.error("Meta live spend sync failed:", error);
    }
    window.dispatchEvent(new Event("boterarealtimechange"));
  }

  function cardByLabel(text) {
    return [...document.querySelectorAll(`${rootSelector} .metric-card`)].find((card) =>
      card.querySelector(".kpi-label")?.textContent.trim() === text
    );
  }

  function reorder() {
    const root = document.querySelector(rootSelector);
    if (!root) return false;
    const aov = cardByLabel(labels.aov); if (aov) aov.remove();
    const ad = cardByLabel(labels.ad), orders = cardByLabel(labels.orders), revenue = cardByLabel(labels.revenue), profit = cardByLabel(labels.profit);
    if (!ad || !orders || !revenue || !profit) return false;
    const remaining = [...root.querySelectorAll(".metric-card")].filter((card) => ![ad, orders, revenue, profit].includes(card));
    const top = document.createElement("div"); top.className = "insights-kpi-hero insights-kpi-primary"; top.append(ad, orders);
    const second = document.createElement("div"); second.className = "insights-kpi-hero insights-kpi-secondary"; second.append(revenue, profit);
    const rest = document.createElement("div"); rest.className = "insights-kpi-rest"; remaining.forEach((card) => rest.appendChild(card));
    root.replaceChildren(top, second, rest);
    return true;
  }

  function observe() {
    const root = document.querySelector(rootSelector);
    if (!root) return false;
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; observer.disconnect(); reorder(); observer.observe(root, { childList: true, subtree: true }); });
    });
    observer.observe(root, { childList: true, subtree: true });
    setTimeout(reorder, 50);
    return true;
  }

  syncMetaLive();
  setInterval(syncMetaLive, 30000);
  const boot = () => observe() || setTimeout(boot, 100);
  boot();
})();
