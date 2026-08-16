(async function init() {

  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_settings" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();
  const canManageTeam = !!(profile.is_platform_owner || profile.can_manage_team);
  if (!canManageTeam) document.getElementById("teamTabBtn")?.remove();

  const profileTab = document.getElementById("profileTab");
  const integrationsTab = document.getElementById("integrationsTab");
  const notificationsTab = document.getElementById("notificationsTab");
  const teamTab = document.getElementById("teamTab");
  const productsTab = document.getElementById("productsTab");
  const financeTab = document.getElementById("financeTab");
  if (!financeTab) console.error("financeTab is missing from settings.html");
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => {
    const activeTab = button.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll("[data-tab-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.tabPanel !== activeTab));
  }));

  profileTab.innerHTML = skeletonBlock("24px", 4);
  let connected = false, customers = [], orders = [];
  if (isSupabaseConfigured()) {
    try {
      [customers, orders] = await Promise.all([CustomersService.list(profile.company_id), OrdersService.list(profile.company_id)]);
      connected = true;
    } catch (error) {
      connected = false;
    }
  }

  const company = profile.company || {};
  profileTab.innerHTML = `<h2 class="section-title">Profile</h2><ul class="detail-list" style="margin-top:var(--space-5);">
    <li><strong>الشركة:</strong> ${escapeHtml(company.name || "—")}</li>
    <li><strong>المجال:</strong> ${escapeHtml(company.industry || "—")}</li>
    <li><strong>الدولة:</strong> ${escapeHtml(company.country || "—")}</li>
    <li><strong>العملة:</strong> ${escapeHtml(company.currency || "—")}</li>
    <li><strong>العملاء المسجلون:</strong> ${connected ? customers.length : "تعذر التحقق"}</li>
    <li><strong>الطلبات المسجلة:</strong> ${connected ? orders.length : "تعذر التحقق"}</li>
    <li><strong>حالة قاعدة البيانات:</strong> ${connected ? '<span class="badge badge-neon">متصل</span>' : '<span class="badge badge-red">غير متصل</span>'}</li>
  </ul>`;

  // Each automation reports a heartbeat into integration_status (see
  // supabase/06-integration-status.sql) whenever it runs successfully.
  // TikTok and Email have no automation reporting yet, so they honestly
  // stay "غير متصل" until one exists — nothing here is guessed.
  const INTEGRATIONS = [
    { label: "WhatsApp", key: "whatsapp_bot" },
    { label: "Instagram", key: "instagram_bot" },
    { label: "Facebook", key: "facebook_bot" },
    { label: "TikTok", key: null },
    { label: "تقرير الإعلانات", key: "ads_report" },
    { label: "شركة شحن", key: "shipping" },
    { label: "Email", key: null },
  ];

  // ---- Channel credentials -------------------------------------------------
  // Credentials are stored server-side. Secret values are never returned to
  // the browser after saving. Each card starts collapsed; clicking the
  // platform name opens its fields.
  async function invokeIntegrationCredentials(payload) {
    const { data, error } = await supabaseClient.functions.invoke(
      "save-integration-credentials-v2",
      { body: { company_id: profile.company_id, ...payload } }
    );
    if (error) {
      let message = error.message || "تعذر الاتصال بخدمة الربط.";
      try {
        const body = await error.context?.json?.();
        message = body?.details || body?.error || message;
      } catch (_) {}
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.details || data?.error || "تعذر حفظ بيانات الربط.");
    return data;
  }

  async function validateFacebookConnection() {
    const { data, error } = await supabaseClient.functions.invoke(
      "validate-facebook-connection-v2",
      { body: { company_id: profile.company_id } }
    );
    if (error) {
      let message = error.message || "تعذر اختبار اتصال Facebook.";
      try {
        const body = await error.context?.json?.();
        message = body?.details || body?.error || message;
      } catch (_) {}
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.details || data?.error || "بيانات Facebook غير صالحة.");
    return data;
  }

  const CHANNEL_FORMS = {
    facebook: {
      title: "Facebook / Messenger",
      icon: "f",
      description: "اربط صفحة Facebook لاستقبال وإدارة رسائل العملاء. بعد الربط يتم الاشتراك في رسائل الصفحة تلقائيًا، ويبقى تفعيل Callback في Meta مطلوبًا مرة واحدة.",
      fields: [
        { key: "app_id", label: "Meta App ID", placeholder: "مثال: 1234567890" },
        { key: "app_secret", label: "Meta App Secret", secret: true, placeholder: "App Secret" },
        { key: "page_id", label: "Facebook Page ID", placeholder: "معرّف الصفحة" },
        { key: "access_token", label: "Page Access Token", secret: true, placeholder: "Page access token" },
      ],
      validate: true,
    },
    whatsapp: {
      title: "WhatsApp Business",
      icon: "wa",
      description: "اربط رقم WhatsApp Business لاستخدام Cloud API.",
      fields: [
        { key: "app_id", label: "Meta App ID", placeholder: "Meta App ID" },
        { key: "app_secret", label: "Meta App Secret", secret: true, placeholder: "App Secret" },
        { key: "phone_number_id", label: "Phone Number ID", placeholder: "WhatsApp Phone Number ID" },
        { key: "waba_id", label: "WhatsApp Business Account ID (WABA)", placeholder: "WABA ID" },
        { key: "access_token", label: "WhatsApp Access Token", secret: true, placeholder: "Cloud API token" },
      ],
    },
    instagram: {
      title: "Instagram Professional",
      icon: "ig",
      description: "اربط حساب Instagram Professional للرسائل والتقارير.",
      fields: [
        { key: "app_id", label: "Meta App ID", placeholder: "Meta App ID" },
        { key: "app_secret", label: "Meta App Secret", secret: true, placeholder: "App Secret" },
        { key: "instagram_account_id", label: "Instagram Account ID", placeholder: "Professional account ID" },
        { key: "access_token", label: "Instagram Access Token", secret: true, placeholder: "Instagram access token" },
      ],
    },
    ads: {
      title: "الإعلانات والتقارير",
      icon: "ads",
      description: "بيانات حساب الإعلانات التي سيستخدمها النظام لتجميع الإنفاق والحملات داخل التقارير.",
      fields: [
        { key: "platform", label: "منصة الإعلانات", placeholder: "meta / tiktok / google" },
        { key: "ad_account_id", label: "Ad Account ID", placeholder: "مثال: act_123456789" },
        { key: "app_id", label: "App ID", placeholder: "App ID" },
        { key: "app_secret", label: "App Secret", secret: true, placeholder: "App Secret" },
        { key: "access_token", label: "Access Token", secret: true, placeholder: "Ad platform access token" },
      ],
    },
  };

  function integrationCard(channel, cfg, row) {
    const connected = !!row?.is_active;
    const status = row?.metadata?.connection_status === "connected" || row?.metadata?.validated_page_id
      ? '<span class="badge badge-neon">تم الربط ✓</span>'
      : connected ? '<span class="badge badge-sky">تم حفظ البيانات</span>' : '<span class="badge badge-red">غير مربوط</span>';
    const fields = cfg.fields.map((field) => `
      <div class="form-field">
        <label class="form-label" for="int-${channel}-${field.key}">${escapeHtml(field.label)}</label>
        <input class="form-input" id="int-${channel}-${field.key}" type="${field.secret ? "password" : "text"}"
          placeholder="${escapeHtml(field.placeholder || "")}" autocomplete="off">
        ${field.secret ? '<small style="color:var(--muted);display:block;margin-top:6px;">القيمة السرية لا تظهر مرة أخرى بعد الحفظ.</small>' : ""}
      </div>`).join("");
    const action = channel === "facebook"
      ? '<button class="btn-secondary" type="button" data-test-facebook>اختبار الاتصال</button>'
      : (channel === "whatsapp" || channel === "instagram" ? `<button class="btn-secondary" type="button" data-test-channel="${channel}">اختبار الاتصال والـWebhook</button>` : '');
    return `<article class="integration-card" data-integration-card="${channel}" style="border:1px solid var(--color-border);border-radius:16px;margin-top:14px;overflow:hidden;">
      <button type="button" data-integration-toggle="${channel}" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:transparent;border:0;color:inherit;padding:18px;cursor:pointer;text-align:right;">
        <span style="display:flex;align-items:center;gap:12px;"><span style="width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--color-surface-2);font-weight:800;">${escapeHtml(cfg.icon)}</span><span><strong style="display:block;">${escapeHtml(cfg.title)}</strong><small style="color:var(--muted);">${escapeHtml(cfg.description)}</small></span></span>
        <span style="display:flex;align-items:center;gap:10px;">${status}<span data-chevron>⌄</span></span>
      </button>
      <div class="integration-card-body hidden" data-integration-body="${channel}" style="padding:0 18px 18px;">
        <form class="settings-add-form" data-integration-form="${channel}">
          <div class="form-grid-2">${fields}</div>
          <div class="form-error" data-integration-error="${channel}" style="display:none;"></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
            <button class="btn" type="submit" data-integration-submit="${channel}">حفظ وربط</button>${action}
          </div>
        </form>
      </div>
    </article>`;
  }

  async function renderChannelConnections(existingRows = []) {
    const byChannel = Object.fromEntries(existingRows.map((row) => [row.channel, row]));
    const adRow = byChannel.ads || byChannel.meta_ads || byChannel.tiktok_ads || byChannel.google_ads;
    integrationsTab.innerHTML = `<h2 class="section-title">Integrations</h2>
      <div class="detail-list" style="margin-top:var(--space-4);"><div style="color:var(--muted);line-height:1.7;">اضغط على اسم المنصة لفتح بيانات الربط. بعد الحفظ تظهر الحالة هنا، وFacebook يمكن اختباره فعليًا مع Meta. قسم الإعلانات مخصص لبيانات حساب الإعلانات التي تغذي تقارير الإنفاق والحملات.</div></div>
      ${integrationCard("facebook", CHANNEL_FORMS.facebook, byChannel.facebook)}
      ${integrationCard("whatsapp", CHANNEL_FORMS.whatsapp, byChannel.whatsapp)}
      ${integrationCard("instagram", CHANNEL_FORMS.instagram, byChannel.instagram)}
      ${integrationCard("ads", CHANNEL_FORMS.ads, adRow)}
      <div id="channelStatusList" style="margin-top:var(--space-5);"></div>`;

    const statusList = document.getElementById("channelStatusList");
    const renderStatus = (rows) => {
      const map = Object.fromEntries(rows.map((row) => [row.channel, row]));
      const ads = map.ads || map.meta_ads || map.tiktok_ads || map.google_ads;
      const rowsForStatus = [
        ["facebook", "Facebook / Messenger"], ["whatsapp", "WhatsApp Business"], ["instagram", "Instagram Professional"], ["ads", "الإعلانات والتقارير"],
      ];
      statusList.innerHTML = `<ul class="integration-list">${rowsForStatus.map(([channel, label]) => {
        const row = channel === "ads" ? ads : map[channel];
        const connected = row?.metadata?.connection_status === "connected" || row?.is_active;
        return `<li><span>${escapeHtml(label)}</span>${connected ? '<span class="badge badge-neon">تم الربط ✓</span>' : '<span class="badge badge-red">غير مربوط</span>'}</li>`;
      }).join("")}</ul>`;
    };
    renderStatus(existingRows);

    integrationsTab.querySelectorAll("[data-integration-toggle]").forEach((toggle) => toggle.addEventListener("click", () => {
      const channel = toggle.dataset.integrationToggle;
      const body = integrationsTab.querySelector(`[data-integration-body="${channel}"]`);
      body?.classList.toggle("hidden");
      const chev = toggle.querySelector("[data-chevron]");
      if (chev) chev.textContent = body?.classList.contains("hidden") ? "⌄" : "⌃";
    }));

    integrationsTab.querySelectorAll("[data-integration-form]").forEach((form) => form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const channel = form.dataset.integrationForm;
      const cfg = CHANNEL_FORMS[channel];
      const errorEl = form.querySelector(`[data-integration-error="${channel}"]`);
      const button = form.querySelector(`[data-integration-submit="${channel}"]`);
      errorEl.style.display = "none";
      const payload = {};
      cfg.fields.forEach((field) => {
        const value = document.getElementById(`int-${channel}-${field.key}`).value.trim();
        if (value) payload[field.key] = value;
      });
      const requiredKeys = cfg.fields.filter((f) => f.key !== "app_secret" || payload.app_secret).map((f) => f.key);
      const missing = requiredKeys.find((key) => !payload[key]);
      if (missing) {
        errorEl.textContent = "من فضلك أكمل كل بيانات الربط المطلوبة.";
        errorEl.style.display = "block";
        return;
      }
      errorEl.textContent = "";
      errorEl.style.display = "none";
      button.disabled = true;
      button.textContent = "جارٍ الحفظ…";
      try {
        const normalizedChannel = channel === "ads" ? "ads" : channel;
        const saved = await invokeIntegrationCredentials({
          action: "save", provider: channel === "ads" ? (payload.platform || "meta") : "meta", channel: normalizedChannel,
          external_account_id: payload.page_id || payload.phone_number_id || payload.instagram_account_id || payload.ad_account_id || `${channel}:${profile.company_id}`,
          external_account_name: payload.page_id || payload.phone_number_id || payload.instagram_account_id || payload.ad_account_id || null,
          access_token: payload.access_token || null,
          app_secret: payload.app_secret || null,
          metadata: {
            app_id: payload.app_id || null,
            app_secret_saved: !!payload.app_secret,
            page_id: payload.page_id || null,
            phone_number_id: payload.phone_number_id || null,
            waba_id: payload.waba_id || null,
            instagram_account_id: payload.instagram_account_id || null,
            ad_account_id: payload.ad_account_id || null,
            platform: payload.platform || (channel === "ads" ? "meta" : null),
          },
          is_active: true,
        });

        let successText = "تم الربط ✓";
        if (channel === "facebook") {
          button.textContent = "جارٍ اختبار Facebook…";
          const result = await validateFacebookConnection();
          if (result?.webhook?.subscribed) successText = "تم الربط + استقبال الرسائل ✓";
        } else if (channel !== "ads") {
          successText = "تم حفظ بيانات الربط ✓";
        }
        button.textContent = successText;
        errorEl.textContent = "";
        errorEl.style.display = "none";
        const rows = await invokeIntegrationCredentials({ action: "list" });
        renderStatus(rows.data || []);
        setTimeout(() => { button.textContent = "حفظ وربط"; button.disabled = false; }, 1800);
      } catch (error) {
        errorEl.textContent = error.message || "تعذر إتمام الربط.";
        errorEl.style.display = "block";
        button.disabled = false;
        button.textContent = "حفظ وربط";
      }
    }));

    integrationsTab.querySelector("[data-test-facebook]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const errorEl = integrationsTab.querySelector('[data-integration-error="facebook"]');
      errorEl.textContent = "";
      errorEl.style.display = "none";
      try {
        button.disabled = true; button.textContent = "جارٍ الاختبار…";
        const result = await validateFacebookConnection();
        button.textContent = result?.webhook?.subscribed ? "تم الربط + استقبال الرسائل ✓" : "تم الربط ✓";
        errorEl.textContent = "";
        errorEl.style.display = "none";
        const rows = await invokeIntegrationCredentials({ action: "list" });
        renderStatus(rows.data || []);
      } catch (error) {
        errorEl.textContent = error.message || "بيانات Facebook غير صالحة.";
        errorEl.style.display = "block";
        button.textContent = "فشل الاختبار";
      } finally { setTimeout(() => { button.disabled = false; button.textContent = "اختبار الاتصال"; }, 1800); }
    });

    integrationsTab.querySelectorAll("[data-test-channel]").forEach((button) => button.addEventListener("click", async () => {
      const channel = button.dataset.testChannel;
      const card = integrationsTab.querySelector(`[data-integration-card="${channel}"]`);
      const errorBox = card?.querySelector(`[data-integration-error="${channel}"]`);
      if (errorBox) { errorBox.style.display = "none"; errorBox.textContent = ""; }
      button.disabled = true; const original = button.textContent; button.textContent = "جارٍ الاختبار…";
      try {
        const { data, error } = await supabaseClient.functions.invoke("validate-meta-channel-v2", { body: { company_id: profile.company_id, channel } });
        if (error) throw new Error(error.message || "تعذر اختبار الاتصال.");
        if (!data?.ok) throw new Error(data?.details || data?.error || "بيانات الربط غير صالحة.");
        button.textContent = "تم الربط + Webhook ✓";
        const rows = await invokeIntegrationCredentials({ action: "list" });
        renderStatus(rows.data || []);
      } catch (e) { if (errorBox) { errorBox.textContent = e.message || "فشل الاختبار"; errorBox.style.display = "block"; } button.textContent = "فشل الاختبار"; }
      setTimeout(() => { button.textContent = original; button.disabled = false; }, 2500);
    }));
  }

  let integrationAccounts = [];
  try {
    if (isSupabaseConfigured()) {
      const result = await invokeIntegrationCredentials({ action: "list" });
      integrationAccounts = result.data || [];
    }
  } catch (error) {
    console.warn("Could not load integration accounts:", error);
  }
  renderChannelConnections(integrationAccounts);

  // ---- Notifications: real table now (see supabase/02-real-backend.sql),
  // populated by trusted server-side processes (e.g. an n8n workflow) —
  // starts empty for every company until something writes to it.
  let allNotifications = [], notificationsLoaded = false;
  async function renderNotifications() {
    if (!notificationsLoaded) notificationsTab.innerHTML = `<h2 class="section-title">Notifications</h2>${skeletonBlock("40px", 4)}`;
    try {
      if (!notificationsLoaded) { allNotifications = await NotificationsService.list(profile.company_id); notificationsLoaded = true; }
      const range = DateRange.getCurrent();
      const visible = allNotifications.filter((n) => DateRange.within(n.created_at, range));
      notificationsTab.innerHTML = `<h2 class="section-title">Notifications</h2>${visible.length ? `<ul class="activity-list" style="margin-top:var(--space-5);">${visible.map((n) => `<li><span class="badge badge-sky">${escapeHtml(n.type)}</span><span>${escapeHtml(n.title)}</span><time class="activity-time">${formatDate(n.created_at)}</time></li>`).join("")}</ul>` : emptyState("لا توجد إشعارات بعد", "الإشعارات هتظهر هنا تلقائيًا لما workflows الأتمتة تتصل.")}`;
    } catch (error) {
      notificationsTab.innerHTML = `<h2 class="section-title">Notifications</h2>${errorState("تعذر تحميل الإشعارات", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase.")}`;
    }
  }
  await renderNotifications();
  window.addEventListener("boteradaterangechange", renderNotifications);

  // ---- Team --------------------------------------------------------------
  // Only rendered at all when the tab button exists (owner / can_manage_team
  // — see canManageTeam above and the tab-button removal at the top).
  const TEAM_PERMS = [
    { key: "can_view_conversations", label: "محادثات" },
    { key: "can_view_customers", label: "عملاء" },
    { key: "can_view_orders", label: "طلبات" },
    { key: "can_view_insights", label: "تقارير" },
    { key: "can_view_automation", label: "توصيات الأتمتة" },
    { key: "can_view_settings", label: "إعدادات" },
    { key: "can_manage_team", label: "إدارة الفريق" },
  ];

  function roleLabel(r) { return r === "owner" ? '<span class="badge badge-neon">مالك</span>' : '<span class="badge badge-sky">موظف</span>'; }

  function teamRowHtml(member) {
    const locked = member.role === "owner"; // never edit the owner's own permissions from this UI
    const checks = TEAM_PERMS.map((p) => `<label class="permission-check"><input type="checkbox" data-member-id="${member.id}" data-perm-key="${p.key}" ${member[p.key] ? "checked" : ""} ${locked ? "disabled" : ""}> ${p.label}</label>`).join("");
    return `<tr data-member-row="${member.id}">
      <td>${escapeHtml(member.full_name)}</td>
      <td>${roleLabel(member.role)}</td>
      <td><div class="permission-checks">${checks}</div></td>
      <td>${locked ? "—" : `<button class="btn-secondary" type="button" data-save-member="${member.id}">حفظ</button>`}</td>
    </tr>`;
  }

  async function renderTeam() {
    if (!canManageTeam) return;
    if (!isSupabaseConfigured()) {
      teamTab.innerHTML = `<h2 class="section-title">Team</h2>${emptyState("لا يوجد اتصال بقاعدة بيانات", "اربط مشروع Supabase أولاً من assets/lib/supabase-client.js.")}`;
      return;
    }
    teamTab.innerHTML = `<h2 class="section-title">Team</h2>${skeletonBlock("40px", 3)}`;
    let team = [];
    try {
      team = await TeamService.list(profile.company_id);
    } catch (error) {
      teamTab.innerHTML = `<h2 class="section-title">Team</h2>${errorState("تعذر تحميل الفريق", "تحقق من اتصالك وحاول مرة أخرى.")}`;
      return;
    }

    const addMemberForm = `<form id="addMemberForm" class="settings-add-form" style="margin-top:var(--space-5);">
      <div class="form-section-title">إضافة عضو جديد</div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="memberName">الاسم</label><input class="form-input" id="memberName" required></div>
        <div class="form-field"><label class="form-label" for="memberEmail">الإيميل</label><input class="form-input" id="memberEmail" type="email" required></div>
      </div>
      <div class="form-field"><label class="form-label" for="memberPassword">كلمة السر</label><input class="form-input" id="memberPassword" type="password" minlength="8" required></div>
      <div class="form-field"><span class="form-label">الصلاحيات</span>
        <div class="permission-checks">${TEAM_PERMS.map((p) => `<label class="permission-check"><input type="checkbox" name="newMemberPerm" value="${p.key}"> ${p.label}</label>`).join("")}</div>
      </div>
      <div class="form-error" id="addMemberError" style="display:none;"></div>
      <button class="btn" type="submit" id="addMemberSubmit">إضافة عضو</button>
    </form>`;

    const tableHtml = team.length
      ? `<div class="table-wrap" style="margin-top:var(--space-5);"><table class="data-table"><thead><tr><th>الاسم</th><th>الدور</th><th>الصلاحيات</th><th></th></tr></thead><tbody>${team.map(teamRowHtml).join("")}</tbody></table></div>`
      : emptyState("لا توجد حسابات فريق بعد", "أضف أول عضو من النموذج فوق.");

    teamTab.innerHTML = `<h2 class="section-title">Team</h2>${tableHtml}${addMemberForm}`;

    teamTab.querySelectorAll("[data-save-member]").forEach((button) => button.addEventListener("click", async () => {
      const memberId = button.dataset.saveMember;
      const row = teamTab.querySelector(`tr[data-member-row="${memberId}"]`);
      const permissions = {};
      TEAM_PERMS.forEach((p) => {
        permissions[p.key] = row.querySelector(`input[data-perm-key="${p.key}"]`).checked;
      });
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "جارٍ الحفظ…";
      try {
        await TeamService.updatePermissions(memberId, permissions);
        button.textContent = "تم الحفظ ✓";
        setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 1500);
      } catch (error) {
        button.textContent = "تعذر الحفظ";
        setTimeout(() => { button.textContent = originalText; button.disabled = false; }, 2000);
      }
    }));

    const addForm = document.getElementById("addMemberForm");
    const addError = document.getElementById("addMemberError");
    const addSubmit = document.getElementById("addMemberSubmit");
    addForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      addError.style.display = "none";
      const fullName = document.getElementById("memberName").value.trim();
      const email = document.getElementById("memberEmail").value.trim();
      const password = document.getElementById("memberPassword").value;
      const permissions = {};
      addForm.querySelectorAll('input[name="newMemberPerm"]').forEach((input) => { permissions[input.value] = input.checked; });

      if (!fullName || !email) { addError.textContent = "من فضلك أكمل الاسم والإيميل."; addError.style.display = "block"; return; }
      if (password.length < 8) { addError.textContent = "كلمة السر لازم تكون 8 أحرف على الأقل."; addError.style.display = "block"; return; }

      addSubmit.disabled = true;
      addSubmit.textContent = "جارٍ الإضافة…";
      try {
        await TeamService.invite({ fullName, email, password, permissions });
        await renderTeam();
      } catch (error) {
        addError.textContent = error.message || "تعذر إضافة العضو.";
        addError.style.display = "block";
        addSubmit.disabled = false;
        addSubmit.textContent = "إضافة عضو";
      }
    });
  }
  await renderTeam();

  // ---- Products ------------------------------------------------------------
  // Writable from here now (see supabase/07-fixes-team-products.sql) — the
  // cost entered here is what powers real profit numbers once orders start
  // referencing a product's cost.
  function productRowHtml(product, currency) {
    return `<tr data-product-row="${product.id}">
      <td>${escapeHtml(product.name)}</td>
      <td>${escapeHtml(product.sku || "—")}</td>
      <td>${formatMoney(product.price, currency)}</td>
      <td>${formatMoney(product.cost, currency)}</td>
      <td>${escapeHtml(product.description || "—")}</td>
      <td><button class="btn-secondary" type="button" data-delete-product="${product.id}">حذف</button></td>
    </tr>`;
  }

  async function renderProducts() {
    if (!isSupabaseConfigured()) {
      productsTab.innerHTML = `<h2 class="section-title">Products</h2>${emptyState("لا يوجد اتصال بقاعدة بيانات", "اربط مشروع Supabase أولاً من assets/lib/supabase-client.js.")}`;
      return;
    }
    productsTab.innerHTML = `<h2 class="section-title">Products</h2>${skeletonBlock("40px", 3)}`;
    let products = [];
    try {
      products = await ProductsService.list(profile.company_id);
    } catch (error) {
      productsTab.innerHTML = `<h2 class="section-title">Products</h2>${errorState("تعذر تحميل المنتجات", "تحقق من اتصالك وحاول مرة أخرى.")}`;
      return;
    }

    const currency = company.currency || "EGP";
    const addForm = `<form id="addProductForm" class="settings-add-form" style="margin-top:var(--space-5);">
      <div class="form-section-title">إضافة منتج جديد</div>
      <div class="form-grid-2">
        <div class="form-field"><label class="form-label" for="productName">اسم المنتج</label><input class="form-input" id="productName" required></div>
        <div class="form-field"><label class="form-label" for="productSku">SKU (اختياري)</label><input class="form-input" id="productSku"></div>
        <div class="form-field"><label class="form-label" for="productPrice">سعر البيع</label><input class="form-input" id="productPrice" type="number" min="0" step="0.01" required></div>
        <div class="form-field"><label class="form-label" for="productCost">التكلفة</label><input class="form-input" id="productCost" type="number" min="0" step="0.01" required></div>
        <div class="form-field" style="grid-column:1/-1"><label class="form-label" for="productDescription">محتوى / وصف المنتج</label><textarea class="form-input" id="productDescription" rows="5" placeholder="اكتب هنا محتوى المنتج، المميزات، طريقة الاستخدام، المعلومات التي سيستخدمها الـAI..."></textarea></div>
      </div>
      <div class="form-error" id="addProductError" style="display:none;"></div>
      <button class="btn" type="submit" id="addProductSubmit">إضافة منتج</button>
    </form>`;

    const tableHtml = products.length
      ? `<div class="table-wrap" style="margin-top:var(--space-5);"><table class="data-table"><thead><tr><th>الاسم</th><th>SKU</th><th>السعر</th><th>التكلفة</th><th>محتوى المنتج</th><th></th></tr></thead><tbody>${products.map((p) => productRowHtml(p, currency)).join("")}</tbody></table></div>`
      : emptyState("لا توجد منتجات بعد", "أضف أول منتج من النموذج تحت — التكلفة اللي هتدخلها هنا هي أساس حساب الربح الحقيقي.");

    productsTab.innerHTML = `<h2 class="section-title">Products</h2>${tableHtml}${addForm}`;

    productsTab.querySelectorAll("[data-delete-product]").forEach((button) => button.addEventListener("click", async () => {
      if (!confirm("تأكيد حذف المنتج؟")) return;
      button.disabled = true;
      try {
        await ProductsService.remove(button.dataset.deleteProduct);
        await renderProducts();
      } catch (error) {
        button.disabled = false;
      }
    }));

    const productForm = document.getElementById("addProductForm");
    const productError = document.getElementById("addProductError");
    const productSubmit = document.getElementById("addProductSubmit");
    productForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      productError.style.display = "none";
      const name = document.getElementById("productName").value.trim();
      const sku = document.getElementById("productSku").value.trim();
      const price = Number(document.getElementById("productPrice").value);
      const cost = Number(document.getElementById("productCost").value);
      const description = document.getElementById("productDescription").value.trim();

      if (!name) { productError.textContent = "من فضلك أدخل اسم المنتج."; productError.style.display = "block"; return; }
      if (Number.isNaN(price) || price < 0 || Number.isNaN(cost) || cost < 0) { productError.textContent = "من فضلك أدخل سعر وتكلفة صحيحين."; productError.style.display = "block"; return; }

      productSubmit.disabled = true;
      productSubmit.textContent = "جارٍ الإضافة…";
      try {
        await ProductsService.create(profile.company_id, { name, sku: sku || null, price, cost, description: description || null });
        await renderProducts();
      } catch (error) {
        productError.textContent = error.message || "تعذر إضافة المنتج.";
        productError.style.display = "block";
        productSubmit.disabled = false;
        productSubmit.textContent = "إضافة منتج";
      }
    });
  }

  // ---- Shipping & Ads finance ---------------------------------------------
  async function renderFinance() {
    financeTab.innerHTML = `<h2 class="section-title">الشحن والإعلانات</h2>${skeletonBlock("40px", 3)}`;
    const companyId = profile.company_id;
    const today = new Date().toISOString().slice(0,10);
    try {
      const [{ data: shipping, error: shippingError }, { data: adExpenses, error: adError }] = await Promise.all([
        supabaseClient.from("shipping_settings").select("*").eq("company_id", companyId).maybeSingle(),
        supabaseClient.from("ad_expenses").select("*").eq("company_id", companyId).order("expense_date",{ascending:false}).limit(100)
      ]);
      if (shippingError) throw shippingError;
      if (adError) throw adError;
      financeTab.innerHTML = `
        <h2 class="section-title">الشحن والإعلانات</h2>
        <div class="form-grid-2" style="margin-top:var(--space-5)">
          <form id="shippingSettingsForm" class="settings-add-form">
            <div class="form-section-title">تكلفة الشحن للأوردرات</div>
            <div class="form-field"><label class="form-label">شركة الشحن</label><input class="form-input" id="shippingProvider" value="${escapeHtml(shipping?.provider||"")}" placeholder="تترك فارغة لحين الربط"></div>
            <div class="form-field"><label class="form-label">مصاريف الشحن لكل أوردر</label><input class="form-input" id="shippingDefaultCost" type="number" min="0" step="0.01" value="${Number(shipping?.default_cost||0)}"></div>
            <label class="form-label" style="display:flex;gap:8px;align-items:center"><input id="shippingActive" type="checkbox" ${shipping?.active!==false?"checked":""}> تطبيق مصاريف الشحن تلقائيًا على كل الأوردرات الجديدة</label>
            <label class="form-label" style="display:flex;gap:8px;align-items:center"><input id="shippingChargeToCustomer" type="checkbox" ${shipping?.charge_to_customer?"checked":""}> الشحن على العميل: أضف مصاريف الشحن إلى Total الأوردر</label>
            <div class="form-hint" style="margin-top:8px">لو ألغيت الاختيار، الشحن يظل تكلفة على الشركة ويُخصم في حساب الربح، لكن لا يزيد Total الذي يدفعه العميل. لو فعلته، يُضاف الشحن إلى Total ويظل ظاهرًا كتكلفة في الربح.</div>
            <button class="btn" type="submit">حفظ إعدادات الشحن</button>
            <div id="shippingSaveMsg" class="form-error" style="display:none"></div>
          </form>
          <form id="adExpenseForm" class="settings-add-form">
            <div class="form-section-title">مصاريف الإعلانات</div>
            <div class="form-field"><label class="form-label">اليوم</label><input class="form-input" id="adExpenseDate" type="date" value="${today}" required></div>
            <div class="form-field"><label class="form-label">المنصة</label><input class="form-input" id="adExpensePlatform" placeholder="Meta / Facebook / Instagram"></div>
            <div class="form-field"><label class="form-label">المبلغ</label><input class="form-input" id="adExpenseAmount" type="number" min="0" step="0.01" required></div>
            <div class="form-field"><label class="form-label">طريقة الإدخال</label><select class="form-input" id="adExpenseMode"><option value="manual">يدوي</option><option value="auto">أوتوماتيك</option></select></div>
            <div class="form-field" style="grid-column:1/-1"><label class="form-label">ملاحظات</label><input class="form-input" id="adExpenseNotes"></div>
            <button class="btn" type="submit">حفظ مصروف الإعلان</button>
            <div id="adExpenseMsg" class="form-error" style="display:none"></div>
          </form>
        </div>
        <div class="table-wrap" style="margin-top:var(--space-6)">
          <table class="data-table"><thead><tr><th>التاريخ</th><th>النوع</th><th>المنصة</th><th>المبلغ</th><th>الإدخال</th></tr></thead>
          <tbody>
            ${(adExpenses||[]).map(x=>`<tr><td>${escapeHtml(x.expense_date)}</td><td>إعلان</td><td>${escapeHtml(x.platform||"—")}</td><td>${formatMoney(x.amount, company.currency||"EGP")}</td><td>${escapeHtml(x.entry_mode||"manual")}</td></tr>`).join("") || `<tr><td colspan="5">لا توجد مصاريف إعلانية بعد.</td></tr>`}
          </tbody></table>
        </div>`;

      document.getElementById("shippingSettingsForm")?.addEventListener("submit", async (e)=>{
        e.preventDefault();
        const msg=document.getElementById("shippingSaveMsg");
        try {
          const payload={company_id:companyId,provider:document.getElementById("shippingProvider").value.trim()||null,default_cost:Number(document.getElementById("shippingDefaultCost").value||0),active:document.getElementById("shippingActive").checked,charge_to_customer:document.getElementById("shippingChargeToCustomer").checked,updated_at:new Date().toISOString()};
          const {error}=await supabaseClient.from("shipping_settings").upsert(payload,{onConflict:"company_id"});
          if(error) throw error;
          msg.textContent="تم حفظ مصاريف الشحن وسيتم تطبيقها تلقائيًا على الأوردرات الجديدة"; msg.style.display="block";
        } catch(error){ msg.textContent=error.message||"تعذر حفظ إعدادات الشحن"; msg.style.display="block"; }
      });
      document.getElementById("adExpenseForm")?.addEventListener("submit", async(e)=>{
        e.preventDefault();
        const msg=document.getElementById("adExpenseMsg");
        try {
          const amount=Number(document.getElementById("adExpenseAmount").value||0);
          if(amount<0) throw new Error("المبلغ غير صحيح");
          const {error}=await supabaseClient.from("ad_expenses").insert({company_id:companyId,expense_date:document.getElementById("adExpenseDate").value,platform:document.getElementById("adExpensePlatform").value.trim()||null,amount,entry_mode:document.getElementById("adExpenseMode").value,notes:document.getElementById("adExpenseNotes").value.trim()||null});
          if(error) throw error;
          msg.textContent="تم تسجيل مصروف الإعلان"; msg.style.display="block";
          await renderFinance();
        } catch(error){ msg.textContent=error.message||"تعذر تسجيل مصروف الإعلان"; msg.style.display="block"; }
      });
    } catch(error) {
      financeTab.innerHTML=`<h2 class="section-title">الشحن والإعلانات</h2>${errorState("تعذر تحميل الإعدادات", escapeHtml(error.message||"خطأ"))}`;
    }
  }
  await renderFinance();
  await renderProducts();
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { renderFinance(); renderProducts(); }, 180);
  });
})();
