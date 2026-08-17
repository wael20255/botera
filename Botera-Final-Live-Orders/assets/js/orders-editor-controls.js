/* Orders editor controls: presentation/trigger layer only.
   Uses the existing orders-editor.js implementation for all actual editing/saving. */
(function initOrdersEditorControls() {
  const ADD_SOURCE = '[data-open-order-editor="new"]';
  const EDIT_SOURCE = '[data-edit-order]';

  function waitFor(selector, timeout = 5000) {
    return new Promise((resolve) => {
      const started = Date.now();
      const poll = () => {
        const el = document.querySelector(selector);
        if (el) return resolve(el);
        if (Date.now() - started >= timeout) return resolve(null);
        setTimeout(poll, 100);
      };
      poll();
    });
  }

  function ensureAddButton() {
    const heading = document.querySelector('.page-heading');
    if (!heading || heading.querySelector('[data-orders-add-proxy]')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.ordersAddProxy = '1';
    button.textContent = 'إضافة أوردر';
    button.style.marginTop = '12px';
    button.addEventListener('click', async () => {
      const source = document.querySelector(ADD_SOURCE) || await waitFor(ADD_SOURCE);
      if (source) {
        source.click();
        return;
      }
      alert('محرر الأوردر لم يجهز بعد. جرّب الضغط مرة أخرى.');
    });
    heading.appendChild(button);
  }

  function ensureEditButtons() {
    const table = document.getElementById('ordersTable');
    if (!table) return;

    table.querySelectorAll('tbody tr').forEach((row) => {
      const orderId = row.querySelector('[data-order-id]')?.dataset.orderId;
      const actions = row.querySelector('.order-quick-actions');
      if (!orderId || !actions || actions.querySelector('[data-orders-edit-proxy]')) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn-secondary btn-sm';
      button.dataset.ordersEditProxy = orderId;
      button.textContent = 'تعديل';
      button.addEventListener('click', async (event) => {
        event.stopPropagation();
        const sourceSelector = `${EDIT_SOURCE}[data-edit-order="${CSS.escape(orderId)}"]`;
        const source = document.querySelector(sourceSelector) || await waitFor(sourceSelector);
        if (source) {
          source.click();
          return;
        }
        alert('محرر الأوردر لم يجهز بعد. جرّب الضغط مرة أخرى.');
      });
      actions.prepend(button);
    });
  }

  function sync() {
    ensureAddButton();
    ensureEditButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sync, { once: true });
  } else {
    sync();
  }

  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
  setInterval(sync, 750);
})();
