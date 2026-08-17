import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization,x-client-info,apikey,content-type","Access-Control-Allow-Methods":"POST,OPTIONS","Content-Type":"application/json"};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:cors});
const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});

async function authCompany(req:Request){
  const auth=req.headers.get("Authorization");
  if(!auth?.startsWith("Bearer ")) return {error:json({ok:false,error:"missing_authorization"},401)};
  const {data,error}=await db.auth.getUser(auth.slice(7));
  if(error||!data.user) return {error:json({ok:false,error:"invalid_session"},401)};
  const {data:profile}=await db.from("profiles").select("company_id").eq("id",data.user.id).maybeSingle();
  if(!profile?.company_id) return {error:json({ok:false,error:"profile_not_found"},403)};
  return {user:data.user,companyId:profile.company_id};
}

async function audit(companyId:string,action:string,entityType:string|null,entityId:string|null,status:string,reason:string,beforeData:unknown=null,afterData:unknown=null,metadata:unknown={}){
  await db.rpc("log_ai_operation",{p_company_id:companyId,p_action:action,p_entity_type:entityType,p_entity_id:entityId,p_status:status,p_reason:reason,p_before:beforeData,p_after:afterData,p_metadata:metadata});
}

const tools=[{functionDeclarations:[
  {name:"get_customer",description:"Read a customer and their recent orders.",parameters:{type:"object",properties:{customer_id:{type:"string"}},required:["customer_id"]}},
  {name:"get_order",description:"Read a complete order including customer, items and validation.",parameters:{type:"object",properties:{order_id:{type:"string"}},required:["order_id"]}},
  {name:"validate_order",description:"Validate an order for missing items, customer and total/subtotal mismatches.",parameters:{type:"object",properties:{order_id:{type:"string"}},required:["order_id"]}},
  {name:"get_products",description:"List active products with their current price and cost.",parameters:{type:"object",properties:{query:{type:"string"}}}},
  {name:"health_check",description:"Check system consistency for orders and customers.",parameters:{type:"object",properties:{}}},
  {name:"create_order",description:"Create an order from a complete customer conversation. Only use when name, phone, address and product are complete and no active order already exists for the conversation.",parameters:{type:"object",properties:{conversation_id:{type:"string"},customer_id:{type:"string"},name:{type:"string"},phone:{type:"string"},address:{type:"string"},product_id:{type:"string"},quantity:{type:"integer"},source_message_id:{type:"string"}},required:["conversation_id","customer_id","name","phone","address","product_id","quantity"]}},
  {name:"update_customer",description:"Update non-financial customer fields when the new data is explicit and reliable.",parameters:{type:"object",properties:{customer_id:{type:"string"},name:{type:"string"},phone:{type:"string"},address:{type:"string"},city:{type:"string"},notes:{type:"string"}},required:["customer_id"]}},
  {name:"update_order_status",description:"Change an order status when the evidence is explicit. Never delete an order.",parameters:{type:"object",properties:{order_id:{type:"string"},status:{type:"string"},shipping_status:{type:"string"}},required:["order_id","status"]}}
]}];

async function executeTool(companyId:string,name:string,args:any){
  switch(name){
    case "get_customer": {const r=await db.rpc("get_customer_snapshot",{p_company_id:companyId,p_customer_id:String(args.customer_id)});return r.error?{ok:false,error:r.error.message}:r.data;}
    case "get_order": {const r=await db.rpc("get_order_snapshot",{p_company_id:companyId,p_order_id:String(args.order_id)});return r.error?{ok:false,error:r.error.message}:r.data;}
    case "validate_order": {const r=await db.rpc("validate_order_consistency",{p_company_id:companyId,p_order_id:String(args.order_id)});return r.error?{ok:false,error:r.error.message}:r.data;}
    case "get_products": {const {data,error}=await db.from("products").select("id,name,sku,price,cost,status,stock,description").eq("company_id",companyId).eq("status","active").order("name");if(error)return {ok:false,error:error.message};const q=String(args.query||"").trim().toLowerCase();return {ok:true,products:q?data.filter((p:any)=>String(p.name||"").toLowerCase().includes(q)||String(p.sku||"").toLowerCase().includes(q)):data};}
    case "health_check": {const r=await db.rpc("botera_ai_health_summary",{p_company_id:companyId});return r.error?{ok:false,error:r.error.message}:r.data;}
    case "create_order": {const phone=String(args.phone||"").replace(/[^0-9+]/g,"");if(!/^01\d{9}$/.test(phone))return {ok:false,error:"invalid_phone"};const {data:existing}=await db.from("orders").select("id,order_number,status").eq("company_id",companyId).eq("conversation_id",String(args.conversation_id)).not("status","eq","cancelled").order("created_at",{ascending:false}).limit(1).maybeSingle();if(existing)return {ok:true,skipped:"existing_order",order:existing};const r=await db.rpc("create_order_from_agent",{p_company_id:companyId,p_conversation_id:String(args.conversation_id),p_customer_id:String(args.customer_id),p_order:{name:String(args.name),phone,address:String(args.address),product_id:String(args.product_id),quantity:Math.max(1,Number(args.quantity)||1),source_message_id:args.source_message_id||null,notes:"تم إنشاء الطلب بواسطة Botera AI Operations"}});if(r.error)return {ok:false,error:r.error.message};return r.data;}
    case "update_customer": {const {data:before}=await db.from("customers").select("*").eq("company_id",companyId).eq("id",String(args.customer_id)).maybeSingle();const r=await db.rpc("update_customer_from_agent",{p_company_id:companyId,p_customer_id:String(args.customer_id),p_patch:{name:args.name,phone:args.phone,address:args.address,city:args.city,notes:args.notes}});if(r.error)return {ok:false,error:r.error.message};await audit(companyId,"update_customer","customer",String(args.customer_id),r.data?.ok?"success":"failed","AI operations customer update",before,r.data?.after||r.data,{source:"botera-ai-operations"});return r.data;}
    case "update_order_status": {const allowed=["pending","confirmed","shipped","delayed","delivered","returned","cancelled","refunded","قيد التنفيذ","مؤكد","تم الشحن","مؤجل","تم التسليم","مرتجع","ملغي"];if(!allowed.includes(String(args.status)))return {ok:false,error:"unsupported_status"};const {data:before}=await db.from("orders").select("*").eq("company_id",companyId).eq("id",String(args.order_id)).maybeSingle();const r=await db.rpc("update_order_status_from_agent",{p_company_id:companyId,p_order_id:String(args.order_id),p_status:String(args.status),p_shipping_status:args.shipping_status||null});if(r.error)return {ok:false,error:r.error.message};await audit(companyId,"update_order_status","order",String(args.order_id),r.data?.ok?"success":"failed","AI operations order status update",before,r.data?.after||r.data,{source:"botera-ai-operations"});return r.data;}
    default:return {ok:false,error:"unknown_tool"};
  }
}

async function callGemini(contents:any[]){
  const key=Deno.env.get("GEMINI_API_KEY");
  if(!key)return {configured:false};
  const body={systemInstruction:{parts:[{text:"You are Botera AI Operations. Manage customer and order data safely. Never invent values. Read first when uncertain. Only change data when the request is explicit or a safe automatic order-creation event. Use the provided tools. Never delete orders, never change product prices/costs, and never directly set financial totals. After tool execution, respond briefly in Egyptian Arabic."}]},contents,tools,generationConfig:{temperature:0.1,maxOutputTokens:700}};
  const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":key},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok)return {configured:true,error:data?.error?.message||`Gemini HTTP ${r.status}`};
  const content=data?.candidates?.[0]?.content||null;
  const calls=(content?.parts||[]).map((p:any)=>p.functionCall).filter(Boolean);
  const text=(content?.parts||[]).filter((p:any)=>p.text).map((p:any)=>p.text).join("\n");
  return {configured:true,content,calls,text};
}

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({ok:false,error:"method_not_allowed"},405);
  const auth=await authCompany(req);if(auth.error)return auth.error;
  try{
    const body=await req.json();const instruction=String(body.instruction||body.message||"").trim();if(!instruction)return json({ok:false,error:"instruction_required"},400);
    const context=body.context??{};let contents=[{role:"user",parts:[{text:instruction+"\nContext JSON: "+JSON.stringify(context)}]}];let executed:any[]=[];let finalText="";
    for(let step=0;step<4;step++){
      const ai=await callGemini(contents);if(!ai.configured)return json({ok:false,error:"AI_NOT_CONFIGURED",message:"Set GEMINI_API_KEY in Supabase Edge Function secrets to enable the model."},503);if(ai.error)return json({ok:false,error:"AI_PROVIDER_ERROR",details:ai.error},502);
      if(ai.content)contents.push(ai.content);finalText=ai.text||finalText;
      if(!ai.calls.length)break;
      const responseParts:any[]=[];
      for(const call of ai.calls){const result=await executeTool(auth.companyId,call.name,call.args||{});executed.push({tool:call.name,args:call.args,result});responseParts.push({functionResponse:{name:call.name,response:{result}}});await audit(auth.companyId,call.name,call.name.startsWith("get_")||call.name==="validate_order"||call.name==="health_check"?"read":call.name.includes("order")?"order":"customer",null,"success","AI tool execution",null,result,{args:call.args});}
      contents.push({role:"user",parts:responseParts});
    }
    return json({ok:true,response:finalText||"تم تنفيذ العملية.",executed});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500);}
});