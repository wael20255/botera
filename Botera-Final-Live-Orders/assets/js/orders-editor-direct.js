/* BOTERA_ORDERS_EDITOR_DIRECT=v1 */
(function () {
  const state = { profile: null, products: [], customers: [], orderId: null };
  const esc = (v) => (window.escapeHtml ? escapeHtml(String(v ?? '')) : String(v ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])));
  const money = (v, currency='EGP') => window.formatMoney ? formatMoney(Number(v || 0), currency) : `${Number(v || 0).toLocaleString('en-US')} ${currency}`;

  function styles() {
    if (document.getElementById('botera-direct-editor-style')) return;
    const s = document.createElement('style'); s.id = 'botera-direct-editor-style';
    s.textContent = `
      #boteraDirectOrderEditor{width:min(980px,94vw);max-height:90vh;overflow:auto;border:1px solid var(--color-border);border-radius:20px;background:var(--color-surface);color:var(--color-text);padding:0;box-shadow:0 30px 90px rgba(0,0,0,.55)}
      #boteraDirectOrderEditor::backdrop{background:rgba(0,0,0,.72);backdrop-filter:blur(3px)}
      .doe{padding:24px}.doe-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}.doe-title{font-size:24px;font-weight:800}.doe-sub{color:var(--color-text-muted);font-size:12px;margin-top:3px}
      .doe-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.doe-card{background:var(--color-surface-2);border:1px solid var(--color-border);border-radius:16px;padding:16px}.doe-card h3{font-size:15px;margin-bottom:12px}.doe-field{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}.doe-field label{font-size:12px;color:var(--color-text-muted)}.doe-field input,.doe-field select{height:42px;width:100%;background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px;color:var(--color-text);padding:0 10px}.doe-items{grid-column:1/-1}.doe-item{display:grid;grid-template-columns:1.7fr .6fr .7fr auto;gap:8px;align-items:end;border:1px solid var(--color-border);border-radius:12px;padding:10px;margin-top:8px;background:var(--color-surface)}.doe-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.doe-error{display:none;color:#ff9c9c;background:rgba(255,80,80,.08);border:1px solid rgba(255,80,80,.25);border-radius:10px;padding:9px;margin-top:10px}.doe-note{font-size:11px;color:var(--color-text-muted);margin-top:5px}
      @media(max-width:760px){.doe-grid{grid-template-columns:1fr}.doe-item{grid-template-columns:1fr 1fr}.doe-item .doe-product{grid-column:1/-1}.doe-item button{grid-column:1/-1}}
    `;
    document.head.appendChild(s);
  }

  async function ensureProfile(){
    if (state.profile) return state.profile;
    state.profile = window.__boteraLiveProfile || window.AuthStore?.get?.().profile || await window.useAuth?.ensureAuthenticated?.({requiredPermission:'can_view_orders'});
    return state.profile;
  }

  async function loadData(){
    const p = await ensureProfile(); if (!p?.company_id) throw new Error('تعذر تحديد الشركة.');
    const [pr, cu] = await Promise.all([
      supabaseClient.from('products').select('id,name,sku,price,cost,status').eq('company_id',p.company_id).order('name',{ascending:true}),
      supabaseClient.from('customers').select('id,name,phone,email,country,city,address,notes').eq('company_id',p.company_id).order('created_at',{ascending:false})
    ]);
    if (pr.error) throw pr.error; if (cu.error) throw cu.error;
    state.products = pr.data || []; state.customers = cu.data || [];
  }

  function productOptions(selected=''){
    const active = state.products.filter(p=>p.status==='active' || String(p.id)===String(selected));
    return `<option value="">اختر المنتج</option>${active.map(p=>`<option value="${esc(p.id)}" ${String(p.id)===String(selected)?'selected':''}>${esc(p.name)}${p.status!=='active'?' (غير نشط)':''}</option>`).join('')}`;
  }
  function customerOptions(selected=''){
    return `<option value="">عميل جديد</option>${state.customers.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(selected)?'selected':''}>${esc(c.name||'بدون اسم')}${c.phone?' — '+esc(c.phone):''}</option>`).join('')}`;
  }

  function addItem(item={}){
    const wrap=document.querySelector('#doeItems'); if(!wrap) return;
    const product = state.products.find(p=>String(p.id)===String(item.product_id||''))
      || state.products.find(p=>String(p.name||'').trim()===String(item.product_name||'').trim());
    const selectedProductId = product?.id || item.product_id || '';
    const row=document.createElement('div'); row.className='doe-item'; row.dataset.itemRow='1';
    row.innerHTML=`<div class="doe-field doe-product"><label>المنتج</label><select data-product>${productOptions(selectedProductId)}</select><div class="doe-note" data-info>${product?`السعر: ${money(product.price)} · التكلفة: ${money(product.cost)}`:''}</div></div><div class="doe-field"><label>الكمية</label><input data-qty type="number" min="1" step="1" value="${Math.max(1,Number(item.quantity||1))}"></div><div class="doe-field"><label>السعر</label><input data-price type="number" readonly value="${Number(item.price ?? product?.price ?? 0)}"></div><button type="button" class="btn-secondary" data-remove>حذف</button>`;
    row.querySelector('[data-product]').addEventListener('change',()=>{
      const p=state.products.find(x=>String(x.id)===String(row.querySelector('[data-product]').value));
      if(!p) return; row.querySelector('[data-price]').value=Number(p.price||0); row.querySelector('[data-info]').textContent=`السعر: ${money(p.price)} · التكلفة: ${money(p.cost)}`;
    });
    row.querySelector('[data-remove]').addEventListener('click',()=>{ if(document.querySelectorAll('[data-item-row]').length>1) row.remove(); });
    wrap.appendChild(row);
  }

  async function open(orderId=null){
    styles(); state.orderId=orderId; await loadData();
    let order=null;
    if(orderId){
      const r=await supabaseClient.from('orders').select('*, customers(id,name,phone,email,country,city,address,notes), order_items(id,product_id,product_name,quantity,price,cost,total)').eq('id',orderId).eq('company_id',state.profile.company_id).single();
      if(r.error) throw r.error; order=r.data;
    }
    const customer=state.customers.find(c=>String(c.id)===String(order?.customer_id||'')) || (Array.isArray(order?.customers)?order.customers[0]:order?.customers) || {};
    const dlg=document.getElementById('boteraDirectOrderEditor') || document.body.appendChild(document.createElement('dialog')); dlg.id='boteraDirectOrderEditor'; dlg.className='dialog';
    dlg.innerHTML=`<div class="doe"><div class="doe-head"><div><div class="doe-title">${order?'تعديل الأوردر':'إضافة أوردر'}</div><div class="doe-sub">المنتج يتم اختياره من منتجات Botera الموجودة في Settings.</div></div><button type="button" class="btn-secondary" data-close>إغلاق</button></div><div class="doe-grid"><section class="doe-card"><h3>بيانات العميل</h3><div class="doe-field"><label>العميل الحالي</label><select id="doeCustomer">${customerOptions(order?.customer_id||'')}</select></div><div class="doe-field"><label>اسم العميل في الأوردر</label><input id="doeOrderName" value="${esc(order?.customer_order_name || customer?.name || order?.name || '')}"><div class="doe-note">هذا الاسم هو الذي سيتم حفظه كاسم العميل.</div></div><div class="doe-field"><label>الهاتف</label><input id="doePhone" value="${esc(customer?.phone || order?.phone || '')}"></div><div class="doe-field"><label>العنوان</label><input id="doeAddress" value="${esc(customer?.address || order?.address || '')}"></div></section><section class="doe-card"><h3>بيانات الأوردر</h3><div class="doe-field"><label>رقم الأوردر</label><input id="doeNumber" value="${esc(order?.order_number||'')}"></div><div class="doe-field"><label>الحالة</label><select id="doeStatus"><option value="pending">قيد الانتظار</option><option value="confirmed">مؤكد</option><option value="shipped">تم الشحن</option><option value="delivered">تم التسليم</option><option value="refunded">مرتجع</option><option value="cancelled">ملغي</option></select></div><div class="doe-field"><label>الشحن</label><input id="doeShipping" type="number" value="${Number(order?.shipping_cost||0)}"></div><div class="doe-field"><label>الخصم</label><input id="doeDiscount" type="number" value="${Number(order?.discount||0)}"></div></section><section class="doe-card doe-items"><h3>المنتجات</h3><div id="doeItems"></div><div class="doe-actions"><button type="button" class="btn-secondary" id="doeAddProduct">إضافة منتج</button></div><div class="doe-note" id="doeTotalNote"></div></section></div><div class="doe-error" id="doeError"></div><div class="doe-actions"><button type="button" class="btn-secondary" data-close>إلغاء</button><button type="button" class="btn" id="doeSave">${order?'حفظ التعديلات':'إضافة الأوردر'}</button></div></div>`;
    dlg.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>dlg.close());
    const status=dlg.querySelector('#doeStatus'); status.value=order?.status||'pending';
    const custSel=dlg.querySelector('#doeCustomer'); custSel.onchange=()=>{ const c=state.customers.find(x=>String(x.id)===String(custSel.value)); if(c){ dlg.querySelector('#doeOrderName').value=c.name||''; dlg.querySelector('#doePhone').value=c.phone||''; dlg.querySelector('#doeAddress').value=c.address||''; }};
    const items=order?.order_items?.length?order.order_items:[{product_id:'',quantity:1}]; items.forEach(addItem);
    dlg.querySelector('#doeAddProduct').onclick=()=>addItem();
    dlg.querySelector('#doeSave').onclick=async()=>{
      const err=dlg.querySelector('#doeError'); err.style.display='none'; const name=dlg.querySelector('#doeOrderName').value.trim();
      const rows=[...dlg.querySelectorAll('[data-item-row]')]; const picked=rows.map(r=>({product_id:r.querySelector('[data-product]').value,quantity:Math.max(1,Number(r.querySelector('[data-qty]').value||1))})).filter(x=>x.product_id);
      if(!name){err.textContent='اسم العميل في الأوردر مطلوب.';err.style.display='block';return;} if(!picked.length){err.textContent='اختار منتج واحد على الأقل.';err.style.display='block';return;}
      const btn=dlg.querySelector('#doeSave'); btn.disabled=true; btn.textContent='جارٍ الحفظ…';
      try{
        const selectedCustomerId=custSel.value||null;
        const customer=state.customers.find(x=>String(x.id)===String(selectedCustomerId))||{};
        await OrdersService.saveEditor({companyId:state.profile.company_id,orderId:state.orderId,customerId:selectedCustomerId,customer:{...customer,name,phone:dlg.querySelector('#doePhone').value.trim(),address:dlg.querySelector('#doeAddress').value.trim()},order:{order_number:dlg.querySelector('#doeNumber').value.trim(),status:status.value,shipping_cost:Number(dlg.querySelector('#doeShipping').value||0),discount:Number(dlg.querySelector('#doeDiscount').value||0),customer_order_name:name},items:picked});
        dlg.close();
        window.dispatchEvent(new CustomEvent('boterarealtimechange'));
      }catch(e){btn.disabled=false;btn.textContent=order?'حفظ التعديلات':'إضافة الأوردر';err.textContent=e?.message||'تعذر حفظ الأوردر.';err.style.display='block';}
    };
    dlg.showModal();
  }

  window.BoteraOrdersEditor={open};
  console.log('Botera Orders direct editor ready');
})();
