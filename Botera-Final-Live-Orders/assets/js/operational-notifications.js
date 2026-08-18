// Botera global notifications bell — real DB notifications + live operational checks.
(() => {
  if (window.__boteraOperationalNotificationsStarted) return;
  window.__boteraOperationalNotificationsStarted = true;
  const READ_KEY = "botera:operational-notifications:read";
  let profile = null;
  let refreshTimer = null;
  let bootTimer = null;
  const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const money = (v, c = "EGP") => `${Number(v || 0).toLocaleString("ar-EG", { maximumFractionDigits: 0 })} ${c || "EGP"}`;
  const today = () => { const d = new Date(); d.setHours(0,0,0,0); return d; };
  const readIds = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || "[]"); } catch { return []; } };
  const saveReadIds = (ids) => { try { localStorage.setItem(READ_KEY, JSON.stringify(ids.slice(-200))); } catch {} };
  const daysSince = (v) => { const t = new Date(v || 0).getTime(); return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now()-t)/86400000)) : 0; };
  const levelForType = (type) => {
    const t = String(type || "info").toLowerCase();
    if (["critical","error","urgent"].includes(t)) return "critical";
    if (["warning","warn","attention"].includes(t)) return "warning";
    return "info";
  };
  const hasSupabase = () => typeof supabaseClient !== "undefined" && !!supabaseClient;

  async function queryData() {
    const companyId = profile?.company_id;
    if (!companyId || !hasSupabase()) return { orders: [], customers: [], ads: [], products: [], persisted: [] };
    const day = today().toISOString().slice(0,10);
    const [ordersR, customersR, adsR, productsR, notificationsR] = await Promise.all([
      supabaseClient.from("orders").select("id,order_number,status,shipping_status,total,currency,created_at,customer_id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(300),
      supabaseClient.from("customers").select("id,name,phone,stage,created_at,updated_at").eq("company_id", companyId).order("updated_at", { ascending: false }).limit(300),
      supabaseClient.from("ad_expenses").select("expense_date,amount,currency,campaign_name,platform").eq("company_id", companyId).gte("expense_date", day).limit(500),
      supabaseClient.from("products").select("id,name,stock,status").eq("company_id", companyId).eq("status", "active").limit(200),
      supabaseClient.from("notifications").select("id,title,message,type,is_read,created_at").eq("company_id", companyId).not("type", "in", "(ai_action,ai_error)").order("created_at", { ascending: false }).limit(50),
    ]);
    return {
      orders: ordersR.error ? [] : (ordersR.data || []),
      customers: customersR.error ? [] : (customersR.data || []),
      ads: adsR.error ? [] : (adsR.data || []),
      products: productsR.error ? [] : (productsR.data || []),
      persisted: notificationsR.error ? [] : (notificationsR.data || []).map((n) => ({
        id: `db:${n.id}`,
        sourceId: n.id,
        level: levelForType(n.type),
        title: n.title || "تنبيه من Botera",
        body: n.message || "",
        icon: levelForType(n.type) === "critical" ? "🔴" : levelForType(n.type) === "warning" ? "🟠" : "🔵",
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
    if (spend > 0 && bookedToday === 0) alerts.push({ id:`rule:no-orders:${start.toISOString().slice(0,10)}`, level:"critical", title:"صرف إعلاني بدون حجوزات", body:`تم صرف ${money(spend,currency)} اليوم بدون أوردرات مؤكدة.`, href:"settings.html?tab=notifications", icon:"🔴", persisted:false });
    const price = customers.filter(c => c.stage === "price_shown").length;
    if (price >= 10) alerts.push({ id:`rule:price:${start.toISOString().slice(0,10)}`, level:"warning", title:"عملاء متوقفون عند السعر", body:`${price} عميل في «تم عرض السعر» يحتاج متابعة وتحويل للحجز.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    const pendingOld = orders.filter(o => ["pending","confirmed","قيد الانتظار","مؤكد","قيد التنفيذ"].includes(String(o.status || "")) && daysSince(o.created_at) >= 1).length;
    if (pendingOld >= 3) alerts.push({ id:`rule:pending:${start.toISOString().slice(0,10)}`, level:"warning", title:"أوردرات تحتاج متابعة", body:`${pendingOld} أوردر ما زال ينتظر منذ يوم أو أكثر.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    const returns = ordersToday.filter(o => ["refunded","returned","مرتجع","استرجاع"].includes(String(o.status || "").toLowerCase()) || ["returned","مرتجع"].includes(String(o.shipping_status || "").toLowerCase())).length;
    if (returns >= 3) alerts.push({ id:`rule:returns:${start.toISOString().slice(0,10)}`, level:"critical", title:"ارتفاع المرتجعات", body:`تم تسجيل ${returns} حالات مرتجع اليوم.`, href:"settings.html?tab=notifications", icon:"🔴", persisted:false });
    const lowStock = products.filter(p => Number.isFinite(Number(p.stock)) && Number(p.stock) <= 5);
    if (lowStock.length) alerts.push({ id:`rule:stock:${lowStock.map(p=>p.id).sort().join(",")}`, level:"warning", title:"مخزون منخفض", body:`${lowStock.length} منتج نشط عند 5 وحدات أو أقل.`, href:"settings.html?tab=notifications", icon:"🟠", persisted:false });
    return alerts;
  }

  function routeToDetails(alert) {
    try { sessionStorage.setItem("botera:selectedOperationalAlert", JSON.stringify(alert)); } catch {}
    window.location.href = alert.persisted && alert.sourceId
      ? `settings.html?tab=notifications&alert=${encodeURIComponent(alert.sourceId)}`
      : "settings.html?tab=notifications";
  }

  function ensureUI() {
    if (document.getElementById("boteraNotificationsButton")) return;
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const wrap = document.createElement("div");
    wrap.className = "botera-notifications-wrap";
    wrap.innerHTML = `<button class="botera-notifications-button" id="boteraNotificationsButton" type="button" aria-label="التنبيهات" aria-expanded="false"><span class="botera-notifications-icon">🔔</span><span class="botera-notifications-count hidden" id="boteraNotificationsCount">0</span></button><div class="botera-notifications-panel hidden" id="boteraNotificationsPanel"><div class="botera-notifications-head"><div><strong>التنبيهات</strong><small>التنبيهات الفعلية والتشغيلية في Botera</small></div><button class="btn-secondary btn-sm" id="boteraNotificationsReadAll" type="button">تحديد الكل كمقروء</button></div><div class="botera-notifications-list" id="boteraNotificationsList"></div></div>`;
    const workspace = document.getElementById("workspaceChip");
    if (workspace) topbar.insertBefore(wrap, workspace); else topbar.appendChild(wrap);
    document.getElementById("boteraNotificationsButton")?.addEventListener("click", e => { e.stopPropagation(); const p = document.getElementById("boteraNotificationsPanel"); const b = document.getElementById("boteraNotificationsButton"); const closed = p.classList.toggle("hidden"); b.setAttribute("aria-expanded", closed ? "false" : "true"); });
    document.getElementById("boteraNotificationsReadAll")?.addEventListener("click", async () => {
      const alerts = window.__boteraOperationalAlerts || [];
      const dbIds = alerts.filter(a => a.persisted && a.sourceId).map(a => a.sourceId);
      if (dbIds.length && hasSupabase()) await supabaseClient.from("notifications").update({ is_read: true }).eq("company_id", profile.company_id).in("id", dbIds);
      saveReadIds(alerts.filter(a => !a.persisted).map(a => a.id));
      await refresh();
    });
    document.addEventListener("click", e => { if (!wrap.contains(e.target)) { document.getElementById("boteraNotificationsPanel")?.classList.add("hidden"); document.getElementById("boteraNotificationsButton")?.setAttribute("aria-expanded","false"); } });
  }

  function render(alerts) {
    window.__boteraOperationalAlerts = alerts;
    ensureUI();
    const list = document.getElementById("boteraNotificationsList");
    const count = document.getElementById("boteraNotificationsCount");
    if (!list || !count) return;
    const localRead = new Set(readIds());
    const unread = alerts.filter(a => a.persisted ? !a.is_read : !localRead.has(a.id)).length;
    count.textContent = String(unread);
    count.classList.toggle("hidden", unread === 0);
    list.innerHTML = alerts.length ? alerts.map(a => { const read = a.persisted ? a.is_read : localRead.has(a.id); return `<button class="botera-notification-item ${read ? "is-read" : ""}" data-id="${esc(a.id)}" type="button"><span class="botera-notification-dot botera-notification-${esc(a.level)}">${esc(a.icon)}</span><span class="botera-notification-copy"><strong>${esc(a.title)}</strong><small>${esc(a.body)}</small></span></button>`; }).join("") : `<div class="botera-notifications-empty">لا توجد تنبيهات حالياً ✅</div>`;
    list.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => { const alert = alerts.find(a => a.id === b.dataset.id); if (!alert) return; const ids = new Set(readIds()); ids.add(alert.id); saveReadIds([...ids]); if (alert.persisted && alert.sourceId && hasSupabase()) supabaseClient.from("notifications").update({ is_read: true }).eq("company_id", profile.company_id).eq("id", alert.sourceId); routeToDetails(alert); }));
  }

  async function refresh() {
    if (!profile || !hasSupabase()) return;
    try {
      const data = await queryData();
      const merged = [...(data.persisted || []), ...buildDerivedAlerts(data)];
      const seen = new Set();
      const unique = merged.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; }).sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)).slice(0,30);
      render(unique);
    } catch (e) { console.warn("Operational notifications failed:", e); }
  }
  async function init() {
    profile = window.__boteraLiveProfile || null;
    if (!profile) return;
    if (!hasSupabase()) {
      clearInterval(bootTimer);
      bootTimer = setInterval(() => { if (hasSupabase()) { clearInterval(bootTimer); refresh(); } }, 250);
    }
    ensureUI();
    await refresh();
    window.addEventListener("boterarealtimechange", () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); });
    window.addEventListener("pageshow", refresh);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once:true }); else init();
})();