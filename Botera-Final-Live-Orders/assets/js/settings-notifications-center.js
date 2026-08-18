// Settings > Notifications center.
// Read-only operational display; does not change orders, customers, stages, ads, or integrations.
(() => {
  if (window.__boteraSettingsNotificationsCenterStarted) return;
  window.__boteraSettingsNotificationsCenterStarted = true;

  const esc = (v) => String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const LEVELS = {
    critical: { label: "حرج", icon: "🔴" },
    warning: { label: "يحتاج انتباه", icon: "🟠" },
    info: { label: "معلومة", icon: "🔵" },
    operational_test: { label: "اختبار حقيقي", icon: "🟢" },
  };

  function levelOf(type) {
    const t = String(type || "info").toLowerCase();
    if (LEVELS[t]) return t;
    if (["error", "critical", "urgent"].includes(t)) return "critical";
    if (["warning", "warn", "attention"].includes(t)) return "warning";
    return "info";
  }

  function ensureStyles() {
    if (document.getElementById("boteraNotificationsCenterStyles")) return;
    const style = document.createElement("style");
    style.id = "boteraNotificationsCenterStyles";
    style.textContent = `
      .botera-nc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}
      .botera-nc-head h2{margin:0;font-size:22px}
      .botera-nc-head p{margin:6px 0 0;color:var(--muted);line-height:1.7}
      .botera-nc-actions{display:flex;gap:8px;flex-wrap:wrap}
      .botera-nc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}
      .botera-nc-card{border:1px solid var(--color-border);border-radius:14px;padding:14px;background:var(--color-surface)}
      .botera-nc-card strong{display:block;font-size:22px;margin-top:6px}
      .botera-nc-muted{color:var(--muted);font-size:12px}
      .botera-nc-list{display:flex;flex-direction:column;gap:10px}
      .botera-nc-item{border:1px solid var(--color-border);border-radius:14px;padding:16px;background:var(--color-surface);text-align:start;width:100%;cursor:pointer;color:inherit}
      .botera-nc-item:hover{border-color:var(--color-neon);background:var(--color-surface-2)}
      .botera-nc-item.is-unread{box-shadow:inset 3px 0 0 var(--color-neon)}
      .botera-nc-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}
      .botera-nc-title{display:flex;gap:10px;align-items:center;font-weight:800}
      .botera-nc-body{margin-top:8px;color:var(--color-text-muted);line-height:1.75}
      .botera-nc-meta{margin-top:10px;color:var(--color-text-faint);font-size:12px;display:flex;justify-content:space-between;gap:10px}
      .botera-nc-pill{border-radius:999px;padding:3px 9px;background:var(--color-surface-2);color:var(--color-text-muted);font-size:11px;white-space:nowrap}
      .botera-nc-detail{display:none;border:1px solid var(--color-border);border-radius:14px;padding:18px;margin-bottom:16px;background:var(--color-surface-2)}
      .botera-nc-detail.active{display:block}
      .botera-nc-detail h3{margin:0 0 8px;font-size:20px}
      .botera-nc-detail p{margin:0;color:var(--color-text-muted);line-height:1.8;white-space:pre-wrap}
      .botera-nc-empty{padding:38px 18px;text-align:center;color:var(--color-text-muted);border:1px dashed var(--color-border);border-radius:14px}
      @media(max-width:900px){.botera-nc-grid{grid-template-columns:1fr}.botera-nc-head{flex-direction:column}}
    `;
    document.head.appendChild(style);
  }

  function normalizeRow(row) {
    const level = levelOf(row.type);
    return {
      id: row.id,
      title: row.title || "تنبيه من Botera",
      message: row.message || "",
      type: row.type || "info",
      level,
      created_at: row.created_at || new Date().toISOString(),
      is_read: !!row.is_read,
    };
  }

  function selectedId() {
    return new URLSearchParams(window.location.search).get("alert");
  }

  function readSelectedTransient() {
    try {
      const raw = sessionStorage.getItem("botera:selectedOperationalAlert");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.id) return null;
      sessionStorage.removeItem("botera:selectedOperationalAlert");
      return {
        id: parsed.id,
        title: parsed.title || "تنبيه تشغيلي",
        message: parsed.body || parsed.message || "",
        type: parsed.type || parsed.level || "info",
        level: levelOf(parsed.level || parsed.type),
        created_at: parsed.created_at || new Date().toISOString(),
        is_read: true,
        transient: true,
      };
    } catch { return null; }
  }

  async function listNotifications(profile) {
    const { data, error } = await supabaseClient
      .from("notifications")
      .select("id,title,message,type,is_read,created_at")
      .eq("company_id", profile.company_id)
      .neq("type", "ai_action")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data || []).map(normalizeRow);
  }

  async function markRead(ids, profile) {
    if (!ids.length) return;
    const { error } = await supabaseClient
      .from("notifications")
      .update({ is_read: true })
      .eq("company_id", profile.company_id)
      .in("id", ids);
    if (error) console.warn("Notification mark-read failed:", error);
  }

  function render(root, rows, profile, selected, transient) {
    const allRows = transient ? [transient, ...rows.filter(r => r.id !== transient.id)] : rows;
    const unread = allRows.filter(r => !r.is_read).length;
    const critical = allRows.filter(r => r.level === "critical").length;
    const attention = allRows.filter(r => r.level === "warning").length;

    root.innerHTML = `
      <div class="botera-nc-head">
        <div>
          <h2>مركز التنبيهات</h2>
          <p>كل التنبيهات التشغيلية المهمة في Botera. اضغط على أي تنبيه لعرض التفاصيل.</p>
        </div>
        <div class="botera-nc-actions">
          <button class="btn-secondary" type="button" data-mark-all>تحديد الكل كمقروء</button>
          <button class="btn-secondary" type="button" data-refresh>تحديث</button>
        </div>
      </div>
      <div class="botera-nc-grid">
        <div class="botera-nc-card"><span class="botera-nc-muted">غير مقروء</span><strong>${unread}</strong></div>
        <div class="botera-nc-card"><span class="botera-nc-muted">حرج</span><strong>${critical}</strong></div>
        <div class="botera-nc-card"><span class="botera-nc-muted">يحتاج انتباه</span><strong>${attention}</strong></div>
      </div>
      <div class="botera-nc-detail" data-detail></div>
      <div class="botera-nc-list" data-list>
        ${allRows.length ? allRows.map(row => {
          const meta = LEVELS[row.level] || LEVELS.info;
          return `<button class="botera-nc-item ${row.is_read ? "" : "is-unread"}" type="button" data-alert-row="${esc(row.id)}">
            <div class="botera-nc-item-head">
              <span class="botera-nc-title"><span>${meta.icon}</span><span>${esc(row.title)}</span></span>
              <span class="botera-nc-pill">${esc(meta.label)}</span>
            </div>
            <div class="botera-nc-body">${esc(row.message)}</div>
            <div class="botera-nc-meta"><span>${new Date(row.created_at).toLocaleString("ar-EG")}</span><span>${row.is_read ? "مقروء" : "غير مقروء"}</span></div>
          </button>`;
        }).join("") : `<div class="botera-nc-empty">لا توجد تنبيهات تشغيلية حاليًا.</div>`}
      </div>`;

    const detail = root.querySelector("[data-detail]");
    const showDetail = (row) => {
      if (!row) { detail.classList.remove("active"); detail.innerHTML = ""; return; }
      const meta = LEVELS[row.level] || LEVELS.info;
      detail.innerHTML = `<h3>${meta.icon} ${esc(row.title)}</h3><p>${esc(row.message)}\n\nالنوع: ${esc(meta.label)}\nالوقت: ${new Date(row.created_at).toLocaleString("ar-EG")}</p>`;
      detail.classList.add("active");
    };

    root.querySelectorAll("[data-alert-row]").forEach(btn => btn.addEventListener("click", async () => {
      const row = allRows.find(r => r.id === btn.dataset.alertRow);
      if (!row) return;
      showDetail(row);
      if (!row.transient && !row.is_read) {
        await markRead([row.id], profile);
        row.is_read = true;
        btn.classList.remove("is-unread");
      }
    }));

    root.querySelector("[data-mark-all]")?.addEventListener("click", async () => {
      const ids = allRows.filter(r => !r.is_read && !r.transient).map(r => r.id);
      await markRead(ids, profile);
      allRows.forEach(r => { r.is_read = true; });
      render(root, rows, profile, selected, null);
    });
    root.querySelector("[data-refresh]")?.addEventListener("click", async () => {
      await load(root, profile, selectedId(), null);
    });

    const initial = allRows.find(r => r.id === selected) || transient;
    if (initial) showDetail(initial);
  }

  async function load(root, profile, selected, transient = readSelectedTransient()) {
    try {
      const rows = await listNotifications(profile);
      render(root, rows, profile, selected, transient);
    } catch (error) {
      root.innerHTML = `<div class="botera-nc-empty">تعذر تحميل مركز التنبيهات الآن. تحقق من الاتصال بقاعدة البيانات.</div>`;
      console.warn("Notifications center load failed:", error);
    }
  }

  async function init() {
    try {
      const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_settings" });
      if (!profile) return;
      ensureStyles();
      const tab = document.getElementById("notificationsTab");
      if (!tab) return;

      const activateNotificationsTab = () => {
        document.querySelectorAll("[data-tab]").forEach((item) => item.classList.toggle("active", item.dataset.tab === "notifications"));
        document.querySelectorAll("[data-tab-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.tabPanel !== "notifications"));
        tab.classList.remove("hidden");
        void load(tab, profile, selectedId());
      };

      tab.__boteraActivate = activateNotificationsTab;
      document.querySelector('[data-tab="notifications"]')?.addEventListener("click", activateNotificationsTab);
      if (new URLSearchParams(window.location.search).get("tab") === "notifications") activateNotificationsTab();

      window.addEventListener("boterarealtimechange", () => {
        if (!tab.classList.contains("hidden")) void load(tab, profile, selectedId(), null);
      });
    } catch (error) {
      console.warn("Settings notifications center init failed:", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
