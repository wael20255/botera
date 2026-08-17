(function(){
  if(window.__boteraLiveFixes)return;window.__boteraLiveFixes=true;
  const profile=()=>window.__boteraLiveProfile;
  const page=()=>document.body?.dataset?.page||'';
  const esc=v=>typeof escapeHtml==='function'?escapeHtml(String(v??'')):String(v??'');
  const inRange=(d,r)=>DateRange?.within?DateRange.within(d,r):true;
  const sum=(a,k)=>(a||[]).reduce((s,x)=>s+Number(x?.[k]||0),0);
  const pc=o=>{const d=Number(o?.cost_total);if(Number.isFinite(d)&&d>0)return d;return(Array.isArray(o?.order_items)?o.order_items:[]).reduce((s,i)=>s+Number(i?.cost||0)*Number(i?.quantity||1),0)};
  const digits=s=>String(s??'').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const englishMoney=(v,c='EGP')=>new Intl.NumberFormat('ar-EG-u-nu-latn',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v||0));
  const englishDate=v=>!v?'—':new Intl.DateTimeFormat('ar-EG-u-nu-latn',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));

  function enableEnglishNumerals(){
    if(!['dashboard','insights'].includes(page()))return;
    window.formatMoney=englishMoney;
    window.formatDate=englishDate;
    if(DateRange?.buckets&&!DateRange.__latinPatched){
      const originalBuckets=DateRange.buckets.bind(DateRange);
      DateRange.buckets=function(range){return originalBuckets(range).map(b=>({...b,label:digits(b.label)}));};
      DateRange.__latinPatched=true;
    }
    const walk=root=>{if(!root)return;const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];let n;while((n=w.nextNode()))nodes.push(n);nodes.forEach(x=>{const v=digits(x.nodeValue);if(v!==x.nodeValue)x.nodeValue=v})};
    walk(document.body);
    if(!window.__boteraLatinObserver){const mo=new MutationObserver(()=>walk(document.body));mo.observe(document.body,{childList:true,subtree:true});window.__boteraLatinObserver=mo;}
  }

  async function returnCost(){
    const f=document.getElementById('shippingSettingsForm'),p=profile();if(!f||f.querySelector('#shippingReturnCost')||!p)return;
    const q=await supabaseClient.from('shipping_settings').select('return_cost').eq('company_id',p.company_id).maybeSingle();
    const d=document.createElement('div');d.className='form-field';d.innerHTML='<label class="form-label">تكلفة المرتجع لكل أوردر</label><input class="form-input" id="shippingReturnCost" type="number" min="0" step="0.01" value="'+Number(q.data?.return_cost||0)+'"><div class="form-hint">تُضاف عند تسجيل المرتجع وتدخل في حساب التكلفة والربح.</div>';f.appendChild(d);
    f.addEventListener('submit',()=>setTimeout(async()=>{await supabaseClient.from('shipping_settings').upsert({company_id:p.company_id,return_cost:Math.max(0,Number(document.getElementById('shippingReturnCost')?.value||0)),updated_at:new Date().toISOString()},{onConflict:'company_id'})},300));
  }

  async function adControls(){
    const p=profile(),t=[...document.querySelectorAll('#financeTab .data-table')].find(x=>/المبلغ/.test(x.innerText||''));if(!p||!t||t.dataset.live==='1')return;
    const q=await supabaseClient.from('ad_expenses').select('*').eq('company_id',p.company_id).order('expense_date',{ascending:false}).limit(100);if(q.error)return;
    const h=t.querySelector('thead tr'),b=t.querySelector('tbody');if(!b)return;if(h&&!h.querySelector('[data-ad-actions]'))h.insertAdjacentHTML('beforeend','<th data-ad-actions>إجراءات</th>');
    b.innerHTML=(q.data||[]).map(x=>'<tr><td>'+esc(x.expense_date)+'</td><td>إعلان</td><td>'+esc(x.platform||'—')+'</td><td>'+englishMoney(x.amount,p.company?.currency||'EGP')+'</td><td>'+esc(x.entry_mode||'manual')+'</td><td><button class="btn-secondary btn-sm" data-ad-edit="'+x.id+'">تعديل</button> <button class="btn-secondary btn-sm" data-ad-delete="'+x.id+'">حذف</button></td></tr>').join('')||'<tr><td colspan="6">لا توجد مصاريف إعلانية بعد.</td></tr>';t.dataset.live='1';
    b.querySelectorAll('[data-ad-edit]').forEach(bn=>bn.onclick=async()=>{const r=(q.data||[]).find(x=>x.id===bn.dataset.adEdit);if(!r)return;const a=prompt('مبلغ صرف الإعلان',r.amount);if(a===null)return;const n=Number(a);if(!Number.isFinite(n)||n<0)return alert('المبلغ غير صحيح');const platform=prompt('الأكونت / المنصة',r.platform||'');if(platform===null)return;const date=prompt('التاريخ YYYY-MM-DD',r.expense_date);if(date===null)return;const e=await supabaseClient.from('ad_expenses').update({amount:n,platform:platform.trim()||null,expense_date:date,updated_at:new Date().toISOString()}).eq('id',r.id).eq('company_id',p.company_id);if(e.error)alert(e.error.message);else{t.dataset.live='0';adControls()}});
    b.querySelectorAll('[data-ad-delete]').forEach(bn=>bn.onclick=async()=>{if(!confirm('حذف مصروف الإعلان؟'))return;const e=await supabaseClient.from('ad_expenses').delete().eq('id',bn.dataset.adDelete).eq('company_id',p.company_id);if(e.error)alert(e.error.message);else{t.dataset.live='0';adControls()}});
  }

  async function fetchFinanceData(p){
    const [oq,cq,aq]=await Promise.all([
      supabaseClient.from('orders').select('*,order_items(cost,quantity)').eq('company_id',p.company_id),
      supabaseClient.from('campaigns').select('*').eq('company_id',p.company_id),
      supabaseClient.from('ad_expenses').select('*').eq('company_id',p.company_id)
    ]);
    return {orders:oq.data||[],campaigns:cq.data||[],ads:aq.data||[]};
  }

  function profitForRange(orders,campaigns,ads,r){
    const current=orders.filter(o=>inRange(o.created_at,r)), previous=orders.filter(o=>inRange(o.created_at,r.previous));
    const delivered=current.filter(o=>o.status==='delivered'), deliveredPrev=previous.filter(o=>o.status==='delivered');
    const refunded=current.filter(o=>o.status==='refunded'), refundedPrev=previous.filter(o=>o.status==='refunded');
    const adNow=campaigns.filter(c=>inRange(c.created_at,r)).reduce((s,c)=>s+Number(c.spend||0),0)+ads.filter(e=>inRange(e.expense_date,r)).reduce((s,e)=>s+Number(e.amount||0),0);
    const adPrev=campaigns.filter(c=>inRange(c.created_at,r.previous)).reduce((s,c)=>s+Number(c.spend||0),0)+ads.filter(e=>inRange(e.expense_date,r.previous)).reduce((s,e)=>s+Number(e.amount||0),0);
    const deliveredRevenue=sum(delivered,'total'), deliveredRevenuePrev=sum(deliveredPrev,'total');
    const deliveredProduct=delivered.reduce((s,o)=>s+pc(o),0), deliveredShip=sum(delivered,'shipping_cost');
    const deliveredProductPrev=deliveredPrev.reduce((s,o)=>s+pc(o),0), deliveredShipPrev=sum(deliveredPrev,'shipping_cost');
    const returnCost=sum(refunded,'return_shipping_cost'), returnCostPrev=sum(refundedPrev,'return_shipping_cost');
    return {current,previous,delivered,deliveredPrev,refunded,refundedPrev,adNow,adPrev,deliveredRevenue,deliveredRevenuePrev,deliveredProduct,deliveredProductPrev,deliveredShip,deliveredShipPrev,returnCost,returnCostPrev,profit:deliveredRevenue-deliveredProduct-deliveredShip-returnCost-adNow,prevProfit:deliveredRevenuePrev-deliveredProductPrev-deliveredShipPrev-returnCostPrev-adPrev};
  }

  async function reportFix(){
    if(page()!=='insights')return;
    const p=profile(),m=document.getElementById('reportsMetrics'),a=document.getElementById('adsReportArea'),g=document.getElementById('growthChartArea');if(!p||!m)return;
    const r=DateRange.getCurrent();const {orders,campaigns,ads}=await fetchFinanceData(p);const fx=profitForRange(orders,campaigns,ads,r);
    const valid=fx.current.filter(o=>!['cancelled','refunded'].includes(o.status)),prevValid=fx.previous.filter(o=>!['cancelled','refunded'].includes(o.status));
    const revenue=sum(valid,'total'),revenuePrev=sum(prevValid,'total'),adSpend=fx.adNow,adSpendPrev=fx.adPrev;
    // Realized order cost: delivered orders = product + delivery; returned orders = return cost only.
    // Pending/confirmed/cancelled orders do not add product cost. Advertising is a separate project expense.
    const cost=fx.deliveredProduct+fx.deliveredShip+fx.returnCost+adSpend;
    const prevCost=fx.deliveredProductPrev+fx.deliveredShipPrev+fx.returnCostPrev+adSpendPrev;
    const orderCost=fx.current.length?(fx.deliveredProduct+fx.deliveredShip+fx.returnCost)/fx.current.length:0;
    const prevOrderCost=fx.previous.length?(fx.deliveredProductPrev+fx.deliveredShipPrev+fx.returnCostPrev)/fx.previous.length:0;
    const aov=valid.length?revenue/valid.length:0,prevAov=prevValid.length?revenuePrev/prevValid.length:0;
    const currency=valid[0]?.currency||p.company?.currency||'EGP';
    const vals={'الإيراد':revenue,'صرف الإعلانات':adSpend,'عدد الأوردرات':fx.current.length,'التسليمات':fx.delivered.length,'التكلفة':cost,'الأرباح (صافي بعد التسليم)':fx.profit,'متوسط قيمة الطلب':aov,'تكلفة الأوردر':orderCost};
    const prevVals={'الإيراد':revenuePrev,'صرف الإعلانات':adSpendPrev,'عدد الأوردرات':fx.previous.length,'التسليمات':fx.deliveredPrev.length,'التكلفة':prevCost,'الأرباح (صافي بعد التسليم)':fx.prevProfit,'متوسط قيمة الطلب':prevAov,'تكلفة الأوردر':prevOrderCost};
    m.querySelectorAll('.metric-card').forEach(card=>{const k=card.querySelector('.kpi-label')?.textContent?.trim();if(!(k in vals))return;const v=card.querySelector('.kpi-value');if(v)v.textContent=['عدد الأوردرات','التسليمات'].includes(k)?digits(vals[k]):englishMoney(vals[k],currency);const d=card.querySelector('.kpi-delta');if(d&&prevVals[k]>0){const change=((vals[k]-prevVals[k])/prevVals[k])*100;d.innerHTML=`<span class="${change>=0?'kpi-delta-up':'kpi-delta-down'}">${change>=0?'▲':'▼'} ${Math.abs(change).toFixed(1)}%</span><span class="kpi-delta-muted">مقابل الفترة السابقة</span>`}});
    if(a){const rows=campaigns.filter(c=>inRange(c.created_at,r)).map(x=>'<tr><td>'+esc(x.name||'—')+'</td><td>'+esc(x.platform||'—')+'</td><td>'+englishMoney(x.spend,currency)+'</td><td>'+englishMoney(x.revenue,currency)+'</td><td>'+Number(x.impressions||0).toLocaleString('en-US')+'</td><td>'+Number(x.clicks||0).toLocaleString('en-US')+'</td><td>'+Number(x.ctr||0).toFixed(2)+'%</td><td>'+englishMoney(x.cpc,currency)+'</td><td>'+englishMoney(x.cpm,currency)+'</td><td>'+(Number(x.spend)?(Number(x.revenue||0)/Number(x.spend)).toFixed(2):'0.00')+'x</td></tr>').join('');const manual=ads.filter(e=>inRange(e.expense_date,r)).map(x=>'<tr><td>مصروف يدوي</td><td>'+esc(x.platform||'—')+'</td><td>'+englishMoney(x.amount,currency)+'</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td><td>—</td></tr>').join('');a.innerHTML=(rows||manual)?'<div style="overflow:auto"><table class="data-table"><thead><tr><th>الحملة</th><th>المنصة</th><th>الإنفاق</th><th>الإيراد</th><th>الظهور</th><th>النقرات</th><th>CTR</th><th>CPC</th><th>CPM</th><th>ROAS</th></tr></thead><tbody>'+rows+manual+'</tbody></table></div>':'';}
    if(g&&typeof Chart!=='undefined'){
      if(window.__boteraFixedGrowthChart)window.__boteraFixedGrowthChart.destroy();const buckets=DateRange.buckets(r);const revenueSeries=buckets.map(b=>valid.filter(o=>inRange(o.created_at,b)).reduce((s,o)=>s+Number(o.total||0),0));const profitSeries=buckets.map(b=>{const d=valid.filter(o=>o.status==='delivered'&&inRange(o.created_at,b));const rf=fx.current.filter(o=>o.status==='refunded'&&inRange(o.created_at,b));const adB=campaigns.filter(c=>inRange(c.created_at,b)).reduce((s,c)=>s+Number(c.spend||0),0)+ads.filter(e=>inRange(e.expense_date,b)).reduce((s,e)=>s+Number(e.amount||0),0);return sum(d,'total')-d.reduce((s,o)=>s+pc(o),0)-sum(d,'shipping_cost')-sum(rf,'return_shipping_cost')-adB});const canvas=g.querySelector('canvas')||(()=>{g.innerHTML='<canvas></canvas>';return g.querySelector('canvas')})();const css=getComputedStyle(document.documentElement);window.__boteraFixedGrowthChart=new Chart(canvas,{type:'line',data:{labels:buckets.map(b=>b.label),datasets:[{label:'الإيراد',data:revenueSeries,borderColor:css.getPropertyValue('--color-chart-teal').trim(),backgroundColor:css.getPropertyValue('--color-chart-teal-fill').trim(),fill:true,tension:.35,pointRadius:0,borderWidth:2},{label:'صافي الربح',data:profitSeries,borderColor:css.getPropertyValue('--color-neon').trim(),backgroundColor:css.getPropertyValue('--color-neon-10').trim(),fill:true,tension:.35,pointRadius:0,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:css.getPropertyValue('--color-text').trim()}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${englishMoney(c.parsed.y,currency)}`}}},scales:{x:{grid:{display:false}},y:{ticks:{callback:v=>englishMoney(v,currency)}}}}});
    }
    enableEnglishNumerals();
  }

  async function dashboardProfitFix(){
    if(page()!=='dashboard')return;const p=profile();if(!p)return;
    const r=DateRange.getCurrent();const {orders, campaigns, ads}=await fetchFinanceData(p);const fx=profitForRange(orders,campaigns,ads,r);const buckets=DateRange.buckets(r);
    const revenueSeries=buckets.map(b=>fx.delivered.filter(o=>inRange(o.created_at,b)).reduce((s,o)=>s+Number(o.total||0),0));
    const profitSeries=buckets.map(b=>{const d=fx.delivered.filter(o=>inRange(o.created_at,b));const rf=fx.refunded.filter(o=>inRange(o.created_at,b));const adB=campaigns.filter(c=>inRange(c.created_at,b)).reduce((s,c)=>s+Number(c.spend||0),0)+ads.filter(e=>inRange(e.expense_date,b)).reduce((s,e)=>s+Number(e.amount||0),0);return sum(d,'total')-d.reduce((s,o)=>s+pc(o),0)-sum(d,'shipping_cost')-sum(rf,'return_shipping_cost')-adB});
    const totalRevenue=revenueSeries.reduce((s,v)=>s+v,0),totalProfit=profitSeries.reduce((s,v)=>s+v,0),totalCosts=totalRevenue-totalProfit,margin=totalRevenue?(totalProfit/totalRevenue)*100:0,currency=fx.delivered[0]?.currency||p.company?.currency||'EGP';
    const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v};set('profitTotalValue',englishMoney(totalProfit,currency));set('profitRevenueValue',englishMoney(totalRevenue,currency));set('profitExpensesValue',englishMoney(totalCosts,currency));set('profitNetValue',englishMoney(totalProfit,currency));set('profitMarginValue',`${margin.toFixed(1)}%`);
    const canvas=document.getElementById('profitChart');if(!canvas||typeof Chart==='undefined')return;if(window.__boteraFixedProfitChart)window.__boteraFixedProfitChart.destroy();const css=getComputedStyle(document.documentElement);window.__boteraFixedProfitChart=new Chart(canvas,{type:'line',data:{labels:buckets.map(b=>b.label),datasets:[{label:'الإيراد المحقق',data:revenueSeries,borderColor:css.getPropertyValue('--color-chart-teal').trim(),backgroundColor:css.getPropertyValue('--color-chart-teal-fill').trim(),fill:true,tension:.35,pointRadius:0,borderWidth:2},{label:'صافي الربح',data:profitSeries,borderColor:css.getPropertyValue('--color-neon').trim(),backgroundColor:css.getPropertyValue('--color-neon-10').trim(),fill:true,tension:.35,pointRadius:0,borderWidth:2}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{color:css.getPropertyValue('--color-text-muted').trim()}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${englishMoney(c.parsed.y,currency)}`}}},scales:{x:{grid:{display:false}},y:{ticks:{callback:v=>englishMoney(v,currency)}}}}});
    enableEnglishNumerals();
  }

  async function orderDetails(){
    const p=profile(),box=document.getElementById('orderDetails');if(!p||!box||box.dataset.liveOrder==='1')return;const n=box.querySelector('.section-title')?.textContent?.trim();if(!n)return;box.dataset.liveOrder='1';const o=(await supabaseClient.from('orders').select('customer_id,return_shipping_cost,currency').eq('company_id',p.company_id).eq('order_number',n).maybeSingle()).data;if(!o?.customer_id)return;const c=(await supabaseClient.from('customers').select('name,phone,address,city,country').eq('id',o.customer_id).maybeSingle()).data;if(!c)return;const list=box.querySelector('[data-order-panel=details] .detail-list');if(!list)return;const li=document.createElement('li');li.innerHTML='<strong>بيانات العميل:</strong><div style="margin-top:8px;line-height:1.9">الاسم: '+esc(c.name||'—')+'<br><span dir="ltr">رقم التلفون: '+esc(c.phone||'—')+'</span><br>العنوان: '+esc(c.address||'—')+(c.city?' — '+esc(c.city):'')+(c.country?' — '+esc(c.country):'')+'<br>تكلفة المرتجع: '+englishMoney(o.return_shipping_cost,o.currency||'EGP')+'</div>';list.insertBefore(li,list.firstChild);
  }

  async function socialNames(){const p=profile();if(!p)return;const q=await supabaseClient.from('customers').select('id').eq('company_id',p.company_id).in('source',['facebook','instagram']).in('name',['Facebook Customer','Instagram Customer','عميل غير معروف']).limit(100);for(const x of q.data||[]){try{await supabaseClient.functions.invoke('sync-social-profile',{body:{customer_id:x.id}})}catch(_){}}}

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-order-id]'))setTimeout(orderDetails,60);
    if(e.target.closest('[data-quick-status="refunded"],[data-update-status="refunded"]'))setTimeout(async()=>{const p=profile(),n=document.querySelector('#orderDetails .section-title')?.textContent?.trim();if(!p||!n)return;const s=(await supabaseClient.from('shipping_settings').select('return_cost').eq('company_id',p.company_id).maybeSingle()).data;const v=Number(s?.return_cost||0);if(v)await supabaseClient.from('orders').update({return_shipping_cost:v}).eq('company_id',p.company_id).eq('order_number',n).eq('return_shipping_cost',0)},500)
  });

  enableEnglishNumerals();
  window.addEventListener('boteradaterangechange',()=>setTimeout(()=>{enableEnglishNumerals();reportFix();dashboardProfitFix()},150));
  window.addEventListener('boterarealtimechange',()=>setTimeout(()=>{enableEnglishNumerals();reportFix();dashboardProfitFix();adControls();orderDetails();socialNames()},300));
  setTimeout(()=>{returnCost();adControls();reportFix();dashboardProfitFix();orderDetails();socialNames();enableEnglishNumerals()},1000);
})();