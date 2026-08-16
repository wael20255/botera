(async function init() {
  const profile = await useAuth.ensureAuthenticated();
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();

  const companyId = profile.company_id;
  const canSeeRevenue = profile.is_platform_owner || profile.can_view_insights;
  if (!canSeeRevenue) document.getElementById("revenueCard")?.remove();

  // Fetched once; every date-range change re-filters this same data
  // client-side instead of re-querying Supabase every time.
  let allCustomers = [], allOrders = [], allConversations = [], allMessages = [], allAdExpenses = [], loaded = false;
  let ordersChartInstance = null, revenueChartInstance = null, profitChartInstance = null;

  ["revenueValue", "ordersValue", "customersValue", "conversionValue"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = skeletonBlock("22px");
  });

  async function load() {
    try {
      if (!loaded) {
        // Load each dataset independently so one optional table (messages/ads)
        // can never blank the entire dashboard. Core business numbers always
        // come from the real orders/customers/conversations tables.
        const safe = async (fn, fallback = []) => {
          try { return await fn(); } catch (error) { console.warn("Dashboard optional dataset failed:", error); return fallback; }
        };
        allCustomers = await safe(() => CustomersService.list(companyId));
        allOrders = await safe(() => OrdersService.list(companyId));
        allConversations = await safe(() => ConversationsService.list(companyId));
        allMessages = await safe(() => MessagesService.listCompany(companyId));
        allAdExpenses = await safe(async () => {
          const { data, error } = await supabaseClient.from("ad_expenses").select("*").eq("company_id", companyId);
          if (error) throw error;
          return data || [];
        });
        loaded = true;
      }
      const range = DateRange.getCurrent();
      const inRange = (dateStr) => DateRange.within(dateStr, range);
      const inPrevRange = (dateStr) => DateRange.within(dateStr, range.previous);

      const orders = allOrders.filter((o) => inRange(o.created_at));
      const prevOrders = allOrders.filter((o) => inPrevRange(o.created_at));
      const validOrders = orders.filter((o) => !["cancelled", "refunded"].includes(o.status));
      console.log("orders", orders);
console.log("validOrders", validOrders);
console.log("totals", orders.map(o => o.total));
      const prevValidOrders = prevOrders.filter((o) => !["cancelled", "refunded"].includes(o.status));
      const customers = allCustomers.filter((c) => inRange(c.created_at));
      const prevCustomers = allCustomers.filter((c) => inPrevRange(c.created_at));
      const conversations = allConversations.filter((c) => c.last_message_at && inRange(c.last_message_at));
      const prevConversations = allConversations.filter((c) => c.last_message_at && inPrevRange(c.last_message_at));
      const messages = allMessages.filter((m) => inRange(m.created_at));
      const prevMessages = allMessages.filter((m) => inPrevRange(m.created_at));
      const adExpenses = allAdExpenses.filter((e) => inRange(e.expense_date));
      const prevAdExpenses = allAdExpenses.filter((e) => inPrevRange(e.expense_date));
      const currency = validOrders[0]?.currency || allOrders[0]?.currency || "EGP";

      // Core KPIs are rendered first and independently. A secondary chart/widget
      // must never prevent the real numbers from appearing.
      renderKpis({ customers, prevCustomers, orders, prevOrders, validOrders, prevValidOrders, conversations, prevConversations, currency });
      const optional = (label, fn) => { try { fn(); } catch (e) { console.warn(`Dashboard ${label} failed:`, e); } };
      optional("revenue chart", () => renderRevenueChart(validOrders, range, currency));
      optional("orders chart", () => renderOrdersChart(orders, range));
      optional("top products", () => renderTopProducts(validOrders));
      optional("recent orders", () => renderRecentOrders(orders, currency));
      optional("profit trend", () => renderProfitTrend(validOrders, prevValidOrders, range, currency, adExpenses, prevAdExpenses));
      optional("average order", () => updateAverageOrder(validOrders, currency));
      optional("conversation sources", () => updateConversationSources(conversations));
      optional("AI stats", () => updateAIStats(messages, orders));
      optional("dashboard header", () => updateDashboardHeader());
    } catch (error) {
      console.error("Dashboard failed to load:", error);
      renderKpis({
        customers: [], prevCustomers: [], orders: [], prevOrders: [],
        validOrders: [], prevValidOrders: [], conversations: [], prevConversations: [], currency: "EGP"
      });
      const empty = document.getElementById("revenueChartEmpty");
      if (empty) empty.innerHTML = emptyState("تعذر تحميل بعض البيانات", "تم تحميل الصفحة بدون كسر الأرقام الأساسية. راجع اتصال Supabase.");
    }
  }

  await load();
  initQuickActions();
  let campaigns = [];
  try { campaigns = await CampaignsService.list(companyId); } catch (e) { /* companyGrowth handles an empty/missing campaigns list the same way */ }
  window.addEventListener("boteradaterangechange", load);
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { loaded = false; load(); }, 180);
  });
})();

function renderDelta(elId, current, previous) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (previous <= 0) { el.innerHTML = `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`; return; }
  const change = ((current - previous) / previous) * 100;
  const up = change >= 0;
  el.innerHTML = `<span class="${up ? "kpi-delta-up" : "kpi-delta-down"}">${up ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
}

function renderKpis({ customers=[], prevCustomers=[], orders=[], prevOrders=[], validOrders=[], prevValidOrders=[], conversations=[], prevConversations=[], currency="EGP" }) {
  const sum = (list) => list.reduce((total, order) => total + Number(order.total || 0), 0);
  const setText = (id, value) => { const el=document.getElementById(id); if (el) el.textContent=value; };
  const revenue=sum(validOrders), previousRevenue=sum(prevValidOrders);
  setText("revenueValue", formatMoney(revenue, currency));
  setText("ordersValue", orders.length.toLocaleString("en-US"));
  setText("customersValue", customers.length.toLocaleString("en-US"));
  const orderConversationIds=new Set(orders.map(o=>o.conversation_id).filter(Boolean));
  const previousConversationIds=new Set(prevOrders.map(o=>o.conversation_id).filter(Boolean));
  const rate=(list,ids)=>list.length ? (list.filter(c=>ids.has(c.id)).length/list.length)*100 : 0;
  const currentRate=rate(conversations,orderConversationIds), previousRate=rate(prevConversations,previousConversationIds);
  setText("conversionValue", conversations.length ? `${currentRate.toFixed(1)}%` : "—");
  renderDelta("revenueDelta", revenue, previousRevenue);
  renderDelta("ordersDelta", orders.length, prevOrders.length);
  renderDelta("customersDelta", customers.length, prevCustomers.length);
  renderDelta("conversionDelta", currentRate, previousRate);
}

// ---- Revenue Overview (real orders, bucketed to fit the selected range) ---
function renderRevenueChart(orders, range, currency) {
  const buckets = DateRange.buckets(range);
  const values = buckets.map((b) => orders.filter((o) => DateRange.within(o.created_at, b)).reduce((s, o) => s + Number(o.total || 0), 0));
  const total = values.reduce((s, v) => s + v, 0);
  document.getElementById("revenueChartTotal").textContent = formatMoney(total, currency);

  const canvas = document.getElementById("revenueChart");
  const emptyBox = document.getElementById("revenueChartEmpty");
  if (total === 0) {
    canvas.classList.add("hidden");
    emptyBox.innerHTML = emptyState("لا توجد إيرادات في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى.");
    return;
  }
  canvas.classList.remove("hidden");
  emptyBox.innerHTML = "";
  if (window.__revenueChartInstance) window.__revenueChartInstance.destroy();
  const style = getComputedStyle(document.documentElement);
  window.__revenueChartInstance = new Chart(canvas, {
    type: "line",
    data: { labels: buckets.map((b) => b.label), datasets: [{ data: values, borderColor: style.getPropertyValue("--color-chart-teal").trim(), backgroundColor: style.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatMoney(c.parsed.y, currency) } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: style.getPropertyValue("--color-text-faint").trim() } },
        y: { grid: { color: style.getPropertyValue("--color-border").trim() }, ticks: { color: style.getPropertyValue("--color-text-faint").trim() } },
      },
    },
  });
}

// ---- Orders Overview --------------------------------------------------------
function renderOrdersChart(orders, range) {
  const buckets = DateRange.buckets(range);
  const values = buckets.map((b) => orders.filter((o) => DateRange.within(o.created_at, b)).length);
  const count = values.reduce((s, v) => s + v, 0);
  document.getElementById("ordersChartTotal").textContent = count;

  const canvas = document.getElementById("ordersChart");
  const emptyBox = document.getElementById("ordersChartEmpty");
  if (count === 0) {
    canvas.classList.add("hidden");
    emptyBox.innerHTML = emptyState("لا توجد طلبات في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى.");
    return;
  }
  canvas.classList.remove("hidden");
  emptyBox.innerHTML = "";
  if (window.__ordersChartInstance) window.__ordersChartInstance.destroy();
  const style = getComputedStyle(document.documentElement);
  window.__ordersChartInstance = new Chart(canvas, {
    type: "bar",
    data: { labels: buckets.map((b) => b.label), datasets: [{ data: values, backgroundColor: style.getPropertyValue("--color-chart-blue").trim(), borderRadius: 4, maxBarThickness: 26 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: style.getPropertyValue("--color-text-faint").trim() } },
        y: { grid: { color: style.getPropertyValue("--color-border").trim() }, ticks: { precision: 0, color: style.getPropertyValue("--color-text-faint").trim() } },
      },
    },
  });
}

// ---- Top Products (aggregated from real orders.items, within range) -------
function renderTopProducts(orders) {
  const counts = new Map();
  orders.forEach((o) => {
    const items = Array.isArray(o.order_items) ? o.order_items : (Array.isArray(o.items) ? o.items : []);
    items.forEach((item) => {
      const name = item.product_name || item.name || "منتج غير مسمى";
      counts.set(name, (counts.get(name) || 0) + Number(item.quantity || 1));
    });
  });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const target = document.getElementById("topProducts");
  if (!top.length) { target.innerHTML = emptyState("لا توجد منتجات في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى."); return; }
  target.innerHTML = top.map(([name, qty]) => `
    <div class="list-row">
      <span class="list-row-icon">📦</span>
      <div><div class="list-row-title">${escapeHtml(name)}</div><div class="list-row-sub">${qty} قطعة مطلوبة</div></div>
      <span class="list-row-meta">${qty}</span>
    </div>`).join("");
}

// ---- Recent Orders table ----------------------------------------------------
function renderRecentOrders(orders, currency) {
  const target = document.getElementById("recentOrders");
  const recent = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 6);
  if (!recent.length) { target.innerHTML = emptyState("لا توجد طلبات في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى."); return; }
  target.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>العميل</th><th>الحالة</th><th>المبلغ</th></tr></thead><tbody>
    ${recent.map((o) => `<tr><td>${formatDate(o.created_at)}</td><td>${escapeHtml(o.customers?.name || "عميل")}</td><td>${statusBadge(o.status)}</td><td>${formatMoney(o.total, o.currency || currency)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

// ---- Company Growth — real, long-term, independent of the date filter -----
// Revenue/Orders/Customers growth and conversion rate are computed for real
// from Supabase data across the company's full history. Profit Growth and
// ROAS need cost data and ad-platform data respectively — until those exist
// for a company, they're shown honestly as "not available yet" rather than
// invented.
function renderCompanyGrowth(companyId, allOrders, allCustomers, allConversations, campaigns) {
  const months = 12;
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    const end = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i) + 1, 1);
    return { label: start.toLocaleDateString("ar-EG", { month: "short", year: "2-digit" }), start, end };
  });
  const validOrders = allOrders.filter((o) => !["cancelled", "refunded"].includes(o.status));
  const revenueSeries = buckets.map((b) => validOrders.filter((o) => new Date(o.created_at) >= b.start && new Date(o.created_at) < b.end).reduce((s, o) => s + Number(o.total || 0), 0));
  const ordersSeries = buckets.map((b) => allOrders.filter((o) => new Date(o.created_at) >= b.start && new Date(o.created_at) < b.end).length);
  const customersSeries = buckets.map((b) => allCustomers.filter((c) => new Date(c.created_at) >= b.start && new Date(c.created_at) < b.end).length);
  const profitSeries = buckets.map((b) => validOrders.filter((o) => new Date(o.created_at) >= b.start && new Date(o.created_at) < b.end).reduce((s, o) => s + (Number(o.total || 0) - Number(o.cost_total || 0)), 0));

  const growthOf = (series) => {
    const nonZero = series.filter((v) => v > 0);
    if (nonZero.length < 2) return null;
    const first = nonZero[0], last = series[series.length - 1];
    return first > 0 ? Math.round(((last - first) / first) * 1000) / 10 : null;
  };
  const revenueGrowth = growthOf(revenueSeries);
  const ordersGrowth = growthOf(ordersSeries);
  const customersGrowth = growthOf(customersSeries);
  const profitGrowth = growthOf(profitSeries);

  const orderConvIds = new Set(allOrders.map((o) => o.conversation_id).filter(Boolean));
  const conversionRate = allConversations.length ? (allConversations.filter((c) => orderConvIds.has(c.id)).length / allConversations.length) * 100 : null;

  // ROAS only exists once an ad platform is actually connected and has
  // spend/revenue on real campaigns — until then this stays honestly "N/A".
  const campaignsWithSpend = (campaigns || []).filter((c) => Number(c.spend) > 0);
  const totalSpend = campaignsWithSpend.reduce((s, c) => s + Number(c.spend || 0), 0);
  const totalAdRevenue = campaignsWithSpend.reduce((s, c) => s + Number(c.revenue || 0), 0);
  const roas = totalSpend > 0 ? Math.round((totalAdRevenue / totalSpend) * 100) / 100 : null;

  const available = [revenueGrowth, ordersGrowth, customersGrowth].filter((v) => v !== null);
  const overallGrowthPct = available.length ? Math.round((available.reduce((s, v) => s + v, 0) / available.length) * 10) / 10 : null;

  let health = "stable", healthMeta = { emoji: "🟡", label: "مستقر", cls: "badge-amber" }, trendText = "مستقر";
  if (overallGrowthPct === null) { healthMeta = { emoji: "···", label: "لا تتوفر بيانات كافية", cls: "badge-muted" }; trendText = "محتاج بيانات أكتر لتحديد الاتجاه"; }
  else if (overallGrowthPct >= 8) { health = "growing"; healthMeta = { emoji: "🟢", label: "في نمو", cls: "badge-neon" }; trendText = "تصاعدي"; }
  else if (overallGrowthPct <= -3) { health = "declining"; healthMeta = { emoji: "🔴", label: "في تراجع", cls: "badge-red" }; trendText = "تراجعي"; }

  const growthValueEl = document.getElementById("growthOverallValue");
  if (growthValueEl) growthValueEl.textContent = overallGrowthPct === null ? "—" : `${overallGrowthPct >= 0 ? "+" : ""}${overallGrowthPct}%`;
  const growthTrendEl = document.getElementById("growthTrendText");
  if (growthTrendEl) growthTrendEl.textContent = `الاتجاه العام: ${trendText} · منذ أول يوم استخدام Botera`;
  const badge = document.getElementById("growthHealthBadge");
  if (badge) { badge.className = `badge ${healthMeta.cls}`; badge.textContent = `${healthMeta.emoji} ${healthMeta.label}`; }

  const hasAnyRevenue = revenueSeries.some((v) => v > 0);
  const canvas = document.getElementById("growthChart");
  if (!canvas) { /* legacy dashboard layout has no growth card */ }
  else if (!hasAnyRevenue) {
    canvas.classList.add("hidden");
    canvas.insertAdjacentHTML("afterend", emptyState("لا توجد بيانات كافية بعد", "المؤشر ده هيتكوّن تلقائيًا مع أول شهرين من الطلبات."));
  } else {
    canvas.classList.remove("hidden");
    const style = getComputedStyle(document.documentElement);
    new Chart(canvas, {
      type: "line",
      data: { labels: buckets.map((b) => b.label), datasets: [{ data: revenueSeries, borderColor: style.getPropertyValue("--color-chart-teal").trim(), backgroundColor: style.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: style.getPropertyValue("--color-text-faint").trim() } },
          y: { grid: { color: style.getPropertyValue("--color-border").trim() }, ticks: { color: style.getPropertyValue("--color-text-faint").trim() } },
        },
      },
    });
  }

  const factor = (label, value, note) => {
    if (value === null) return `<div class="list-row" style="padding:var(--space-2) 0;"><span class="list-row-title" style="font-weight:500;">${label}</span><span class="list-row-meta kpi-delta-muted">${note || "غير متاح بعد"}</span></div>`;
    const up = value >= 0;
    return `<div class="list-row" style="padding:var(--space-2) 0;"><span class="list-row-title" style="font-weight:500;">${label}</span><span class="list-row-meta ${up ? "kpi-delta-up" : "kpi-delta-down"}">${up ? "▲" : "▼"} ${Math.abs(value)}%</span></div>`;
  };
  const growthFactorsEl = document.getElementById("growthFactors");
  if (growthFactorsEl) growthFactorsEl.innerHTML = [
    factor("نمو الإيراد", revenueGrowth),
    factor("نمو الربح", profitGrowth, "محتاج بيانات تكلفة أكتر"),
    factor("نمو الطلبات", ordersGrowth),
    factor("نمو العملاء", customersGrowth),
    factor("معدل التحويل", conversionRate !== null ? Math.round(conversionRate * 10) / 10 : null),
    roas !== null ? `<div class="list-row" style="padding:var(--space-2) 0;"><span class="list-row-title" style="font-weight:500;">ROAS</span><span class="list-row-meta">${roas}x</span></div>` : factor("ROAS", null, "لسه مفيش منصة إعلانات متصلة"),
  ].join("");
}

// ---- Profit Trend — real, follows the global date range --------------------
function renderProfitTrend(validOrders, prevValidOrders, range, currency, adExpenses = [], prevAdExpenses = []) {
  const buckets = DateRange.buckets(range);
  const revenue = buckets.map((b) => validOrders.filter((o) => DateRange.within(o.created_at, b)).reduce((s, o) => s + Number(o.total || 0), 0));
  const cost = buckets.map((b) => validOrders.filter((o) => DateRange.within(o.created_at, b)).reduce((s, o) => s + Number(o.cost_total || 0), 0));
  const shippingTotal = validOrders.reduce((s,o)=>s+Number(o.shipping_cost||0),0);
  const adTotal = adExpenses.reduce((s,e)=>s+Number(e.amount||0),0);
  const profit = buckets.map((b, i) => {
    const ship = validOrders.filter(o=>DateRange.within(o.created_at,b)).reduce((s,o)=>s+Number(o.shipping_cost||0),0);
    const ads = adExpenses.filter(e=>DateRange.within(e.expense_date,b)).reduce((s,e)=>s+Number(e.amount||0),0);
    return revenue[i] - cost[i] - ship - ads;
  });

  const totalRevenue = revenue.reduce((s, v) => s + v, 0);
  const productCost = cost.reduce((s, v) => s + v, 0);
  const totalCost = productCost + shippingTotal + adTotal;
  const totalProfit = totalRevenue - totalCost;
  const marginPct = totalRevenue ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0;
  const prevProductCost = prevValidOrders.reduce((s, o) => s + Number(o.cost_total || 0), 0);
  const prevShipping = prevValidOrders.reduce((s,o)=>s+Number(o.shipping_cost||0),0);
  const prevAds = prevAdExpenses.reduce((s,e)=>s+Number(e.amount||0),0);
  const prevRevenue = prevValidOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const prevProfit = prevRevenue - prevProductCost - prevShipping - prevAds;

  const setProfit = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  setProfit("profitTotalValue", formatMoney(totalProfit, currency));
  setProfit("profitRevenueValue", formatMoney(totalRevenue, currency));
  setProfit("profitExpensesValue", formatMoney(totalCost, currency));
  setProfit("profitNetValue", formatMoney(totalProfit, currency));
  setProfit("profitMarginValue", `${marginPct}%`);
  renderDelta("profitGrowthDelta", totalProfit, prevProfit);

  const canvas = document.getElementById("profitChart");
  if (!canvas) return;
  if (totalRevenue === 0) {
    canvas.classList.add("hidden");
    canvas.insertAdjacentHTML("afterend", emptyState("لا توجد بيانات ربح في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى."));
    return;
  }
  canvas.classList.remove("hidden");
  const style = getComputedStyle(document.documentElement);
  if (window.__profitChartInstance) window.__profitChartInstance.destroy();
  window.__profitChartInstance = new Chart(canvas, {
    type: "line",
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [
        { label: "الإيراد", data: revenue, borderColor: style.getPropertyValue("--color-chart-teal").trim(), backgroundColor: style.getPropertyValue("--color-chart-teal-fill").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
        { label: "المصروفات", data: cost, borderColor: style.getPropertyValue("--color-red").trim(), backgroundColor: style.getPropertyValue("--color-red-10").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
        { label: "صافي الربح", data: profit, borderColor: style.getPropertyValue("--color-neon").trim(), backgroundColor: style.getPropertyValue("--color-neon-10").trim(), fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 10, color: style.getPropertyValue("--color-text-muted").trim(), font: { size: 10 } } } },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 6, color: style.getPropertyValue("--color-text-faint").trim() } },
        y: { grid: { color: style.getPropertyValue("--color-border").trim() }, ticks: { color: style.getPropertyValue("--color-text-faint").trim() } },
      },
    },
  });
}
/* =======================================================
   DASHBOARD EXTRA WIDGETS
======================================================= */

function updateAverageOrder(orders, currency){

    const el=document.getElementById("averageOrderValue");

    if(!el) return;

    if(!orders.length){

        el.textContent="—";

        return;

    }

    const total=orders.reduce(
        (sum,o)=>sum+Number(o.total||0),
        0
    );

    const avg=total/orders.length;

    el.textContent=formatMoney(avg,currency);

}



function updateConversationSources(conversations){

    const map={

        whatsapp:0,

        facebook:0,

        instagram:0,

        website:0

    };



    conversations.forEach(c=>{

        const channel=(

            c.channel ||

            c.platform ||

            ""

        ).toLowerCase();



        if(channel.includes("whatsapp"))

            map.whatsapp++;



        else if(channel.includes("facebook"))

            map.facebook++;



        else if(channel.includes("instagram"))

            map.instagram++;



        else

            map.website++;

    });



    const set=(id,val)=>{

        const el=document.getElementById(id);

        if(el)

            el.textContent=val;

    };



    set("whatsappCount",map.whatsapp);

    set("facebookCount",map.facebook);

    set("instagramCount",map.instagram);

    set("websiteCount",map.website);

}



function updateAIStats(messages, orders){
    const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    const customerMessages=(messages||[]).filter(m=>String(m.sender||"").toLowerCase()==="customer").length;
    const aiReplies=(messages||[]).filter(m=>["ai","bot","agent"].includes(String(m.sender||"").toLowerCase())).length;
    set("aiMessages", customerMessages);
    set("aiReplies", aiReplies);
    set("aiConversions", (orders||[]).filter(o=>!["cancelled","refunded"].includes(o.status)).length);
    const rate=customerMessages ? (aiReplies/customerMessages)*100 : 0;
    set("aiSuccess", customerMessages ? `${Math.min(100,rate).toFixed(1)}%` : "—");
}
/* =======================================================
   Animated Counters
======================================================= */

function animateValue(element,start,end,duration){

    if(!element) return;

    const startTime=performance.now();

    const isMoney=element.textContent.includes("ج");

    function update(now){

        const progress=Math.min(

            (now-startTime)/duration,

            1

        );

        const value=Math.floor(

            start+(end-start)*progress

        );

        if(isMoney){

            element.textContent=

                value.toLocaleString("ar-EG");

        }

        else{

            element.textContent=value;

        }

        if(progress<1){

            requestAnimationFrame(update);

        }

    }

    requestAnimationFrame(update);

}
function updateDashboardHeader() {

    const el = document.getElementById("lastUpdateTime");

    if (!el) return;

    const now = new Date();

    el.textContent = now.toLocaleTimeString("ar-EG", {

        hour: "2-digit",

        minute: "2-digit"

    });

}
/* ==========================================
   QUICK ACTIONS
========================================== */

function initQuickActions() {

    document.getElementById("newOrderBtn")
        ?.addEventListener("click", () => {

            window.location.href = "orders.html";

        });

    document.getElementById("openChatsBtn")
        ?.addEventListener("click", () => {

            window.location.href = "conversations.html";

        });

    document.getElementById("todayReportBtn")
        ?.addEventListener("click", () => {

            alert("هيتم إضافة تقرير اليوم في المرحلة القادمة.");

        });

    document.getElementById("automationBtn")
        ?.addEventListener("click", () => {

            window.location.href = "automation.html";

        });

}