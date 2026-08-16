// ============================================================================
// hooks/use-auth — the auth "hook" every protected page starts with.
// Loads the current user via AuthService, stores it in AuthStore, enforces
// the page's required permission, and redirects when needed.
// ============================================================================
const useAuth = (function () {
  // requiredPermission: one of the can_view_* keys from types/index.js,
  // or omit for pages every signed-in user may open (e.g. the dashboard).
  async function ensureAuthenticated({ requiredPermission = null } = {}) {
    const result = await AuthService.loadCurrentUser();
    if (!result) {
      AuthStore.clear();
      window.location.href = "login.html";
      return null;
    }
    AuthStore.set(result);
    const { profile } = result;
    if (requiredPermission && !profile.is_platform_owner && !profile[requiredPermission]) {
      window.location.href = "index.html";
      return null;
    }
    return profile;
  }

  return { ensureAuthenticated };
})();
