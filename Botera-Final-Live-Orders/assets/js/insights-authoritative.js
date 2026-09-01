// Authoritative Reports engine for Insights.
// All KPIs are calculated from live Supabase data and the current active product costs in Settings.
(function () {
  let running = false;

  const money = (value, currency = "EGP") =>
    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;

  const sum = (list, key) =>
    (list || []).reduce((total, row) => total + (Number(row?.[key]) || 0), 0);

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
    const totalSales = sum(inRange, "total");
    const revenue = sum(delivered, "total");

    const deliveredProductCost = delivered.reduce(
      (total, order) => total + productCostForOrder(order, products.activeById, products.activeByName),
      0,
    );

    const beforeShipping = orderCount ? adSpend / orderCount : 0;
    const afterShipping = deliveryCount ? adSpend / deliveryCount : 0;
    const profit = revenue - (afterShipping * deliveryCount) - deliveredProductCost;
    const aov = orderCount ? totalSales / orderCount : 0;

    return {
      orders: orderCount,
      deliveries: deliveryCount,
      adSpend,
      totalSales,
      revenue,
      beforeShipping,
      afterShipping,
      deliveredProductCost,
      profit,
      aov,
    };
  }

  function ensureMetricCards() {
    const root = document.getElementById("reportsMetrics");
    if (!root || root.dataset.cardsReady === "1") return;

    const heroCards = [
      "صرف الإعلانات",
      "الأرباح (صافي بعد التسليم)",
    ];
    const restCards = [
      "الإيراد",
      "إجمالي المبيعات",
      "عدد الأوردرات",
      "التسليمات",
      "تكلفة الأوردر بعد الشحن",
      "تكلفة الأوردر قبل الشحن",
      "متوسط قيمة الطلب",
    ];

    const cardMarkup = (label) => `
      <article class="card kpi-card metric-card">
        <span class="kpi-label">${label}</span>
        <strong class="kpi-value">—</strong>
        <div class="kpi-delta"><span class="kpi-delta-muted">جاري الحساب...</span></div>
      </article>`;

    root.classList.add("insights-metrics-layout");
    root.innerHTML = `
      <div class="insights-kpi-hero">
        ${heroCards.map(cardMarkup).join("")}
      </div>
      <div class="insights-kpi-rest">
        ${restCards.map(cardMarkup).join("")}
      </div>
    `;

    if (!document.getElementById("boteraInsightsKpiStyle")) {
      const style = document.createElement("style");
      style.id = "boteraInsightsKpiStyle";
      style.textContent = `
        .insights-metrics-layout{display:block!important;margin-bottom:var(--space-6)}
        .insights-kpi-hero{display:flex;justify-content:center;gap:var(--space-5);margin-bottom:var(--space-5)}
        .insights-kpi-hero .metric-card{flex:0 0 calc((100% - 2 * var(--space-5)) / 3)}
        .insights-kpi-rest{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--space-4)}
        .insights-kpi-hero .metric-card,.insights-kpi-rest .metric-card{position:relative;overflow:hidden;border:1px solid var(--color-border);border-radius:20px;background:linear-gradient(145deg,var(--color-surface),var(--color-surface-2));box-shadow:0 12px 30px rgba(0,0,0,.18);transition:transform 160ms ease,box-shadow 160ms ease,border-color 160ms ease}
        .insights-kpi-hero .metric-card{min-height:150px;padding:var(--space-6)}
        .insights-kpi-rest .metric-card{min-height:124px;padding:var(--space-5)}
        .insights-kpi-hero .metric-card:hover,.insights-kpi-rest .metric-card:hover{transform:translateY(-2px);box-shadow:0 16px 34px rgba(0,0,0,.24);border-color:var(--color-neon)}
        .insights-kpi-hero .metric-card:first-child:before,.insights-kpi-hero .metric-card:last-child:before{content:"";position:absolute;inset-inline-start:0;inset-block:0;width:4px;background:var(--color-neon);opacity:.9}
        .insights-kpi-hero .kpi-value{font-size:clamp(1.65rem,2.5vw,2.35rem);margin-top:var(--space-3)}
        .insights-kpi-rest .kpi-value{font-size:clamp(1.2rem,1.7vw,1.55rem)}
        @media (max-width:900px){.insights-kpi-hero .metric-card{flex-basis:calc((100% - var(--space-5)) / 2)}.insights-kpi-rest{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:640px){.insights-kpi-hero{flex-direction:column}.insights-kpi-hero .metric-card{flex-basis:auto;width:100%}.insights-kpi-rest{grid-template-columns:1fr}}
      `;
      document.head.appendChild(style);
    }

    root.dataset.cardsReady = "1";
  }

  function setMetric(label, value, currency, previous) {
    const cards = [...document.querySelectorAll("#reportsMetrics .metric-card")];
    const card = cards.find((item) => item.querySelector(".kpi-label")?.textContent?.trim() === label);
    if (!card) return;
    const valueEl = card.querySelector(".kpi-value");
    const deltaEl = card.querySelector(".kpi-delta");
    if (valueEl) valueEl.textContent = money(value, currency);
    if (deltaEl) {
      if (previous > 0) {
        const change = ((value - previous) / previous) * 100;
        deltaEl.innerHTML = `<span class="${change >= 0 ? "kpi-delta-up" : "kpi-delta-down"}">${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
      } else {
        deltaEl.innerHTML = `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`;
      }
    }
  }

  function setCountMetric(label, value, previous) {
    const cards = [...document.querySelectorAll("#reportsMetrics .metric-card")];
    const card = cards.find((item) => item.querySelector(".kpi-label")?.textContent?.trim() === label);
    if (!card) return;
    const valueEl = card.querySelector(".kpi-value");
    const deltaEl = card.querySelector(".kpi-delta");
    if (valueEl) valueEl.textContent = String(value);
    if (deltaEl) {
      if (previous > 0) {
        const change = ((value - previous) / previous) * 100;
        deltaEl.innerHTML = `<span class="${change >= 0 ? "kpi-delta-up" : "kpi-delta-down"}">${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
      } else {
        deltaEl.innerHTML = `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`;
      }
    }
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
          {
            label: "الإيراد",
            data: revenueSeries,
            borderColor: css.getPropertyValue("--color-chart-teal").trim(),
            backgroundColor: css.getPropertyValue("--color-chart-teal-fill").trim(),
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "صافي الربح بعد التسليم",
            data: profitSeries,
            borderColor: css.getPropertyValue("--color-neon").trim(),
            backgroundColor: css.getPropertyValue("--color-neon-10").trim(),
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
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
      const profile = window.__boteraLiveProfile || await useAuth.ensureAuthenticated({ requiredPermission: "can_view_insights" });
      if (!profile) return;
      setupLayout(profile);
      ensureMetricCards();
      const range = DateRange.getCurrent();
      const previousRange = range.previous;
      const data = await fetchData(profile);
      const current = calculatePeriod(data.orders, data.campaigns, data.ads, data, range);
      const previous = calculatePeriod(data.orders, data.campaigns, data.ads, data, previousRange);
      const currency = data.orders.find((o) => o.currency)?.currency || profile.company?.currency || "EGP";

      setMetric("الإيراد", current.revenue, currency, previous.revenue);
      setMetric("إجمالي المبيعات", current.totalSales, currency, previous.totalSales);
      setMetric("صرف الإعلانات", current.adSpend, currency, previous.adSpend);
      setCountMetric("عدد الأوردرات", current.orders, previous.orders);
      setCountMetric("التسليمات", current.deliveries, previous.deliveries);
      setMetric("تكلفة الأوردر بعد الشحن", current.afterShipping, currency, previous.afterShipping);
      setMetric("الأرباح (صافي بعد التسليم)", current.profit, currency, previous.profit);
      setMetric("متوسط قيمة الطلب", current.aov, currency, previous.aov);
      setMetric("تكلفة الأوردر قبل الشحن", current.beforeShipping, currency, previous.beforeShipping);

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
  setTimeout(render, 1500);
})();
