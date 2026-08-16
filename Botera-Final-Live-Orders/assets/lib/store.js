// ============================================================================
// lib/store — the single global auth state for the current page load.
// Holds { user, profile, company } once loaded by hooks/use-auth.js, so any
// page script or service can read "who is signed in" without re-fetching.
// Not persisted here on purpose — Supabase's own session (in localStorage,
// managed by the SDK) is the source of truth; this store is just an
// in-memory cache of the profile/company for the current page.
// ============================================================================
const AuthStore = (function () {
  let state = { user: null, profile: null, company: null };
  const listeners = new Set();

  function get() { return state; }
  function set(next) {
    state = { ...state, ...next };
    listeners.forEach((fn) => fn(state));
  }
  function clear() { set({ user: null, profile: null, company: null }); }
  function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  return { get, set, clear, subscribe };
})();
