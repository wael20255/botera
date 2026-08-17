(function(){
  if(window.__boteraLiveFixes)return;window.__boteraLiveFixes=true;
  const profile=()=>window.__boteraLiveProfile;
  const money=(v,c)=>typeof formatMoney==='function'?formatMoney(Number(v||0),c||'EGP'):String(Number(v||0));
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'');
  async function returnCost(){
    const f=document.getElementById('shippingSettingsForm'),p=profile();if(!f||f.querySelector('#shippingReturnCost')||!p)return;
    const q=await supabaseClient.from('shipping_settings').select('return_cost').eq('company_id',p.company_id).maybeSingle();
    const d=document.createElement('div');d.className='form-field';d.innerHTML='<label class="form-label">تكلفة المرتجع لكل أوردر</label><input class="form-input" id="shippingReturnCost" type="number" min="0" step="0.01" value="'+Number(q.data?.return_cost||0)+'"><div class="form-hint">تُضاف عند تسجيل المرتجع وتدخل في حساب التكلفة والربح.</div>';
    f.appendChild(d);f.addEventListener('submit',()=>setTimeout(async()=>{await supabaseClient.from('shipping_settings').upsert({company_id:p.company_id,return_cost:Math.max(0,Number(document.getElementById('shippingReturnCost')?.value||0)),updated_at:new Date().toISOString()},{onConflict:'company_id'})},300));
  }
  async function adControls(){
    const p=profile(),t=[...document.querySelectorAll('#financeTab .data-table')].find(x=>/المبلغ/.test(x.innerText||''));if(!p||!t||t.dataset.live==='1')return;
    const q=await supabaseClient.from('ad_expenses').select('*').eq('company_id',p.company_id).order('expense_date',{ascending:false}).limit(100);if(q.error)return;
    const h=t.querySelector('thead tr'),b=t.querySelector('tbody');if(!b)return;if(h&&!h.querySelector('[data-ad-actions]'))h.insertAdjacentHTML('beforeend','<th data-ad-actions>إجراءات</th>');
    b.innerHTML=(q.data||[]).map(x=>'<tr><td>'+esc(x.expense_date)+'</td><td>إعلان</td><td>'+esc(x.platform||'—')+'</td><td>'+money(x.amount,p.company?.currency||'EGP')+'</td><td>'+esc(x.entry_mode||'manual')+'</td><td><button class="btn-secondary btn-sm" data-ad-edit="'+x.id+'">تعديل</button> <button class="btn-secondary btn-sm" data-ad-delete="'+x.id+'">حذف</button></td></tr>').join('')||'<tr><td colspan="6">لا توجد مصاريف إعلانية بعد.</td></tr>';
    t.dataset.live='1';b.querySelectorAll('[data-ad-edit]').forEach(bn=>bn.onclick=async()=>{const r=(q.data||[]).find(x=>x.id===bn.dataset.adEdit);if(!r)return;const a=prompt('مبلغ صرف الإعلان',r.amount);if(a===null)return;const n=Number(a);if(!Number.isFinite(n)||n<0)return alert('المبلغ غير صحيح');const platform=prompt('الأكونت / المنصة',r.platform||'');if(platform===null)return;const date=prompt('التاريخ YYYY-MM-DD',r.expense_date);if(date===null)return;const e=await supabaseClient.from('ad_expenses').update({amount:n,platform:platform.trim()||null,expense_date:date,updated_at:new Date().toISOString()}).eq('id',r.id).eq('company_id',p.company_id);if(e.error)alert(e.error.message);else{t.dataset.live='0';adControls()}});
    b.querySelectorAll('[data-ad-delete]').forEach(bn=>bn.onclick=async()=>{if(!confirm('حذف مصروف الإعلان؟'))return;const e=await supabaseClient.from('ad_expenses').delete().eq('id',bn.dataset.adDelete).eq('company_id',p.company_id);if(e.error)alert(e.error.message);else{t.dataset.live='0';adControls()}});
  }
  async function orderDetails(){
    const p=profile(),box=document.getElementById('orderDetails');if(!p||!box||box.dataset.liveOrder==='1')return;const n=box.querySelector('.section-title')?.textContent?.trim();if(!n)return;box.dataset.liveOrder='1';
    const o=(await supabaseClient.from('orders').select('customer_id,return_shipping_cost,currency').eq('company_id',p.company_id).eq('order_number',n).maybeSingle()).data;if(!o?.customer_id)return;
    const c=(await supabaseClient.from('customers').select('name,phone,address,city,country').eq('id',o.customer_id).maybeSingle()).data;if(!c)return;const list=box.querySelector('[data-order-panel=details] .detail-list');if(!list)return;
    const li=document.createElement('li');li.innerHTML='<strong>بيانات العميل:</strong><div style="margin-top:8px;line-height:1.9">الاسم: '+esc(c.name||'—')+'<br><span dir="ltr">رقم التلفون: '+esc(c.phone||'—')+'</span><br>العنوان: '+esc(c.address||'—')+(c.city?' — '+esc(c.city):'')+(c.country?' — '+esc(c.country):'')+'<br>تكلفة المرتجع: '+money(o.return_shipping_cost,o.currency||'EGP')+'</div>';list.insertBefore(li,list.firstChild);
  }
  async function socialNames(){const p=profile();if(!p)return;const q=await supabaseClient.from('customers').select('id').eq('company_id',p.company_id).in('source',['facebook','instagram']).in('name',['Facebook Customer','Instagram Customer','عميل غير معروف']).limit(50);for(const x of q.data||[]){try{await supabaseClient.functions.invoke('sync-social-profile',{body:{customer_id:x.id}})}catch(_){}}}
  document.addEventListener('click',e=>{if(e.target.closest('[data-order-id]'))setTimeout(orderDetails,60);if(e.target.closest('[data-quick-status="refunded"],[data-update-status="refunded"]'))setTimeout(async()=>{const p=profile(),n=document.querySelector('#orderDetails .section-title')?.textContent?.trim();if(!p||!n)return;const s=(await supabaseClient.from('shipping_settings').select('return_cost').eq('company_id',p.company_id).maybeSingle()).data;const v=Number(s?.return_cost||0);if(v)await supabaseClient.from('orders').update({return_shipping_cost:v}).eq('company_id',p.company_id).eq('order_number',n).eq('return_shipping_cost',0)},500)});
  window.addEventListener('boterarealtimechange',()=>setTimeout(()=>{adControls();orderDetails();socialNames()},250));
  setTimeout(()=>{returnCost();adControls();orderDetails();socialNames()},1000);
})();