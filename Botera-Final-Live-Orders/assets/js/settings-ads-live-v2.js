(function(){
  if(window.__boteraAdsLiveV2)return;window.__boteraAdsLiveV2=true;
  const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
  const iso=d=>d.toISOString().slice(0,10);
  const show=(form,msg)=>{const el=form.querySelector('[data-integration-error="ads"]');if(el){el.textContent=msg||'';el.style.display=msg?'block':'none';}};
  const input=k=>document.getElementById(`int-ads-${k}`);
  const invoke=(name,body)=>supabaseClient.functions.invoke(name,{body});
  const currentProfile=()=>window.__boteraLiveProfile||window.boteraProfile||window.AuthStore?.get?.()?.profile||null;

  document.addEventListener('submit',async function(ev){
    const form=ev.target?.closest?.('[data-integration-form="ads"]');
    if(!form)return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const profile=currentProfile();
    if(!profile?.company_id){show(form,'تعذر تحديد مساحة العمل.');return;}
    const get=k=>(input(k)?.value||'').trim();
    const platform=(get('platform')||'meta').toLowerCase();
    const adAccountId=get('ad_account_id');
    const accessToken=get('access_token');
    const appId=get('app_id');
    const appSecret=get('app_secret');
    const button=form.querySelector('[data-integration-submit="ads"]');
    show(form,'');
    if(platform!=='meta'){show(form,'المزامنة الحية حاليًا متاحة لحساب Meta فقط.');return;}
    if(!adAccountId||!accessToken||!appId||!appSecret){show(form,'أكمل بيانات Meta المطلوبة أولًا.');return;}
    if(button){button.disabled=true;button.textContent='جارٍ التحقق والمزامنة…';}
    try{
      const saved=await invoke('save-integration-credentials-v2',{
        company_id:profile.company_id,
        action:'save',provider:'meta',channel:'ads',
        external_account_id:adAccountId.replace(/^act_/i,''),
        external_account_name:adAccountId,
        access_token:accessToken,app_secret:appSecret,is_active:true,
        metadata:{app_id:appId,ad_account_id:adAccountId.replace(/^act_/i,''),platform:'meta',live_source:'meta_marketing_api_v2'}
      });
      if(saved.error)throw new Error(saved.error.message||'فشل حفظ الربط.');
      if(!saved.data?.ok)throw new Error(saved.data?.details||saved.data?.error||'فشل التحقق من حساب الإعلانات.');
      const now=new Date(),until=iso(now),since=iso(new Date(now.getTime()-89*86400000));
      if(!DATE_RE.test(since)||!DATE_RE.test(until))throw new Error('نطاق التاريخ غير صالح.');
      const sync=await invoke('sync-meta-ads-spend-v2',{company_id:profile.company_id,since,until});
      if(sync.error)throw new Error(sync.error.message||'فشل جلب صرف Meta.');
      if(!sync.data?.ok)throw new Error(sync.data?.details||sync.data?.error||'فشل جلب صرف Meta.');
      show(form,'');
      if(button)button.textContent=`تم الربط والمزامنة ✓ (${Number(sync.data.spend||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} EGP)`;
      window.dispatchEvent(new CustomEvent('boterarealtimechange'));
      setTimeout(()=>{if(button){button.disabled=false;button.textContent='حفظ وربط';}},2500);
    }catch(err){
      show(form,err?.message||'تعذر إتمام ربط حساب الإعلانات.');
      if(button){button.disabled=false;button.textContent='حفظ وربط';}
    }
  },true);
})();
