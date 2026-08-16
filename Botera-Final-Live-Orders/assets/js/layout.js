// ============================================================================
// js/layout — sidebar/topbar wiring only. Formatting helpers live in
// lib/format.js now; auth/session logic lives in services/hooks.
// ============================================================================
function setupLayout(profile) {
  const current = document.body.dataset.page;
  document.querySelectorAll(".nav-item").forEach((el) => {
    if (el.dataset.page === current) el.classList.add("active");
  });

  // Remove nav links the current user has no permission to see —
  // removed from the DOM entirely, not just hidden with CSS.
  document.querySelectorAll("[data-requires]").forEach((el) => {
    const permission = el.dataset.requires;
    if (!profile.is_platform_owner && !profile[permission]) el.remove();
  });

  document.getElementById("pageTitle").textContent = document.body.dataset.title || "Botera";

  // Real authenticated company + owner — replaces any placeholder identity.
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
}
