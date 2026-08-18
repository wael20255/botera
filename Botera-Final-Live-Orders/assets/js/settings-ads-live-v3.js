(function(){
  // Final Meta Ads connection path. Disable the older v2 listener if the old
  // script is still present in the page; this script is loaded before it.
  window.__boteraAdsLiveV2 = true;
  if(window.__boteraAdsLiveV3)return;window.__boteraAdsLiveV3=true;
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
      const saved=await invoke('save-meta-ads-connection-v2',{
        company_id:profile.company_id,
        ad_account_id:adAccountId,
        access_token:accessToken,
        app_id:appId,
        app_secret:appSecret
      });
      if(saved.error)throw new Error(saved.error.message||'فشل حفظ ربط حساب الإعلانات.');
      if(!saved.data?.ok)throw new Error(saved.data?.details||saved.data?.error||'فشل التحقق من حساب الإعلانات.');

      const now=new Date(),until=iso(now),since=iso(new Date(now.getTime()-89*86400000));
      if(!DATE_RE.test(since)||!DATE_RE.test(until))throw new Error('نطاق التاريخ غير صالح.');
      const sync=await invoke('sync-meta-ads-spend-v2',{company_id:profile.company_id,since,until});
      if(sync.error)throw new Error(sync.error.message||'فشل جلب صرف Meta.');
      if(!sync.data?.ok)throw new Error(sync.data?.details||sync.data?.error||'فشل جلب صرف Meta.');

      const currency=sync.data.currency||saved.data.account?.currency||'EGP';
      if(button)button.textContent=`تم الربط والمزامنة ✓ (${Number(sync.data.spend||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} ${currency})`;
      show(form,'');
      window.dispatchEvent(new CustomEvent('boterarealtimechange'));
      setTimeout(()=>{if(button){button.disabled=false;button.textContent='حفظ وربط';}},2500);
    }catch(err){
      show(form,err?.message||'تعذر إتمام ربط حساب الإعلانات.');
      if(button){button.disabled=false;button.textContent='حفظ وربط';}
    }
  },true);

  try {
    if (typeof useAuth !== 'undefined') window.useAuth = useAuth;
    if (typeof supabaseClient !== 'undefined') window.supabaseClient = supabaseClient;
  } catch (_) {}

  try {
    if (!window.__boteraIntegrationsEnhancementLoaded) {
      window.__boteraIntegrationsEnhancementLoaded = true;
      const script = document.createElement('script');
      script.src = 'assets/js/settings-integrations-enhancement.js?v=20260818-2';
      script.defer = true;
      document.head.appendChild(script);

      const cleanup = document.createElement('script');
      cleanup.src = 'assets/js/settings-integrations-minimal.js?v=20260818-1';
      cleanup.defer = true;
      document.head.appendChild(cleanup);
    }
  } catch (e) {
    console.warn('Could not load integrations enhancements:', e);
  }
})();
