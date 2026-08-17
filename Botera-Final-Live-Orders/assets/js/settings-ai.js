(async function initAiSettings() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_settings" });
  if (!profile) return;
  const notificationsTab = document.getElementById("notificationsTab");
  if (!notificationsTab) return;

  function apiError(error, fallback = "تعذر تنفيذ العملية.") {
    return error?.message || error?.error_description || fallback;
  }

  async function aiSettings(action, apiKey = "") {
    const { data, error } = await supabaseClient.functions.invoke("botera-ai-settings", {
      body: { action, api_key: apiKey }
    });
    if (error) throw new Error(apiError(error, "تعذر الاتصال بإعدادات AI."));
    if (!data?.ok) throw new Error(data?.error || "تعذر تحديث إعدادات AI.");
    return data;
  }

  function timeLabel(value) {
    if (!value) return "الآن";
    try { return new Date(value).toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" }); }
    catch (_) { return value; }
  }

  function notificationHtml(row) {
    const ok = row.type === "ai_action";
    return `<article class="ai-notification-row" data-notification-id="${escapeHtml(row.id)}" style="display:flex;gap:14px;align-items:flex-start;padding:16px 0;border-bottom:1px solid var(--color-border);">
      <span style="width:38px;height:38px;border-radius:12px;display:grid;place-items:center;background:${ok ? "rgba(34,197,94,.14)" : "rgba(239,68,68,.14)"};color:${ok ? "var(--color-neon)" : "#ff6b6b"};font-weight:900;flex:0 0 auto;">${ok ? "✓" : "!"}</span>
      <div style="min-width:0;flex:1;">
        <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;">
          <strong>${escapeHtml(row.title || "Botera AI")}</strong>
          <small style="color:var(--muted);white-space:nowrap;">${escapeHtml(timeLabel(row.created_at))}</small>
        </div>
        <p style="margin:7px 0 0;color:var(--muted);line-height:1.7;">${escapeHtml(row.message || "نفّذ النظام عملية تلقائية.")}</p>
      </div>
    </article>`;
  }

  async function renderNotifications() {
    notificationsTab.innerHTML = skeletonBlock("20px", 5);
    try {
      const rows = (await NotificationsService.list(profile.company_id)).filter((row) => ["ai_action", "ai_error"].includes(row.type));
      const unread = rows.filter((row) => !row.is_read).length;
      notificationsTab.innerHTML = `<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:18px;">
        <div><h2 class="section-title" style="margin:0;">Botera AI</h2><p style="color:var(--muted);margin:8px 0 0;">كل عملية ينفذها الـAI Agent تظهر هنا تلقائيًا.</p></div>
        <span class="badge ${unread ? "badge-neon" : "badge-sky"}">${unread} غير مقروءة</span>
      </div>
      <div class="card" style="background:var(--color-surface-2);border:1px solid var(--color-border);padding:0 18px;box-shadow:none;">
        ${rows.length ? rows.map(notificationHtml).join("") : `<div style="padding:44px 16px;text-align:center;color:var(--muted);">لا توجد عمليات AI مسجلة حتى الآن.</div>`}
      </div>
      <div style="margin-top:28px;">
        <h2 class="section-title">Gemini API</h2>
        <p style="color:var(--muted);margin:8px 0 16px;">غيّر مفتاح Gemini المستخدم بواسطة Botera AI. القيمة السرية لا تظهر كاملة بعد الحفظ.</p>
        <div class="card" style="background:var(--color-surface-2);border:1px solid var(--color-border);box-shadow:none;">
          <div id="aiApiStatus" style="margin-bottom:14px;color:var(--muted);">جاري التحقق...</div>
          <form id="aiApiForm">
            <div class="form-field"><label class="form-label" for="geminiApiKey">Gemini API Key</label><input class="form-input" id="geminiApiKey" type="password" autocomplete="new-password" placeholder="أدخل المفتاح الجديد"></div>
            <div id="aiApiError" class="form-error" style="display:none;"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <button class="btn" type="submit" id="saveGeminiBtn">حفظ المفتاح</button>
              <button class="btn-secondary" type="button" id="clearGeminiBtn">مسح المفتاح</button>
            </div>
          </form>
        </div>
      </div>`;

      const statusEl = document.getElementById("aiApiStatus");
      const form = document.getElementById("aiApiForm");
      const errorEl = document.getElementById("aiApiError");
      try {
        const status = await aiSettings("status");
        statusEl.innerHTML = status.configured
          ? `<span class="badge badge-neon">Gemini متصل</span><span style="margin-inline-start:10px;">${escapeHtml(status.masked || "••••")}</span>`
          : `<span class="badge badge-red">مفتاح Gemini غير مضبوط</span>`;
      } catch (error) {
        statusEl.textContent = apiError(error, "تعذر قراءة حالة Gemini.");
      }

      form?.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorEl.style.display = "none";
        const key = document.getElementById("geminiApiKey")?.value.trim() || "";
        if (!key) { errorEl.textContent = "اكتب مفتاح Gemini أولًا."; errorEl.style.display = "block"; return; }
        const button = document.getElementById("saveGeminiBtn");
        button.disabled = true;
        try {
          const result = await aiSettings("save", key);
          statusEl.innerHTML = `<span class="badge badge-neon">تم حفظ Gemini</span><span style="margin-inline-start:10px;">${escapeHtml(result.masked || "••••")}</span>`;
          form.reset();
        } catch (error) {
          errorEl.textContent = apiError(error, "تعذر حفظ مفتاح Gemini.");
          errorEl.style.display = "block";
        } finally { button.disabled = false; }
      });

      document.getElementById("clearGeminiBtn")?.addEventListener("click", async () => {
        errorEl.style.display = "none";
        try {
          await aiSettings("clear");
          statusEl.innerHTML = `<span class="badge badge-red">تم مسح مفتاح Gemini</span>`;
          form.reset();
        } catch (error) {
          errorEl.textContent = apiError(error, "تعذر مسح المفتاح.");
          errorEl.style.display = "block";
        }
      });
    } catch (error) {
      notificationsTab.innerHTML = `<div class="empty-state"><h3>تعذر تحميل إشعارات Botera AI</h3><p>${escapeHtml(apiError(error))}</p></div>`;
    }
  }

  await renderNotifications();
  let refreshTimer = setInterval(() => {
    if (!document.hidden && !notificationsTab.classList.contains("hidden")) renderNotifications();
  }, 5000);
  window.addEventListener("beforeunload", () => clearInterval(refreshTimer), { once: true });
})();