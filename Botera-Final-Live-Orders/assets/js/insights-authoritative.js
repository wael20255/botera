// Authoritative Reports engine for Insights.
// All KPIs are calculated from live Supabase data and the current active product costs in Settings.
(function () {
  let running = false;

  const money = (value, currency = "EGP") =>
    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;

  const sum = (list, key) =>
    (list || []).reduce((total, row) => total + (Number(row?.[key]) || 0), 0);

  function ensureMetricsMarkup() {
    const root = document.getElementById("reportsMetrics");
    if (!root || root.children.length > 0) return;
    const cards = [
      ["revenue", "الإيراد"],
      ["adSpend", "صرف الإعلانات"],
      ["orders", "عدد الأوردرات"],
      ["deliveries", "التسليمات"],
      ["afterShipping", "تكلفة الأوردر بعد الشحن"],
      ["profit", "الأرباح (صافي بعد التسليم)"],
      ["aov", "متوسط قيمة الطلب"],
      ["beforeShipping", "تكلفة الأوردر قبل الشحن"],
    ];
    root.innerHTML = cards.map(([key, label]) => `
      <article class="card kpi-card metric-card" data-metric="${key}">
        <span class="kpi-label">${label}</span>
        <strong class="kpi-value">—</strong>
        <div class="kpi-delta"><span class="kpi-delta-muted">جاري الحساب...</span></div>
      </article>
    `).join("");
  }

  function setMetric(key, value, currency, previous, isCount = false) {
    const card = document.querySelector(`#reportsMetrics [data-metric="${key}"]`);
    if (!card) return;
    const valueEl = card.querySelector(".kpi-value");
    const deltaEl = card.querySelector(".kpi-delta");
    if (valueEl) valueEl.textContent = isCount ? String(value) : money(value, currency);
    if (deltaEl) {
      if (previous > 0) {
        const change = ((value - previous) / previous) * 100;
        deltaEl.innerHTML = `<span class="${change >= 0 ? "kpi-delta-up" : "kpi-delta-down"}">${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
      } else {
        deltaEl.innerHTML = `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`;
      }
    }
  }

  function productCostForOrder(order, activeById, activeByName) {
    const items = Array.isArray(order?.order_items) ? order.order_items : [];
    return items.reduce((total, item) => {
      const idKey = item?.product_id ? String(item.product_id) : "";
      const nameKey = String(item?.product_name || "").trim();
      const product = activeById.get(idKey) || activeByName.get(nameKey);
      const unitCost = Number(product?.cost);
      const quantity = Number(item?.quantity) || 1;
      return total + (Number.isFinite(unitCost) ? unitCost * quantity : 0);
    }, 0);
  }

  async function fetchData(profile) {
    const [ordersResult, campaignResult, adResult, productsResult] = await Promise.all([
      OrdersService.list(profile.company_id),
      CampaignsService.list(profile.company_id).catch(() => []),
      supabaseClient.from("ad_expenses").select("*").eq("company_id", profile.company_id).order("expense_date", { ascending: false }),
      supabaseClient
        .from("products")
        .select("id,name,cost,status,updated_at")
        .eq("company_id", profile.company_id)
        .eq("status", "active")
        .order("updated_at", { ascending: false }),
    ]);

    if (adResult.error) throw adResult.error;

    const activeById = new Map();
    const activeByName = new Map();
    for (const product of productsResult.data || []) {
      activeById.set(String(product.id), product);
      const name = String(product.name || "").trim();
      if (name && !activeByName.has(name)) activeByName.set(name, product);
    }

    return {
      orders: ordersResult || [],
      campaigns: campaignResult || [],
      ads: adResult.data || [],
      activeById,
      activeByName,
    };
  }

  function adSpendForRange(campaigns, ads, range) {
    const campaignSpend = (campaigns || [])
      .filter((c) => DateRange.within(c.created_at, range))
      .reduce((s, c) => s + (Number(c.spend) || 0), 0);
    const manualSpend = (ads || [])
      .filter((a) => DateRange.within(a.expense_date, range))
      .reduce((s, a) => s + (Number(a.amount) || 0), 0);
    return campaignSpend + manualSpend;
  }

  function calculatePeriod(orders, campaigns, ads, products, range) {
    const inRange = orders.filter((o) => DateRange.within(o.created_at, range));
    const delivered = inRange.filter((o) => o.status === "delivered");
    const adSpend = adSpendForRange(campaigns, ads, range);
    const orderCount = inRange.length;
    const deliveryCount = delivered.length;
    const revenue = sum(delivered, "total");

    const deliveredProductCost = delivered.reduce(
      (total, order) => total + productCostForOrder(order, products.activeById, products.activeByName),
      0,
    );

    const beforeShipping = orderCount ? adSpend / orderCount : 0;
    const afterShipping = deliveryCount ? adSpend / deliveryCount : 0;
    const profit = revenue - (afterShipping * deliveryCount) - deliveredProductCost;
    const aov = deliveryCount ? revenue / deliveryCount : 0;

    return {
      orders: orderCount,
      deliveries: deliveryCount,
      adSpend,
      revenue,
      beforeShipping,
      afterShipping,
      deliveredProductCost,
      profit,
      aov,
    };
  }

  function renderChart(range, orders, campaigns, ads, products, currency) {
    const root = document.getElementById("growthChartArea");
    if (!root || typeof Chart === "undefined") return;
    if (window.__boteraAuthoritativeInsightsChart) {
      window.__boteraAuthoritativeInsightsChart.destroy();
      window.__boteraAuthoritativeInsightsChart = null;
    }

    const buckets = DateRange.buckets(range);
    const revenueSeries = buckets.map((bucket) => calculatePeriod(orders, campaigns, ads, products, bucket).revenue);
    const profitSeries = buckets.map((bucket) => calculatePeriod(orders, campaigns, ads, products, bucket).profit);

    if (revenueSeries.reduce((s, v) => s + v, 0) === 0) {
      root.innerHTML = emptyState("لا توجد بيانات كافية لعرض النمو", "جرّب فترة زمنية أطول من الأعلى.");
      return;
    }

    root.innerHTML = "<canvas></canvas>";
    const css = getComputedStyle(document.documentElement);
    const canvas = root.querySelector("canvas");
    window.__boteraAuthoritativeInsightsChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          { label: "الإيراد", data: revenueSeries, borderColor: css.getPropertyValue("--color-chart-teal").trim(), backgroundColor: css.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { label: "صافي الربح بعد التسليم", data: profitSeries, borderColor: css.getPropertyValue("--color-neon").trim(), backgroundColor: css.getPropertyValue("--color-neon-10").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: css.getPropertyValue("--color-text").trim() } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y, currency)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: css.getPropertyValue("--color-text-faint").trim() } },
          y: { grid: { color: css.getPropertyValue("--color-border").trim() }, ticks: { color: css.getPropertyValue("--color-text-faint").trim() } },
        },
      },
    });
  }

  async function render() {
    if (running || document.body?.dataset?.page !== "insights") return;
    running = true;
    try {
      ensureMetricsMarkup();
      const profile = window.__boteraLiveProfile || await useAuth.ensureAuthenticated({ requiredPermission: "can_view_insights" });
      if (!profile) return;

      const range = DateRange.getCurrent();
      const data = await fetchData(profile);
      const current = calculatePeriod(data.orders, data.campaigns, data.ads, data, range);
      const previous = calculatePeriod(data.orders, data.campaigns, data.ads, data, range.previous);
      const currency = data.orders.find((o) => o.currency)?.currency || profile.company?.currency || "EGP";

      setMetric("revenue", current.revenue, currency, previous.revenue);
      setMetric("adSpend", current.adSpend, currency, previous.adSpend);
      setMetric("orders", current.orders, currency, previous.orders, true);
      setMetric("deliveries", current.deliveries, currency, previous.deliveries, true);
      setMetric("afterShipping", current.afterShipping, currency, previous.afterShipping);
      setMetric("profit", current.profit, currency, previous.profit);
      setMetric("aov", current.aov, currency, previous.aov);
      setMetric("beforeShipping", current.beforeShipping, currency, previous.beforeShipping);

      renderChart(range, data.orders, data.campaigns, data.ads, data, currency);
    } catch (error) {
      console.error("Authoritative Insights failed:", error);
    } finally {
      running = false;
    }
  }

  window.addEventListener("boteradaterangechange", () => setTimeout(render, 50));
  window.addEventListener("boterarealtimechange", () => setTimeout(render, 100));
  window.addEventListener("pageshow", () => setTimeout(render, 100));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(render, 100);
  });
  setTimeout(render, 1200);
})();
