(function(){
  if(window.__boteraReportCostFix)return;window.__boteraReportCostFix=true;
  const money=(v,c='EGP')=>typeof formatMoney==='function'?formatMoney(Number(v||0),c):new Intl.NumberFormat('ar-EG-u-nu-latn',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v||0));
  const inRange=(d,r)=>window.DateRange?.within?window.DateRange.within(d,r):true;
  const pc=o=>{const d=Number(o?.cost_total);if(Number.isFinite(d)&&d>0)return d;return(Array.isArray(o?.order_items)?o.order_items:[]).reduce((s,i)=>s+Number(i?.cost||0)*Number(i?.quantity||1),0)};

  async function calculate(range, p){
    const [oq,cq,aq]=await Promise.all([
      supabaseClient.from('orders').select('*,order_items(cost,quantity)').eq('company_id',p.company_id),
      supabaseClient.from('campaigns').select('*').eq('company_id',p.company_id),
      supabaseClient.from('ad_expenses').select('*').eq('company_id',p.company_id)
    ]);
    const orders=oq.data||[], campaigns=cq.data||[], ads=aq.data||[];
    const current=orders.filter(o=>inRange(o.created_at,range));
    const refunded=current.filter(o=>o.status==='refunded');
    const adSpend=campaigns.filter(c=>inRange(c.created_at,range)).reduce((s,c)=>s+Number(c.spend||0),0)+ads.filter(a=>inRange(a.expense_date,range)).reduce((s,a)=>s+Number(a.amount||0),0);
    const orderCount=current.length;

    // Before shipping = advertising cost distributed over all orders.
    const beforeShipping=orderCount?adSpend/orderCount:0;

    // Existing after-shipping base: delivered product + outbound shipping,
    // plus return-shipping for refunded orders. Then add the advertising cost
    // represented by the before-shipping metric for each refunded order.
    const delivered=current.filter(o=>o.status==='delivered');
    const realizedBase=delivered.reduce((s,o)=>s+pc(o)+Number(o.shipping_cost||0),0)+refunded.reduce((s,o)=>s+Number(o.return_shipping_cost||0),0);
    const afterShipping=orderCount?(realizedBase+(beforeShipping*refunded.length))/orderCount:0;
    const currency=current.find(o=>o.currency)?.currency||p.company?.currency||'EGP';
    return {beforeShipping,afterShipping,currency};
  }

  async function run(){
    if(document.body?.dataset?.page!=='insights')return;
    const p=window.__boteraLiveProfile;if(!p||!window.supabaseClient||!window.DateRange)return;
    const root=document.getElementById('reportsMetrics');if(!root)return;
    try{
      const range=DateRange.getCurrent();
      const {beforeShipping,afterShipping,currency}=await calculate(range,p);
      root.querySelectorAll('.metric-card').forEach(card=>{
        const labelEl=card.querySelector('.kpi-label');const valueEl=card.querySelector('.kpi-value');if(!labelEl||!valueEl)return;
        const label=labelEl.textContent.trim();
        if(label==='التكلفة'||label==='تكلفة الأوردر قبل الشحن'||label==='تكلفة الاوردر قبل الشحن'){
          labelEl.textContent='تكلفة الأوردر قبل الشحن';valueEl.textContent=money(beforeShipping,currency);
        }else if(label==='تكلفة الأوردر'||label==='تكلفة الأوردر بعد الشحن'||label==='تكلفة الاوردر بعد الشحن'){
          labelEl.textContent='تكلفة الأوردر بعد الشحن';valueEl.textContent=money(afterShipping,currency);
        }
      });
    }catch(error){
      console.error('Report cost fix failed:',error);
    }
  }
  window.addEventListener('load',()=>setTimeout(run,650));
  window.addEventListener('boteradaterangechange',()=>setTimeout(run,150));
  window.addEventListener('boterarealtimechange',()=>setTimeout(run,250));
  const mo=new MutationObserver(()=>{if(document.body?.dataset?.page==='insights')setTimeout(run,200)});mo.observe(document.body,{childList:true,subtree:true});
})();