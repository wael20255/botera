import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workflow-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function field(text: string, names: string[]) {
  const re = new RegExp(`(?:${names.join("|")})\\s*[:：-]?\\s*([^\\n]+)`, "i");
  return text.match(re)?.[1]?.trim() || null;
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const normalized = String(value).replace(/[٠-٩]/g, (d) => String(arabicDigits.indexOf(d)));
  const clean = normalized.replace(/[^0-9+]/g, "").replace(/^0020/, "+20").replace(/^20/, "0");
  return /^01\d{9}$/.test(clean) ? clean : null;
}

function normalizeText(value: string) {
  return String(value || "")
    .toLocaleLowerCase()
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();
}

function extractOrderData(messages: Array<{ sender: string; message: string }>, products: any[], body: any) {
  const customerMessages = messages
    .filter((m) => m.sender === "customer")
    .map((m) => String(m.message || "").trim())
    .filter(Boolean);
  const combined = customerMessages.join("\n");
  if (!combined) return null;

  const phone = normalizePhone(
    String(body.order?.phone || body.phone || "") ||
    (combined.match(/(?:01\d{9}|\+20\d{10})/) || [])[0] ||
    field(combined, ["الهاتف", "الموبايل", "رقم الموبايل", "رقم الهاتف", "رقم التلفون", "التليفون", "phone"]),
  );
  if (!phone) return null;

  let name = String(body.order?.name || body.customer_name || "").trim() || field(combined, ["الاسم", "اسم العميل", "الاسم كامل", "name"]);
  let address = String(body.order?.address || "").trim() || field(combined, ["العنوان", "العنوان كامل", "عنوان التوصيل", "address"]);
  const lines = customerMessages.flatMap((m) => m.split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
  const phoneIndex = lines.findIndex((line) => normalizePhone(line) === phone);

  if (!name && phoneIndex > 0) name = lines[phoneIndex - 1];
  if (!address && phoneIndex >= 0 && phoneIndex < lines.length - 1) address = lines[phoneIndex + 1];

  if (!name) {
    name = lines.find((line) => {
      if (!line || normalizePhone(line)) return false;
      return !/^(الاسم|اسم العميل|الهاتف|الموبايل|رقم الموبايل|رقم الهاتف|رقم التلفون|العنوان|address|phone)\s*[:：-]/i.test(line);
    }) || null;
  }
  if (!address) {
    const candidates = lines.filter((line) => line && line !== name && normalizePhone(line) !== phone && !/^(الاسم|اسم العميل|الهاتف|الموبايل|رقم الموبايل|رقم الهاتف|رقم التلفون|العنوان|address|phone)\s*[:：-]/i.test(line));
    address = candidates.length ? candidates[candidates.length - 1] : null;
  }
  if (!name || !address) return null;

  const lower = normalizeText(combined);
  let product = null;
  if (body.order?.product_id) {
    product = (products || []).find((p: any) => String(p.id) === String(body.order.product_id)) || null;
  }
  if (!product && body.order?.product_name) {
    product = (products || []).find((p: any) => normalizeText(p.name) === normalizeText(body.order.product_name)) || null;
  }
  if (!product) {
    product = (products || []).find((p: any) => {
      const candidates = [p.name, p.sku].filter(Boolean).map((v) => normalizeText(v));
      return candidates.some((v) => v && lower.includes(v));
    }) || null;
  }
  if (!product) {
    const aliases: Record<string, string[]> = {
      "العرض الاول": ["العرض الاول", "العرض 1", "العرض الاولى"],
      "العرض التاني": ["العرض التاني", "العرض الثاني", "العرض 2", "العرض التانى"],
      "العرض الثالث": ["العرض الثالث", "العرض 3"],
      "عرض الساعه": ["عرض الساعه", "عرض الساعة"],
      "عرض الساعه 2": ["عرض الساعه 2", "عرض الساعة 2"],
    };
    product = (products || []).find((p: any) => (aliases[normalizeText(p.name)] || []).some((a) => lower.includes(normalizeText(a)))) || null;
  }

  const quantityRaw = body.order?.quantity ?? field(combined, ["الكمية", "عدد", "quantity", "qty"]);
  const quantity = Math.max(1, Number.parseInt(String(quantityRaw || "1"), 10) || 1);
  return { name: name.trim(), phone, address: address.trim(), product, quantity };
}

async function syncSocialAccountName(companyId: string, customerId: string, channel: string, platformId: string) {
  if (!["facebook", "instagram"].includes(channel) || !platformId) return;
  try {
    const { data: integration } = await db.from("integration_accounts")
      .select("access_token")
      .eq("company_id", companyId)
      .eq("provider", "meta")
      .eq("channel", channel)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!integration?.access_token) return;
    const fields = channel === "facebook" ? "name,first_name,last_name" : "name,username";
    const graphUrl = `https://graph.facebook.com/${encodeURIComponent(platformId)}?fields=${fields}&access_token=${encodeURIComponent(integration.access_token)}`;
    const response = await fetch(graphUrl);
    const graph = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const resolved = String(graph?.name || [graph?.first_name, graph?.last_name].filter(Boolean).join(" ") || graph?.username || "").trim();
    if (!resolved || ["Facebook Customer", "Instagram Customer", "عميل غير معروف"].includes(resolved)) return;
    await db.from("customers").update({ name: resolved, updated_at: new Date().toISOString() }).eq("id", customerId).eq("company_id", companyId);
  } catch (error) {
    console.error("social account name sync failed", error);
  }
}

async function tryCreateOrder(companyId: string, conversationId: string, customerId: string, sourceMessageId: string | null, body: any) {
  const { data: existingOrder, error: existingError } = await db.from("orders")
    .select("id,order_number,status")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError || existingOrder) return existingOrder || null;

  const [{ data: recentMessages }, { data: products }] = await Promise.all([
    db.from("messages").select("sender,message,created_at").eq("conversation_id", conversationId).order("created_at", { ascending: true }).limit(120),
    db.from("products").select("id,name,sku,price,cost,status").eq("company_id", companyId),
  ]);

  const extracted = extractOrderData(recentMessages || [], products || [], body);
  if (!extracted?.product) return null;

  const { data, error } = await db.rpc("save_order_from_chat", {
    p_company_id: companyId,
    p_conversation_id: conversationId,
    p_customer_id: customerId,
    p_order: {
      name: extracted.name,
      phone: extracted.phone,
      address: extracted.address,
      product_id: extracted.product.id,
      quantity: extracted.quantity,
      source_message_id: sourceMessageId,
      notes: "تم إنشاء الطلب تلقائيًا بعد اكتمال بيانات العميل داخل المحادثة",
      order_number: body.order?.order_number || null,
    },
  });
  if (error) {
    console.error("auto order creation failed", error);
    return null;
  }
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
    if (!companyId || !channel || !platformId || !secret) return out({ ok: false, error: "company_id, channel, platform_id and x-workflow-secret are required" }, 400);

    const hb = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
    const hash = Array.from(new Uint8Array(hb)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const sr = await db.from("workflow_sync_secrets").select("secret_hash").eq("company_id", companyId).maybeSingle();
    if (sr.error) throw sr.error;
    if (!sr.data || sr.data.secret_hash !== hash) return out({ ok: false, error: "Invalid workflow secret" }, 401);

    const cm = body.customer_message == null ? "" : String(body.customer_message);
    const am = body.ai_message == null ? "" : String(body.ai_message);
    const cmid = body.customer_message_id ?? body.message_id ?? null;
    const amid = body.ai_message_id ?? (cmid ? `${cmid}:ai` : null);
    const now = new Date().toISOString();

    let customer = await db.from("customers")
      .select("id,name,stage")
      .eq("company_id", companyId)
      .eq("source", channel)
      .eq("external_id", platformId)
      .maybeSingle();
    if (customer.error) throw customer.error;

    if (!customer.data) {
      const r = await db.from("customers").insert({
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
      const r = await db.from("customers").update(u).eq("id", customer.data.id);
      if (r.error) throw r.error;
    }

    if (customer.data?.id) await syncSocialAccountName(companyId, customer.data.id, channel, platformId);

    let conv = await db.from("conversations")
      .select("id,unread_count")
      .eq("company_id", companyId)
      .eq("channel", channel)
      .eq("platform_id", platformId)
      .maybeSingle();
    if (conv.error) throw conv.error;

    if (!conv.data) {
      const r = await db.from("conversations").insert({ company_id: companyId, customer_id: customer.data.id, channel, platform_id: platformId, status: "open", last_message: cm || am || null, last_message_at: now, unread_count: cm ? 1 : 0 }).select("id,unread_count").single();
      if (r.error) throw r.error;
      conv = { data: r.data, error: null } as typeof conv;
    } else {
      const r = await db.from("conversations").update({ customer_id: customer.data.id, last_message: am || cm || null, last_message_at: now, updated_at: now, unread_count: cm ? Number(conv.data.unread_count ?? 0) + 1 : Number(conv.data.unread_count ?? 0) }).eq("id", conv.data.id);
      if (r.error) throw r.error;
    }

    const inserted: string[] = [];
    if (cm && cmid) {
      const r = await db.from("messages").upsert({ conversation_id: conv.data.id, sender: "customer", message: cm, message_type: body.message_type ?? "text", attachment_url: body.attachment_url ?? null, attachment_type: body.attachment_type ?? null, external_message_id: String(cmid) }, { onConflict: "external_message_id", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      if (r.data?.length) inserted.push("customer");
    }

    if (am && amid) {
      const r = await db.from("messages").upsert({ conversation_id: conv.data.id, sender: "bot", message: am, message_type: body.reply_type ?? "text", attachment_url: body.reply_attachment_url ?? null, attachment_type: body.reply_attachment_type ?? null, external_message_id: String(amid) }, { onConflict: "external_message_id", ignoreDuplicates: true }).select("id");
      if (r.error) throw r.error;
      if (r.data?.length) inserted.push("bot");
    }

    let autoOrder = null;
    if (cm && cmid && customer.data?.id) autoOrder = await tryCreateOrder(companyId, conv.data.id, customer.data.id, String(cmid), body);
    return out({ ok: true, customer_id: customer.data.id, conversation_id: conv.data.id, inserted, auto_order: autoOrder });
  } catch (e) {
    console.error(e);
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
