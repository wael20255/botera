(async function init() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_insights" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();

  let allOrders = [], allCampaigns = [], allAdExpenses = [], loaded = false;
  let growthChart = null;

  const metricsEl = document.getElementById("reportsMetrics");
  const growthArea = document.getElementById("growthChartArea");
  const adsReportArea = document.getElementById("adsReportArea");

  function formatMoneyEn(amount, currency = "EGP") {
    return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(amount || 0))} ${currency}`;
  }

  const METRICS = [
    { key: "revenue", label: "الإيراد", money: true },
    { key: "adSpend", label: "صرف الإعلانات", money: true },
    { key: "orders", label: "عدد الأوردرات", money: false },
    { key: "deliveries", label: "التسليمات", money: false },
    { key: "cost", label: "تكلفة الأوردر بعد الشحن", money: true },
    { key: "profit", label: "الأرباح (صافي بعد التسليم)", money: true },
    { key: "aov", label: "متوسط قيمة الطلب", money: true },
    { key: "orderCost", label: "تكلفة الأوردر قبل الشحن", money: true },
  ];

  function renderDelta(current, previous) {
    if (previous <= 0) return `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`;
    const change = ((current - previous) / previous) * 100;
    const up = change >= 0;
    return `<span class="${up ? "kpi-delta-up" : "kpi-delta-down"}">${up ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
  }

  function renderAdsReport(campaigns, manualExpenses, currency) {
    if (!adsReportArea) return;
    if (!campaigns.length && !manualExpenses.length) {
      adsReportArea.innerHTML = emptyState("لا توجد بيانات إعلانات بعد", "أدخل مصروف الإعلانات يدويًا من Settings → Shipping & Ads أو اربط الحساب الإعلاني.");
      return;
    }
    const rows = campaigns.map((c) => {
      const spend = Number(c.spend) || 0;
      const revenue = Number(c.revenue) || 0;
      const impressions = Number(c.impressions) || 0;
      const clicks = Number(c.clicks) || 0;
      const ctr = c.ctr == null ? (impressions ? (clicks / impressions) * 100 : 0) : Number(c.ctr) || 0;
      const cpc = c.cpc == null ? (clicks ? spend / clicks : 0) : Number(c.cpc) || 0;
      const cpm = c.cpm == null ? (impressions ? (spend / impressions) * 1000 : 0) : Number(c.cpm) || 0;
      const roas = c.roas == null ? (spend ? revenue / spend : 0) : Number(c.roas) || 0;
      return `<tr><td>${escapeHtml(c.name || "—")}</td><td>${escapeHtml(c.platform || "—")}</td><td>${formatMoneyEn(spend, currency)}</td><td>${formatMoneyEn(revenue, currency)}</td><td>${impressions.toLocaleString("en-US")}</td><td>${clicks.toLocaleString("en-US")}</td><td>${ctr.toFixed(2)}%</td><td>${formatMoneyEn(cpc, currency)}</td><td>${formatMoneyEn(cpm, currency)}</td><td>${roas.toFixed(2)}x</td></tr>`;
    }).join("");
    const manualRows = manualExpenses.map((e) => `<tr><td>مصروف يدوي</td><td>${escapeHtml(e.platform || "—")}</td><td>${formatMoneyEn(e.amount, currency)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`).join("");
    adsReportArea.innerHTML = `<div style="overflow:auto;"><table class="data-table"><thead><tr><th>الحملة</th><th>المنصة</th><th>الإنفاق</th><th>الإيراد</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>CPC</th><th>CPM</th><th>ROAS</th></tr></thead><tbody>${rows}${manualRows}</tbody></table></div>`;
  }

  function renderMetrics(m) {
    metricsEl.innerHTML = METRICS.map(({ key, label, money }) => {
      const value = money ? formatMoneyEn(m[key], m.currency) : String(m[key]);
      return `<article class="card kpi-card metric-card"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong><div class="kpi-delta">${renderDelta(m[key], m.prev[key])}</div></article>`;
    }).join("");
  }

  function renderGrowthChart(buckets, revenueSeries, profitSeries, currency) {
    if (growthChart) { growthChart.destroy(); growthChart = null; }
    const total = revenueSeries.reduce((s, v) => s + v, 0);
    if (total === 0) {
      growthArea.innerHTML = emptyState("لا توجد بيانات كافية لعرض النمو", "جرّب فترة زمنية أطول من الأعلى.");
      return;
    }
    growthArea.innerHTML = "<canvas></canvas>";
    const css = getComputedStyle(document.documentElement);
    const teal = css.getPropertyValue("--color-chart-teal").trim();
    const tealFill = css.getPropertyValue("--color-chart-teal-fill").trim();
    const neon = css.getPropertyValue("--color-neon").trim();
    const neonFill = css.getPropertyValue("--color-neon-10").trim();
    const muted = css.getPropertyValue("--color-text-faint").trim();
    const border = css.getPropertyValue("--color-border").trim();
    const text = css.getPropertyValue("--color-text").trim();
    growthChart = new Chart(growthArea.querySelector("canvas"), {
      type: "line",
      data: {
        labels: buckets.map((b) => b.label),
        datasets: [
          { label: "الإيراد", data: revenueSeries, borderColor: teal, backgroundColor: tealFill, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
          { label: "صافي الربح بعد التسليم", data: profitSeries, borderColor: neon, backgroundColor: neonFill, fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: text } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatMoneyEn(c.parsed.y, currency)}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: muted } },
          y: { grid: { color: border }, ticks: { color: muted } },
        },
      },
    });
  }

  async function load() {
    try {
      if (!loaded) {
        [allOrders, allCampaigns] = await Promise.all([
          OrdersService.list(profile.company_id),
          CampaignsService.list(profile.company_id).catch((error) => { console.warn("Could not load campaigns:", error); return []; }),
        ]);
        const adResult = await supabaseClient.from("ad_expenses").select("*").eq("company_id", profile.company_id).order("expense_date", { ascending: false });
        if (adResult.error) throw adResult.error;
        allAdExpenses = adResult.data || [];
        loaded = true;
      }

      const range = DateRange.getCurrent();
      const buckets = DateRange.buckets(range);
      const orders = allOrders.filter((o) => DateRange.within(o.created_at, range));
      const prevOrders = allOrders.filter((o) => DateRange.within(o.created_at, range.previous));
      const campaigns = allCampaigns.filter((c) => DateRange.within(c.created_at, range));
      const prevCampaigns = allCampaigns.filter((c) => DateRange.within(c.created_at, range.previous));
      const adExpenses = allAdExpenses.filter((e) => DateRange.within(e.expense_date, range));
      const prevAdExpenses = allAdExpenses.filter((e) => DateRange.within(e.expense_date, range.previous));
      const currency = orders[0]?.currency || allOrders[0]?.currency || "EGP";

      const sum = (list, key) => list.reduce((s, item) => s + (Number(item[key]) || 0), 0);
      const productCostOf = (order) => {
        const direct = Number(order?.cost_total);
        if (Number.isFinite(direct) && direct > 0) return direct;
        const items = Array.isArray(order?.order_items) ? order.order_items : [];
        return items.reduce((s, item) => s + (Number(item?.cost || 0) * Number(item?.quantity || 1)), 0);
      };
      const productCosts = (list) => list.reduce((s, o) => s + productCostOf(o), 0);
      const campaignSpend = (list) => list.reduce((s, c) => s + (Number(c.spend) || 0), 0);
      const manualSpend = (list) => list.reduce((s, e) => s + (Number(e.amount) || 0), 0);
      const adsForPeriod = (campaignList, manualList) => campaignSpend(campaignList) + manualSpend(manualList);

      // Requested business formulas:
      // 1) Cost per order before shipping = ad spend / total orders.
      // 2) Cost per order after shipping = ad spend / delivered orders.
      // 3) Revenue = delivered order totals only.
      // 4) Net profit = delivered revenue - total delivery advertising cost - product cost of delivered orders.
      const calculatePeriod = (orderList, campaignList, manualList) => {
        const delivered = orderList.filter((o) => o.status === "delivered");
        const adSpend = adsForPeriod(campaignList, manualList);
        const orderCount = orderList.length;
        const deliveryCount = delivered.length;
        const beforeShippingPerOrder = orderCount ? adSpend / orderCount : 0;
        const afterShippingPerDelivery = deliveryCount ? adSpend / deliveryCount : 0;
        const revenue = sum(delivered, "total");
        const totalDeliveryAdvertisingCost = afterShippingPerDelivery * deliveryCount;
        const deliveredProductCost = productCosts(delivered);
        const profit = revenue - totalDeliveryAdvertisingCost - deliveredProductCost;
        const aov = deliveryCount ? revenue / deliveryCount : 0;

        return {
          revenue,
          adSpend,
          orders: orderCount,
          deliveries: deliveryCount,
          cost: afterShippingPerDelivery,
          profit,
          aov,
          orderCost: beforeShippingPerOrder,
        };
      };

      const current = calculatePeriod(orders, campaigns, adExpenses);
      const previous = calculatePeriod(prevOrders, prevCampaigns, prevAdExpenses);

      const bucketOrders = (b) => orders.filter((o) => DateRange.within(o.created_at, b));
      const bucketCampaigns = (b) => campaigns.filter((c) => DateRange.within(c.created_at, b));
      const bucketAds = (b) => adExpenses.filter((e) => DateRange.within(e.expense_date, b));
      const revenueSeries = buckets.map((b) => calculatePeriod(bucketOrders(b), bucketCampaigns(b), bucketAds(b)).revenue);
      const profitSeries = buckets.map((b) => calculatePeriod(bucketOrders(b), bucketCampaigns(b), bucketAds(b)).profit);

      renderMetrics({ currency, ...current, prev: previous });
      renderGrowthChart(buckets, revenueSeries, profitSeries, currency);
      renderAdsReport(campaigns, adExpenses, currency);
    } catch (error) {
      console.error("Reports page failed to load:", error);
      metricsEl.innerHTML = errorState("تعذر تحميل التقارير", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
    }
  }

  metricsEl.innerHTML = skeletonBlock("90px", 8);
  await load();
  window.addEventListener("boteradaterangechange", load);
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { loaded = false; load(); }, 180);
  });
})();
