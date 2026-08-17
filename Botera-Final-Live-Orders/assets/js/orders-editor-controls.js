/* Orders editor controls: add, edit, and delete triggers for Orders page. */
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

  function ensureRowActions() {
    const table = document.getElementById('ordersTable');
    if (!table) return;

    table.querySelectorAll('tbody tr').forEach((row) => {
      const orderId = row.querySelector('[data-order-id]')?.dataset.orderId;
      const actions = row.querySelector('.order-quick-actions');
      if (!orderId || !actions) return;

      if (!actions.querySelector('[data-orders-edit-proxy]')) {
        const editButton = document.createElement('button');
        editButton.type = 'button';
        editButton.className = 'btn-secondary btn-sm';
        editButton.dataset.ordersEditProxy = orderId;
        editButton.textContent = 'تعديل';
        editButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          const sourceSelector = `${EDIT_SOURCE}[data-edit-order="${CSS.escape(orderId)}"]`;
          const source = document.querySelector(sourceSelector) || await waitFor(sourceSelector);
          if (source) {
            source.click();
            return;
          }
          alert('محرر الأوردر لم يجهز بعد. جرّب الضغط مرة أخرى.');
        });
        actions.prepend(editButton);
      }

      if (!actions.querySelector('[data-orders-delete]')) {
        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'btn-secondary btn-sm';
        deleteButton.dataset.ordersDelete = orderId;
        deleteButton.textContent = 'حذف';
        deleteButton.style.borderColor = 'rgba(255,80,80,.35)';
        deleteButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          const orderLabel = row.querySelector('[data-order-id]')?.textContent?.trim() || orderId;
          const confirmed = window.confirm(`هل أنت متأكد من حذف الأوردر ${orderLabel}؟\nسيتم حذف الأوردر وبيانات المنتجات المرتبطة به، ولا يمكن التراجع عن العملية.`);
          if (!confirmed) return;

          deleteButton.disabled = true;
          const oldText = deleteButton.textContent;
          deleteButton.textContent = 'جارٍ…';
          try {
            await OrdersService.deleteOrder(orderId);
            window.location.reload();
          } catch (error) {
            deleteButton.disabled = false;
            deleteButton.textContent = oldText;
            alert(`تعذر حذف الأوردر. ${error?.message || 'حاول مرة أخرى.'}`);
          }
        });
        actions.appendChild(deleteButton);
      }
    });
  }

  function sync() {
    ensureAddButton();
    ensureRowActions();
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
