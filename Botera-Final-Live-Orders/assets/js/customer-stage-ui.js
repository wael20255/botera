// Deterministic customer-stage UI: stages are driven by outgoing agent replies,
// never by Gemini/AI. The database trigger classifies agent messages and writes
// customers.stage; this page only reads and renders those values.
(() => {
  const STAGES = [
    { key: "new", label: "جديد" },
    { key: "product_shown", label: "تم عرض المنتج" },
    { key: "price_shown", label: "تم عرض السعر" },
    { key: "collect", label: "بيجمع البيانات" },
    { key: "booked", label: "تم الحجز" },
    { key: "following", label: "بيتابع" },
    { key: "delivered", label: "استلم المنتج" },
  ];
  const byKey = Object.fromEntries(STAGES.map((s) => [s.key, s]));
  let profile = null;
  let timer = null;

  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function stageBadge(stage) {
    const item = byKey[stage] || byKey.new;
    return `<span class="status-badge">${esc(item.label)}</span>`;
  }

  function renderStageFilters(customers) {
    const root = document.getElementById("stageFilters");
    if (!root) return;
    const active = root.dataset.activeStage || "all";
    const counts = {};
    customers.forEach((c) => { counts[c.stage] = (counts[c.stage] || 0) + 1; });
    root.innerHTML = [
      `<button class="filter-button ${active === "all" ? "active" : ""}" data-customer-stage="all">الكل (${customers.length})</button>`,
      ...STAGES.map((s) => `<button class="filter-button ${active === s.key ? "active" : ""}" data-customer-stage="${s.key}">${esc(s.label)} (${counts[s.key] || 0})</button>`),
    ].join("");
    root.querySelectorAll("[data-customer-stage]").forEach((button) => button.addEventListener("click", () => {
      root.dataset.activeStage = button.dataset.customerStage;
      renderCustomers(customers);
    }));
  }

  function renderCustomers(customers) {
    const root = document.getElementById("customersTable");
    if (!root) return;
    const q = (document.getElementById("customerSearch")?.value || "").trim().toLocaleLowerCase();
    const active = document.getElementById("stageFilters")?.dataset.activeStage || "all";
    const visible = customers.filter((c) => {
      const searchHit = !q || String(c.name || "").toLocaleLowerCase().includes(q) || String(c.phone || "").toLocaleLowerCase().includes(q);
      return searchHit && (active === "all" || c.stage === active);
    });

    renderStageFilters(customers);
    if (!visible.length) {
      root.innerHTML = `<div class="empty-state"><div class="empty-state-title">لا يوجد عملاء في هذه المرحلة</div><div class="empty-state-desc">غيّر المرحلة أو كلمة البحث.</div></div>`;
      return;
    }

    root.innerHTML = `<table class="data-table customers-table"><thead><tr><th>الاسم</th><th>جاي منين</th><th>المرحلة</th><th>تاريخ الإضافة</th></tr></thead><tbody>${visible.map((c) => {
      const name = esc(c.name || "عميل غير معروف");
      const phone = esc(c.phone || "");
      const source = esc(c.source || "—");
      const stage = c.stage && byKey[c.stage] ? c.stage : "new";
      return `<tr><td><button class="row-button customer-name-button" type="button" data-customer-id="${esc(c.id)}" title="فتح المحادثة">${name}${phone ? `<div class="table-subtext" dir="ltr">${phone}</div>` : ""}</button></td><td>${source}</td><td>${stageBadge(stage)}</td><td>${esc(new Date(c.created_at).toLocaleString("ar-EG"))}</td></tr>`;
    }).join("")}</tbody></table>`;

    root.querySelectorAll("[data-customer-id]").forEach((button) => button.addEventListener("click", () => {
      window.location.href = `conversations.html?customer=${encodeURIComponent(button.dataset.customerId)}`;
    }));
  }

  async function load() {
    if (!profile) return;
    const { data, error } = await supabaseClient
      .from("customers")
      .select("id,name,phone,source,stage,created_at")
      .eq("company_id", profile.company_id)
      .order("created_at", { ascending: false });
    if (error) {
      console.warn("Deterministic customer stage UI load failed:", error);
      return;
    }
    renderCustomers(data || []);
  }

  async function init() {
    try {
      profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_customers" });
      if (!profile) return;
      await load();
      document.getElementById("customerSearch")?.addEventListener("input", load);
      window.addEventListener("boterarealtimechange", () => {
        clearTimeout(timer);
        timer = setTimeout(load, 120);
      });
    } catch (error) {
      console.warn("Deterministic customer stage UI init failed:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
