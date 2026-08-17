// Insights KPI presentation only.
// Required order: ads + orders, then revenue + net profit, then all remaining cards.
(function () {
  const rootSelector = "#reportsMetrics";
  const labels = {
    ad: "صرف الإعلانات",
    orders: "عدد الأوردرات",
    revenue: "الإيرادات",
    profit: "صافي الربح",
    aov: "متوسط قيمة الطلب",
  };

  function cardByLabel(text) {
    return [...document.querySelectorAll(`${rootSelector} .metric-card`)].find((card) =>
      card.querySelector(".kpi-label")?.textContent.trim() === text
    );
  }

  function reorder() {
    const root = document.querySelector(rootSelector);
    if (!root) return false;

    const aov = cardByLabel(labels.aov);
    if (aov) aov.remove();

    const ad = cardByLabel(labels.ad);
    const orders = cardByLabel(labels.orders);
    const revenue = cardByLabel(labels.revenue);
    const profit = cardByLabel(labels.profit);
    if (!ad || !orders || !revenue || !profit) return false;

    const remaining = [...root.querySelectorAll(".metric-card")].filter(
      (card) => ![ad, orders, revenue, profit].includes(card)
    );

    const top = document.createElement("div");
    top.className = "insights-kpi-hero insights-kpi-primary";
    top.append(ad, orders);

    const second = document.createElement("div");
    second.className = "insights-kpi-hero insights-kpi-secondary";
    second.append(revenue, profit);

    const rest = document.createElement("div");
    rest.className = "insights-kpi-rest";
    remaining.forEach((card) => rest.appendChild(card));

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
      requestAnimationFrame(() => {
        scheduled = false;
        observer.disconnect();
        reorder();
        observer.observe(root, { childList: true, subtree: true });
      });
    });

    observer.observe(root, { childList: true, subtree: true });
    setTimeout(reorder, 50);
    return true;
  }

  const boot = () => observe() || setTimeout(boot, 100);
  boot();
})();
