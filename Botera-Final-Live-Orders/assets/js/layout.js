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

  // Load the additive live fixes once on every authenticated page. It is
  // deliberately loaded after the page script has created its DOM so it can
  // enhance existing modals/forms without replacing the existing UI.
  if (!document.querySelector('script[data-botera-live-fixes]')) {
    const script = document.createElement("script");
    script.src = "assets/js/live-fixes.js";
    script.dataset.boteraLiveFixes = "1";
    script.defer = true;
    document.head.appendChild(script);
  }
}
