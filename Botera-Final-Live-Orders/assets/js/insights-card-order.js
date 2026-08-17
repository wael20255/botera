// Insights-only card ordering. Moves existing cards without changing their markup, styles, calculations, or values.
(function () {
  function reorder() {
    const root = document.getElementById("reportsMetrics");
    const hero = root?.querySelector(".insights-kpi-hero");
    const rest = root?.querySelector(".insights-kpi-rest");
    if (!root || !hero || !rest) return false;

    const cards = [...root.querySelectorAll(".metric-card")];
    if (!cards.length) return false;

    const byLabel = new Map(cards.map((card) => [card.querySelector(".kpi-label")?.textContent?.trim(), card]));
    const adCard = byLabel.get("صرف الإعلانات");
    const ordersCard = byLabel.get("عدد الأوردرات");
    const revenueCard = byLabel.get("الإيرادات");
    const profitCard = byLabel.get("صافي الربح");
    const averageOrderCard = byLabel.get("متوسط قيمة الطلب");
    if (!adCard || !ordersCard || !revenueCard || !profitCard) return false;

    // Remove Average Order from Insights; it lives on the main Dashboard.
    averageOrderCard?.remove();

    // Top row: ad spend + order count.
    hero.replaceChildren(adCard, ordersCard);

    // Second row: revenue + net profit, then all remaining metrics unchanged.
    const remaining = cards.filter((card) =>
      ![adCard, ordersCard, revenueCard, profitCard, averageOrderCard].includes(card),
    );
    rest.replaceChildren(revenueCard, profitCard, ...remaining);

    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (reorder() || attempts >= 100) clearInterval(timer);
  }, 100);
})();
