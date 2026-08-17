(async function initOrderEditor() {
  const profile = window.__boteraLiveProfile || window.AuthStore?.get?.().profile || await useAuth.ensureAuthenticated({ requiredPermission: "can_view_orders" });
  if (!profile || !window.supabaseClient || !window.OrdersService) return;

  const companyId = profile.company_id;
  const money = (value, currency = "EGP") => formatMoney(Number(value || 0), currency);
  const esc = (value) => escapeHtml(value == null ? "" : String(value));
  const statusLabels = {
    pending: "قيد الانتظار",
    confirmed: "مؤكد",
    shipped: "تم الشحن",
    delivered: "تم التسليم",
    refunded: "مرتجع",
    cancelled: "ملغي",
  };
  const paymentLabels = { pending: "معلق", paid: "مدفوع", failed: "فشل", refunded: "مرتجع" };
  const shippingLabels = { pending: "قيد الانتظار", shipped: "تم الشحن", delivered: "تم التسليم", returned: "مرتجع" };

  let customers = [];
  let products = [];
  let chargeToCustomer = false;
  let editingOrderId = null;

  function localDateTime(iso) {
    const date = iso ? new Date(iso) : new Date();
    const tz = date.getTimezoneOffset();
    const local = new Date(date.getTime() - tz * 60000);
    return local.toISOString().slice(0, 16);
  }

  function makeOptions(items, valueKey, labelFn, selected) {
    return items.map((item) => `<option value="${esc(item[valueKey])}" ${String(item[valueKey]) === String(selected || "") ? "selected" : ""}>${esc(labelFn(item))}</option>`).join("");
  }

  function productOptions(selectedId) {
    return `<option value="">اختر المنتج</option>${products.map((p) => {
      const archived = p.status === "inactive";
      const selected = String(p.id) === String(selectedId || "") ? "selected" : "";
      return `<option value="${esc(p.id)}" ${selected} ${archived && !selected ? "disabled" : ""}>${esc(p.name)}${archived ? " (غير نشط)" : ""}</option>`;
    }).join("")}`;
  }

  function addStyles() {
    if (document.getElementById("botera-order-editor-style")) return;
    const style = document.createElement("style");
    style.id = "botera-order-editor-style";
    style.textContent = `
      #orderEditorModal{width:min(1100px,94vw);max-width:1100px;border:1px solid var(--color-border);border-radius:22px;background:var(--color-surface);color:var(--color-text);padding:0;box-shadow:0 28px 80px rgba(0,0,0,.5)}
      #orderEditorModal::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(4px)}
      .oe-wrap{padding:24px}
      .oe-header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
      .oe-title{font-size:24px;font-weight:800;margin:0}
      .oe-subtitle{color:var(--muted);font-size:13px;margin-top:5px}
      .oe-grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}
      .oe-section{background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:18px;padding:18px}
      .oe-section-title{font-size:15px;font-weight:800;margin-bottom:14px}
      .oe-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      .oe-form-grid.one{grid-template-columns:1fr}
      .oe-item-row{display:grid;grid-template-columns:1.8fr .7fr .8fr .8fr auto;gap:9px;align-items:end;padding:12px;border:1px solid var(--color-border);border-radius:14px;background:var(--color-surface);margin-top:10px}
      .oe-item-meta{font-size:12px;color:var(--muted);margin-top:6px}
      .oe-remove{height:42px}
      .oe-summary{display:grid;gap:8px;margin-top:14px;padding-top:14px;border-top:1px solid var(--color-border)}
      .oe-summary-row{display:flex;justify-content:space-between;gap:12px;color:var(--muted)}
      .oe-summary-row.total{color:var(--color-text);font-size:18px;font-weight:800}
      .oe-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
      .oe-error{display:none;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.28);color:#ffb0b0;border-radius:12px;padding:10px;margin-top:12px}
      .oe-loading{opacity:.55;pointer-events:none}
      @media(max-width:850px){.oe-grid{grid-template-columns:1fr}.oe-item-row{grid-template-columns:1fr 1fr 1fr auto}.oe-item-row .oe-product{grid-column:1/-1}}
      @media(max-width:560px){.oe-form-grid{grid-template-columns:1fr}.oe-item-row{grid-template-columns:1fr 1fr}.oe-item-row .oe-product{grid-column:1/-1}.oe-item-row .oe-remove{grid-column:1/-1}}
    `;
    document.head.appendChild(style);
  }

  function ensureButton() {
    const heading = document.querySelector(".page-heading");
    if (!heading || heading.querySelector("[data-open-order-editor]")) return;
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.dataset.openOrderEditor = "new";
    button.textContent = "إضافة أوردر";
    button.style.marginTop = "12px";
    button.addEventListener("click", () => openEditor());
    heading.appendChild(button);
  }

  function ensureModal() {
    let modal = document.getElementById("orderEditorModal");
    if (modal) return modal;
    modal = document.createElement("dialog");
    modal.className = "dialog";
    modal.id = "orderEditorModal";
    document.body.appendChild(modal);
    return modal;
  }

  function renderItemRow(item = {}) {
    const product = products.find((p) => String(p.id) === String(item.product_id));
    const productId = item.product_id || "";
    const price = Number(item.price ?? product?.price ?? 0);
    const cost = Number(item.cost ?? product?.cost ?? 0);
    const quantity = Math.max(1, Number(item.quantity || 1));
    return `<div class="oe-item-row" data-item-row>
      <div class="form-field oe-product"><label class="form-label">المنتج</label><select class="form-input" data-item-product>${productOptions(productId)}</select><div class="oe-item-meta" data-item-info>${product ? `سعر: ${money(product.price, formCurrency())} · تكلفة: ${money(product.cost, formCurrency())}` : ""}</div></div>
      <div class="form-field"><label class="form-label">الكمية</label><input class="form-input" type="number" min="1" step="1" value="${quantity}" data-item-quantity></div>
      <div class="form-field"><label class="form-label">سعر الوحدة</label><input class="form-input" type="number" value="${price}" data-item-price readonly></div>
      <div class="form-field"><label class="form-label">تكلفة الوحدة</label><input class="form-input" type="number" value="${cost}" data-item-cost readonly></div>
      <button type="button" class="btn-secondary oe-remove" data-remove-item>حذف</button>
    </div>`;
  }

  function formCurrency() {
    return document.getElementById("oeCurrency")?.value || profile.company?.currency || "EGP";
  }

  function formValues() {
    const modal = document.getElementById("orderEditorModal");
    const customerId = modal.querySelector("#oeCustomer")?.value || "";
    const items = [...modal.querySelectorAll("[data-item-row]")].map((row) => ({
      product_id: row.querySelector("[data-item-product]")?.value || "",
      quantity: Math.max(1, Number(row.querySelector("[data-item-quantity]")?.value || 1)),
    })).filter((item) => item.product_id);
    return {
      customerId: customerId || null,
      customer: {
        name: modal.querySelector("#oeCustomerName")?.value.trim() || "",
        phone: modal.querySelector("#oeCustomerPhone")?.value.trim() || "",
        email: modal.querySelector("#oeCustomerEmail")?.value.trim() || "",
        country: modal.querySelector("#oeCustomerCountry")?.value.trim() || "",
        city: modal.querySelector("#oeCustomerCity")?.value.trim() || "",
        address: modal.querySelector("#oeCustomerAddress")?.value.trim() || "",
        notes: modal.querySelector("#oeCustomerNotes")?.value.trim() || "",
      },
      order: {
        order_number: modal.querySelector("#oeOrderNumber")?.value.trim() || "",
        status: modal.querySelector("#oeStatus")?.value || "pending",
        payment_status: modal.querySelector("#oePaymentStatus")?.value || "pending",
        shipping_status: modal.querySelector("#oeShippingStatus")?.value || "pending",
        shipping_cost: Number(modal.querySelector("#oeShippingCost")?.value || 0),
        discount: Number(modal.querySelector("#oeDiscount")?.value || 0),
        return_shipping_cost: Number(modal.querySelector("#oeReturnCost")?.value || 0),
        currency: modal.querySelector("#oeCurrency")?.value || "EGP",
        notes: modal.querySelector("#oeOrderNotes")?.value.trim() || "",
        created_at: modal.querySelector("#oeCreatedAt")?.value ? new Date(modal.querySelector("#oeCreatedAt").value).toISOString() : new Date().toISOString(),
        customer_order_name: modal.querySelector("#oeCustomerOrderName")?.value.trim() || "",
        customer_account_name: modal.querySelector("#oeCustomerAccountName")?.value.trim() || "",
        source_page_name: modal.querySelector("#oeSourcePageName")?.value.trim() || "",
        source_page_id: modal.querySelector("#oeSourcePageId")?.value.trim() || "",
        source_message_id: modal.querySelector("#oeSourceMessageId")?.value.trim() || "",
        conversation_id: modal.querySelector("#oeConversationId")?.value.trim() || "",
      },
      items,
    };
  }

  function recalcPreview() {
    const modal = document.getElementById("orderEditorModal");
    if (!modal) return;
    let subtotal = 0;
    modal.querySelectorAll("[data-item-row]").forEach((row) => {
      const product = products.find((p) => String(p.id) === String(row.querySelector("[data-item-product]")?.value || ""));
      const qty = Math.max(1, Number(row.querySelector("[data-item-quantity]")?.value || 1));
      const price = Number(product?.price ?? row.querySelector("[data-item-price]")?.value ?? 0);
      const cost = Number(product?.cost ?? row.querySelector("[data-item-cost]")?.value ?? 0);
      row.querySelector("[data-item-price]").value = price;
      row.querySelector("[data-item-cost]").value = cost;
      if (product) row.querySelector("[data-item-info]").textContent = `سعر: ${money(price, formCurrency())} · تكلفة: ${money(cost, formCurrency())}`;
      subtotal += price * qty;
    });
    const shipping = Number(modal.querySelector("#oeShippingCost")?.value || 0);
    const discount = Number(modal.querySelector("#oeDiscount")?.value || 0);
    const total = Math.max(0, subtotal + (chargeToCustomer ? shipping : 0) - discount);
    modal.querySelector("[data-preview-subtotal]").textContent = money(subtotal, formCurrency());
    modal.querySelector("[data-preview-shipping]").textContent = money(shipping, formCurrency());
    modal.querySelector("[data-preview-discount]").textContent = money(discount, formCurrency());
    modal.querySelector("[data-preview-total]").textContent = money(total, formCurrency());
    modal.querySelector("[data-charge-note]").textContent = chargeToCustomer ? "الشحن يضاف إلى إجمالي العميل حسب إعدادات الشحن." : "الشحن تكلفة على الشركة ولا يضاف إلى إجمالي العميل.";
  }

  function bindForm() {
    const modal = document.getElementById("orderEditorModal");
    const customerSelect = modal.querySelector("#oeCustomer");
    customerSelect?.addEventListener("change", () => {
      const customer = customers.find((c) => String(c.id) === String(customerSelect.value));
      ["Name","Phone","Email","Country","City","Address","Notes"].forEach((field) => {
        const input = modal.querySelector(`#oeCustomer${field}`);
        if (input) input.value = customer?.[field.toLowerCase()] || "";
      });
    });
    modal.querySelector("[data-add-item]")?.addEventListener("click", () => {
      const list = modal.querySelector("[data-items-list]");
      list.insertAdjacentHTML("beforeend", renderItemRow());
      bindItemRows();
      recalcPreview();
    });
    modal.querySelectorAll("#oeShippingCost,#oeDiscount,#oeCurrency").forEach((el) => el.addEventListener("input", recalcPreview));
    bindItemRows();
    modal.querySelector("#oeOrderForm")?.addEventListener("submit", saveEditor);
  }

  function bindItemRows() {
    const modal = document.getElementById("orderEditorModal");
    modal.querySelectorAll("[data-item-row]").forEach((row) => {
      row.querySelector("[data-remove-item]")?.addEventListener("click", () => {
        const rows = modal.querySelectorAll("[data-item-row]");
        if (rows.length <= 1) return;
        row.remove();
        recalcPreview();
      });
      row.querySelector("[data-item-product]")?.addEventListener("change", recalcPreview);
      row.querySelector("[data-item-quantity]")?.addEventListener("input", recalcPreview);
    });
  }

  function renderEditor(order = null) {
    const modal = ensureModal();
    const customer = customers.find((c) => String(c.id) === String(order?.customer_id || ""));
    const items = Array.isArray(order?.order_items) && order.order_items.length ? order.order_items : [{ product_id: "", quantity: 1 }];
    const currency = order?.currency || profile.company?.currency || "EGP";
    modal.innerHTML = `<div class="oe-wrap">
      <div class="oe-header"><div><h2 class="oe-title">${order ? "تعديل الأوردر" : "إضافة أوردر جديد"}</h2><div class="oe-subtitle">تعديل العميل والمنتجات والحالة والتكاليف في قاعدة البيانات في عملية واحدة.</div></div><button type="button" class="btn-secondary" data-close-editor>إغلاق</button></div>
      <form id="oeOrderForm">
        <div class="oe-grid">
          <div class="oe-section">
            <div class="oe-section-title">بيانات العميل</div>
            <div class="oe-form-grid">
              <div class="form-field"><label class="form-label">العميل</label><select class="form-input" id="oeCustomer"><option value="">عميل جديد</option>${makeOptions(customers, "id", (c) => `${c.name || "بدون اسم"}${c.phone ? ` — ${c.phone}` : ""}`, order?.customer_id)}</select></div>
              <div class="form-field"><label class="form-label">اسم العميل</label><input class="form-input" id="oeCustomerName" required value="${esc(customer?.name || order?.customer_order_name || "")}"></div>
              <div class="form-field"><label class="form-label">رقم الهاتف</label><input class="form-input" id="oeCustomerPhone" value="${esc(customer?.phone || "")}"></div>
              <div class="form-field"><label class="form-label">البريد الإلكتروني</label><input class="form-input" id="oeCustomerEmail" value="${esc(customer?.email || "")}"></div>
              <div class="form-field"><label class="form-label">الدولة</label><input class="form-input" id="oeCustomerCountry" value="${esc(customer?.country || "مصر")}"></div>
              <div class="form-field"><label class="form-label">المدينة</label><input class="form-input" id="oeCustomerCity" value="${esc(customer?.city || "")}"></div>
              <div class="form-field" style="grid-column:1/-1"><label class="form-label">العنوان</label><input class="form-input" id="oeCustomerAddress" value="${esc(customer?.address || "")}"></div>
              <div class="form-field" style="grid-column:1/-1"><label class="form-label">ملاحظات العميل</label><textarea class="form-input" id="oeCustomerNotes" rows="2">${esc(customer?.notes || "")}</textarea></div>
            </div>
          </div>

          <div class="oe-section">
            <div class="oe-section-title">بيانات الأوردر</div>
            <div class="oe-form-grid">
              <div class="form-field"><label class="form-label">كود الأوردر</label><input class="form-input" id="oeOrderNumber" value="${esc(order?.order_number || "")}" placeholder="يتم توليده تلقائيًا إذا تركته فارغًا"></div>
              <div class="form-field"><label class="form-label">تاريخ الأوردر</label><input class="form-input" id="oeCreatedAt" type="datetime-local" value="${localDateTime(order?.created_at)}"></div>
              <div class="form-field"><label class="form-label">حالة الأوردر</label><select class="form-input" id="oeStatus">${Object.entries(statusLabels).map(([key,label]) => `<option value="${key}" ${key === (order?.status || "pending") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
              <div class="form-field"><label class="form-label">حالة الدفع</label><select class="form-input" id="oePaymentStatus">${Object.entries(paymentLabels).map(([key,label]) => `<option value="${key}" ${key === (order?.payment_status || "pending") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
              <div class="form-field"><label class="form-label">حالة الشحن</label><select class="form-input" id="oeShippingStatus">${Object.entries(shippingLabels).map(([key,label]) => `<option value="${key}" ${key === (order?.shipping_status || "pending") ? "selected" : ""}>${label}</option>`).join("")}</select></div>
              <div class="form-field"><label class="form-label">العملة</label><input class="form-input" id="oeCurrency" value="${esc(currency)}"></div>
              <div class="form-field"><label class="form-label">تكلفة الشحن</label><input class="form-input" id="oeShippingCost" type="number" min="0" step="0.01" value="${Number(order?.shipping_cost || 0)}"></div>
              <div class="form-field"><label class="form-label">الخصم</label><input class="form-input" id="oeDiscount" type="number" min="0" step="0.01" value="${Number(order?.discount || 0)}"></div>
              <div class="form-field"><label class="form-label">تكلفة المرتجع</label><input class="form-input" id="oeReturnCost" type="number" min="0" step="0.01" value="${Number(order?.return_shipping_cost || 0)}"></div>
              <div class="form-field" style="grid-column:1/-1"><label class="form-label">ملاحظات الأوردر</label><textarea class="form-input" id="oeOrderNotes" rows="2">${esc(order?.notes || "")}</textarea></div>
            </div>
          </div>
        </div>

        <div class="oe-section" style="margin-top:18px">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><div class="oe-section-title" style="margin:0">المنتجات</div><button type="button" class="btn-secondary" data-add-item>+ إضافة منتج</button></div>
          <div data-items-list>${items.map(renderItemRow).join("")}</div>
          <div class="oe-summary">
            <div class="oe-summary-row"><span>الإجمالي الفرعي</span><strong data-preview-subtotal>${money(order?.subtotal || 0,currency)}</strong></div>
            <div class="oe-summary-row"><span>الشحن</span><strong data-preview-shipping>${money(order?.shipping_cost || 0,currency)}</strong></div>
            <div class="oe-summary-row"><span>الخصم</span><strong data-preview-discount>${money(order?.discount || 0,currency)}</strong></div>
            <div class="oe-summary-row total"><span>الإجمالي</span><strong data-preview-total>${money(order?.total || 0,currency)}</strong></div>
            <div class="oe-item-meta" data-charge-note></div>
          </div>
        </div>

        <div class="oe-section" style="margin-top:18px">
          <div class="oe-section-title">بيانات المصدر</div>
          <div class="oe-form-grid">
            <div class="form-field"><label class="form-label">اسم العميل في الأوردر</label><input class="form-input" id="oeCustomerOrderName" value="${esc(order?.customer_order_name || "")}"></div>
            <div class="form-field"><label class="form-label">اسم حساب Facebook</label><input class="form-input" id="oeCustomerAccountName" value="${esc(order?.customer_account_name || "")}"></div>
            <div class="form-field"><label class="form-label">اسم الصفحة</label><input class="form-input" id="oeSourcePageName" value="${esc(order?.source_page_name || "")}"></div>
            <div class="form-field"><label class="form-label">Page ID</label><input class="form-input" id="oeSourcePageId" value="${esc(order?.source_page_id || "")}"></div>
            <div class="form-field"><label class="form-label">Source Message ID</label><input class="form-input" id="oeSourceMessageId" value="${esc(order?.source_message_id || "")}"></div>
            <div class="form-field"><label class="form-label">Conversation ID</label><input class="form-input" id="oeConversationId" value="${esc(order?.conversation_id || "")}"></div>
          </div>
        </div>

        <div class="oe-error" id="oeError"></div>
        <div class="oe-actions"><button type="button" class="btn-secondary" data-close-editor>إلغاء</button><button type="submit" class="btn" id="oeSave">${order ? "حفظ التعديلات" : "إضافة الأوردر"}</button></div>
      </form>
    </div>`;

    modal.querySelectorAll("[data-close-editor]").forEach((button) => button.addEventListener("click", () => modal.close()));
    bindForm();
    recalcPreview();
    modal.showModal();
  }

  async function loadEditorData() {
    const [customersResult, productsResult, shippingResult] = await Promise.all([
      supabaseClient.from("customers").select("id,name,phone,email,country,city,address,notes").eq("company_id", companyId).order("name", { ascending: true }),
      supabaseClient.from("products").select("id,name,sku,price,cost,status").eq("company_id", companyId).order("created_at", { ascending: false }),
      supabaseClient.from("shipping_settings").select("charge_to_customer").eq("company_id", companyId).maybeSingle(),
    ]);
    if (customersResult.error) throw customersResult.error;
    if (productsResult.error) throw productsResult.error;
    if (shippingResult.error) throw shippingResult.error;
    customers = customersResult.data || [];
    products = productsResult.data || [];
    chargeToCustomer = !!shippingResult.data?.charge_to_customer;
  }

  async function openEditor(orderId = null) {
    const modal = ensureModal();
    modal.innerHTML = `<div class="oe-wrap"><div class="oe-header"><div><h2 class="oe-title">جارٍ التحميل…</h2></div><button type="button" class="btn-secondary" data-close-editor>إغلاق</button></div></div>`;
    modal.querySelector("[data-close-editor]").addEventListener("click", () => modal.close());
    addStyles();
    modal.showModal();
    try {
      const dataPromise = loadEditorData();
      let order = null;
      if (orderId) {
        const { data, error } = await supabaseClient
          .from("orders")
          .select("*, customers(name,phone,email,country,city,address,notes), order_items(id,product_id,product_name,sku,quantity,price,cost,total)")
          .eq("id", orderId)
          .eq("company_id", companyId)
          .single();
        if (error) throw error;
        order = data;
      }
      await dataPromise;
      renderEditor(order);
      editingOrderId = orderId;
    } catch (error) {
      modal.innerHTML = `<div class="oe-wrap"><div class="oe-error" style="display:block">تعذر تحميل بيانات محرر الأوردر: ${esc(error.message || "خطأ غير معروف")}</div><div class="oe-actions"><button class="btn-secondary" data-close-editor type="button">إغلاق</button></div></div>`;
      modal.querySelector("[data-close-editor]").addEventListener("click", () => modal.close());
    }
  }

  async function saveEditor(event) {
    event.preventDefault();
    const modal = document.getElementById("orderEditorModal");
    const errorEl = modal.querySelector("#oeError");
    const saveButton = modal.querySelector("#oeSave");
    errorEl.style.display = "none";
    const values = formValues();
    if (!values.customer.name) { errorEl.textContent = "اسم العميل مطلوب."; errorEl.style.display = "block"; return; }
    if (!values.items.length) { errorEl.textContent = "لازم تضيف منتج واحد على الأقل."; errorEl.style.display = "block"; return; }
    if (values.items.some((item) => !item.product_id || item.quantity < 1)) { errorEl.textContent = "تأكد من اختيار المنتج والكمية."; errorEl.style.display = "block"; return; }

    saveButton.disabled = true;
    saveButton.textContent = "جارٍ الحفظ…";
    modal.classList.add("oe-loading");
    try {
      await OrdersService.saveEditor({
        companyId,
        orderId: editingOrderId,
        customerId: values.customerId,
        customer: values.customer,
        order: values.order,
        items: values.items,
      });
      modal.close();
      window.location.reload();
    } catch (error) {
      modal.classList.remove("oe-loading");
      saveButton.disabled = false;
      saveButton.textContent = editingOrderId ? "حفظ التعديلات" : "إضافة الأوردر";
      errorEl.textContent = error.message || "تعذر حفظ الأوردر.";
      errorEl.style.display = "block";
    }
  }

  function injectEditButtons() {
    const table = document.getElementById("ordersTable");
    if (!table) return;
    table.querySelectorAll("tbody tr").forEach((row) => {
      const orderButton = row.querySelector("[data-order-id]");
      const actionsCell = row.querySelector("td.order-quick-actions");
      if (!orderButton || !actionsCell || actionsCell.querySelector("[data-edit-order]")) return;
      const button = document.createElement("button");
      button.className = "btn-secondary btn-sm";
      button.type = "button";
      button.dataset.editOrder = orderButton.dataset.orderId;
      button.textContent = "تعديل";
      button.addEventListener("click", (event) => { event.stopPropagation(); openEditor(button.dataset.editOrder); });
      actionsCell.prepend(button);
    });
  }

  addStyles();
  ensureModal();
  ensureButton();
  const observer = new MutationObserver(() => { ensureButton(); injectEditButtons(); });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectEditButtons, 250);
})();
