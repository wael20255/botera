(function(){
  if(window.__boteraOrderListFix)return;window.__boteraOrderListFix=true;
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'');
  let timer;
  async function enhance(){
    if(document.body?.dataset?.page!=='orders'||!window.supabaseClient||!window.__boteraLiveProfile)return;
    const rows=[...document.querySelectorAll('#ordersTable tbody tr')];if(!rows.length)return;
    const nums=rows.map(r=>r.querySelector('button[data-order-id]')?.textContent?.trim()).filter(Boolean);if(!nums.length)return;
    const {data,error}=await supabaseClient.from('orders').select('order_number,customer_order_name,customer_account_name,source_page_name').eq('company_id',window.__boteraLiveProfile.company_id).in('order_number',nums);if(error)return;
    const map=new Map((data||[]).map(o=>[o.order_number,o]));
    const head=document.querySelector('#ordersTable thead th:nth-child(2)');if(head)head.textContent='اسم العميل';
    rows.forEach(row=>{const num=row.querySelector('button[data-order-id]')?.textContent?.trim();const o=map.get(num);if(!o)return;const cell=row.querySelector('td:nth-child(2)');const btn=cell?.querySelector('button[data-customer-id]');if(cell&&btn){btn.textContent=o.customer_order_name||'غير مسجل';btn.title=o.customer_account_name?`أكونت العميل: ${o.customer_account_name}`:'فتح المحادثة';}});
  }
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(enhance,150)};
  window.addEventListener('load',()=>setTimeout(enhance,700));
  window.addEventListener('boterarealtimechange',schedule);
  window.addEventListener('boteradaterangechange',schedule);
  const mo=new MutationObserver(schedule);mo.observe(document.body,{childList:true,subtree:true});
})();