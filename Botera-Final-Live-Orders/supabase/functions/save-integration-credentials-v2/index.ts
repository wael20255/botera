import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async(req)=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:cors});
 if(req.method!=="POST") return json({ok:false,error:"method_not_allowed"},405);
 const auth=req.headers.get("Authorization"); if(!auth?.startsWith("Bearer ")) return json({ok:false,error:"missing_authorization"},401);
 const url=Deno.env.get("SUPABASE_URL"), key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if(!url||!key) return json({ok:false,error:"server_configuration_missing"},500);
 const db=createClient(url,key,{auth:{persistSession:false}});
 try{
  const {data:userData,error:userError}=await db.auth.getUser(auth.slice(7)); if(userError||!userData.user) return json({ok:false,error:"invalid_session",details:userError?.message??null},401);
  const body=await req.json().catch(()=>null); if(!body) return json({ok:false,error:"invalid_json_body"},400);
  const {data:profile,error:profileError}=await db.from("profiles").select("company_id,role,is_platform_owner,can_manage_team,can_view_settings").eq("id",userData.user.id).maybeSingle();
  if(profileError) return json({ok:false,error:"profile_lookup_failed",details:profileError.message},500); if(!profile) return json({ok:false,error:"profile_not_found"},403);
  const companyId=String(profile.company_id); if(body.company_id&&String(body.company_id)!==companyId) return json({ok:false,error:"company_mismatch"},403);
  if(!(profile.is_platform_owner||profile.role==="owner"||profile.can_manage_team||profile.can_view_settings)) return json({ok:false,error:"insufficient_permissions"},403);
  const action=String(body.action??"save").toLowerCase();
  if(action==="list"){
   const {data,error}=await db.from("integration_accounts").select("id,provider,channel,external_account_id,external_account_name,token_expires_at,metadata,is_active,updated_at").eq("company_id",companyId).order("updated_at",{ascending:false});
   if(error)return json({ok:false,error:"integration_list_failed",details:error.message},500); return json({ok:true,company_id:companyId,data:data??[]});
  }
  if(action!=="save") return json({ok:false,error:"unsupported_action"},400);
  const provider=String(body.provider??"meta").toLowerCase(), channel=String(body.channel??"meta").toLowerCase();
  const appId=body.app_id??body.meta_app_id??null, appSecret=body.app_secret??body.meta_app_secret??null;
  const externalId=body.external_account_id??body.page_id??body.phone_number_id??body.instagram_account_id??body.ad_account_id??`${provider}:${channel}`;
  const metadata={...(body.metadata&&typeof body.metadata==="object"?body.metadata:{}),...(appId?{app_id:String(appId)}:{}),...(body.page_id?{page_id:String(body.page_id)}:{}),...(body.phone_number_id?{phone_number_id:String(body.phone_number_id)}:{}),...(body.instagram_account_id?{instagram_account_id:String(body.instagram_account_id)}:{}),...(body.ad_account_id?{ad_account_id:String(body.ad_account_id)}:{})};
  const patch:any={company_id:companyId,provider,channel,external_account_id:String(externalId),external_account_name:body.external_account_name??null,token_expires_at:body.token_expires_at??null,metadata,is_active:body.is_active!==false,updated_at:new Date().toISOString()};
  if(body.access_token)patch.access_token=String(body.access_token); if(appSecret)patch.app_secret=String(appSecret); if(body.refresh_token)patch.refresh_token=String(body.refresh_token);
  const {data,error}=await db.from("integration_accounts").upsert(patch,{onConflict:"company_id,provider,channel,external_account_id"}).select("id,provider,channel,external_account_id,external_account_name,token_expires_at,metadata,is_active,updated_at").single();
  if(error)return json({ok:false,error:"integration_save_failed",details:error.message,code:error.code??null,hint:error.hint??null},500);
  return json({ok:true,company_id:companyId,data});
 }catch(e){return json({ok:false,error:"unexpected_error",details:e instanceof Error?e.message:String(e)},500)}
});
