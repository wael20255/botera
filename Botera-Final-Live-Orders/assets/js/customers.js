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
  let customerChannels = {};
  const stages = ["new", "asking", "collect", "closed"];
  const labels = { all: "الكل", new: "جديد", asking: "بيترشحلو المنتج", collect: "بيجمع البيانات", closed: "تم الحجز" };
  const search = document.getElementById("customerSearch");
  const filters = document.getElementById("stageFilters");
  const table = document.getElementById("customersTable");
  const kpis = document.getElementById("customersKpis");

  const CHANNEL_KPIS = [
    { key: "facebook", label: "Facebook", color: "#1877F2" },
    { key: "whatsapp", label: "WhatsApp", color: "#25D366" },
    { key: "instagram", label: "Instagram", color: "linear-gradient(135deg,#f97316,#ec4899,#8b5cf6)" },
  ];

  const AVATAR_PALETTE = ["#25D366", "#1877F2", "#8b5cf6", "#f97316", "#ec4899", "#06b6d4", "#eab308"];
  function avatarColor(seed) {
    let hash = 0;
    const str = String(seed || "x");
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  }

  function highlightMatch(text, term) {
    const safeText = escapeHtml(text ?? "");
    if (!term) return safeText;
    const safeTerm = escapeHtml(term);
    const idx = safeText.toLocaleLowerCase().indexOf(safeTerm.toLocaleLowerCase());
    if (idx === -1) return safeText;
    return `${safeText.slice(0, idx)}<mark class="search-highlight">${safeText.slice(idx, idx + safeTerm.length)}</mark>${safeText.slice(idx + safeTerm.length)}`;
  }

  function stageBadge(stage) {
    const label = labels[stage] || labels.new;
    return `<span class="status-badge status-${escapeHtml(stage || "new")}">${escapeHtml(label)}</span>`;
  }

  function searchedCustomers() {
    const query = search.value.trim().toLocaleLowerCase();
    return customers.filter((customer) => !query || customer.name.toLocaleLowerCase().includes(query) || (customer.phone || "").toLocaleLowerCase().includes(query));
  }

  function renderKpis() {
    kpis.innerHTML = CHANNEL_KPIS.map((channel) => {
      const value = customers.filter((customer) => customerChannels[customer.id] === channel.key).length;
      return `<article class="card kpi-card channel-kpi-card"><span class="channel-kpi-icon" style="background:${channel.color};"></span><span class="kpi-label">${channel.label}</span><strong class="kpi-value">${value}</strong></article>`;
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
        <td>${stageBadge(customer.stage)}</td>
        <td>${latestOrderStatus ? statusBadge(latestOrderStatus) : "—"}</td>
        <td>${formatDate(customer.created_at)}</td>
      </tr>`;
    }).join("")}</tbody></table>` : emptyState("لا يوجد عملاء في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى، أو غيّر كلمة البحث.");

    table.querySelectorAll("[data-customer-id]").forEach((button) => button.addEventListener("click", () => {
      window.location.href = `conversations.html?customer=${encodeURIComponent(button.dataset.customerId)}`;
    }));
  }
  search.addEventListener("input", render);

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
        const [customersData] = await Promise.all([
          CustomersService.list(profile.company_id),
          loadOrderedCustomerIds(),
          loadLatestOrderStatuses(),
          loadCustomerChannels(),
        ]);
        allCustomers = customersData;
      }
      const range = DateRange.getCurrent();
      customers = allCustomers.filter((c) => DateRange.within(c.created_at, range));
      renderKpis();
      render();
    } catch (error) {
      table.innerHTML = errorState("تعذر تحميل العملاء", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
    }
  }

  async function backfillStagesInBackground() {
    const key = `botera:customer-stage-backfill-v1:${profile.company_id}`;
    if (localStorage.getItem(key) === "done") return;
    let offset = Number(localStorage.getItem(key) || 0);
    try {
      while (true) {
        const { data, error } = await supabaseClient.functions.invoke("backfill-customer-stages-v1", {
          body: { offset, batch_size: 8 },
        });
        if (error || !data?.ok) {
          console.warn("Customer stage backfill stopped:", error || data);
          break;
        }
        offset = Number(data.next_offset || offset);
        localStorage.setItem(key, String(offset));
        if (!data.has_more) {
          localStorage.setItem(key, "done");
          break;
        }
      }
      allCustomers = [];
      customerIdsWithOrders = new Set();
      latestOrderStatusByCustomer = {};
      await load();
    } catch (error) {
      console.warn("Customer stage backfill failed:", error);
    }
  }

  await load();
  void backfillStagesInBackground();

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
