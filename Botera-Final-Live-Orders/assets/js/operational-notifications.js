// Botera operational notifications — derived alerts + persisted operational alerts.
(() => {
  if (window.__boteraOperationalNotificationsStarted) return;
  window.__boteraOperationalNotificationsStarted = true;
  const READ_KEY = "botera:operational-notifications:read";
  let profile = null;
  let refreshTimer = null;
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const money = (v, c = "EGP") => `${Number(v || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ${c || "EGP"}`;
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
  const readIds = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || "[]"); } catch { return []; } };
  const saveReadIds = (ids) => { try { localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-200))); } catch {} };
  const daysSince = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now()-t)/86400000)) : 0; };

  async function queryData() {
    const companyId = profile?.company_id;
    if (!companyId || !window.supabaseClient) return { orders: [], customers: [], ads: [], products: [], persisted: [] };
    const day = today().toISOString().slice(0,10);
    const [ordersR, customersR, adsR, productsR, notificationsR] = await Promise.all([
      supabaseClient.from("orders").select("id,order_number,status,shipping_status,total,currency,created_at,customer_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(300),
      supabaseClient.from("customers").select("id,name,phone,stage,created_at,updated_at").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(300),
      supabaseClient.from("ad_expenses").select("expense_date,amount,currency,campaign_name,platform").eq("company_id", companyId).gte("expense_date", day).limit(500),
      supabaseClient.from("products").select("id,name,stock,status").eq("company_id", companyId).eq("status", "active").limit(200),
      supabaseClient.from("notifications").select("id,title,message,type,is_read,created_at").eq("company_id", companyId).neq("type", "ai_action").order("created_at", { ascending: false }).limit(50),
    ]);
    return {
      orders: ordersR.error ? [] : (ordersR.data || []),
      customers: customersR.error ? [] : (customersR.data || []),
      ads: adsR.error ? [] : (adsR.data || []),
      products: productsR.error ? [] : (productsR.data || []),
      persisted: notificationsR.error ? [] : (notificationsR.data || []).map((n) => ({
        id: n.id,
        level: ["critical","error"].includes(String(n.type || "").toLowerCase()) ? "critical" : ["warning","warn"].includes(String(n.type || "").toLowerCase()) ? "warning" : "info",
        title: n.title || "تنبيه من Botera",
        body: n.message || "",
        icon: ["critical","error"].includes(String(n.type || "").toLowerCase()) ? "🔴" : ["warning","warn"].includes(String(n.type || "").toLowerCase()) ? "🟠" : "🔵",
        href: `settings.html?tab=notifications&alert=${encodeURIComponent(n.id)}`,
        is_read: !!n.is_read,
        created_at: n.created_at,
        persisted: true,
      })),
    };
  }

  function buildDerivedAlerts({ orders, customers, ads, products }) {
    const alerts = [];
    const start = today();
    const ordersToday = orders.filter(o => new Date(o.created_at || 0) >= start);
    const valid = o => !["cancelled","refunded","ملغي","مرتجع"].includes(String(o.status || "").toLowerCase());
    const bookedToday = ordersToday.filter(valid).length;
    const spend = ads.reduce((s, a) => s + Number(a.amount || 0), 0);
    const currency = ads[0]?.currency || orders[0]?.currency || "EGP";
    if (spend > 0 && bookedToday === 0) alerts.push({ id:`no-orders:${start.toISOString().slice(0,10)}:${Math.round(spend)}`, level:"critical", title:"صرف إعلاني بدون حجوزات", body:`تم صرف ${money(spend,currency)} اليوم بدون أوردرات مؤكدة.`, href:"settings.html?tab=notifications", icon:"🔴", persisted:false });
    const price = customers.filter(c => c.stage === "price_shown").length;
    if (price >= 10) alerts.push({ id:`price:${price}:${start.toISOString().slice(0,10)}`, level:"warning", title:"عملاء متوقفون عند السعر", body:`${price} عميل في «تم عرض السعر» يحتاج متابعة وتحويل للحجز.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    const pendingOld = orders.filter(o => ["pending","confirmed","قيد الانتظار","مؤكد","قيد التنفيذ"].includes(String(o.status || "")) && daysSince(o.created_at) >= 1).length;
    if (pendingOld >= 3) alerts.push({ id:`pending:${pendingOld}:${start.toISOString().slice(0,10)}`, level:"warning", title:"أوردرات تحتاج متابعة", body:`${pendingOld} أوردر ما زال ينتظر منذ يوم أو أكثر.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    const returns = ordersToday.filter(o => ["refunded","returned","مرتجع","استرجاع"].includes(String(o.status || "").toLowerCase()) || ["returned","مرتجع"].includes(String(o.shipping_status || "").toLowerCase())).length;
    if (returns >= 3) alerts.push({ id:`returns:${returns}:${start.toISOString().slice(0,10)}`, level:"critical", title:"ارتفاع المرتجعات", body:`تم تسجيل ${returns} حالات مرتجع اليوم.`, href:"settings.html?tab=notifications", icon:"🔴", persisted:false });
    const lowStock = products.filter(p => Number.isFinite(Number(p.stock)) && Number(p.stock) <= 5);
    if (lowStock.length) alerts.push({ id:`stock:${lowStock.map(p=>p.id).sort().join(",")}`, level:"warning", title:"مخزون منخفض", body:`${lowStock.length} منتج نشط عند 5 وحدات أو أقل.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    const delivered = orders.filter(o => ["delivered","تم التسليم"].includes(String(o.status || ""))).length;
    const following = customers.filter(c => c.stage === "following").length;
    if (delivered > 0 && following === 0) alerts.push({ id:`followup:${delivered}:${start.toISOString().slice(0,10)}`, level:"info", title:"تحتاج متابعة ما بعد البيع", body:`تم تسليم ${delivered} أوردر ولا توجد حاليًا مرحلة «بيتابع».`, href:"settings.html?tab=notifications", icon:"🔵", persisted:false });
    return alerts;
  }

  function routeToDetails(alert) {
    try { sessionStorage.setItem("botera:selectedOperationalAlert", JSON.stringify(alert)); } catch {}
    const target = alert.persisted
      ? `settings.html?tab=notifications&alert=${encodeURIComponent(alert.id)}`
      : "settings.html?tab=notifications";
    window.location.href = target;
  }

  function ensureUI() {
    if (document.getElementById("boteraNotificationsButton")) return;
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const wrap = document.createElement("div");
    wrap.className = "botera-notifications-wrap";
    wrap.innerHTML = `<button class="botera-notifications-button" id="boteraNotificationsButton" type="button" aria-label="التنبيهات" aria-expanded="false"><span class="botera-notifications-icon">🔔</span><span class="botera-notifications-count hidden" id="boteraNotificationsCount">0</span></button><div class="botera-notifications-panel hidden" id="boteraNotificationsPanel"><div class="botera-notifications-head"><div><strong>التنبيهات</strong><small>افتح أي تنبيه لعرض التفاصيل داخل صفحة Notifications</small></div><button class="btn-secondary btn-sm" id="boteraNotificationsReadAll" type="button">تحديد الكل كمقروء</button></div><div class="botera-notifications-list" id="boteraNotificationsList"></div></div>`;
    const workspace = document.getElementById("workspaceChip");
    if (workspace) topbar.insertBefore(wrap, workspace); else topbar.appendChild(wrap);
    document.getElementById("boteraNotificationsButton")?.addEventListener("click", e => { e.stopPropagation(); const p = document.getElementById("boteraNotificationsPanel"); const b = document.getElementById("boteraNotificationsButton"); const closed = p.classList.toggle("hidden"); b.setAttribute("aria-expanded", closed ? "false" : "true"); });
    document.getElementById("boteraNotificationsReadAll")?.addEventListener("click", () => { const alerts = window.__boteraOperationalAlerts || []; saveReadIds(alerts.map(a=>a.id)); render(alerts); });
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) { document.getElementById("boteraNotificationsPanel")?.classList.add("hidden"); document.getElementById("boteraNotificationsButton")?.setAttribute("aria-expanded","false"); } });
  }

  function render(alerts) {
    window.__boteraOperationalAlerts = alerts;
    ensureUI();
    const list = document.getElementById("boteraNotificationsList");
    const count = document.getElementById("boteraNotificationsCount");
    if (!list || !count) return;
    const read = new Set(readIds());
    const unread = alerts.filter(a => !a.is_read && !read.has(a.id)).length;
    count.textContent = String(unread);
    count.classList.toggle("hidden", unread === 0);
    list.innerHTML = alerts.length ? alerts.map(a => `<button class="botera-notification-item ${a.is_read || read.has(a.id)?"is-read":""}" data-id="${esc(a.id)}" type="button"><span class="botera-notification-dot botera-notification-${esc(a.level)}">${esc(a.icon)}</span><span class="botera-notification-copy"><strong>${esc(a.title)}</strong><small>${esc(a.body)}</small></span></button>`).join("") : `<div class="botera-notifications-empty">لا توجد تنبيهات تحتاج انتباهك الآن ✅</div>`;
    list.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => {
      const alert = alerts.find(a => a.id === b.dataset.id);
      if (!alert) return;
      const ids = new Set(readIds()); ids.add(alert.id); saveReadIds([...ids]);
      routeToDetails(alert);
    }));
  }

  async function refresh() {
    if (!profile) return;
    try {
      const data = await queryData();
      const derived = buildDerivedAlerts(data);
      const persisted = data.persisted || [];
      const seen = new Set();
      const merged = [...persisted, ...derived].filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).slice(0, 30);
      merged.sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      render(merged);
    } catch (e) { console.warn("Operational notifications failed:", e); }
  }
  async function init() {
    profile = window.__boteraLiveProfile || null;
    if (!profile) return;
    ensureUI();
    await refresh();
    window.addEventListener("boterarealtimechange", () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); });
    window.addEventListener("pageshow", refresh);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true }); else init();
})();
