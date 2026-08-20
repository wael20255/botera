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

  const cairoToday = () => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());

  async function fetchData(profile) {
    const [ordersResult, productsResult, shippingResult, campaignsResult, adsResult] = await Promise.all([
      supabaseClient.from("orders").select("id,created_at,status,shipping_status,total,currency,product_id,cost_total,order_items(product_id,product_name,quantity)").eq("company_id", profile.company_id),
      supabaseClient.from("products").select("id,name,price,cost,status,updated_at").eq("company_id", profile.company_id).eq("status", "active").order("updated_at", { ascending: false }),
      supabaseClient.from("shipping_settings").select("default_cost,return_cost,return_shipping_cost,charge_to_customer,active,updated_at").eq("company_id", profile.company_id).eq("active", true).order("updated_at", { ascending: false }).limit(1),
      supabaseClient.from("campaigns").select("spend,created_at").eq("company_id", profile.company_id),
      supabaseClient.from("ad_expenses").select("amount,expense_date,entry_mode,platform,updated_at").eq("company_id", profile.company_id),
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (productsResult.error) throw productsResult.error;
    if (shippingResult.error) throw shippingResult.error;
    if (campaignsResult.error) throw campaignsResult.error;
    if (adsResult.error) throw adsResult.error;

    const byId = new Map(), byName = new Map(), byPrice = new Map();
    for (const p of productsResult.data || []) {
      byId.set(String(p.id), p);
      const n = String(p.name || "").trim().toLowerCase();
      if (n && !byName.has(n)) byName.set(n, p);
      const price = Number(p.price);
      if (Number.isFinite(price) && price > 0 && !byPrice.has(price)) byPrice.set(price, p);
    }

    const shipping = shippingResult.data?.[0] || { default_cost: 0, return_cost: 0, return_shipping_cost: 0, charge_to_customer: false };
    return { orders: ordersResult.data || [], productsById: byId, productsByName: byName, productsByPrice: byPrice, shipping, campaigns: campaignsResult.data || [], ads: adsResult.data || [] };
  }

  function adSpend(data, range) {
    const campaigns = data.campaigns.reduce((sum, c) => sum + (inRange(c.created_at, range) ? Number(c.spend) || 0 : 0), 0);
    const rangedAds = data.ads.filter(a => inRange(a.expense_date, range));
    let manual = rangedAds.reduce((sum, a) => sum + (Number(a.amount) || 0), 0);

    // Meta live spend is stored as a date-only value. Around midnight in Egypt,
    // the database can still be on the previous UTC date while the UI is already
    // on the new Cairo date. If today's range has no live row yet, use the most
    // recently synced live Meta row from the last 36 hours. This keeps the KPI
    // live without changing historical ranges or manual expenses.
    const today = cairoToday();
    if (inRange(today, range)) {
      const liveToday = rangedAds.filter(a => a.entry_mode === "live" && a.platform === "meta");
      if (!liveToday.length) {
        const cutoff = Date.now() - 36 * 60 * 60 * 1000;
        const recentLive = data.ads
          .filter(a => a.entry_mode === "live" && a.platform === "meta" && a.updated_at && new Date(a.updated_at).getTime() >= cutoff)
          .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        if (recentLive.length) manual += Number(recentLive[0].amount) || 0;
      }
    }
    return campaigns + manual;
  }

  function productCostForOrder(order, data) {
    const storedCost = Number(order.cost_total);
    if (Number.isFinite(storedCost) && storedCost > 0) return storedCost;
    const items = Array.isArray(order.order_items) ? order.order_items : [];
    if (items.length) {
      const itemCost = items.reduce((sum, item) => {
        const product = data.productsById.get(String(item.product_id || "")) || data.productsByName.get(String(item.product_name || "").trim().toLowerCase());
        return sum + (Number(product?.cost) || 0) * (Number(item.quantity) || 1);
      }, 0);
      if (itemCost > 0) return itemCost;
    }
    const byPriceProduct = data.productsByPrice.get(Number(order.total));
    return Number(byPriceProduct?.cost) || 0;
  }

  function calculate(data, range) {
    const orders = data.orders.filter(o => inRange(o.created_at, range));
    const delivered = orders.filter(o => o.status === "delivered");
    const returned = orders.filter(o => o.status === "refunded" || o.shipping_status === "returned");
    const ordersCount = orders.length, deliveryCount = delivered.length, returnCount = returned.length;
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
    const executionPerDelivery = productPerDelivery + shippingPerDelivery;
    const fullCostPerDelivery = deliveryCount ? (ad + productCost + deliveredShipping) / deliveryCount : 0;
    const aov = deliveryCount ? revenue / deliveryCount : 0;
    const profit = revenue - ad - productCost - deliveredShipping - returnCosts;
    return { ordersCount, deliveryCount, returnCount, revenue, ad, productCost, deliveredShipping, returnCosts, adPerOrder, adPerDelivery, productPerDelivery, shippingPerDeliveryMetric: shippingPerDelivery, executionPerDelivery, fullCostPerDelivery, aov, profit };
  }

  function buildCards() {
    const root = document.getElementById("reportsMetrics"); if (!root) return;
    root.innerHTML = `<div class="insights-kpi-hero"><article class="card kpi-card metric-card"><span class="kpi-label">صرف الإعلانات</span><strong class="kpi-value" data-kpi="ad">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">صافي الربح</span><strong class="kpi-value" data-kpi="profit">—</strong><div class="kpi-delta"></div></article></div><div class="insights-kpi-rest"><article class="card kpi-card metric-card"><span class="kpi-label">الإيرادات</span><strong class="kpi-value" data-kpi="revenue">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">عدد الأوردرات</span><strong class="kpi-value" data-kpi="orders">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">التسليمات</span><strong class="kpi-value" data-kpi="deliveries">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">المرتجعات</span><strong class="kpi-value" data-kpi="returns">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">تكلفة الإعلان للأوردر</span><strong class="kpi-value" data-kpi="adPerOrder">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">تكلفة الإعلان للتسليم</span><strong class="kpi-value" data-kpi="adPerDelivery">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">متوسط تكلفة المنتج للتسليم</span><strong class="kpi-value" data-kpi="productPerDelivery">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">متوسط الشحن للتسليم</span><strong class="kpi-value" data-kpi="shippingPerDelivery">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">تكلفة تنفيذ الأوردر المسلم</span><strong class="kpi-value" data-kpi="execution">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">إجمالي تكلفة الأوردر المسلم</span><strong class="kpi-value" data-kpi="fullCost">—</strong><div class="kpi-delta"></div></article><article class="card kpi-card metric-card"><span class="kpi-label">متوسط قيمة الطلب</span><strong class="kpi-value" data-kpi="aov">—</strong><div class="kpi-delta"></div></article></div>`;
  }

  function paint(current, previous, currency) {
    const values = { ad: current.ad, profit: current.profit, revenue: current.revenue, adPerOrder: current.adPerOrder, adPerDelivery: current.adPerDelivery, productPerDelivery: current.productPerDelivery, shippingPerDelivery: current.shippingPerDeliveryMetric, execution: current.executionPerDelivery, fullCost: current.fullCostPerDelivery, aov: current.aov };
    for (const [key, value] of Object.entries(values)) { const el = document.querySelector(`[data-kpi="${key}"]`); if (el) el.textContent = money(value, currency); }
    const counts = { orders: current.ordersCount, deliveries: current.deliveryCount, returns: current.returnCount };
    for (const [key, value] of Object.entries(counts)) { const el = document.querySelector(`[data-kpi="${key}"]`); if (el) el.textContent = String(value); }
    document.querySelectorAll("#reportsMetrics .kpi-delta").forEach(el => { el.textContent = ""; });
  }

  function renderChart(range, data, currency) {
    const root = document.getElementById("growthChartArea"); if (!root || typeof Chart === "undefined") return;
    if (window.__boteraAuthoritativeInsightsChart) { window.__boteraAuthoritativeInsightsChart.destroy(); window.__boteraAuthoritativeInsightsChart = null; }
    const buckets = DateRange.buckets(range), revenueSeries = buckets.map(b => calculate(data, b).revenue), profitSeries = buckets.map(b => calculate(data, b).profit), total = revenueSeries.reduce((s, v) => s + v, 0);
    if (!total) { root.innerHTML = "<div class='empty-state'><strong>لا توجد بيانات كافية لعرض النمو</strong></div>"; return; }
    root.innerHTML = "<canvas></canvas>";
    const css = getComputedStyle(document.documentElement);
    window.__boteraAuthoritativeInsightsChart = new Chart(root.querySelector("canvas"), { type: "line", data: { labels: buckets.map(b => b.label), datasets: [{ label: "الإيرادات", data: revenueSeries, borderColor: css.getPropertyValue("--color-chart-teal").trim(), backgroundColor: css.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }, { label: "صافي الربح", data: profitSeries, borderColor: css.getPropertyValue("--color-neon").trim(), backgroundColor: css.getPropertyValue("--color-neon-10").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: css.getPropertyValue("--color-text").trim() } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y, currency)}` } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: css.getPropertyValue("--color-text-faint").trim() } }, y: { grid: { color: css.getPropertyValue("--color-border").trim() }, ticks: { color: css.getPropertyValue("--color-text-faint").trim() } } } } });
  }

  async function render() {
    if (running || document.body?.dataset?.page !== "insights") return;
    running = true;
    try {
      const profile = window.__boteraLiveProfile || await useAuth.ensureAuthenticated({ requiredPermission: "can_view_insights" }); if (!profile) return;
      const range = DateRange.getCurrent(), previousRange = range.previous, data = await fetchData(profile);
      buildCards(); const current = calculate(data, range), previous = calculate(data, previousRange), currency = data.orders.find(o => o.currency)?.currency || profile.company?.currency || "EGP";
      paint(current, previous, currency); renderChart(range, data, currency); window.__boteraInsightsMetrics = { current, previous, shipping: data.shipping };
    } catch (error) { console.error("Ecommerce Insights failed:", error); } finally { running = false; }
  }

  window.addEventListener("boteradaterangechange", () => setTimeout(render, 60));
  window.addEventListener("boterarealtimechange", () => setTimeout(render, 120));
  window.addEventListener("pageshow", () => setTimeout(render, 120));
  document.addEventListener("visibilitychange", () => { if (!document.hidden) setTimeout(render, 120); });
  setTimeout(render, 1800);
})();
