// Keep the Reports page synchronized with database changes made outside the current tab.
(function () {
  const refresh = () => window.dispatchEvent(new Event("boterarealtimechange"));

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });

  window.addEventListener("pageshow", refresh);

  // Safety net for changes made directly in Supabase or another session where
  // Realtime is not available for the current browser session.
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 30000);
})();
