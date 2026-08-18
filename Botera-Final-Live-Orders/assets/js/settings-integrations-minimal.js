// Minimal integrations UI adjustment: keep the existing Google Sheets card unchanged
// except for the requested disconnect action. Hide the extra Secret-generator control.
(function () {
  function cleanGoogleSheetsCard() {
    document.querySelectorAll('[data-google-sheets-enhancement="1"]').forEach((card) => {
      card.querySelector('[data-google-generate]')?.remove();
      card.querySelector('[data-google-form] > div:last-child')?.remove();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cleanGoogleSheetsCard);
  } else {
    cleanGoogleSheetsCard();
  }

  const observer = new MutationObserver(cleanGoogleSheetsCard);
  observer.observe(document.body, { childList: true, subtree: true });
})();
