// Keeps the Average Order Value KPI aligned with total sales / total orders.
(function () {
  function renderAov() {
    if (document.body?.dataset?.page !== "insights") return;
    const metrics = window.__boteraInsightsMetrics?.current;
    if (!metrics) return;

    const orders = Number(metrics.ordersCount) || 0;
    const totalSales = Number(metrics.totalSales) || 0;
    const aov = orders > 0 ? totalSales / orders : 0;

    const el = document.querySelector('[data-kpi="aov"]');
    if (el) {
      const currency = window.__boteraInsightsMetrics?.currency || "EGP";
      el.textContent = `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(aov)} ${currency}`;
    }
  }

  const schedule = () => setTimeout(renderAov, 180);
  window.addEventListener("boteradaterangechange", schedule);
  window.addEventListener("boterarealtimechange", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) schedule();
  });
  setTimeout(renderAov, 2200);
})();
