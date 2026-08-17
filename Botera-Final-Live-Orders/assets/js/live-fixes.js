/* Botera live fixes: additive compatibility layer for the production UI. */
(function () {
  if (window.__boteraLiveFixes) return;
  window.__boteraLiveFixes = true;

  const esc = (v) => (typeof escapeHtml === "function" ? escapeHtml(String(v ?? "")) : String(v ?? ""));
  const money = (v, c = "EGP") => (typeof formatMoney === "function" ? formatMoney(Number(v || 0), c) : `${Number(v || 0).toFixed(2)} ${c}`);
  const getProfile = () => window.__boteraLiveProfile || null;
  const setProfile = (p) => { if (p) window.__boteraLiveProfile = p; };
  const within = (d, r) => window.DateRange?.within ? DateRange.within(d, r) : true;
  const sum = (a, k) => (a || []).reduce((s, x) => s + Number(x?.[k] || 0), 0);
  const orderProductCost = (o) => {
    const direct = Number(o?.cost_total);
    if (Number.isFinite(direct) && direct > 0) return direct;
    return (Array.isArray(o?.order_items) ? o.order_items : []).reduce((s, i) => s + Number(i?.cost || 0) * Number(i?.quantity || 1), 0);
  };

  async function profile() {
    if (getProfile()) return getProfile();
    try {
      const p = await useAuth.ensureAuthenticated();
      setProfile(p);
      return p;
    } catch (_) { return null; }
  }

  async function syncFacebookNames() {
    const p = await profile();
    if (!p || !window.supabaseClient) return;
    const { data } = await supabaseClient.from("customers")
      .select("id,name,source,external_id")
      .eq("company_id", p.company_id)
      .eq("source", "facebook")
      .in("name", ["Facebook Customer", "عميل غير معروف"])
      .limit(50);
    for (const c of data || []) {
      try {
        const r = await supabaseClient.functions.invoke("sync-social-profile", { body: { customer_id: c.id } });
        if (r?.data?.name) {
          document.dispatchEvent(new CustomEvent("boteraProfileNameUpdated", { detail: { customerId: c.id, name: r.data.name } }));
        }
      } catch (_) {}
    }
  }

  function addReturnCostControl() {
    const form = document.getElementById("shippingSettingsForm");
    if (!form || form.querySelector("#shippingReturnCost")) return;
    const wrap = document.createElement("div");
    wrap.className = "form-field";
    wrap.innerHTML = '<label class="form-label" for="shippingReturnCost">تكلفة المرتجع لكل أوردر</label><input class="form-input" id="shippingReturnCost" type="number" min="0" step="0.01" value="0"><div class="form-hint">تُضاف تلقائيًا عند تحويل الأوردر إلى «مرتجع» وتدخل في حساب التكلفة والربح.</div>';
    const anchor = form.querySelector("#shippingChargeToCustomer")?.parentElement;
    (anchor?.after ? anchor.after(wrap) : form.appendChild(wrap));
    const save = async () => {
      const p = await profile();
      if (!p) return;
      const value = Number(document.getElementById("shippingReturnCost")?.value || 0);
      await supabaseClient.from("shipping_settings").upsert({ company_id: p.company_id, return_cost: Math.max(0, value), updated_at: new Date().toISOString() }, { onConflict: "company_id" });
    };
    form.addEventListener("submit", () => setTimeout(() => save().catch(() => {}), 300));
  }

  async function enhanceAdExpenses() {
    const p = await profile();
    if (!p || !window.supabaseClient) return;
    const tables = [...document.querySelectorAll("#financeTab .data-table")];
    const table = tables.find(t => /المبلغ/.test(t.innerText || ""));
    if (!table) return;
    const { data, error } = await supabaseClient.from("ad_expenses").select("*").eq("company_id", p.company_id).order("expense_date", { ascending: false }).limit(100);
    if (error) return;
    const tbody = table.querySelector("tbody");
    if (!tbody) return;
    tbody.innerHTML = (data || []).length ? (data || []).map(x => `<tr><td>${esc(x.expense_date)}</td><td>إعلان</td><td>${esc(x.platform || "—")}</td><td>${money(x.amount, p.company?.currency || "EGP")}</td><td>${esc(x.entry_mode || "manual")}</td><td><button type="button" class="btn-secondary btn-sm" data-edit-ad="${x.id}">تعديل</button> <button type="button" class="btn-secondary btn-sm" data-delete-ad="${x.id}">حذف</button></td></tr>`).join("") : '<tr><td colspan="6">لا توجد مصاريف إعلانية بعد.</td></tr>';
    const head = table.querySelector("thead tr");
    if (head && !head.querySelector("[data-ad-actions-head]")) head.insertAdjacentHTML("beforeend", '<th data-ad-actions-head>إجراءات</th>');
    tbody.querySelectorAll("[data-edit-ad]").forEach(btn => btn.addEventListener("click", async () => {
      const id = btn.dataset.editAd; const row = (data || []).find(x => x.id === id); if (!row) return;
      const amount = prompt("مبلغ صرف الإعلان", String(row.amount ?? "")); if (amount === null) return;
      const platform = prompt("الأكونت / المنصة", row.platform || ""); if (platform === null) return;
      const date = prompt("التاريخ YYYY-MM-DD", row.expense_date || ""); if (date === null) return;
      const n = Number(amount); if (!Number.isFinite(n) || n < 0) return alert("المبلغ غير صحيح");
      const { error: e } = await supabaseClient.from("ad_expenses").update({ amount: n, platform: platform.trim() || null, expense_date: date, updated_at: new Date().toISOString() }).eq("id", id).eq("company_id", p.company_id);
      if (e) alert(e.message); else enhanceAdExpenses();
    }));
    tbody.querySelectorAll("[data-delete-ad]").forEach(btn => btn.addEventListener("click", async () => {
      if (!confirm("حذف مصروف الإعلان؟")) return;
      const { error: e } = await supabaseClient.from("ad_expenses").delete().eq("id", btn.dataset.deleteAd).eq("company_id", p.company_id);
      if (e) alert(e.message); else enhanceAdExpenses();
    }));
  }

  async function fixInsights() {
    const area = document.getElementById("adsReportArea");
    const metrics = document.getElementById("reportsMetrics");
    if (!area || !metrics) return;
    const p = await profile(); if (!p) return;
    const range = DateRange.getCurrent();
    const prev = range.previous;
    const [{ data: orders }, { data: campaigns }, { data: ads }] = await Promise.all([
      supabaseClient.from("orders").select("*, order_items(cost,quantity)").eq("company_id", p.company_id),
      supabaseClient.from("campaigns").select("*").eq("company_id", p.company_id),
      supabaseClient.from("ad_expenses").select("*").eq("company_id", p.company_id),
    ]);
    const currentOrders = (orders || []).filter(o => within(o.created_at, range));
    const previousOrders = (orders || []).filter(o => within(o.created_at, prev));
    const valid = currentOrders.filter(o => !["cancelled", "refunded"].includes(o.status));
    const validPrev = previousOrders.filter(o => !["cancelled", "refunded"].includes(o.status));
    const delivered = currentOrders.filter(o => o.status === "delivered");
    const deliveredPrev = previousOrders.filter(o => o.status === "delivered");
    const refunded = currentOrders.filter(o => o.status === "refunded");
    const refundedPrev = previousOrders.filter(o => o.status === "refunded");
    const camp = (campaigns || []).filter(c => within(c.created_at, range));
    const campPrev = (campaigns || []).filter(c => within(c.created_at, prev));
    const ad = (ads || []).filter(e => within(e.expense_date, range));
    const adPrev = (ads || []).filter(e => within(e.expense_date, prev));
    const cSpend = a => sum(a, "spend"), aSpend = a => sum(a, "amount");
    const productCosts = a => (a || []).reduce((s,o) => s + orderProductCost(o), 0);
    const shipping = a => sum(a, "shipping_cost");
    const returns = a => sum(a, "return_shipping_cost");
    const adsTotal = (c,a) => cSpend(c) + aSpend(a);
    const revenue = sum(valid, "total"), revenuePrev = sum(validPrev, "total");
    const adSpend = adsTotal(camp, ad), adSpendPrev = adsTotal(campPrev, adPrev);
    const cost = productCosts(valid) + shipping(valid) + returns(refunded) + adSpend;
    const costPrev = productCosts(validPrev) + shipping(validPrev) + returns(refundedPrev) + adsTotal(campPrev, adPrev);
    const profit = sum(delivered, "total") - productCosts(delivered) - shipping(delivered) - returns(refunded) - adSpend;
    const profitPrev = sum(deliveredPrev, "total") - productCosts(deliveredPrev) - shipping(deliveredPrev) - returns(refundedPrev) - adSpendPrev;
    const aov = valid.length ? revenue / valid.length : 0, aovPrev = validPrev.length ? revenuePrev / validPrev.length : 0;
    const orderCost = currentOrders.length ? (productCosts(currentOrders) + shipping(currentOrders) + returns(refunded) + adSpend) / currentOrders.length : 0;
    const orderCostPrev = previousOrders.length ? (productCosts(previousOrders) + shipping(previousOrders) + returns(refundedPrev) + adSpendPrev) / previousOrders.length : 0;
    const cur = valid[0]?.currency || orders?.[0]?.currency || p.company?.currency || "EGP";
    const vals = { "الإيراد": revenue, "صرف الإعلانات": adSpend, "عدد الأوردرات": currentOrders.length, "التسليمات": delivered.length, "التكلفة": cost, "الأرباح (صافي بعد التسليم)": profit, "متوسط قيمة الطلب": aov, "تكلفة الأوردر": orderCost };
    const prevVals = { "الإيراد": revenuePrev, "صرف الإعلانات": adSpendPrev, "عدد الأوردرات": previousOrders.length, "التسليمات": deliveredPrev.length, "التكلفة": costPrev, "الأرباح (صافي بعد التسليم)": profitPrev, "متوسط قيمة الطلب": aovPrev, "تكلفة الأوردر": orderCostPrev };
    metrics.querySelectorAll(".metric-card").forEach(card => { const label = card.querySelector(".kpi-label")?.textContent?.trim(); if (!(label in vals)) return; const value = card.querySelector(".kpi-value"); if (value) value.textContent = ["عدد الأوردرات", "التسليمات"].includes(label) ? String(vals[label]) : money(vals[label], cur); });
    const rows = camp.map(c => `<tr><td>${esc(c.name || "—")}</td><td>${esc(c.platform || "—")}</td><td>${money(c.spend, cur)}</td><td>${money(c.revenue, cur)}</td><td>${Number(c.impressions || 0).toLocaleString("en-US")}</td><td>${Number(c.clicks || 0).toLocaleString("en-US")}</td><td>${Number(c.ctr || 0).toFixed(2)}%</td><td>${money(c.cpc, cur)}</td><td>${money(c.cpm, cur)}</td><td>${Number(c.spend) ? (Number(c.revenue || 0) / Number(c.spend)).toFixed(2) : "0.00"}x</td></tr>`).join("");
    const manual = ad.map(e => `<tr><td>مصروف يدوي</td><td>${esc(e.platform || "—")}</td><td>${money(e.amount, cur)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>`).join("");
    area.innerHTML = (camp.length || ad.length) ? `<div style="overflow:auto"><table class="data-table"><thead><tr><th>الحملة</th><th>المنصة</th><th>الإنفاق</th><th>الإيراد</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>CPC</th><th>CPM</th><th>ROAS</th></tr></thead><tbody>${rows}${manual}</tbody></table></div>` : (typeof emptyState === "function" ? emptyState("لا توجد بيانات إعلانات بعد", "أدخل مصروف الإعلانات يدويًا من Settings → Shipping & Ads أو اربط الحساب الإعلاني.") : "");
  }

  function enhanceOrderModal() {
    const box = document.getElementById("orderDetails");
    if (!box || box.dataset.liveEnhanced === "1") return;
    box.dataset.liveEnhanced = "1";
    const title = box.querySelector(".section-title")?.textContent?.trim();
    if (!title) return;
    const p = getProfile(); if (!p) return;
    const orderNumber = title;
    supabaseClient.from("orders").select("customer_id,shipping_cost,return_shipping_cost,total,currency").eq("company_id", p.company_id).eq("order_number", orderNumber).maybeSingle().then(async ({ data: order }) => {
      if (!order?.customer_id) return;
      const { data: customer } = await supabaseClient.from("customers").select("name,phone,address,city,country").eq("id", order.customer_id).maybeSingle();
      if (!customer) return;
      const list = box.querySelector("[data-order-panel=details] .detail-list");
      if (!list) return;
      const li = document.createElement("li");
      li.innerHTML = `<strong>بيانات العميل:</strong><div style="margin-top:8px;line-height:1.9">الاسم: ${esc(customer.name || "—")}<br><span dir="ltr">رقم التلفون: ${esc(customer.phone || "—")}</span><br>العنوان: ${esc(customer.address || "—")}${customer.city ? ` — ${esc(customer.city)}` : ""}${customer.country ? ` — ${esc(customer.country)}` : ""}<br>تكلفة المرتجع: ${money(order.return_shipping_cost, order.currency || "EGP")}</div>`;
      list.insertBefore(li, list.firstChild);
    });
  }

  function observe() {
    const mo = new MutationObserver(() => {
      addReturnCostControl();
      enhanceAdExpenses();
      enhanceOrderModal();
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-order-id]")) setTimeout(enhanceOrderModal, 40);
    if (e.target.closest("[data-quick-status=refunded], [data-update-status=refunded]")) {
      setTimeout(async () => {
        const p = await profile(); if (!p) return;
        const title = document.querySelector("#orderDetails .section-title")?.textContent?.trim(); if (!title) return;
        const { data: s } = await supabaseClient.from("shipping_settings").select("return_cost").eq("company_id", p.company_id).maybeSingle();
        if (s?.return_cost > 0) await supabaseClient.from("orders").update({ return_shipping_cost: Number(s.return_cost) }).eq("company_id", p.company_id).eq("order_number", title).eq("return_shipping_cost", 0);
      }, 450);
    }
  });

  window.addEventListener("boteradaterangechange", () => setTimeout(fixInsights, 100));
  window.addEventListener("boterarealtimechange", () => setTimeout(() => { fixInsights(); enhanceAdExpenses(); syncFacebookNames(); }, 250));
  window.addEventListener("load", () => { setTimeout(() => { fixInsights(); enhanceAdExpenses(); syncFacebookNames(); }, 500); });
  profile().then(() => { observe(); setTimeout(() => { fixInsights(); enhanceAdExpenses(); syncFacebookNames(); }, 700); });
})();