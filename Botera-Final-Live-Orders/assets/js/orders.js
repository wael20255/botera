(async function init() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_orders" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();

  let allOrders = [];
  let orders = [];
  let prevOrdersCount = 0;
  let activeStatus = "all";
  let currentOrderId = null;
  // Statuses that drive the filter row + the "update status" buttons in the
  // order modal — unchanged from before, so existing filtering/updating
  // behavior is untouched.
  const statuses = ["pending", "confirmed", "shipped", "delivered", "refunded", "cancelled"];
  const filterLabels = { all: "الكل", pending: "قيد الانتظار", confirmed: "مؤكد", shipped: "تم الشحن", delivered: "تم التسليم", refunded: "مرتجع", cancelled: "ملغي" };
  // The 6 KPI boxes requested — a separate list from `statuses` above
  // (it includes "refunded", not "cancelled", and uses different labels),
  // so the filter row and modal keep behaving exactly as before.
  const KPI_STATUSES = [
    { key: "all", label: "الطلبات" },
    { key: "confirmed", label: "تم التاكيد" },
    { key: "shipped", label: "تم الشحن" },
    { key: "pending", label: "تأجيل" },
    { key: "delivered", label: "استلم" },
    { key: "refunded", label: "مرتجع" },
  ];
  const kpis = document.getElementById("ordersKpis");
  const analytics = document.getElementById("ordersAnalytics");
  const search = document.getElementById("orderSearch");
  const filters = document.getElementById("orderFilters");
  const table = document.getElementById("ordersTable");
  const modal = document.getElementById("orderModal");
  const details = document.getElementById("orderDetails");
  const historyModal = document.getElementById("customerHistoryModal");
  const historyDetails = document.getElementById("customerHistoryDetails");

  function customerName(order) {
    return Array.isArray(order.customers) ? order.customers[0]?.name : order.customers?.name;
  }
  function customerPhone(order) {
    return Array.isArray(order.customers) ? order.customers[0]?.phone : order.customers?.phone;
  }
  // Channel lives on the linked conversation, not on the order itself.
  function orderChannel(order) {
    return Array.isArray(order.conversations) ? order.conversations[0]?.channel : order.conversations?.channel;
  }
  // Real line items come from the joined order_items table (see
  // orders-service.js) — already a proper array, no JSON parsing needed.
  function orderItems(order) {
    return Array.isArray(order.order_items) ? order.order_items : [];
  }

  function productSummary(order) {
    const items = orderItems(order);
    if (!items.length) return "—";
    const first = escapeHtml(items[0].product_name || "—");
    return items.length > 1 ? `${first} <span class="product-extra-count">+${items.length - 1}</span>` : first;
  }

  function renderKpis() {
    kpis.innerHTML = KPI_STATUSES.map(({ key, label }) => {
      const value = key === "all" ? orders.length : orders.filter((order) => order.status === key).length;
      const deltaHtml = key === "all" ? `<div class="kpi-delta" id="ordersTotalDelta"></div>` : "";
      return `<article class="card kpi-card"><span class="kpi-label">${label}</span><strong class="kpi-value">${value}</strong>${deltaHtml}</article>`;
    }).join("");
    const deltaEl = document.getElementById("ordersTotalDelta");
    if (deltaEl) {
      if (prevOrdersCount <= 0) {
        deltaEl.innerHTML = `<span class="kpi-delta-muted">لا تتوفر مقارنة بعد</span>`;
      } else {
        const change = ((orders.length - prevOrdersCount) / prevOrdersCount) * 100;
        const up = change >= 0;
        deltaEl.innerHTML = `<span class="${up ? "kpi-delta-up" : "kpi-delta-down"}">${up ? "▲" : "▼"} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`;
      }
    }
  }

  // Two real, data-backed rankings — both computed from the current
  // date-range-filtered `orders`, same as the KPI boxes above:
  //   - top products, ranked by quantity actually sold (from order_items)
  //   - top channels, ranked by number of orders whose linked conversation
  //     has a channel set
  // (There's no governorate/city field on orders/customers used for this —
  // that's a possible future addition, not fabricated here.)
  function renderAnalytics() {
    const productCounts = {};
    orders.forEach((order) => {
      orderItems(order).forEach((item) => {
        if (!item || !item.product_name) return;
        productCounts[item.product_name] = (productCounts[item.product_name] || 0) + (Number(item.quantity) || 0);
      });
    });
    const topProducts = Object.entries(productCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const channelCounts = {};
    orders.forEach((order) => { const channel = orderChannel(order); if (channel) channelCounts[channel] = (channelCounts[channel] || 0) + 1; });
    const topChannels = Object.entries(channelCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const rankList = (rows, valueSuffix) => `<ol class="rank-list">${rows.map(([name, value], i) => `<li class="rank-item"><span class="rank-position">${i + 1}</span><span class="rank-name">${escapeHtml(name)}</span><span class="rank-value">${value} ${valueSuffix}</span></li>`).join("")}</ol>`;

    const productsHtml = topProducts.length
      ? rankList(topProducts, "قطعة")
      : emptyState("لا توجد بيانات منتجات كافية", "لا توجد عناصر منتجات مسجلة على الطلبات في هذه الفترة.");
    const channelsHtml = topChannels.length
      ? rankList(topChannels.map(([channel, count]) => [channelLabel(channel), count]), "طلب")
      : emptyState("لا تتوفر بيانات القناة بعد", "الطلبات في هذه الفترة ليس لها قناة مسجّلة.");

    analytics.innerHTML = `<article class="card"><h2 class="section-title">المنتج الأكثر مبيعًا</h2>${productsHtml}</article><article class="card"><h2 class="section-title">القناة الأكثر جلبًا للطلبات</h2>${channelsHtml}</article>`;
  }

  function searchedOrders() {
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) return orders;
    return orders.filter((order) => {
      const name = (customerName(order) || "").toLocaleLowerCase();
      const phone = (customerPhone(order) || "").toLocaleLowerCase();
      return name.includes(query) || phone.includes(query);
    });
  }

  function renderFilters() {
    filters.innerHTML = ["all", ...statuses].map((status) => `<button class="filter-button ${activeStatus === status ? "active" : ""}" data-status="${status}">${filterLabels[status]}</button>`).join("");
    filters.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { activeStatus = button.dataset.status; renderFilters(); renderTable(); }));
  }

  function renderTable() {
    const base = searchedOrders();
    const visible = base.filter((order) => activeStatus === "all" || order.status === activeStatus);
    table.innerHTML = visible.length ? `<table class="data-table orders-table"><thead><tr><th>الكود</th><th>العميل</th><th>المنتج</th><th>الإجمالي</th><th>الحالة</th><th>القناة</th><th>التاريخ</th><th>إجراءات</th><th></th></tr></thead><tbody>${visible.map((order) => `<tr><td><button class="row-button" data-order-id="${order.id}">${escapeHtml(order.order_number || "—")}</button></td><td><button class="row-button" data-customer-id="${order.customer_id || ""}" title="فتح المحادثة">${escapeHtml(customerName(order) || "عميل غير معروف")}</button></td><td class="product-cell">${productSummary(order)}</td><td>${formatMoney(order.total, order.currency)}</td><td>${statusBadge(order.status)}</td><td>${channelLabel(orderChannel(order))}</td><td>${formatDate(order.created_at)}</td><td class="order-quick-actions"><button class="btn-secondary btn-sm" data-quick-status="shipped" data-quick-order-id="${order.id}" type="button">تم الشحن</button><button class="btn-secondary btn-sm" data-quick-status="delivered" data-quick-order-id="${order.id}" type="button">تم التسليم</button><button class="btn-secondary btn-sm" data-quick-status="refunded" data-quick-order-id="${order.id}" type="button">مرتجع</button></td><td><button class="icon-btn icon-btn-sm" data-history-id="${order.customer_id || ""}" title="سجل مشتريات العميل"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/></svg></button></td></tr>`).join("")}</tbody></table>` : emptyState(search.value.trim() ? "لا توجد نتائج" : "لا توجد طلبات", search.value.trim() ? "جرّب اسمًا أو رقم هاتف مختلف." : "ستظهر الطلبات عند وصولها إلى قاعدة البيانات.");
    table.querySelectorAll("[data-order-id]").forEach((button) => button.addEventListener("click", () => openOrder(button.dataset.orderId)));
    table.querySelectorAll("[data-quick-order-id]").forEach((button) => button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const orderId = button.dataset.quickOrderId;
      const newStatus = button.dataset.quickStatus;
      const labelMap = { shipped: "تم الشحن", delivered: "تم التسليم", refunded: "مرتجع" };
      const label = labelMap[newStatus] || newStatus;
      button.disabled = true;
      const oldText = button.textContent;
      button.textContent = "جارٍ…";
      try {
        const updated = await OrdersService.updateStatus(orderId, newStatus);
        const index = orders.findIndex((order) => order.id === orderId);
        if (index !== -1) orders[index] = { ...orders[index], ...updated };
        const allIndex = allOrders.findIndex((order) => order.id === orderId);
        if (allIndex !== -1) allOrders[allIndex] = { ...allOrders[allIndex], ...updated };
        renderKpis(); renderAnalytics(); renderTable();
      } catch (error) {
        button.disabled = false;
        button.textContent = oldText;
        alert(`تعذر تسجيل حالة «${label}». ${error?.message || "حاول مرة أخرى."}`);
      }
    }));
    table.querySelectorAll("[data-customer-id]").forEach((button) => {
      if (!button.dataset.customerId) return;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        window.location.href = `conversations.html?customer=${encodeURIComponent(button.dataset.customerId)}`;
      });
    });
    table.querySelectorAll("[data-history-id]").forEach((button) => {
      if (!button.dataset.historyId) return;
      button.addEventListener("click", () => openCustomerHistory(button.dataset.historyId));
    });
  }
  search.addEventListener("input", () => { renderFilters(); renderTable(); });

  function openOrder(id) {
    currentOrderId = id;
    const order = orders.find((item) => item.id === id);
    if (!order) return;
    const items = orderItems(order);
    const itemsHtml = items.length ? items.map((item) => `<li>${escapeHtml(item.product_name)} — ${item.quantity} × ${formatMoney(item.price, order.currency)}</li>`).join("") : emptyState("لا توجد تفاصيل منتجات", "لا توجد عناصر مسجلة لهذا الطلب.");
    details.innerHTML = `<div class="dialog-header"><h2 class="section-title">${escapeHtml(order.order_number || "—")}</h2><button class="btn-secondary" id="closeOrderModal" type="button">إغلاق</button></div><div class="settings-tabs"><button class="filter-button active" data-order-tab="details" type="button">التفاصيل</button><button class="filter-button" data-order-tab="shipping" type="button">الشحن</button></div><div data-order-panel="details"><ul class="detail-list"><li><strong>العميل:</strong> ${escapeHtml(customerName(order) || "عميل غير معروف")}</li><li><strong>القناة:</strong> ${channelLabel(orderChannel(order))}</li><li><strong>حالة الدفع:</strong> ${statusBadge(order.payment_status)}</li><li><strong>المنتجات:</strong><ul class="detail-list">${itemsHtml}</ul></li></ul><h3 class="section-title" style="margin-top:var(--space-5);">تحديث الحالة يدويًا</h3><div class="status-actions">${statuses.map((status) => `<button class="btn-secondary" data-update-status="${status}" type="button">${filterLabels[status]}</button>`).join("")}</div><p style="color:var(--muted);margin-top:10px;">تقدر تحدد «تم الشحن» أو «تم التسليم» أو «مرتجع» يدويًا الآن، ولما نربط شركة الشحن هنخلي الحالة تتحدث تلقائيًا.</p><p class="error-message status-message" id="orderUpdateError"></p></div><div class="hidden" data-order-panel="shipping"><div class="empty-state"><div class="empty-state-icon">···</div><div class="empty-state-title">حالة الشحن الحالية: ${statusBadge(order.shipping_status || order.status)}</div><div class="empty-state-desc">لا توجد تفاصيل تتبع إضافية في قاعدة البيانات حالياً.</div></div></div>`;
    document.getElementById("closeOrderModal").addEventListener("click", () => modal.close());
    details.querySelectorAll("[data-order-tab]").forEach((button) => button.addEventListener("click", () => {
      const selectedTab = button.dataset.orderTab;
      details.querySelectorAll("[data-order-tab]").forEach((item) => item.classList.toggle("active", item === button));
      details.querySelectorAll("[data-order-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.orderPanel !== selectedTab));
    }));
    details.querySelectorAll("[data-update-status]").forEach((button) => button.addEventListener("click", () => changeStatus(button.dataset.updateStatus)));
    modal.showModal();
  }

  function openCustomerHistory(customerId) {
    const customerOrders = allOrders.filter((order) => order.customer_id === customerId);
    const name = customerOrders.length ? (customerName(customerOrders[0]) || "عميل غير معروف") : "عميل غير معروف";
    const phone = customerOrders.length ? customerPhone(customerOrders[0]) : null;
    const totalSpent = customerOrders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const currency = customerOrders[0]?.currency;
    const rowsHtml = customerOrders.length
      ? customerOrders.map((order) => `<tr><td><button class="row-button" data-history-order-id="${order.id}">${escapeHtml(order.order_number || "—")}</button></td><td class="product-cell">${productSummary(order)}</td><td>${formatMoney(order.total, order.currency)}</td><td>${statusBadge(order.status)}</td><td>${formatDate(order.created_at)}</td></tr>`).join("")
      : "";
    historyDetails.innerHTML = `<div class="dialog-header"><h2 class="section-title">${escapeHtml(name)}${phone ? ` <span class="muted-link" dir="ltr">${escapeHtml(phone)}</span>` : ""}</h2><button class="btn-secondary" id="closeHistoryModal" type="button">إغلاق</button></div>
      <div class="history-summary">
        <div class="history-summary-stat"><span class="kpi-label">عدد مرات الشراء</span><strong class="kpi-value">${customerOrders.length}</strong></div>
        <div class="history-summary-stat"><span class="kpi-label">إجمالي المشتريات</span><strong class="kpi-value">${formatMoney(totalSpent, currency)}</strong></div>
      </div>
      <div class="table-wrap">${customerOrders.length ? `<table class="data-table"><thead><tr><th>الكود</th><th>المنتج</th><th>الإجمالي</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>${rowsHtml}</tbody></table>` : emptyState("لا توجد طلبات سابقة", "لم يقم هذا العميل بأي طلب حتى الآن.")}</div>`;
    document.getElementById("closeHistoryModal").addEventListener("click", () => historyModal.close());
    historyDetails.querySelectorAll("[data-history-order-id]").forEach((button) => button.addEventListener("click", () => {
      historyModal.close();
      if (orders.some((order) => order.id === button.dataset.historyOrderId)) openOrder(button.dataset.historyOrderId);
    }));
    historyModal.showModal();
  }

  async function changeStatus(newStatus) {
    const errorBox = document.getElementById("orderUpdateError");
    errorBox.textContent = "";
    try {
      const updated = await OrdersService.updateStatus(currentOrderId, newStatus);
      const index = orders.findIndex((order) => order.id === currentOrderId);
      orders[index] = { ...orders[index], ...updated };
      const allIndex = allOrders.findIndex((order) => order.id === currentOrderId);
      if (allIndex !== -1) allOrders[allIndex] = { ...allOrders[allIndex], ...updated };
      renderKpis(); renderAnalytics(); renderTable(); openOrder(currentOrderId);
    } catch (error) {
      errorBox.textContent = "تعذر تحديث الحالة. لم يتم تغيير الطلب.";
    }
  }
  async function load() {
    if (!allOrders.length) table.innerHTML = skeletonBlock("44px", 5);
    try {
      if (!allOrders.length) allOrders = await OrdersService.list(profile.company_id);
      const range = DateRange.getCurrent();
      orders = allOrders.filter((order) => DateRange.within(order.created_at, range));
      prevOrdersCount = allOrders.filter((order) => DateRange.within(order.created_at, range.previous)).length;
      renderKpis(); renderAnalytics(); renderFilters(); renderTable();
    } catch (error) {
      table.innerHTML = errorState("تعذر تحميل الطلبات", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
    }
  }
  await load();
  window.addEventListener("boteradaterangechange", load);
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { allOrders = []; load(); }, 180);
  });
})();
