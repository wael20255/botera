(function(){
  if(window.__boteraOrderDetailFix)return;window.__boteraOrderDetailFix=true;
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'');
  const money=(v,c='EGP')=>typeof formatMoney==='function'?formatMoney(Number(v||0),c):`${Number(v||0).toFixed(2)} ${c}`;
  let lastKey='';
  async function enhance(){
    const box=document.getElementById('orderDetails');
    if(!box)return;
    const title=box.querySelector('.dialog-header .section-title')?.textContent?.trim();
    if(!title)return;
    const key=`${title}|${box.querySelector('.detail-list')?.innerText||''}`;
    if(key===lastKey)return;
    const p=window.__boteraLiveProfile;
    if(!p||!window.supabaseClient)return;
    const {data:o,error}=await supabaseClient.from('orders').select('id,customer_order_name,customer_account_name,source_page_name,source_page_id,total,currency,shipping_cost,return_shipping_cost,created_at,customer_id').eq('company_id',p.company_id).eq('order_number',title).maybeSingle();
    if(error||!o)return;
    const {data:c}=await supabaseClient.from('customers').select('name,phone,address,city,country').eq('id',o.customer_id).maybeSingle();
    if(!c)return;
    const existing=box.querySelector('[data-order-customer-block]');
    if(existing)existing.remove();
    const list=box.querySelector('[data-order-panel="details"] .detail-list');
    if(!list)return;
    const first=list.querySelector('li');
    if(first)first.remove();
    const li=document.createElement('li');
    li.setAttribute('data-order-customer-block','1');
    li.innerHTML=`<strong>بيانات العميل:</strong><div style="margin-top:8px;line-height:1.9">اسم العميل: ${esc(o.customer_order_name||'غير مسجل')}<br>أكونت العميل: ${esc(o.customer_account_name||c.name||'غير مسجل')}<br>الصفحة: ${esc(o.source_page_name||'غير مسجل')}<br><span dir="ltr">رقم الهاتف: ${esc(c.phone||'—')}</span><br>العنوان: ${esc(c.address||'—')}${c.city?` — ${esc(c.city)}`:''}${c.country?` — ${esc(c.country)}`:''}<br>الإجمالي: ${money(o.total,o.currency||'EGP')}<br>شحن التسليم: ${money(o.shipping_cost,o.currency||'EGP')}<br>شحن المرتجع: ${money(o.return_shipping_cost,o.currency||'EGP')}</div>`;
    list.insertBefore(li,list.firstChild);
    lastKey=key;
  }
  const mo=new MutationObserver(()=>setTimeout(enhance,50));
  mo.observe(document.body,{childList:true,subtree:true});
  window.addEventListener('load',()=>setTimeout(enhance,300));
})();