// Insights-only card ordering. Moves existing cards without changing their markup, styles, calculations, or values.
(function () {
  function reorder() {
    const root = document.getElementById("reportsMetrics");
    const hero = root?.querySelector(".insights-kpi-hero");
    const rest = root?.querySelector(".insights-kpi-rest");
    if (!root || !hero || !rest) return false;

    const cards = [...root.querySelectorAll(".metric-card")];
    if (cards.length !== 8) return false;

    const byLabel = new Map(cards.map((card) => [card.querySelector(".kpi-label")?.textContent?.trim(), card]));
    const adCard = byLabel.get("صرف الإعلانات");
    const ordersCard = byLabel.get("عدد الأوردرات");
    const revenueCard = byLabel.get("الإيراد");
    const profitCard = byLabel.get("الأرباح (صافي بعد التسليم)");
    if (!adCard || !ordersCard || !revenueCard || !profitCard) return false;

    // Top row: ad spend + order count.
    hero.replaceChildren(adCard, ordersCard);

    // Second row starts with revenue + net profit; remaining cards keep their existing style.
    rest.replaceChildren(
      revenueCard,
      profitCard,
      ...cards.filter((card) => ![adCard, ordersCard, revenueCard, profitCard].includes(card)),
    );

    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (reorder() || attempts >= 100) clearInterval(timer);
  }, 100);
})();
