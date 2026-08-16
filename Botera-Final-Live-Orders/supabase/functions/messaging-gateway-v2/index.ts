import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,"Content-Type":"application/json"}});
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
Deno.serve(async(req)=>{if(req.method==="OPTIONS")return new Response("ok",{headers:cors});try{
 const auth=req.headers.get("Authorization");if(!auth?.startsWith("Bearer "))return json({ok:false,error:"missing_authorization"},401);
 const {data:u}=await db.auth.getUser(auth.slice(7));if(!u.user)return json({ok:false,error:"invalid_session"},401);
 const b=await req.json();const companyId=String(b.company_id||"");const conversationId=String(b.conversation_id||"");const text=String(b.message||"");
 if(!companyId||!conversationId)return json({ok:false,error:"company_id_conversation_id_required"},400);
 const {data:p}=await db.from("profiles").select("company_id,role,is_platform_owner,can_view_settings,can_view_conversations").eq("id",u.user.id).maybeSingle();
 if(!p||p.company_id!==companyId||!(p.is_platform_owner||p.role==="owner"||p.can_view_settings||p.can_view_conversations))return json({ok:false,error:"forbidden"},403);
 const {data:c,error:ce}=await db.from("conversations").select("id,company_id,channel,platform_id").eq("id",conversationId).eq("company_id",companyId).single();if(ce||!c)return json({ok:false,error:"conversation_not_found"},404);
 const {data:i,error:ie}=await db.from("integration_accounts").select("*").eq("company_id",companyId).eq("provider","meta").eq("channel",c.channel).eq("is_active",true).order("updated_at",{ascending:false}).limit(1).maybeSingle();if(ie||!i?.access_token)return json({ok:false,error:"integration_not_connected",details:ie?.message||null},400);
 let url="",body:any={};
 if(c.channel==="facebook"){url=`https://graph.facebook.com/v23.0/${i.external_account_id}/messages`;body={recipient:{id:c.platform_id},messaging_type:"RESPONSE",message:{text}}}
 else if(c.channel==="instagram"){url=`https://graph.facebook.com/v23.0/${i.external_account_id}/messages`;body={recipient:{id:c.platform_id},message:{text}}}
 else if(c.channel==="whatsapp"){const phoneId=String(i.metadata?.phone_number_id||i.external_account_id||"");if(!phoneId)return json({ok:false,error:"whatsapp_phone_number_id_missing"},400);url=`https://graph.facebook.com/v23.0/${phoneId}/messages`;body={messaging_product:"whatsapp",to:c.platform_id,type:"text",text:{body:text}}}
 else return json({ok:false,error:"unsupported_channel"},400);
 const r=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${i.access_token}`,"Content-Type":"application/json"},body:JSON.stringify(body)});const out=await r.json().catch(()=>({}));if(!r.ok||out.error)return json({ok:false,error:"meta_send_failed",details:out?.error?.message||`HTTP ${r.status}`,meta_code:out?.error?.code||null},400);
 const now=new Date().toISOString();const mid=String(out?.message_id||out?.messages?.[0]?.id||`agent-${crypto.randomUUID()}`);const ins=await db.from("messages").insert({conversation_id:conversationId,sender:"agent",message:text,message_type:"text",external_message_id:mid,created_at:now}).select().single();if(ins.error)return json({ok:false,error:"message_log_failed",details:ins.error.message,meta_response:out},500);
 await db.from("conversations").update({last_message:text,last_message_at:now,updated_at:now}).eq("id",conversationId);
 return json({ok:true,message:ins.data,meta_response:out});
}catch(e){console.error(e);return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}});
