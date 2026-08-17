/* Orders editor enhancements: active Settings products + order-name/customer-name sync. */
(function initOrdersEditorEnhancements() {
  let productCache = null;
  let loadingProducts = false;
  let observer = null;

  const escapeHtml = (value) => {
    if (window.escapeHtml) return window.escapeHtml(String(value ?? ""));
    return String(value ?? "").replace(/[&<>'"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  };

  async function getProducts() {
    if (productCache) return productCache;
    if (loadingProducts) {
      while (loadingProducts) await new Promise((r) => setTimeout(r, 40));
      return productCache || [];
    }
    loadingProducts = true;
    try {
      const profile = window.__boteraLiveProfile || window.AuthStore?.get?.().profile;
      if (!profile?.company_id || !window.supabaseClient) return [];
      const { data, error } = await supabaseClient
        .from("products")
        .select("id,name,price,cost,status")
        .eq("company_id", profile.company_id)
        .eq("status", "active")
        .order("name", { ascending: true });
      if (error) throw error;
      productCache = data || [];
      return productCache;
    } catch (error) {
      console.error("Orders editor product lookup failed:", error);
      productCache = [];
      return [];
    } finally {
      loadingProducts = false;
    }
  }

  function syncCustomerName(modal) {
    const orderName = modal.querySelector("#oeCustomerOrderName");
    const customerName = modal.querySelector("#oeCustomerName");
    if (!orderName || !customerName) return;

    if (!customerName.dataset.ordersNameSyncBound) {
      const apply = () => {
        customerName.value = orderName.value || "";
      };
      orderName.addEventListener("input", apply);
      orderName.addEventListener("change", apply);
      customerName.dataset.ordersNameSyncBound = "1";
      apply();
    } else {
      customerName.value = orderName.value || customerName.value || "";
    }
  }

  async function syncProductSelects(modal) {
    const selects = [...modal.querySelectorAll("[data-item-product]")];
    if (!selects.length) return;
    const products = await getProducts();
    const byId = new Map(products.map((p) => [String(p.id), p]));

    selects.forEach((select) => {
      const selected = String(select.value || "");
      const current = byId.get(selected);
      const options = [`<option value="">اختر المنتج</option>`]
        .concat(products.map((p) => `<option value="${escapeHtml(p.id)}" ${String(p.id) === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`));
      if (selected && !current) {
        options.push(`<option value="${escapeHtml(selected)}" selected>المنتج الحالي</option>`);
      }
      select.innerHTML = options.join("");

      if (!select.dataset.ordersProductSyncBound) {
        select.addEventListener("change", () => {
          const product = byId.get(String(select.value || ""));
          const row = select.closest("[data-item-row]");
          if (!row || !product) return;
          const price = row.querySelector("[data-item-price]");
          const cost = row.querySelector("[data-item-cost]");
          const info = row.querySelector("[data-item-info]");
          if (price) price.value = Number(product.price || 0);
          if (cost) cost.value = Number(product.cost || 0);
          if (info) info.textContent = `سعر: ${Number(product.price || 0)} · تكلفة: ${Number(product.cost || 0)}`;
        });
        select.dataset.ordersProductSyncBound = "1";
      }
    });
  }

  async function enhance() {
    const modal = document.getElementById("orderEditorModal");
    if (!modal) return;
    syncCustomerName(modal);
    await syncProductSelects(modal);
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (document.getElementById("orderEditorModal")) setTimeout(enhance, 0);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(enhance, 800);
  }

  start();
})();
