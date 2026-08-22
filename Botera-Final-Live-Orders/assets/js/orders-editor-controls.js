/* BOTERA_ORDERS_EDITOR_CONTROLS=v2 */
(function initOrdersEditorControls(){
  const state = { profile: null, products: null };

  async function getProfile(){
    if(state.profile) return state.profile;
    state.profile = window.__boteraLiveProfile || window.AuthStore?.get?.().profile || await window.useAuth?.ensureAuthenticated?.({requiredPermission:'can_view_orders'});
    return state.profile;
  }

  async function getProducts(){
    if(state.products) return state.products;
    const profile = await getProfile();
    if(!profile?.company_id) return [];
    const { data, error } = await supabaseClient
      .from('products')
      .select('id,name,sku,price,cost,status')
      .eq('company_id', profile.company_id)
      .order('name', { ascending: true });
    if(error) throw error;
    state.products = data || [];
    return state.products;
  }

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

  async function setOrderProduct(orderId, productId, select){
    const profile = await getProfile();
    if(!profile?.company_id) throw new Error('تعذر تحديد الشركة.');
    const product = (state.products || []).find(p => String(p.id) === String(productId));
    if(!product) throw new Error('المنتج غير موجود.');

    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .select('*, customers(id,name,phone,email,country,city,address,notes), order_items(id,product_id,product_name,quantity,price,cost,total,sku)')
      .eq('id', orderId)
      .eq('company_id', profile.company_id)
      .single();
    if(orderError) throw orderError;

    const currentItems = Array.isArray(order.order_items) ? order.order_items : [];
    const nextItems = currentItems.length
      ? currentItems.map((item, index) => index === 0 ? { product_id: product.id, quantity: Math.max(1, Number(item.quantity || 1)) } : { product_id: item.product_id, quantity: Math.max(1, Number(item.quantity || 1)) })
      : [{ product_id: product.id, quantity: 1 }];

    const customer = Array.isArray(order.customers) ? (order.customers[0] || {}) : (order.customers || {});
    await OrdersService.saveEditor({
      companyId: profile.company_id,
      orderId: order.id,
      customerId: order.customer_id || customer.id || null,
      customer: {
        ...customer,
        name: order.customer_order_name || customer.name || order.name || '',
        phone: customer.phone || order.phone || '',
        address: customer.address || order.address || ''
      },
      order: {
        order_number: order.order_number || '',
        status: order.status || 'pending',
        payment_status: order.payment_status || 'pending',
        shipping_status: order.shipping_status || 'pending',
        shipping_cost: Number(order.shipping_cost || 0),
        discount: Number(order.discount || 0),
        currency: order.currency || 'EGP',
        notes: order.notes || '',
        customer_order_name: order.customer_order_name || customer.name || order.name || '',
        customer_account_name: order.customer_account_name || customer.name || order.name || '',
        source_page_name: order.source_page_name || null,
        source_page_id: order.source_page_id || null
      },
      items: nextItems
    });
  }

  function enhanceProductCells(){
    const table=document.getElementById('ordersTable'); if(!table) return;
    table.querySelectorAll('tbody tr').forEach(row=>{
      const orderId=row.querySelector('[data-order-id]')?.dataset.orderId;
      const cell=row.querySelector('.product-cell');
      if(!orderId || !cell || cell.querySelector('[data-product-picker]')) return;

      const currentName=cell.textContent.trim();
      const select=document.createElement('select');
      select.dataset.productPicker='1';
      select.className='form-input';
      select.style.minWidth='170px';
      select.style.cursor='pointer';
      select.innerHTML='<option value="">اختار المنتج</option>';
      if(currentName && currentName !== '—'){
        const currentOption=document.createElement('option');
        currentOption.value='__current__';
        currentOption.textContent=currentName;
        currentOption.selected=true;
        select.appendChild(currentOption);
      }
      cell.replaceChildren(select);

      getProducts().then(products=>{
        const currentValue=select.value;
        select.innerHTML='<option value="">اختار المنتج</option>';
        products.filter(p=>p.status==='active').forEach(p=>{
          const option=document.createElement('option');
          option.value=p.id;
          option.textContent=p.name;
          select.appendChild(option);
        });
        if(currentValue === '__current__') select.selectedIndex = 0;
      }).catch(()=>{
        select.innerHTML='<option value="">تعذر تحميل المنتجات</option>';
      });

      select.addEventListener('change', async (event)=>{
        const productId=event.target.value;
        if(!productId) return;
        const previous=select.dataset.previousValue || '';
        select.dataset.previousValue=productId;
        select.disabled=true;
        try{
          await setOrderProduct(orderId, productId, select);
          location.reload();
        }catch(error){
          select.disabled=false;
          select.value=previous || '';
          alert(`تعذر تحديث المنتج. ${error?.message || 'حاول مرة أخرى.'}`);
        }
      });
    });
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
      if(!actions.querySelector('[data-orders-shipped]')){
        const b=document.createElement('button'); b.type='button'; b.className='btn-secondary btn-sm'; b.dataset.ordersShipped=orderId; b.textContent='تم الشحن';
        b.onclick=async e=>{e.stopPropagation(); b.disabled=true; const old=b.textContent; b.textContent='جارٍ…'; try{await OrdersService.updateStatus(orderId,'shipped'); location.reload();}catch(err){b.disabled=false;b.textContent=old;alert(`تعذر تسجيل حالة «تم الشحن». ${err?.message||'حاول مرة أخرى.'}`)}};
        actions.appendChild(b);
      }
      if(!actions.querySelector('[data-orders-delete]')){
        const b=document.createElement('button'); b.type='button'; b.className='btn-secondary btn-sm'; b.dataset.ordersDelete=orderId; b.textContent='حذف'; b.style.borderColor='rgba(255,80,80,.35)';
        b.onclick=async e=>{e.stopPropagation(); const label=row.querySelector('[data-order-id]')?.textContent?.trim()||orderId; if(!confirm(`هل أنت متأكد من حذف الأوردر ${label}؟\nسيتم حذف الأوردر وبيانات المنتجات المرتبطة به، ولا يمكن التراجع عن العملية.`)) return; b.disabled=true; const old=b.textContent; b.textContent='جارٍ…'; try{await OrdersService.deleteOrder(orderId);location.reload();}catch(err){b.disabled=false;b.textContent=old;alert(`تعذر حذف الأوردر. ${err?.message||'حاول مرة أخرى.'}`)}};
        actions.appendChild(b);
      }
    });
  }

  function sync(){
    ensureAddButton();
    ensureRowActions();
    enhanceProductCells();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',sync,{once:true}); else sync();
  new MutationObserver(sync).observe(document.body,{childList:true,subtree:true});
  setInterval(sync,700);
})();
