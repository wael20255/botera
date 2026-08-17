// Settings-only enhancements: product cost editing + ad expense edit/delete.
// Intentionally isolated so the existing Settings logic remains unchanged.
(function () {
  const productTabId = "productsTab";
  const financeTabId = "financeTab";
  let productBusy = false;
  let financeBusy = false;

  function toast(message, isError = false) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `position:fixed;bottom:24px;left:24px;z-index:10000;padding:12px 16px;border-radius:12px;background:${isError ? "#3a1111" : "#102f1a"};color:#fff;border:1px solid ${isError ? "#7f1d1d" : "#1f7a3d"};box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:14px;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }

  function closeModal() {
    document.getElementById("settingsEnhancementModal")?.remove();
  }

  function openModal(title, fields, onSave) {
    closeModal();
    const overlay = document.createElement("div");
    overlay.id = "settingsEnhancementModal";
    overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.68);display:grid;place-items:center;padding:20px;";
    const card = document.createElement("div");
    card.style.cssText = "width:min(720px,100%);max-height:90vh;overflow:auto;background:var(--color-surface,#111);border:1px solid var(--color-border,#333);border-radius:18px;padding:22px;box-shadow:0 25px 70px rgba(0,0,0,.5);direction:rtl;";
    const form = document.createElement("form");
    form.style.cssText = "display:grid;gap:14px;";
    const heading = document.createElement("div");
    heading.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><h2 style="margin:0">${title}</h2><button type="button" data-close-modal class="btn-secondary">إغلاق</button></div>`;
    form.appendChild(heading);

    const inputs = {};
    fields.forEach((field) => {
      const wrap = document.createElement("div");
      wrap.className = "form-field";
      const label = document.createElement("label");
      label.className = "form-label";
      label.textContent = field.label;
      const input = field.type === "textarea" ? document.createElement("textarea") : document.createElement("input");
      input.className = "form-input";
      if (field.type !== "textarea") input.type = field.type || "text";
      if (field.type === "textarea") input.rows = 5;
      input.value = field.value ?? "";
      input.required = !!field.required;
      if (field.min !== undefined) input.min = field.min;
      if (field.step !== undefined) input.step = field.step;
      wrap.append(label, input);
      form.appendChild(wrap);
      inputs[field.key] = input;
    });

    const error = document.createElement("div");
    error.className = "form-error";
    error.style.display = "none";
    form.appendChild(error);

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:10px;justify-content:flex-start;";
    const save = document.createElement("button");
    save.type = "submit";
    save.className = "btn";
    save.textContent = "حفظ التعديل";
    actions.appendChild(save);
    form.appendChild(actions);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      save.disabled = true;
      save.textContent = "جارٍ الحفظ…";
      error.style.display = "none";
      try {
        const values = Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value]));
        await onSave(values);
        closeModal();
        toast("تم الحفظ ✓");
      } catch (e) {
        error.textContent = e?.message || "تعذر الحفظ.";
        error.style.display = "block";
        save.disabled = false;
        save.textContent = "حفظ التعديل";
      }
    });

    heading.querySelector("[data-close-modal]").addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeModal(); });
    card.appendChild(form);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  async function editProduct(id) {
    if (productBusy) return;
    productBusy = true;
    try {
      const { data, error } = await supabaseClient.from("products").select("*").eq("id", id).single();
      if (error) throw error;
      openModal("تعديل المنتج", [
        { key: "name", label: "اسم المنتج", value: data.name, required: true },
        { key: "sku", label: "SKU", value: data.sku || "" },
        { key: "price", label: "سعر البيع", value: data.price ?? 0, type: "number", min: 0, step: "0.01", required: true },
        { key: "cost", label: "تكلفة المنتج", value: data.cost ?? 0, type: "number", min: 0, step: "0.01", required: true },
        { key: "description", label: "محتوى / وصف المنتج", value: data.description || "", type: "textarea" },
      ], async (values) => {
        const price = Number(values.price);
        const cost = Number(values.cost);
        if (!values.name.trim()) throw new Error("من فضلك أدخل اسم المنتج.");
        if (!Number.isFinite(price) || price < 0 || !Number.isFinite(cost) || cost < 0) throw new Error("سعر البيع وتكلفة المنتج غير صحيحين.");
        await ProductsService.update(id, {
          name: values.name.trim(),
          sku: values.sku.trim() || null,
          price,
          cost,
          description: values.description.trim() || null,
        });
        window.dispatchEvent(new CustomEvent("boterarealtimechange"));
      });
    } catch (e) {
      toast(e?.message || "تعذر تحميل المنتج.", true);
    } finally {
      productBusy = false;
    }
  }

  async function enhanceProducts() {
    const tab = document.getElementById(productTabId);
    if (!tab || tab.querySelector("[data-product-row] [data-edit-product]") || !tab.querySelector("[data-product-row]")) return;

    const table = tab.querySelector("table.data-table");
    if (!table) return;
    const head = table.querySelector("thead tr");
    if (head && !head.querySelector("[data-product-actions-head]")) {
      const th = document.createElement("th");
      th.dataset.productActionsHead = "1";
      th.textContent = "إجراء";
      head.appendChild(th);
    }

    tab.querySelectorAll("[data-product-row]").forEach((row) => {
      if (row.querySelector("[data-edit-product]")) return;
      const td = document.createElement("td");
      const button = document.createElement("button");
      button.className = "btn-secondary";
      button.type = "button";
      button.dataset.editProduct = row.dataset.productRow;
      button.textContent = "تعديل";
      button.addEventListener("click", () => editProduct(row.dataset.productRow));
      td.appendChild(button);
      row.appendChild(td);
    });

    tab.querySelectorAll(".form-label").forEach((label) => {
      if (label.textContent.trim() === "التكلفة") label.textContent = "تكلفة المنتج";
    });
    if (head) head.querySelectorAll("th").forEach((th) => { if (th.textContent.trim() === "التكلفة") th.textContent = "تكلفة المنتج"; });
  }

  async function enhanceAdExpenses() {
    const tab = document.getElementById(financeTabId);
    if (!tab || financeBusy) return;
    const table = tab.querySelector("table.data-table");
    if (!table || !table.querySelector("tbody")) return;
    if (table.querySelector("[data-ad-edit]")) return;

    financeBusy = true;
    try {
      // RLS already scopes this query to the logged-in company; no other settings are changed.
      const { data: expenses, error } = await supabaseClient
        .from("ad_expenses")
        .select("*")
        .order("expense_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      const rows = Array.from(table.querySelectorAll("tbody tr"));
      if (!expenses?.length || !rows.length || !rows[0].querySelector("td")) return;

      const head = table.querySelector("thead tr");
      if (head && !head.querySelector("[data-ad-actions-head]")) {
        const th = document.createElement("th");
        th.dataset.adActionsHead = "1";
        th.textContent = "إجراء";
        head.appendChild(th);
      }

      rows.forEach((row, index) => {
        const expense = expenses[index];
        if (!expense || row.querySelector("[data-ad-edit]")) return;
        const td = document.createElement("td");
        td.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;";
        const edit = document.createElement("button");
        edit.className = "btn-secondary";
        edit.type = "button";
        edit.dataset.adEdit = expense.id;
        edit.textContent = "تعديل";
        const del = document.createElement("button");
        del.className = "btn-secondary";
        del.type = "button";
        del.dataset.adDelete = expense.id;
        del.textContent = "حذف";
        td.append(edit, del);
        row.appendChild(td);

        edit.addEventListener("click", () => editAdExpense(expense));
        del.addEventListener("click", async () => {
          if (!confirm("تأكيد حذف مصروف الإعلان؟")) return;
          del.disabled = true;
          try {
            const { error: deleteError } = await supabaseClient.from("ad_expenses").delete().eq("id", expense.id);
            if (deleteError) throw deleteError;
            row.remove();
            toast("تم حذف مصروف الإعلان ✓");
          } catch (e) {
            del.disabled = false;
            toast(e?.message || "تعذر حذف مصروف الإعلان.", true);
          }
        });
      });
    } catch (e) {
      console.warn("Could not enhance ad expenses:", e);
    } finally {
      financeBusy = false;
    }
  }

  function editAdExpense(expense) {
    openModal("تعديل مصروف الإعلان", [
      { key: "expense_date", label: "اليوم", value: expense.expense_date, type: "date", required: true },
      { key: "platform", label: "المنصة", value: expense.platform || "" },
      { key: "amount", label: "المبلغ", value: expense.amount ?? 0, type: "number", min: 0, step: "0.01", required: true },
      { key: "entry_mode", label: "طريقة الإدخال (manual / auto)", value: expense.entry_mode || "manual" },
      { key: "notes", label: "ملاحظات", value: expense.notes || "", type: "textarea" },
    ], async (values) => {
      const amount = Number(values.amount);
      if (!values.expense_date) throw new Error("من فضلك اختر اليوم.");
      if (!Number.isFinite(amount) || amount < 0) throw new Error("المبلغ غير صحيح.");
      const { error } = await supabaseClient.from("ad_expenses").update({
        expense_date: values.expense_date,
        platform: values.platform.trim() || null,
        amount,
        entry_mode: values.entry_mode.trim() || "manual",
        notes: values.notes.trim() || null,
      }).eq("id", expense.id);
      if (error) throw error;
      window.dispatchEvent(new CustomEvent("boterarealtimechange"));
    });
  }

  function installObservers() {
    const observer = new MutationObserver(() => {
      enhanceProducts();
      enhanceAdExpenses();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    enhanceProducts();
    enhanceAdExpenses();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installObservers);
  else installObservers();
})();
