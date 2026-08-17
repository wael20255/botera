// Settings-only return shipping cost enhancement.
// Keeps the existing Settings implementation intact and only restores the
// return-shipping-cost control + persistence.
(function () {
  if (window.__boteraReturnShippingCostFix) return;
  window.__boteraReturnShippingCostFix = true;

  let lastForm = null;

  async function saveReturnCost(form) {
    const companyId = window.AuthStore?.get?.().profile?.company_id;
    const input = form.querySelector("#shippingReturnCost");
    if (!companyId || !input) return;

    const returnCost = Number(input.value || 0);
    if (!Number.isFinite(returnCost) || returnCost < 0) {
      throw new Error("تكلفة المرتجع غير صحيحة.");
    }

    const { error } = await supabaseClient
      .from("shipping_settings")
      .upsert({
        company_id: companyId,
        return_shipping_cost: returnCost,
        updated_at: new Date().toISOString(),
      }, { onConflict: "company_id" });

    if (error) throw error;
  }

  async function enhance() {
    const form = document.getElementById("shippingSettingsForm");
    if (!form || form === lastForm) return;
    lastForm = form;

    const defaultInput = document.getElementById("shippingDefaultCost");
    if (!defaultInput || document.getElementById("shippingReturnCost")) return;

    const wrap = document.createElement("div");
    wrap.className = "form-field";
    wrap.innerHTML = `
      <label class="form-label" for="shippingReturnCost">تكلفة المرتجع لكل أوردر</label>
      <input class="form-input" id="shippingReturnCost" type="number" min="0" step="0.01" value="0">
      <div class="form-hint">تُضاف تلقائيًا إلى تكلفة الأوردر بعد الشحن عند تسجيله كمرتجع.</div>
    `;
    defaultInput.closest(".form-field")?.insertAdjacentElement("afterend", wrap);

    try {
      const companyId = window.AuthStore?.get?.().profile?.company_id;
      if (companyId) {
        const { data, error } = await supabaseClient
          .from("shipping_settings")
          .select("return_shipping_cost")
          .eq("company_id", companyId)
          .maybeSingle();
        if (!error && data) {
          document.getElementById("shippingReturnCost").value = Number(data.return_shipping_cost || 0);
        }
      }
    } catch (error) {
      console.warn("Could not load return shipping cost:", error);
    }

    form.addEventListener("submit", async () => {
      // The original Settings handler remains responsible for all existing
      // shipping fields. This second listener persists only this new field.
      try {
        await saveReturnCost(form);
      } catch (error) {
        console.error("Could not save return shipping cost:", error);
      }
    });
  }

  const observer = new MutationObserver(enhance);
  observer.observe(document.body, { childList: true, subtree: true });
  enhance();
})();
