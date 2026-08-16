import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = "botera_fb_webhook_2026";
const WEBHOOK_URL = "https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/facebook-webhook-v2";
const API = "v23.0";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
  if(req.method!=="POST") return json({ok:false,error:"POST only"},405);
  const auth=req.headers.get("Authorization");
  if(!auth?.startsWith("Bearer ")) return json({ok:false,error:"missing_authorization"},401);
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
  const {data:{user},error:ue}=await db.auth.getUser(auth.slice(7));
  if(ue||!user) return json({ok:false,error:"invalid_session"},401);
  try{
    const body=await req.json();
    const companyId=String(body.company_id||"").trim();
    const channel=String(body.channel||"").toLowerCase().trim();
    if(!companyId||!channel) return json({ok:false,error:"company_id_and_channel_required"},400);
    const {data:profile}=await db.from("profiles").select("company_id,role,is_platform_owner,can_manage_team,can_view_settings").eq("id",user.id).maybeSingle();
    if(!profile||profile.company_id!==companyId) return json({ok:false,error:"forbidden"},403);
    if(!(profile.is_platform_owner||profile.role==="owner"||profile.can_manage_team||profile.can_view_settings)) return json({ok:false,error:"insufficient_permissions"},403);
    const {data:integration,error:intErr}=await db.from("integration_accounts").select("id,company_id,channel,provider,external_account_id,external_account_name,access_token,metadata,is_active").eq("company_id",companyId).eq("channel",channel).order("updated_at",{ascending:false}).limit(1).maybeSingle();
    if(intErr) throw intErr;
    if(!integration?.access_token) return json({ok:false,error:`${channel}_access_token_missing`},400);

    let result:any={};
    if(channel==="whatsapp"){
      const phoneId=String(integration.metadata?.phone_number_id||integration.external_account_id||"").trim();
      const wabaId=String(body.waba_id||integration.metadata?.waba_id||"").trim();
      if(!phoneId||!wabaId) return json({ok:false,error:"whatsapp_phone_number_id_and_waba_id_required"},400);
      const r=await fetch(`https://graph.facebook.com/${API}/${encodeURIComponent(phoneId)}?fields=id,display_phone_number,verified_name,status&access_token=${encodeURIComponent(integration.access_token)}`);
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.error) return json({ok:false,error:"whatsapp_token_validation_failed",details:data?.error?.message||`Meta HTTP ${r.status}`,meta_code:data?.error?.code??null},400);
      const sub=await fetch(`https://graph.facebook.com/${API}/${encodeURIComponent(wabaId)}/subscribed_apps`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscribed_fields:["messages"],access_token:integration.access_token})});
      const subBody=await sub.json().catch(()=>({}));
      result={phone_id:phoneId,waba_id:wabaId,phone:data,webhook:{url:WEBHOOK_URL,subscribed:sub.ok&&subBody?.success!==false,response:subBody}};
      const metadata={...(integration.metadata||{}),phone_number_id:phoneId,waba_id:wabaId,connection_status:"connected",last_validated_at:new Date().toISOString(),webhook:result.webhook,validated_account_name:data?.verified_name||data?.display_phone_number||null};
      await db.from("integration_accounts").update({is_active:true,external_account_id:phoneId,external_account_name:data?.verified_name||data?.display_phone_number||integration.external_account_name,metadata}).eq("id",integration.id);
    } else if(channel==="instagram"){
      const igId=String(integration.metadata?.instagram_account_id||integration.external_account_id||"").trim();
      if(!igId) return json({ok:false,error:"instagram_account_id_required"},400);
      const r=await fetch(`https://graph.facebook.com/${API}/${encodeURIComponent(igId)}?fields=id,username,name&access_token=${encodeURIComponent(integration.access_token)}`);
      const data=await r.json().catch(()=>({}));
      if(!r.ok||data.error) return json({ok:false,error:"instagram_token_validation_failed",details:data?.error?.message||`Meta HTTP ${r.status}`,meta_code:data?.error?.code??null},400);
      const sub=await fetch(`https://graph.facebook.com/${API}/${encodeURIComponent(igId)}/subscribed_apps`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({subscribed_fields:["messages","messaging_postbacks"],access_token:integration.access_token})});
      const subBody=await sub.json().catch(()=>({}));
      result={instagram_account_id:igId,account:data,webhook:{url:WEBHOOK_URL,subscribed:sub.ok&&subBody?.success!==false,response:subBody}};
      const metadata={...(integration.metadata||{}),instagram_account_id:igId,connection_status:"connected",last_validated_at:new Date().toISOString(),webhook:result.webhook,validated_account_name:data?.username||data?.name||null};
      await db.from("integration_accounts").update({is_active:true,external_account_id:igId,external_account_name:data?.username||data?.name||integration.external_account_name,metadata}).eq("id",integration.id);
    } else {
      return json({ok:false,error:"unsupported_channel"},400);
    }
    return json({ok:true,status:"connected",result});
  }catch(e){
    console.error(e); return json({ok:false,error:e instanceof Error?e.message:String(e)},500);
  }
});
