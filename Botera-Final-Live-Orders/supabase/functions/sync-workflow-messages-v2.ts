import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workflow-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });

function field(text: string, names: string[]) {
  const re = new RegExp(`(?:${names.join("|")})\\s*[:：-]?\\s*([^\\n]+)`, "i");
  return text.match(re)?.[1]?.trim() || null;
}
function normalizePhone(value: string | null) {
  if (!value) return null;
  const digits = String(value).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const clean = digits.replace(/[^0-9+]/g, "").replace(/^0020/, "+20").replace(/^20/, "0");
  return /^01\d{9}$/.test(clean) ? clean : null;
}
async function tryCreateOrder(db: any, companyId: string, conversationId: string, customerId: string, sourceMessageId: string | null) {
  const { data: existing } = await db.from("orders").select("id,order_number,status").eq("company_id", companyId).eq("conversation_id", conversationId).not("status", "eq", "cancelled").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return existing;
  const { data: msgs, error: me } = await db.from("messages").select("sender,message,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(60);
  if (me) throw me;
  const { data: products, error: pe } = await db.from("products").select("id,name,sku,price,cost").eq("company_id", companyId);
  if (pe) throw pe;
  const customerMessages = (msgs || []).filter((m: any) => m.sender === "customer").map((m: any) => String(m.message || "").trim()).filter(Boolean);
  const combined = (msgs || []).map((m: any) => String(m.message || "").trim()).filter(Boolean).join("\n");
  const phone = normalizePhone((combined.match(/(?:01\d{9}|\+20\d{10})/) || [])[0] || field(combined, ["الهاتف", "الموبايل", "رقم الموبايل", "رقم الهاتف", "phone"]));
  if (!phone) return null;
  let name = field(combined, ["الاسم", "اسم العميل", "name"]);
  let address = field(combined, ["العنوان", "العنوان كامل", "address"]);
  const lines = customerMessages.flatMap((m: string) => m.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
  const pi = lines.findIndex((x) => normalizePhone(x) === phone);
  if (pi >= 0) { if (!name && pi > 0) name = lines[pi - 1]; if (!address && pi < lines.length - 1) address = lines[pi + 1]; }
  if (!name) name = lines.find((x: string) => !normalizePhone(x) && !/^\d+$/.test(x)) || null;
  if (!address) { const rest = lines.filter((x: string) => x !== name && normalizePhone(x) !== phone); address = rest.length ? rest[rest.length - 1] : null; }
  if (!name || !address) return null;
  const lower = combined.toLocaleLowerCase();
  let product = (products || []).find((p: any) => [p.name, p.sku].filter(Boolean).map((v: any) => String(v).toLocaleLowerCase()).some((v: string) => v && lower.includes(v))) || null;
  if (!product) {
    const aliases: Record<string, string[]> = { "العرض الاول": ["العرض الاول", "العرض الأول", "العرض 1", "العرض الاولى"], "العرض التاني": ["العرض التاني", "العرض الثاني", "العرض 2", "العرض التانى"] };
    product = (products || []).find((p: any) => (aliases[String(p.name || "")] || []).some((a) => lower.includes(a))) || null;
  }
  if (!product) return null;
  const quantity = Math.max(1, parseInt(field(combined, ["الكمية", "quantity", "qty"]) || "1", 10) || 1);
  const { data, error } = await db.rpc("save_order_from_chat", { p_company_id: companyId, p_conversation_id: conversationId, p_customer_id: customerId, p_order: { name, phone, address, product_id: product.id, quantity, source_message_id: sourceMessageId, notes: "تم إنشاء الطلب تلقائيًا من بيانات العميل داخل المحادثة" } });
  if (error) { console.error("auto order creation failed", error); return null; }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ ok: false, error: "POST only" }, 405);

  try {
    const body = await req.json();
    const companyId = String(body.company_id ?? "").trim();
    const channel = String(body.channel ?? "").trim().toLowerCase();
    const platformId = String(body.platform_id ?? "").trim();
    const secret = req.headers.get("x-workflow-secret") ?? "";

    if (!companyId || !channel || !platformId || !secret)
      return out({ ok: false, error: "company_id, channel, platform_id and x-workflow-secret are required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const hb = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const hash = Array.from(new Uint8Array(hb)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const sr = await supabase.from("workflow_sync_secrets").select("secret_hash").eq("company_id", companyId).maybeSingle();
    if (sr.error) throw sr.error;
    if (!sr.data || sr.data.secret_hash !== hash) return out({ ok: false, error: "Invalid workflow secret" }, 401);

    const cm = body.customer_message == null ? "" : String(body.customer_message);
    const am = body.ai_message == null ? "" : String(body.ai_message);
    const cmid = body.customer_message_id ?? body.message_id ?? null;
    const amid = body.ai_message_id ?? (cmid ? `${cmid}:ai` : null);
    const now = new Date().toISOString();

    let customer = await supabase.from("customers")
      .select("id,name,stage")
      .eq("company_id", companyId)
      .eq("source", channel)
      .eq("external_id", platformId)
      .maybeSingle();
    if (customer.error) throw customer.error;

    if (!customer.data) {
      const r = await supabase.from("customers").insert({
        company_id: companyId,
        name: String(body.customer_name ?? platformId),
        source: channel,
        external_id: platformId,
        phone: body.phone ?? null,
        email: body.email ?? null,
        stage: body.stage ?? "new",
        last_contact_at: now,
      }).select("id,name,stage").single();
      if (r.error) throw r.error;
      customer = { data: r.data, error: null } as typeof customer;
    } else {
      const u: Record<string, unknown> = { updated_at: now, last_contact_at: now };
      if (body.customer_name) u.name = String(body.customer_name);
      if (body.phone) u.phone = String(body.phone);
      if (body.email) u.email = String(body.email);
      if (body.stage) u.stage = String(body.stage);
      const r = await supabase.from("customers").update(u).eq("id", customer.data.id);
      if (r.error) throw r.error;
    }

    let conv = await supabase.from("conversations")
      .select("id,unread_count")
      .eq("company_id", companyId)
      .eq("channel", channel)
      .eq("platform_id", platformId)
      .maybeSingle();
    if (conv.error) throw conv.error;

    if (!conv.data) {
      const r = await supabase.from("conversations").insert({
        company_id: companyId,
        customer_id: customer.data.id,
        channel,
        platform_id: platformId,
        status: "open",
        last_message: cm || am || null,
        last_message_at: now,
        unread_count: cm ? 1 : 0,
      }).select("id,unread_count").single();
      if (r.error) throw r.error;
      conv = { data: r.data, error: null } as typeof conv;
    } else {
      const r = await supabase.from("conversations").update({
        customer_id: customer.data.id,
        last_message: am || cm || null,
        last_message_at: now,
        updated_at: now,
        unread_count: cm ? Number(conv.data.unread_count ?? 0) + 1 : Number(conv.data.unread_count ?? 0),
      }).eq("id", conv.data.id);
      if (r.error) throw r.error;
    }

    const inserted: string[] = [];

    if (cm && cmid) {
      const r = await supabase.from("messages").upsert({
        conversation_id: conv.data.id,
        sender: "customer",
        message: cm,
        message_type: body.message_type ?? "text",
        attachment_url: body.attachment_url ?? null,
        attachment_type: body.attachment_type ?? null,
        external_message_id: String(cmid),
      }, { onConflict: "external_message_id", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      if (r.data?.length) inserted.push("customer");
    }

    if (am && amid) {
      const r = await supabase.from("messages").upsert({
        conversation_id: conv.data.id,
        sender: "bot",
        message: am,
        message_type: body.reply_type ?? "text",
        attachment_url: body.reply_attachment_url ?? null,
        attachment_type: body.reply_attachment_type ?? null,
        external_message_id: String(amid),
      }, { onConflict: "external_message_id", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      if (r.data?.length) inserted.push("bot");
    }

    const order = cm ? await tryCreateOrder(supabase, companyId, conv.data.id, customer.data.id, String(cmid || "")) : null;
    return out({ ok: true, customer_id: customer.data.id, conversation_id: conv.data.id, inserted, order });
  } catch (e) {
    console.error(e);
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
