// Settings integrations UX enhancement.
// Adds Google Sheets Orders as an accordion card and gives every saved integration
// an explicit disconnect/reconnect flow without changing the existing integration backend.
(function () {
  const GOOGLE_CHANNEL = "sheets_orders";
  const GOOGLE_PROVIDER = "google";
  const WEBHOOK_FALLBACK = "https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/google-sheets-orders-webhook-v1";
  let busy = false;

  const esc = (value) => {
    const div = document.createElement("div");
    div.textContent = value == null ? "" : String(value);
    return div.innerHTML;
  };

  const toast = (message, error = false) => {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `position:fixed;bottom:24px;left:24px;z-index:10020;padding:12px 16px;border-radius:12px;background:${error ? "#3a1111" : "#102f1a"};color:#fff;border:1px solid ${error ? "#7f1d1d" : "#1f7a3d"};box-shadow:0 10px 30px rgba(0,0,0,.35);font-size:14px;direction:rtl;`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2600);
  };

  async function getProfile() {
    if (!window.useAuth?.ensureAuthenticated) return null;
    return window.useAuth.ensureAuthenticated({ requiredPermission: "can_view_settings" });
  }

  async function listRows(companyId) {
    const { data, error } = await window.supabaseClient
      .from("integration_accounts")
      .select("id,company_id,provider,channel,external_account_id,external_account_name,is_active,connection_status,metadata")
      .eq("company_id", companyId)
      .in("channel", ["facebook", "whatsapp", "instagram", "ads", GOOGLE_CHANNEL]);
    if (error) throw error;
    return data || [];
  }

  async function disconnectIntegration(row) {
    if (!row?.id) throw new Error("تعذر تحديد الربط.");
    const confirmText = row.channel === GOOGLE_CHANNEL
      ? "فصل ربط Google Sheets سيوقف مزامنة الأوردرات من هذا الشيت حتى تعمل حفظ وربط من جديد. هل تريد المتابعة؟"
      : "سيتم فصل هذا الربط داخل Botera ولن يظهر كربط نشط. هل تريد المتابعة؟";
    if (!window.confirm(confirmText)) return false;

    const nextMetadata = {
      ...(row.metadata || {}),
      connection_status: "disconnected",
      disconnected_at: new Date().toISOString()
    };
    const { error } = await window.supabaseClient
      .from("integration_accounts")
      .update({
        is_active: false,
        connection_status: "disconnected",
        metadata: nextMetadata,
        updated_at: new Date().toISOString()
      })
      .eq("id", row.id);
    if (error) throw error;
    toast("تم فصل الربط ✓");
    window.dispatchEvent(new CustomEvent("boterarealtimechange"));
    setTimeout(() => window.location.reload(), 350);
    return true;
  }

  function ensureDisconnectButton(card, row) {
    if (!card || !row?.is_active) return;
    if (card.querySelector("[data-disconnect-integration]")) return;
    const actionArea = card.querySelector("[data-integration-form] > div:last-child");
    if (!actionArea) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary";
    button.dataset.disconnectIntegration = row.id;
    button.textContent = "فصل الربط";
    button.style.borderColor = "#7f1d1d";
    button.style.color = "#fecaca";
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await disconnectIntegration(row);
      } catch (error) {
        button.disabled = false;
        toast(error?.message || "تعذر فصل الربط.", true);
      }
    });
    actionArea.appendChild(button);
  }

  async function enhanceExistingCards(companyId) {
    if (!companyId) return;
    try {
      const rows = await listRows(companyId);
      const byChannel = Object.fromEntries(rows.map((row) => [row.channel, row]));
      document.querySelectorAll("[data-integration-card]").forEach((card) => {
        const channel = card.dataset.integrationCard;
        ensureDisconnectButton(card, byChannel[channel]);
      });
    } catch (error) {
      console.warn("Botera integration controls unavailable:", error);
    }
  }

  function randomSecret() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, "");
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }

  function googleCardHtml(row) {
    const connected = !!row?.is_active;
    const metadata = row?.metadata || {};
    const sheetId = row?.external_account_id || metadata.sheet_id || "";
    const sheetName = metadata.sheet_name || "orders";
    const webhookUrl = metadata.webhook_url || WEBHOOK_FALLBACK;
    const secret = metadata.webhook_secret || "";
    const status = connected && (metadata.connection_status === "connected" || row?.connection_status === "connected")
      ? '<span class="badge badge-neon">تم الربط ✓</span>'
      : connected ? '<span class="badge badge-sky">تم حفظ البيانات</span>' : '<span class="badge badge-red">غير مربوط</span>';

    return `<article class="integration-card" data-integration-card="sheets_orders" data-google-sheets-enhancement="1" style="border:1px solid var(--color-border);border-radius:16px;margin-top:14px;overflow:hidden;">
      <button type="button" data-google-toggle style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:transparent;border:0;color:inherit;padding:18px;cursor:pointer;text-align:right;direction:rtl;">
        <span style="display:flex;align-items:center;gap:12px;">
          <span style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--color-surface-2);font-weight:800;">GS</span>
          <span><strong style="display:block;">Google Sheets — Orders</strong><small style="color:var(--muted);">مزامنة الأوردرات تلقائيًا من تبويب orders إلى Botera.</small></span>
        </span>
        <span style="display:flex;align-items:center;gap:10px;">${status}<span data-google-chevron>⌄</span></span>
      </button>
      <div class="integration-card-body hidden" data-google-body style="padding:0 18px 18px;">
        <form data-google-form>
          <div class="form-grid-2">
            <div class="form-field"><label class="form-label">معرّف جدول البيانات</label><input class="form-input" name="sheet_id" value="${esc(sheetId)}" placeholder="Google Sheet ID" required></div>
            <div class="form-field"><label class="form-label">اسم الورقة</label><input class="form-input" name="sheet_name" value="${esc(sheetName)}" placeholder="orders" required></div>
            <div class="form-field" style="grid-column:1/-1"><label class="form-label">Webhook URL</label><input class="form-input" name="webhook_url" value="${esc(webhookUrl)}" readonly></div>
            <div class="form-field" style="grid-column:1/-1"><label class="form-label">Webhook Secret</label><input class="form-input" name="webhook_secret" value="${esc(secret)}" type="text" readonly placeholder="سيظهر عند أول حفظ أو إعادة ربط"></div>
          </div>
          <div class="form-error" data-google-error style="display:none;"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:12px;">
            <button class="btn" type="submit">حفظ وربط Google Sheets</button>
            ${connected ? '<button class="btn-secondary" type="button" data-google-disconnect>فصل الربط</button>' : ''}
            <button class="btn-secondary" type="button" data-google-generate>توليد Secret جديد</button>
          </div>
          <div style="margin-top:12px;color:var(--muted);line-height:1.7;font-size:13px;">بعد تغيير الـSheet أو الـSecret، حدّث Apps Script في الشيت الجديد بنفس الـWebhook والـSecret ثم اترك Trigger <b>boteraOnEdit</b> كما هو.</div>
        </form>
      </div>
    </article>`;
  }

  async function saveGoogleForm(form, companyId, currentRow) {
    const sheetId = form.elements.sheet_id.value.trim();
    const sheetName = form.elements.sheet_name.value.trim() || "orders";
    let secret = form.elements.webhook_secret.value.trim();
    if (!sheetId) throw new Error("من فضلك أدخل معرّف Google Sheet.");
    if (!secret || !currentRow?.is_active || currentRow.external_account_id !== sheetId) secret = randomSecret();

    const metadata = {
      ...(currentRow?.metadata || {}),
      sheet_id: sheetId,
      sheet_name: sheetName,
      webhook_url: WEBHOOK_FALLBACK,
      webhook_secret: secret,
      connection_status: "connected",
      connected_at: new Date().toISOString(),
    };

    if (currentRow?.id) {
      const { error } = await window.supabaseClient
        .from("integration_accounts")
        .update({
          provider: GOOGLE_PROVIDER,
          channel: GOOGLE_CHANNEL,
          external_account_id: sheetId,
          external_account_name: sheetName,
          is_active: true,
          connection_status: "connected",
          metadata,
          updated_at: new Date().toISOString(),
        })
        .eq("id", currentRow.id);
      if (error) throw error;
    } else {
      const { error } = await window.supabaseClient
        .from("integration_accounts")
        .insert({
          company_id: companyId,
          provider: GOOGLE_PROVIDER,
          channel: GOOGLE_CHANNEL,
          external_account_id: sheetId,
          external_account_name: sheetName,
          is_active: true,
          connection_status: "connected",
          metadata,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      if (error) throw error;
    }
    toast("تم ربط Google Sheets ✓");
    window.dispatchEvent(new CustomEvent("boterarealtimechange"));
    form.elements.webhook_secret.value = secret;
    setTimeout(() => window.location.reload(), 500);
  }

  async function renderGoogleCard(companyId) {
    const integrationsTab = document.getElementById("integrationsTab");
    if (!integrationsTab) return;
    let rows = [];
    try {
      rows = await listRows(companyId);
    } catch (error) {
      console.warn(error);
    }
    const currentRow = rows.find((r) => r.channel === GOOGLE_CHANNEL) || null;
    const existing = integrationsTab.querySelector('[data-google-sheets-enhancement="1"]');
    if (existing) existing.remove();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = googleCardHtml(currentRow);
    const card = wrapper.firstElementChild;
    integrationsTab.appendChild(card);

    const toggle = card.querySelector("[data-google-toggle]");
    const body = card.querySelector("[data-google-body]");
    toggle.addEventListener("click", () => {
      body.classList.toggle("hidden");
      card.querySelector("[data-google-chevron]").textContent = body.classList.contains("hidden") ? "⌄" : "⌃";
    });

    const form = card.querySelector("[data-google-form]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      busy = true;
      const submit = form.querySelector("button[type=submit]");
      const errorEl = form.querySelector("[data-google-error]");
      submit.disabled = true;
      errorEl.style.display = "none";
      try {
        await saveGoogleForm(form, companyId, currentRow);
      } catch (error) {
        errorEl.textContent = error?.message || "تعذر حفظ الربط.";
        errorEl.style.display = "block";
        submit.disabled = false;
      } finally {
        busy = false;
      }
    });

    form.querySelector("[data-google-generate]")?.addEventListener("click", () => {
      form.elements.webhook_secret.value = randomSecret();
      toast("تم توليد Secret جديد — احفظ الربط ثم حدّث Apps Script.");
    });

    form.querySelector("[data-google-disconnect]")?.addEventListener("click", async () => {
      if (!currentRow) return;
      const button = form.querySelector("[data-google-disconnect]");
      button.disabled = true;
      try {
        await disconnectIntegration(currentRow);
      } catch (error) {
        button.disabled = false;
        toast(error?.message || "تعذر فصل Google Sheets.", true);
      }
    });
  }

  async function boot() {
    try {
      const profile = await getProfile();
      if (!profile?.company_id) return;
      window.__BOTERA_PROFILE__ = profile;
      const observer = new MutationObserver(() => {
        enhanceExistingCards(profile.company_id);
        const integrationsTab = document.getElementById("integrationsTab");
        if (integrationsTab && !integrationsTab.querySelector('[data-google-sheets-enhancement="1"]')) {
          renderGoogleCard(profile.company_id);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      enhanceExistingCards(profile.company_id);
      renderGoogleCard(profile.company_id);
    } catch (error) {
      console.warn("Botera integrations enhancement failed:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
