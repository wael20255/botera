// Loads the Google Sheets Orders integration independently of the legacy AI settings UI.
(() => {
  if (window.__boteraGoogleSheetsBootstrapStarted) return;
  window.__boteraGoogleSheetsBootstrapStarted = true;
  const load = () => {
    if (!document.body?.dataset?.page || document.body.dataset.page !== "settings") return;
    if (document.querySelector("script[data-botera-google-sheets-v1]")) return;
    const script = document.createElement("script");
    script.src = "assets/js/settings-google-sheets-v1.js?v=20260819-1000";
    script.dataset.boteraGoogleSheetsV1 = "1";
    script.defer = true;
    document.head.appendChild(script);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load, { once: true });
  else load();
})();
