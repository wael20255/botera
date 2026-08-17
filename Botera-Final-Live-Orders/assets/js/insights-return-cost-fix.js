(async function(){
  const p=await useAuth.ensureAuthenticated({requiredPermission:"can_view_insights"});
  if(!p)return;
  const money=(v,c="EGP")=>`${new Intl.NumberFormat("en-US",{maximumFractionDigits:2}).format(Number(v||0))} ${c}`;
  const sum=(a,k)=>a.reduce((s,x)=>s+(Number(x?.[k])||0),0);
  const productCost=o=>{const d=Number(o?.cost_total);if(Number.isFinite(d)&&d>0)return d;return(Array.isArray(o?.order_items)?o.order_items:[]).reduce((s,i)=>s+(Number(i?.cost)||0)*(Number(i?.quantity)||1),0)};
  async function fix(){
    const r=DateRange.getCurrent();
    const [orders,campaigns,ads]=await Promise.all([
      OrdersService.list(p.company_id),
      CampaignsService.list(p.company_id).catch(()=>[]),
      supabaseClient.from("ad_expenses").select("*").eq("company_id",p.company_id).then(x=>x.data||[])
    ]);
    const inRange=(d)=>DateRange.within(d,r), os=orders.filter(o=>inRange(o.created_at));
    const nonCancelled=os.filter(o=>o.status!=="cancelled"), returned=nonCancelled.filter(o=>o.status==="refunded"), sold=nonCancelled.filter(o=>o.status!=="refunded");
    const cs=campaigns.filter(c=>inRange(c.created_at)), ae=ads.filter(e=>inRange(e.expense_date));
    const adSpend=sum(cs,"spend")+sum(ae,"amount");
    const product=sold.reduce((s,o)=>s+productCost(o),0);
    const outbound=sum(sold,"shipping_cost");
    const returns=sum(returned,"return_shipping_cost");
    const afterShipping=product+outbound+returns+adSpend;
    const beforeShipping=os.length?adSpend/os.length:0;
    const delivered=sold.filter(o=>o.status==="delivered");
    const deliveredRevenue=sum(delivered,"total");
    const deliveredCost=delivered.reduce((s,o)=>s+productCost(o),0)+sum(delivered,"shipping_cost");
    const profit=deliveredRevenue-deliveredCost-returns-adSpend;
    document.querySelectorAll(".metric-card").forEach(card=>{
      const label=card.querySelector(".kpi-label")?.textContent?.trim();
      const value=card.querySelector(".kpi-value"); if(!value)return;
      if(label==="تكلفة الأوردر بعد الشحن") value.textContent=money(afterShipping, delivered[0]?.currency||orders[0]?.currency||"EGP");
      if(label==="تكلفة الأوردر قبل الشحن") value.textContent=money(beforeShipping, delivered[0]?.currency||orders[0]?.currency||"EGP");
      if(label==="الأرباح (صافي بعد التسليم)") value.textContent=money(profit, delivered[0]?.currency||orders[0]?.currency||"EGP");
    });
  }
  await fix();
  window.addEventListener("boteradaterangechange",()=>fix().catch(console.error));
  let t;window.addEventListener("boterarealtimechange",()=>{clearTimeout(t);t=setTimeout(()=>fix().catch(console.error),180)});
})();
