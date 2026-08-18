(function(){
  if(window.__boteraGoogleSheetsOrdersV1)return; window.__boteraGoogleSheetsOrdersV1=true;
  const WEBHOOK_BASE='https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/google-sheets-orders-webhook-v1';
  const template=(cfg)=>`const BOTERA_CONFIG = ${JSON.stringify(cfg,null,2)};\n\nfunction onOpen(){ SpreadsheetApp.getUi().createMenu('Botera').addItem('Sync current sheet','boteraSyncCurrentSheet').addToUi(); }\n\nfunction boteraSendRow_(sheet,rowNumber){\n  const lastCol=sheet.getLastColumn();\n  const headers=sheet.getRange(1,1,1,lastCol).getValues()[0];\n  const values=sheet.getRange(rowNumber,1,1,lastCol).getDisplayValues()[0];\n  const payload={sheet_id:BOTERA_CONFIG.sheet_id,sheet_name:BOTERA_CONFIG.sheet_name,row_number:rowNumber,headers:headers,values:values,edited_at:new Date().toISOString()};\n  const options={method:'post',contentType:'application/json',headers:{'x-botera-secret':BOTERA_CONFIG.webhook_secret},payload:JSON.stringify(payload),muteHttpExceptions:true};\n  const res=UrlFetchApp.fetch(BOTERA_CONFIG.webhook_url,options);\n  Logger.log(res.getContentText());\n}\n\nfunction boteraOnEdit(e){\n  if(!e||!e.range)return;\n  const sheet=e.range.getSheet();\n  if(sheet.getName()!==BOTERA_CONFIG.sheet_name)return;\n  if(e.range.getRow()===1)return;\n  boteraSendRow_(sheet,e.range.getRow());\n}\n\nfunction boteraSyncCurrentSheet(){\n  const sheet=SpreadsheetApp.getActive().getSheetByName(BOTERA_CONFIG.sheet_name);\n  if(!sheet)throw new Error('Sheet not found: '+BOTERA_CONFIG.sheet_name);\n  const lastRow=sheet.getLastRow();\n  for(let r=2;r<=lastRow;r++) boteraSendRow_(sheet,r);\n}\n`;
  function cfg(){return window.__boteraGoogleSheetsConfig||null;}
  function inject(){
    const root=document.getElementById('integrationsTab'); if(!root||document.getElementById('googleSheetsOrdersCard'))return;
    const c=cfg()||{};
    const webhookUrl=c.webhook_url||WEBHOOK_BASE;
    const secret=c.webhook_secret||'';
    const sheetId=c.sheet_id||'';
    const sheetName=c.sheet_name||'orders';
    const code=template({sheet_id:sheetId,sheet_name:sheetName,webhook_url:webhookUrl,webhook_secret:secret});
    const card=document.createElement('article'); card.id='googleSheetsOrdersCard'; card.className='integration-card'; card.style='border:1px solid var(--color-border);border-radius:16px;margin-top:14px;overflow:hidden;';
    card.innerHTML=`<button type="button" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:transparent;border:0;color:inherit;padding:18px;cursor:pointer;text-align:right;"><span><strong style="display:block;font-size:16px;">Google Sheets — Orders</strong><small style="color:var(--muted);">أي أوردر جديد أو تعديل في تبويب orders يتزامن تلقائيًا مع Botera.</small></span><span>${c.webhook_secret?'<span class="badge badge-neon">تم الربط ✓</span>':'<span class="badge badge-red">غير مربوط</span>'}</span></button><div style="padding:0 18px 18px;"><form id="googleSheetsOrdersForm" class="settings-add-form"><div class="form-grid-2"><div class="form-field"><label class="form-label">Google Sheet ID</label><input class="form-input" id="gsSheetId" value="${escapeHtml(sheetId)}" placeholder="1AbC..." required></div><div class="form-field"><label class="form-label">اسم التبويب</label><input class="form-input" id="gsSheetName" value="${escapeHtml(sheetName)}" required></div></div><div class="form-error" id="gsError" style="display:none;"></div><button class="btn" type="submit" id="gsSave">حفظ وربط Google Sheets</button></form><div id="gsResult" style="margin-top:14px;"></div><div style="margin-top:14px;"><label class="form-label">Apps Script</label><textarea id="gsScript" class="form-input" rows="16" style="font-family:monospace;direction:ltr;white-space:pre;">${escapeHtml(code)}</textarea></div></div>`;
    const first= root.querySelector('#channelStatusList')?.parentElement; root.appendChild(card);
    const form=card.querySelector('#googleSheetsOrdersForm');
    form.addEventListener('submit',async(e)=>{
      e.preventDefault(); const btn=form.querySelector('#gsSave'), err=form.querySelector('#gsError'); err.style.display='none'; btn.disabled=true; btn.textContent='جارٍ الحفظ…';
      try{
        const {data,error}=await supabaseClient.functions.invoke('save-google-sheets-orders-v1',{body:{sheet_id:document.getElementById('gsSheetId').value.trim(),sheet_name:document.getElementById('gsSheetName').value.trim()}});
        if(error)throw new Error(error.message||'فشل الربط'); if(!data?.ok)throw new Error(data?.details||data?.error||'فشل الربط');
        window.__boteraGoogleSheetsConfig={webhook_url:data.webhook_url,webhook_secret:data.webhook_secret,sheet_id:data.data.external_account_id,sheet_name:data.data.external_account_name};
        document.getElementById('gsScript').value=template(window.__boteraGoogleSheetsConfig);
        document.getElementById('gsResult').innerHTML='<div class="badge badge-neon">تم الربط ✓ — انسخ الـApps Script إلى Extensions → Apps Script في الشيت.</div>';
        btn.textContent='تم الربط ✓';
      }catch(ex){err.textContent=ex.message||'فشل الربط';err.style.display='block';btn.textContent='حفظ وربط Google Sheets';}
      finally{setTimeout(()=>{btn.disabled=false;btn.textContent='حفظ وربط Google Sheets';},1800);}
    });
  }
  async function load(){
    try{const {data,error}=await supabaseClient.functions.invoke('save-google-sheets-orders-v1',{body:{action:'list'}});if(!error&&data?.ok&&data.data?.[0]){const r=data.data[0];window.__boteraGoogleSheetsConfig={webhook_url:data.webhook_url,webhook_secret:r.metadata?.webhook_secret||'',sheet_id:r.external_account_id,sheet_name:r.external_account_name||r.metadata?.sheet_name||'orders'};}}
    catch(_){ }
    inject();
  }
  const obs=new MutationObserver(()=>{if(document.getElementById('integrationsTab'))inject();});
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(load,1200);
})();
