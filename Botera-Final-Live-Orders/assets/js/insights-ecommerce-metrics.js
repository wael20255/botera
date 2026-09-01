// Ecommerce-first authoritative metrics for Botera Reports.
// Source of truth:
// - Orders: delivery/revenue counts from live orders.
// - Products: current active product costs from Settings.
// - Shipping: current shipping_settings.default_cost and return_cost.
// - Ads: campaigns + manual ad expenses.
(function () {
  let running = false;

  const money = (value, currency = "EGP") =>
    `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(value || 0))} ${currency}`;

  const inRange = (value, range) => DateRange.within(value, range);

  async function fetchData(profile) {
    const [ordersResult, productsResult, shippingResult, campaignsResult, adsResult] = await Promise.all([
      supabaseClient.from("orders").select("id,created_at,status,shipping_status,total,currency,order_items(product_id,product_name,quantity)").eq("company_id", profile.company_id),
      supabaseClient.from("products").select("id,name,cost,status,updated_at").eq("company_id", profile.company_id).eq("status", "active").order("updated_at", { ascending: false }),
      supabaseClient.from("shipping_settings").select("default_cost,return_cost,return_shipping_cost,charge_to_customer,active,updated_at").eq("company_id", profile.company_id).eq("active", true).order("updated_at", { ascending: false }).limit(1),
      supabaseClient.from("campaigns").select("spend,created_at").eq("company_id", profile.company_id),
      supabaseClient.from("ad_expenses").select("amount,expense_date").eq("company_id", profile.company_id),
    ]);
    if (ordersResult.error) throw ordersResult.error;
    if (productsResult.error) throw productsResult.error;
    if (shippingResult.error) throw shippingResult.error;
    if (campaignsResult.error) throw campaignsResult.error;
    if (adsResult.error) throw adsResult.error;
    const byId = new Map();
    const byName = new Map();
    for (const p of productsResult.data || []) {
      byId.set(String(p.id), p);
      const n = String(p.name || "").trim().toLowerCase();
      if (n && !byName.has(n)) byName.set(n, p);
    }
    const shipping = shippingResult.data?.[0] || { default_cost: 0, return_cost: 0, return_shipping_cost: 0, charge_to_customer: false };
    return { orders: ordersResult.data || [], productsById: byId, productsByName: byName, shipping, campaigns: campaignsResult.data || [], ads: adsResult.data || [] };
  }

  function adSpend(data, range) {
    const campaigns = data.campaigns.reduce((sum, c) => sum + (inRange(c.created_at, range) ? Number(c.spend) || 0 : 0), 0);
    const manual = data.ads.reduce((sum, a) => sum + (inRange(a.expense_date, range) ? Number(a.amount) || 0 : 0), 0);
    return campaigns + manual;
  }

  function productCostForOrder(order, data) {
    return (order.order_items || []).reduce((sum, item) => {
      const product = data.productsById.get(String(item.product_id || "")) || data.productsByName.get(String(item.product_name || "").trim().toLowerCase());
      const unitCost = Number(product?.cost) || 0;
      const qty = Number(item.quantity) || 1;
      return sum + unitCost * qty;
    }, 0);
  }

  function calculate(data, range) {
    const orders = data.orders.filter((o) => inRange(o.created_at, range));
    const delivered = orders.filter((o) => o.status === "delivered");
    const returned = orders.filter((o) => o.status === "refunded" || o.shipping_status === "returned");
    const ordersCount = orders.length;
    const deliveryCount = delivered.length;
    const returnCount = returned.length;
    const totalSales = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const revenue = delivered.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const ad = adSpend(data, range);
    const productCost = delivered.reduce((sum, o) => sum + productCostForOrder(o, data), 0);
    const shippingPerDelivery = Number(data.shipping.default_cost) || 0;
    const returnCostPerReturn = Number(data.shipping.return_cost) || Number(data.shipping.return_shipping_cost) || 0;
    const deliveredShipping = deliveryCount * shippingPerDelivery;
    const returnCosts = returnCount * returnCostPerReturn;
    const adPerOrder = ordersCount ? ad / ordersCount : 0;
    const adPerDelivery = deliveryCount ? ad / deliveryCount : 0;
    const productPerDelivery = deliveryCount ? productCost / deliveryCount : 0;
    const shippingPerDeliveryMetric = shippingPerDelivery;
    const executionPerDelivery = productPerDelivery + shippingPerDeliveryMetric;
    const fullCostPerDelivery = deliveryCount ? (ad + productCost + deliveredShipping) / deliveryCount : 0;
    const aov = ordersCount ? totalSales / ordersCount : 0;
    const profit = revenue - ad - productCost - deliveredShipping - returnCosts;
    return { ordersCount, deliveryCount, returnCount, totalSales, revenue, ad, productCost, deliveredShipping, returnCosts, adPerOrder, adPerDelivery, productPerDelivery, shippingPerDeliveryMetric, executionPerDelivery, fullCostPerDelivery, aov, profit };
  }

  function buildCards() {
    const root = document.getElementById("reportsMetrics");
    if (!root) return;
    root.innerHTML = `
      <div class="insights-kpi-hero">
        <article class="card kpi-card metric-card"><span class="kpi-label">صرف الإعلانات</span><strong class="kpi-value" data-kpi="ad">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">صافي الربح</span><strong class="kpi-value" data-kpi="profit">—</strong><div class="kpi-delta"></div></article>
      </div>
      <div class="insights-kpi-rest">
        <article class="card kpi-card metric-card"><span class="kpi-label">الإيرادات</span><strong class="kpi-value" data-kpi="revenue">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">إجمالي المبيعات</span><strong class="kpi-value" data-kpi="totalSales">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">عدد الأوردرات</span><strong class="kpi-value" data-kpi="orders">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">التسليمات</span><strong class="kpi-value" data-kpi="deliveries">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">المرتجعات</span><strong class="kpi-value" data-kpi="returns">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">تكلفة الإعلان للأوردر</span><strong class="kpi-value" data-kpi="adPerOrder">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">تكلفة الإعلان للتسليم</span><strong class="kpi-value" data-kpi="adPerDelivery">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">متوسط تكلفة المنتج للتسليم</span><strong class="kpi-value" data-kpi="productPerDelivery">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">متوسط الشحن للتسليم</span><strong class="kpi-value" data-kpi="shippingPerDelivery">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">تكلفة تنفيذ الأوردر المسلم</span><strong class="kpi-value" data-kpi="execution">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">إجمالي تكلفة الأوردر المسلم</span><strong class="kpi-value" data-kpi="fullCost">—</strong><div class="kpi-delta"></div></article>
        <article class="card kpi-card metric-card"><span class="kpi-label">متوسط قيمة الطلب</span><strong class="kpi-value" data-kpi="aov">—</strong><div class="kpi-delta"></div></article>
      </div>`;
  }

  function paint(current, previous, currency) {
    const values = { ad: current.ad, profit: current.profit, revenue: current.revenue, totalSales: current.totalSales, adPerOrder: current.adPerOrder, adPerDelivery: current.adPerDelivery, productPerDelivery: current.productPerDelivery, shippingPerDelivery: current.shippingPerDeliveryMetric, execution: current.executionPerDelivery, fullCost: current.fullCostPerDelivery, aov: current.aov };
    for (const [key, value] of Object.entries(values)) {
      const el = document.querySelector(`[data-kpi="${key}"]`);
      if (el) el.textContent = money(value, currency);
    }
    const counts = { orders: current.ordersCount, deliveries: current.deliveryCount, returns: current.returnCount };
    for (const [key, value] of Object.entries(counts)) {
      const el = document.querySelector(`[data-kpi="${key}"]`);
      if (el) el.textContent = String(value);
    }
    document.querySelectorAll("#reportsMetrics .kpi-delta").forEach((el) => { el.textContent = ""; });
  }

  function renderChart(range, data, currency) {
    const root = document.getElementById("growthChartArea");
    if (!root || typeof Chart === "undefined") return;
    if (window.__boteraAuthoritativeInsightsChart) { window.__boteraAuthoritativeInsightsChart.destroy(); window.__boteraAuthoritativeInsightsChart = null; }
    const buckets = DateRange.buckets(range);
    const revenueSeries = buckets.map((b) => calculate(data, b).revenue);
    const profitSeries = buckets.map((b) => calculate(data, b).profit);
    const total = revenueSeries.reduce((s, v) => s + v, 0);
    if (!total) { root.innerHTML = "<div class='empty-state'><strong>لا توجد بيانات كافية لعرض النمو</strong></div>"; return; }
    root.innerHTML = "<canvas></canvas>";
    const css = getComputedStyle(document.documentElement);
    window.__boteraAuthoritativeInsightsChart = new Chart(root.querySelector("canvas"), { type: "line", data: { labels: buckets.map((b) => b.label), datasets: [
      { label: "الإيرادات", data: revenueSeries, borderColor: css.getPropertyValue("--color-chart-teal").trim(), backgroundColor: css.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
      { label: "صافي الربح", data: profitSeries, borderColor: css.getPropertyValue("--color-neon").trim(), backgroundColor: css.getPropertyValue("--color-neon-10").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
    ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: css.getPropertyValue("--color-text").trim() } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${money(c.parsed.y, currency)}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: css.getPropertyValue("--color-text-faint").trim() } }, y: { grid: { color: css.getPropertyValue("--color-border").trim() }, ticks: { color: css.getPropertyValue("--color-text-faint").trim() } } } } });
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
      buildCards();
      const current = calculate(data, range);
      const previous = calculate(data, previousRange);
      const currency = data.orders.find((o) => o.currency)?.currency || profile.company?.currency || "EGP";
      paint(current, previous, currency);
      renderChart(range, data, currency);
      window.__boteraInsightsMetrics = { current, previous, shipping: data.shipping };
    } catch (error) { console.error("Ecommerce Insights failed:", error); }
    finally { running = false; }
  }

  window.addEventListener("boteradaterangechange", () => setTimeout(render, 60));
  window.addEventListener("boterarealtimechange", () => setTimeout(render, 120));
  window.addEventListener("pageshow", () => setTimeout(render, 120));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(render, 120); });
  setTimeout(render, 1800);
})();
