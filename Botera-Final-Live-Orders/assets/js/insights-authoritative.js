// Authoritative Reports engine for Insights.
// All KPIs and the chart are calculated from live Supabase data and the current active product costs in Settings.
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
    const revenue = sum(delivered, "total");

    const deliveredProductCost = delivered.reduce(
      (total, order) => total + productCostForOrder(order, products.activeById, products.activeByName),
      0,
    );

    // Final agreed formulas:
    // before shipping = ad spend / all orders
    // after shipping = ad spend / delivered orders
    // revenue = delivered order totals only
    // profit = revenue - (after-shipping cost * deliveries) - delivered product cost
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

  function renderAdsReport(campaigns, ads, currency, range) {
    const root = document.getElementById("adsReportArea");
    if (!root) return;
    const filteredCampaigns = (campaigns || []).filter((c) => DateRange.within(c.created_at, range));
    const filteredAds = (ads || []).filter((a) => DateRange.within(a.expense_date, range));
    if (!filteredCampaigns.length && !filteredAds.length) {
      root.innerHTML = emptyState("لا توجد بيانات إعلانات بعد", "أدخل مصروف الإعلانات من Settings أو اربط الحساب الإعلاني.");
      return;
    }
    const rows = filteredCampaigns.map((c) => {
      const spend = Number(c.spend) || 0;
      const revenue = Number(c.revenue) || 0;
      const impressions = Number(c.impressions) || 0;
      const clicks = Number(c.clicks) || 0;
      const ctr = c.ctr == null ? (impressions ? (clicks / impressions) * 100 : 0) : Number(c.ctr) || 0;
      const cpc = c.cpc == null ? (clicks ? spend / clicks : 0) : Number(c.cpc) || 0;
      const cpm = c.cpm == null ? (impressions ? (spend / impressions) * 1000 : 0) : Number(c.cpm) || 0;
      const roas = spend ? revenue / spend : 0;
      return `<tr><td>${escapeHtml(c.name || "—")}</td><td>${escapeHtml(c.platform || "—")}</td><td>${money(spend, currency)}</td><td>${money(revenue, currency)}</td><td>${impressions.toLocaleString("en-US")}</td><td>${clicks.toLocaleString("en-US")}</td><td>${ctr.toFixed(2)}%</td><td>${money(cpc, currency)}</td><td>${money(cpm, currency)}</td><td>${roas.toFixed(2)}x</td></tr>`;
    }).join("");
    const manual = filteredAds.map((e) => `<tr><td>مصروف يدوي</td><td>${escapeHtml(e.platform || "—")}</td><td>${money(e.amount, currency)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`).join("");
    root.innerHTML = `<div style="overflow:auto"><table class="data-table"><thead><tr><th>الحملة</th><th>المنصة</th><th>الإنفاق</th><th>الإيراد</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>CPC</th><th>CPM</th><th>ROAS</th></tr></thead><tbody>${rows}${manual}</tbody></table></div>`;
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

      const range = DateRange.getCurrent();
      const previousRange = range.previous;
      const data = await fetchData(profile);
      const current = calculatePeriod(data.orders, data.campaigns, data.ads, data, range);
      const previous = calculatePeriod(data.orders, data.campaigns, data.ads, data, previousRange);
      const currency = data.orders.find((o) => o.currency)?.currency || profile.company?.currency || "EGP";

      setMetric("الإيراد", current.revenue, currency, previous.revenue);
      setMetric("صرف الإعلانات", current.adSpend, currency, previous.adSpend);
      setCountMetric("عدد الأوردرات", current.orders, previous.orders);
      setCountMetric("التسليمات", current.deliveries, previous.deliveries);
      setMetric("تكلفة الأوردر بعد الشحن", current.afterShipping, currency, previous.afterShipping);
      setMetric("الأرباح (صافي بعد التسليم)", current.profit, currency, previous.profit);
      setMetric("متوسط قيمة الطلب", current.aov, currency, previous.aov);
      setMetric("تكلفة الأوردر قبل الشحن", current.beforeShipping, currency, previous.beforeShipping);

      renderAdsReport(data.campaigns, data.ads, currency, range);
      renderChart(range, data.orders, data.campaigns, data.ads, data, currency);
    } catch (error) {
      console.error("Authoritative Insights failed:", error);
    } finally {
      running = false;
    }
  }

  window.addEventListener("boteradaterangechange", () => setTimeout(render, 100));
  window.addEventListener("pageshow", () => setTimeout(render, 150));
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) setTimeout(render, 150);
  });
  setInterval(() => {
    if (!document.hidden) render();
  }, 30000);
  setTimeout(render, 1200);
})();
