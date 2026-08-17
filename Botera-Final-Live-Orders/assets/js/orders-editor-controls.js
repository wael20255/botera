/* BOTERA_ORDERS_EDITOR_CONTROLS=v2 */
(function initOrdersEditorControls(){
  function openDirect(orderId=null){
    if (window.BoteraOrdersEditor?.open) return window.BoteraOrdersEditor.open(orderId);
    setTimeout(()=>openDirect(orderId),150);
  }
  function ensureAddButton(){
    const heading=document.querySelector('.page-heading');
    if(!heading || heading.querySelector('[data-orders-add-proxy]')) return;
    const button=document.createElement('button');
    button.type='button'; button.className='btn'; button.dataset.ordersAddProxy='1'; button.textContent='إضافة أوردر'; button.style.marginTop='12px';
    button.onclick=()=>openDirect(null); heading.appendChild(button);
  }
  function ensureRowActions(){
    const table=document.getElementById('ordersTable'); if(!table) return;
    table.querySelectorAll('tbody tr').forEach(row=>{
      const orderId=row.querySelector('[data-order-id]')?.dataset.orderId; const actions=row.querySelector('.order-quick-actions');
      if(!orderId || !actions) return;
      if(!actions.querySelector('[data-orders-edit-proxy]')){
        const b=document.createElement('button'); b.type='button'; b.className='btn-secondary btn-sm'; b.dataset.ordersEditProxy=orderId; b.textContent='تعديل';
        b.onclick=e=>{e.stopPropagation();openDirect(orderId)}; actions.prepend(b);
      }
      if(!actions.querySelector('[data-orders-delete]')){
        const b=document.createElement('button'); b.type='button'; b.className='btn-secondary btn-sm'; b.dataset.ordersDelete=orderId; b.textContent='حذف'; b.style.borderColor='rgba(255,80,80,.35)';
        b.onclick=async e=>{e.stopPropagation(); const label=row.querySelector('[data-order-id]')?.textContent?.trim()||orderId; if(!confirm(`هل أنت متأكد من حذف الأوردر ${label}؟\nسيتم حذف الأوردر وبيانات المنتجات المرتبطة به، ولا يمكن التراجع عن العملية.`)) return; b.disabled=true; const old=b.textContent; b.textContent='جارٍ…'; try{await OrdersService.deleteOrder(orderId);location.reload();}catch(err){b.disabled=false;b.textContent=old;alert(`تعذر حذف الأوردر. ${err?.message||'حاول مرة أخرى.'}`)}};
        actions.appendChild(b);
      }
    });
  }
  function sync(){ensureAddButton();ensureRowActions();}
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',sync,{once:true}); else sync();
  new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});
  setInterval(sync,700);
})();
