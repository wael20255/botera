(async function(){
  if(window.__boteraInsightsReturnCostFix)return;
  window.__boteraInsightsReturnCostFix=true;

  const money=(v,c="EGP")=>typeof formatMoney==="function"
    ? formatMoney(Number(v||0),c)
    : new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Number(v||0))+" "+c;
  const sum=(a,k)=>a.reduce((s,x)=>s+(Number(x?.[k])||0),0);
  const inRange=(d,r)=>window.DateRange?.within?window.DateRange.within(d,r):true;

  function installReportStyle(){
    if(document.getElementById("botera-report-modern-style"))return;
    const style=document.createElement("style");
    style.id="botera-report-modern-style";
    style.textContent=`
      #reportsMetrics{grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;}
      #reportsMetrics .metric-card{position:relative;overflow:hidden;min-height:142px;padding:22px;border-radius:20px;background:linear-gradient(145deg,var(--color-surface),var(--color-surface-2));border:1px solid var(--color-border);box-shadow:0 14px 34px rgba(0,0,0,.18);transition:transform 160ms ease,border-color 160ms ease,box-shadow 160ms ease;}
      #reportsMetrics .metric-card:hover{transform:translateY(-2px);border-color:var(--color-border-strong);box-shadow:0 18px 42px rgba(0,0,0,.24);}
      #reportsMetrics .metric-card.featured{grid-column:span 2;min-height:164px;padding:24px;}
      #reportsMetrics .metric-card.featured .kpi-label{font-size:14px;}
      #reportsMetrics .metric-card.featured .kpi-value{font-size:32px;}
      #reportsMetrics .metric-card.featured::after{content:"";position:absolute;inset:auto 0 0 0;height:3px;background:var(--color-neon);opacity:.9;}
      #reportsMetrics .metric-card.ad-spend::after{background:var(--color-sky);}
      #reportsMetrics .metric-card .kpi-value{letter-spacing:-.02em;}
      @media(max-width:900px){#reportsMetrics{grid-template-columns:repeat(2,minmax(0,1fr));}#reportsMetrics .metric-card.featured{grid-column:span 1;}}
      @media(max-width:560px){#reportsMetrics{grid-template-columns:1fr;}#reportsMetrics .metric-card.featured{grid-column:span 1;}}
    `;
    document.head.appendChild(style);
  }

  function arrangeMetrics(){
    const root=document.getElementById("reportsMetrics");
    if(!root)return;
    const cards=[...root.querySelectorAll(".metric-card")];
    if(cards.length<2)return;
    const getLabel=c=>c.querySelector(".kpi-label")?.textContent?.trim()||"";
    const byLabel={};
    cards.forEach(card=>{byLabel[getLabel(card)]=card;});
    const profit=byLabel["الأرباح (صافي بعد التسليم)"];
    const ads=byLabel["صرف الإعلانات"];
    const revenue=byLabel["الإيراد"];
    const orders=byLabel["عدد الأوردرات"];
    const deliveries=byLabel["التسليمات"];
    const afterShipping=byLabel["تكلفة الأوردر بعد الشحن"]||byLabel["التكلفة"];
    const aov=byLabel["متوسط قيمة الطلب"];
    const beforeShipping=byLabel["تكلفة الأوردر قبل الشحن"]||byLabel["تكلفة الأوردر"];
    [profit,ads,revenue,orders,deliveries,afterShipping,aov,beforeShipping].filter(Boolean).forEach(card=>root.appendChild(card));
    cards.forEach(card=>card.classList.remove("featured","ad-spend"));
    if(ads)ads.classList.add("featured","ad-spend");
    if(profit)profit.classList.add("featured");
  }

  async function fix(){
    const p=window.__boteraLiveProfile||window.AuthStore?.get?.().profile;
    if(!p||!window.supabaseClient||!window.DateRange)return;
    const root=document.getElementById("reportsMetrics");
    if(!root)return;

    const r=DateRange.getCurrent();
    const [orders,campaigns,ads]=await Promise.all([
      OrdersService.list(p.company_id),
      CampaignsService.list(p.company_id).catch(()=>[]),
      supabaseClient.from("ad_expenses").select("*").eq("company_id",p.company_id).then(x=>x.data||[])
    ]);

    const os=orders.filter(o=>inRange(o.created_at,r));
    const allOrdersForAds=os.filter(o=>o.status!=="cancelled");
    const delivered=os.filter(o=>o.status==="delivered");
    const cs=campaigns.filter(c=>inRange(c.created_at,r));
    const ae=ads.filter(e=>inRange(e.expense_date,r));

    // EXACT requested formulas:
    // 1) Before-shipping order cost = total ad spend / total non-cancelled orders.
    // 2) After-shipping order cost = total ad spend / delivered orders.
    // 3) Revenue = delivered order revenue only.
    // 4) Net profit = delivered revenue - (after-shipping cost per delivered order * delivered count).
    const adSpend=sum(cs,"spend")+sum(ae,"amount");
    const beforeShippingPerOrder=allOrdersForAds.length?adSpend/allOrdersForAds.length:0;
    const afterShippingPerOrder=delivered.length?adSpend/delivered.length:0;
    const deliveredRevenue=sum(delivered,"total");
    const totalDeliveredCost=afterShippingPerOrder*delivered.length;
    const profit=deliveredRevenue-totalDeliveredCost;
    const deliveredAov=delivered.length?deliveredRevenue/delivered.length:0;
    const currency=delivered[0]?.currency||os[0]?.currency||p.company?.currency||"EGP";

    root.querySelectorAll(".metric-card").forEach(card=>{
      const label=card.querySelector(".kpi-label")?.textContent?.trim();
      const value=card.querySelector(".kpi-value");
      if(!value)return;
      if(label==="التكلفة"||label==="تكلفة الأوردر بعد الشحن"||label==="تكلفة الاوردر بعد الشحن"){
        card.querySelector(".kpi-label").textContent="تكلفة الأوردر بعد الشحن";
        value.textContent=money(afterShippingPerOrder,currency);
      }
      if(label==="تكلفة الأوردر"||label==="تكلفة الأوردر قبل الشحن"||label==="تكلفة الاوردر قبل الشحن"){
        card.querySelector(".kpi-label").textContent="تكلفة الأوردر قبل الشحن";
        value.textContent=money(beforeShippingPerOrder,currency);
      }
      if(label==="الأرباح (صافي بعد التسليم)")value.textContent=money(profit,currency);
      if(label==="الإيراد")value.textContent=money(deliveredRevenue,currency);
      if(label==="متوسط قيمة الطلب")value.textContent=money(deliveredAov,currency);
      if(label==="عدد الأوردرات")value.textContent=String(os.length);
      if(label==="التسليمات")value.textContent=String(delivered.length);
    });

    installReportStyle();
    arrangeMetrics();
  }

  const run=()=>fix().catch(e=>console.error("Reports exact-cost fix failed:",e));
  window.addEventListener("load",()=>setTimeout(run,300));
  window.addEventListener("boteradaterangechange",()=>setTimeout(run,100));
  window.addEventListener("boterarealtimechange",()=>setTimeout(run,200));
  if(window.AuthStore?.subscribe)window.AuthStore.subscribe(()=>setTimeout(run,100));

  let attempts=0;
  const retry=setInterval(()=>{
    attempts++;
    run();
    if(attempts>=20)clearInterval(retry);
  },500);

  const mo=new MutationObserver(()=>{
    if(document.body?.dataset?.page==="insights")setTimeout(run,180);
  });
  mo.observe(document.body,{childList:true,subtree:true});
})();