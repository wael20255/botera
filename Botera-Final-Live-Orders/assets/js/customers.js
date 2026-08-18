(async function init() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_customers" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();

  let allCustomers = [];
  let customers = [];
  let activeStage = "all";
  let customerIdsWithOrders = new Set();
  let latestOrderStatusByCustomer = {};
  let customerChannels = {}; // customerId -> channel, derived from their conversations (customers themselves don't store a channel)
  const stages = ["new", "recommend", "asking", "hesitant", "ready", "collect", "closed", "lost"];
  const labels = { all: "الكل", new: "جديد", recommend: "بيتوصف له", asking: "يسأل", hesitant: "متردد", ready: "جاهز", collect: "بيجمع بياناته", closed: "مغلق", lost: "مفقود" };
  const search = document.getElementById("customerSearch");
  const filters = document.getElementById("stageFilters");
  const table = document.getElementById("customersTable");
  const kpis = document.getElementById("customersKpis");

  // The 3 channel summary boxes the person asked for — same brand colors
  // used across the rest of the app (dashboard.css / conversations.js).
  const CHANNEL_KPIS = [
    { key: "facebook", label: "Facebook", color: "#1877F2" },
    { key: "whatsapp", label: "WhatsApp", color: "#25D366" },
    { key: "instagram", label: "Instagram", color: "linear-gradient(135deg,#f97316,#ec4899,#8b5cf6)" },
  ];

  // A small fixed palette so each customer's avatar circle gets a
  // consistent (not random-per-render) color, picked by hashing their id.
  const AVATAR_PALETTE = ["#25D366", "#1877F2", "#8b5cf6", "#f97316", "#ec4899", "#06b6d4", "#eab308"];
  function avatarColor(seed) {
    let hash = 0;
    const str = String(seed || "x");
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  // Wraps the first case-insensitive match of `term` inside `text` in a
  // <mark> (reuses the .search-highlight style already defined for the
  // Conversations page) — a local copy so this file has no dependency on
  // conversations.js.
  function highlightMatch(text, term) {
    const safeText = escapeHtml(text ?? "");
    if (!term) return safeText;
    const safeTerm = escapeHtml(term);
    const idx = safeText.toLocaleLowerCase().indexOf(safeTerm.toLocaleLowerCase());
    if (idx === -1) return safeText;
    return `${safeText.slice(0, idx)}<mark class="search-highlight">${safeText.slice(idx, idx + safeTerm.length)}</mark>${safeText.slice(idx + safeTerm.length)}`;
  }

  function searchedCustomers() {
    const query = search.value.trim().toLocaleLowerCase();
    return customers.filter((customer) => !query || customer.name.toLocaleLowerCase().includes(query) || (customer.phone || "").toLocaleLowerCase().includes(query));
  }

  // 3 boxes: how many of the currently-in-range customers came from each
  // channel — derived from their conversations (see loadCustomerChannels).
  function renderKpis() {
    kpis.innerHTML = CHANNEL_KPIS.map((channel) => {
      const value = customers.filter((customer) => customerChannels[customer.id] === channel.key).length;
      const style = channel.color.startsWith("linear") ? `background:${channel.color};` : `background:${channel.color};`;
      return `<article class="card kpi-card channel-kpi-card"><span class="channel-kpi-icon" style="${style}"></span><span class="kpi-label">${channel.label}</span><strong class="kpi-value">${value}</strong></article>`;
    }).join("");
  }

  function render() {
    const base = searchedCustomers();
    const term = search.value.trim();
    filters.innerHTML = ["all", ...stages].map((stage) => `<button class="filter-button ${activeStage === stage ? "active" : ""}" data-stage="${stage}">${labels[stage]} (${stage === "all" ? base.length : base.filter((customer) => customer.stage === stage).length})</button>`).join("");
    filters.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => { activeStage = button.dataset.stage; render(); }));
    const visible = base.filter((customer) => activeStage === "all" || customer.stage === activeStage);
    table.innerHTML = visible.length ? `<table class="data-table customers-table"><thead><tr><th></th><th>الاسم</th><th>جاي منين</th><th>المرحلة</th><th>حالة آخر طلب</th><th>تاريخ الإضافة</th></tr></thead><tbody>${visible.map((customer) => {
      const initial = escapeHtml((customer.name || "؟").trim().charAt(0).toUpperCase() || "؟");
      const hasOrder = customerIdsWithOrders.has(customer.id);
      const latestOrderStatus = latestOrderStatusByCustomer[customer.id] || null;
      return `<tr class="customer-row">
        <td class="customer-avatar-cell"><span class="table-avatar" style="background:${avatarColor(customer.id || customer.name)};">${initial}</span></td>
        <td><button class="row-button customer-name-button" data-customer-id="${customer.id}" title="فتح المحادثة">${highlightMatch(customer.name, term)}${hasOrder ? `<span class="order-dot" title="لديه طلب سابق">●</span>` : ""}</button></td>
        <td>${channelLabel(customerChannels[customer.id])}</td>
        <td>${statusBadge(customer.stage)}</td>
        <td>${latestOrderStatus ? statusBadge(latestOrderStatus) : "—"}</td>
        <td>${formatDate(customer.created_at)}</td>
      </tr>`;
    }).join("")}</tbody></table>` : emptyState("لا يوجد عملاء في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى، أو غيّر كلمة البحث.");
    // Clicking a customer takes you straight to their chat on the
    // Conversations page (conversations.js reads ?customer=<id> and opens
    // the matching thread automatically).
    table.querySelectorAll("[data-customer-id]").forEach((button) => button.addEventListener("click", () => {
      window.location.href = `conversations.html?customer=${encodeURIComponent(button.dataset.customerId)}`;
    }));
  }
  search.addEventListener("input", render);

  // Best-effort: which customers have at least one order, so their row can
  // show a small marker. If this fails for any reason, the page still
  // works fine — customers just won't be marked, nothing else breaks.
  async function loadOrderedCustomerIds() {
    try {
      const orders = await OrdersService.list(profile.company_id);
      customerIdsWithOrders = new Set(orders.map((order) => order.customer_id).filter(Boolean));
    } catch (error) {
      console.warn("Could not load orders to mark customers who ordered (non-fatal):", error);
      customerIdsWithOrders = new Set();
    }
  }

  async function loadLatestOrderStatuses() {
    try {
      const orders = await OrdersService.list(profile.company_id);
      const map = {};
      orders
        .filter((order) => order.customer_id)
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .forEach((order) => {
          if (!map[order.customer_id]) map[order.customer_id] = order.status;
        });
      latestOrderStatusByCustomer = map;
    } catch (error) {
      console.warn("Could not load latest order statuses for customers (non-fatal):", error);
      latestOrderStatusByCustomer = {};
    }
  }

  // Customers themselves don't store a channel — it lives on their
  // conversation(s) — so this derives "where did each customer come from"
  // by looking at their (first found) conversation's channel. Best-effort:
  // if this fails, channels just show as "—" instead of breaking the page.
  async function loadCustomerChannels() {
    try {
      const convos = await ConversationsService.list(profile.company_id);
      const map = {};
      convos.forEach((conversation) => {
        if (conversation.customer_id && !map[conversation.customer_id]) map[conversation.customer_id] = conversation.channel;
      });
      customerChannels = map;
    } catch (error) {
      console.warn("Could not derive customer channels from conversations (non-fatal):", error);
      customerChannels = {};
    }
  }

  async function load() {
    if (!allCustomers.length) table.innerHTML = skeletonBlock("40px", 5);
    try {
      if (!allCustomers.length) {
        const [customersData] = await Promise.all([CustomersService.list(profile.company_id), loadOrderedCustomerIds(), loadLatestOrderStatuses(), loadCustomerChannels()]);
        allCustomers = customersData;
      }
      const range = DateRange.getCurrent();
      customers = allCustomers.filter((c) => DateRange.within(c.created_at, range));
      renderKpis(); render();
    } catch (error) {
      table.innerHTML = errorState("تعذر تحميل العملاء", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
    }
  }
  await load();
  window.addEventListener("boteradaterangechange", load);
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => {
      allCustomers = [];
      customerIdsWithOrders = new Set();
      latestOrderStatusByCustomer = {};
      load();
    }, 180);
  });
})();
