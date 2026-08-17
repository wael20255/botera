(function(){
  if(window.__boteraReportCostFix)return;window.__boteraReportCostFix=true;
  const money=(v,c='EGP')=>typeof formatMoney==='function'?formatMoney(Number(v||0),c):new Intl.NumberFormat('ar-EG-u-nu-latn',{style:'currency',currency:c,maximumFractionDigits:2}).format(Number(v||0));
  const inRange=(d,r)=>window.DateRange?.within?window.DateRange.within(d,r):true;

  async function calculate(range, p){
    const [cq,aq,oq]=await Promise.all([
      supabaseClient.from('campaigns').select('*').eq('company_id',p.company_id),
      supabaseClient.from('ad_expenses').select('*').eq('company_id',p.company_id),
      supabaseClient.from('orders').select('id,created_at').eq('company_id',p.company_id)
    ]);
    const campaigns=cq.data||[], ads=aq.data||[], orders=oq.data||[];
    const adSpend=campaigns.filter(c=>inRange(c.created_at,range)).reduce((s,c)=>s+Number(c.spend||0),0)
      +ads.filter(a=>inRange(a.expense_date,range)).reduce((s,a)=>s+Number(a.amount||0),0);
    const orderCount=orders.filter(o=>inRange(o.created_at,range)).length;
    const beforeShipping=orderCount?adSpend/orderCount:0;
    const currency=p.company?.currency||'EGP';
    return {beforeShipping,currency};
  }

  async function run(){
    if(document.body?.dataset?.page!=='insights')return;
    const p=window.__boteraLiveProfile;if(!p||!window.supabaseClient||!window.DateRange)return;
    const root=document.getElementById('reportsMetrics');if(!root)return;
    try{
      const range=DateRange.getCurrent();
      const {beforeShipping,currency}=await calculate(range,p);
      root.querySelectorAll('.metric-card').forEach(card=>{
        const labelEl=card.querySelector('.kpi-label');const valueEl=card.querySelector('.kpi-value');if(!labelEl||!valueEl)return;
        const label=labelEl.textContent.trim();

        // Keep the existing value of the current "التكلفة" card unchanged;
        // only rename it to the requested after-shipping label.
        if(label==='التكلفة'){
          labelEl.textContent='تكلفة الأوردر بعد الشحن';
          return;
        }
        if(label==='تكلفة الأوردر بعد الشحن'||label==='تكلفة الاوردر بعد الشحن') return;

        // Before shipping = ad spend / orders for the selected date range.
        if(label==='تكلفة الأوردر'||label==='تكلفة الأوردر قبل الشحن'||label==='تكلفة الاوردر قبل الشحن'){
          labelEl.textContent='تكلفة الأوردر قبل الشحن';
          valueEl.textContent=money(beforeShipping,currency);
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