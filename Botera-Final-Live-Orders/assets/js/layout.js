// ============================================================================
// js/layout — sidebar/topbar wiring only. Formatting helpers live in
// lib/format.js now; auth/session logic lives in services/hooks.
// ============================================================================
function setupLayout(profile) {
  window.__boteraLiveProfile = profile;
  const current = document.body.dataset.page;
  document.querySelectorAll(".nav-item").forEach((el) => {
    if (el.dataset.page === current) el.classList.add("active");
  });

  document.querySelectorAll("[data-requires]").forEach((el) => {
    const permission = el.dataset.requires;
    if (!profile.is_platform_owner && !profile[permission]) el.remove();
  });

  document.getElementById("pageTitle").textContent = document.body.dataset.title || "Botera";

  const company = profile.company || {};
  const avatarEl = document.getElementById("workspaceAvatar");
  if (avatarEl) {
    avatarEl.innerHTML = company.logo
      ? `<img src="${company.logo}" alt="${escapeHtml(company.name || "")}">`
      : escapeHtml((company.name || "؟").trim().charAt(0).toUpperCase());
  }
  const companyNameEl = document.getElementById("workspaceCompany");
  if (companyNameEl) companyNameEl.textContent = company.name || "—";
  const ownerNameEl = document.getElementById("workspaceOwner");
  if (ownerNameEl) ownerNameEl.textContent = profile.full_name || "—";

  document.getElementById("menuToggle")?.addEventListener("click", () => {
    document.querySelector(".sidebar")?.classList.toggle("open");
  });
  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await AuthService.logout();
    AuthStore.clear();
    window.location.href = "login.html";
  });

  // Shared operational notifications center.
  if (!document.querySelector("link[data-botera-operational-notifications-css]")) {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "assets/css/operational-notifications.css?v=20260818-1701";
    css.setAttribute("data-botera-operational-notifications-css", "1");
    document.head.appendChild(css);
  }
  if (!document.querySelector("script[data-botera-operational-notifications]")) {
    const notificationsScript = document.createElement("script");
    notificationsScript.src = "assets/js/operational-notifications.js?v=20260818-1701";
    notificationsScript.setAttribute("data-botera-operational-notifications", "1");
    notificationsScript.defer = true;
    document.head.appendChild(notificationsScript);
  }

  // Dedicated Meta Ads live-spend synchronizer. Versioned URL guarantees a
  // fresh file after a deploy; it performs an immediate sync on every page
  // load/refresh and then keeps syncing once per minute.
  if (!document.querySelector("script[data-botera-meta-ads-live-sync]")) {
    const adsLiveScript = document.createElement("script");
    adsLiveScript.src = "assets/js/meta-ads-live-sync.js?v=20260818-1155";
    adsLiveScript.setAttribute("data-botera-meta-ads-live-sync", "1");
    adsLiveScript.defer = true;
    document.head.appendChild(adsLiveScript);
  }

  // Insights has one authoritative reports engine in insights.js.
  // Do not load the legacy live/report overrides there because they
  // recalculate and overwrite the authoritative metrics after render.
  const fixes = current === "insights"
    ? [
        ["data-botera-order-detail-fix", "assets/js/order-detail-fix.js"],
        ["data-botera-order-list-fix", "assets/js/order-list-fix.js"],
      ]
    : [
        ["data-botera-live-fixes", "assets/js/live-fixes.js"],
        ["data-botera-order-detail-fix", "assets/js/order-detail-fix.js"],
        ["data-botera-order-list-fix", "assets/js/order-list-fix.js"],
      ];

  fixes.forEach(([marker, src]) => {
    if (document.querySelector(`script[${marker}]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.setAttribute(marker, "1");
    script.defer = true;
    document.head.appendChild(script);
  });
}
