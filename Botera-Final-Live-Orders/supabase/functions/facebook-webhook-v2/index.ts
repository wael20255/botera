import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = "botera_fb_webhook_2026";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "Content-Type": "application/json" } });

async function syncCustomerProfile(companyId: string, customerId: string, channel: string, platformId: string, accessToken: string | null) {
  if (!accessToken || !customerId || !platformId || !["facebook", "instagram"].includes(channel)) return;
  try {
    const fields = channel === "facebook" ? "name,first_name,last_name" : "name,username";
    const graphUrl = `https://graph.facebook.com/${encodeURIComponent(platformId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
    const response = await fetch(graphUrl);
    const graph = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const name = String(graph?.name || [graph?.first_name, graph?.last_name].filter(Boolean).join(" ") || graph?.username || "").trim();
    if (!name || ["Facebook Customer", "Instagram Customer", "عميل غير معروف"].includes(name)) return;
    await db.from("customers").update({ name, updated_at: new Date().toISOString() }).eq("id", customerId).eq("company_id", companyId);
  } catch (_) {
    // Profile lookup is best-effort; message/order ingestion must never fail because Meta profile lookup is unavailable.
  }
}

async function saveMessage(companyId: string, channel: string, platformId: string, text: string, mid: string | null, attachmentType: string | null, sender: "customer" | "agent", accessToken: string | null = null) {
  if (mid) { const { data: dup } = await db.from("messages").select("id").eq("external_message_id", mid).maybeSingle(); if (dup) return null; }
  let customer = await db.from("customers").select("id,name").eq("company_id", companyId).eq("source", channel).eq("external_id", platformId).maybeSingle();
  if (customer.error) throw customer.error;
  let customerId = customer.data?.id;
  if (!customerId) {
    const r = await db.from("customers").insert({ company_id: companyId, name: channel === "whatsapp" ? "WhatsApp Customer" : channel === "instagram" ? "Instagram Customer" : "Facebook Customer", source: channel, external_id: platformId, status: "lead", last_contact_at: new Date().toISOString() }).select("id").single();
    if (r.error) throw r.error; customerId = r.data.id;
  }
  if (sender === "customer") await syncCustomerProfile(companyId, customerId, channel, platformId, accessToken);

  const now = new Date().toISOString();
  const conv = await db.from("conversations").select("id,unread_count").eq("company_id", companyId).eq("channel", channel).eq("platform_id", platformId).maybeSingle();
  if (conv.error) throw conv.error;
  let conversationId: string;
  if (conv.data) {
    conversationId = conv.data.id;
    const r = await db.from("conversations").update({ customer_id: customerId, last_message: text || "[مرفق]", last_message_at: now, updated_at: now, unread_count: sender === "customer" ? Number(conv.data.unread_count ?? 0) + 1 : Number(conv.data.unread_count ?? 0), status: "open" }).eq("id", conversationId);
    if (r.error) throw r.error;
  } else {
    const r = await db.from("conversations").insert({ company_id: companyId, customer_id: customerId, channel, platform_id: platformId, status: "open", last_message: text || "[مرفق]", last_message_at: now, unread_count: sender === "customer" ? 1 : 0, updated_at: now }).select("id").single();
    if (r.error) throw r.error; conversationId = r.data.id;
  }
  const r = await db.from("messages").insert({ conversation_id: conversationId, sender, message: text || "[مرفق]", message_type: attachmentType ? "attachment" : "text", attachment_type: attachmentType, external_message_id: mid, created_at: now });
  if (r.error) throw r.error;
  return { conversationId, customerId, messageId: mid, createdAt: now };
}

function field(text: string, names: string[]) {
  const re = new RegExp(`(?:${names.join("|")})\\s*[:：-]?\\s*([^\\n]+)`, "i");
  return text.match(re)?.[1]?.trim() || null;
}

function normalizePhone(value: string | null) {
  if (!value) return null;
  const normalizedDigits = String(value).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const clean = normalizedDigits.replace(/[^0-9+]/g, "").replace(/^0020/, "+20").replace(/^20/, "0");
  return /^01\d{9}$/.test(clean) ? clean : null;
}

function extractOrderData(messages: Array<{ sender: string; message: string }>, products: any[]) {
  const customerMessages = messages
    .filter((m) => m.sender === "customer")
    .map((m) => String(m.message || "").trim())
    .filter(Boolean);
  const combined = customerMessages.join("\n");
  if (!combined) return null;

  const phone = normalizePhone(
    (combined.match(/(?:01\d{9}|\+20\d{10})/) || [])[0] ||
    field(combined, ["الهاتف", "الموبايل", "رقم الموبايل", "رقم الهاتف", "رقم التلفون", "التليفون", "phone"])
  );
  if (!phone) return null;

  let name = field(combined, ["الاسم", "اسم العميل", "الاسم كامل", "name"]);
  let address = field(combined, ["العنوان", "العنوان كامل", "عنوان التوصيل", "address"]);
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
    const candidates = lines.filter((line) => line && line !== name && normalizePhone(line) !== phone && !/^(الاسم|اسم العميل|الهاتف|الموبايل|رقم الموبايل|رقم الهاتف|رقم التلفون|address|phone)\s*[:：-]/i.test(line));
    address = candidates.length ? candidates[candidates.length - 1] : null;
  }
  if (!name || !address) return null;

  const lower = combined.toLocaleLowerCase();
  let product = (products || []).find((p: any) => {
    const candidates = [p.name, p.sku].filter(Boolean).map((v) => String(v).toLocaleLowerCase());
    return candidates.some((v) => v && lower.includes(v));
  }) || null;
  if (!product) {
    const aliases: Record<string, string[]> = {
      "العرض الاول": ["العرض الاول", "العرض الأول", "العرض 1", "العرض الاولى"],
      "العرض التاني": ["العرض التاني", "العرض الثاني", "العرض 2", "العرض التانى"],
      "العرض الثالث": ["العرض الثالث", "العرض 3"],
    };
    product = (products || []).find((p: any) => (aliases[String(p.name || "")] || []).some((a) => lower.includes(a))) || null;
  }
  const quantityRaw = field(combined, ["الكمية", "عدد", "quantity", "qty"]);
  const quantity = Math.max(1, parseInt(quantityRaw || "1", 10) || 1);
  return { name: name.trim(), phone, address: address.trim(), product, quantity };
}

function customerReceivedOrder(text: string) {
  const t = String(text || "").toLocaleLowerCase().replace(/[إأآ]/g, "ا");
  return /(?:استلمت|استلمنا|تم الاستلام|الطلب وصل|الاوردر وصل|الأوردر وصل|الاوردر وصلني|الأوردر وصلني|الطلب وصلني|وصلني الاوردر|وصلني الأوردر|وصلنى الاوردر|وصلنى الأوردر|الاوردر جه|الأوردر جه|الطلب جه|وصل الطلب|وصل الاوردر|وصل الأوردر)/i.test(t);
}

async function markDeliveredFromCustomerMessage(companyId: string, conversationId: string, text: string) {
  if (!customerReceivedOrder(text)) return;
  const { data: order } = await db.from("orders")
    .select("id,status")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .not("status", "eq", "cancelled")
    .not("status", "eq", "refunded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!order || order.status === "delivered") return;
  await db.from("orders").update({ status: "delivered", shipping_status: "delivered", updated_at: new Date().toISOString() }).eq("id", order.id).eq("company_id", companyId);
}

async function tryCreateOrder(companyId: string, conversationId: string, customerId: string, sourceMessageId: string | null) {
  if (!conversationId || !customerId) return;

  const { data: existingOrder, error: existingError } = await db.from("orders")
    .select("id,order_number,status")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .not("status", "eq", "cancelled")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) { console.error("existing order lookup failed", existingError); return; }
  if (existingOrder) return existingOrder;

  const { data: recentMessages, error: messagesError } = await db.from("messages")
    .select("sender,message,created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(120);
  if (messagesError) { console.error("order message lookup failed", messagesError); return; }

  const { data: products, error: productsError } = await db.from("products")
    .select("id,name,sku,price,cost")
    .eq("company_id", companyId);
  if (productsError) { console.error("product lookup failed", productsError); return; }

  const extracted = extractOrderData(recentMessages || [], products || []);
  if (!extracted?.product) {
    console.log("auto order waiting for product selection", { conversationId });
    return;
  }

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
      notes: "تم إنشاء الطلب تلقائيًا من بيانات العميل داخل المحادثة"
    }
  });
  if (error) console.error("auto order creation failed", error);
  else console.log("auto order created", data);
  return data;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") { const u = new URL(req.url); if (u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === VERIFY_TOKEN) return new Response(u.searchParams.get("hub.challenge") || "", { status: 200 }); return new Response("Forbidden", { status: 403 }); }
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    const payload = await req.json();

    if (payload.object === "page") for (const entry of payload.entry || []) {
      const pageId = String(entry.id || "");
      const { data: integration } = await db.from("integration_accounts").select("company_id,access_token").eq("provider", "meta").eq("channel", "facebook").eq("external_account_id", pageId).eq("is_active", true).maybeSingle();
      if (!integration) continue;
      for (const ev of entry.messaging || []) {
        const isEcho = ev.message?.is_echo === true;
        const platformId = String(isEcho ? ev.recipient?.id : ev.sender?.id || "");
        const sender = isEcho ? "agent" : "customer";
        const text = String(ev.message?.text || ev.postback?.title || "");
        const attachmentType = ev.message?.attachments?.[0]?.type || null;
        const mid = ev.message?.mid || ev.postback?.mid || null;
        if (platformId && (text || attachmentType)) {
          const saved = await saveMessage(integration.company_id, "facebook", platformId, text, mid, attachmentType, sender, integration.access_token || null);
          if (saved && sender === "customer") {
            await tryCreateOrder(integration.company_id, saved.conversationId, saved.customerId, mid);
            await markDeliveredFromCustomerMessage(integration.company_id, saved.conversationId, text);
          }
        }
      }
    }
    else if (payload.object === "whatsapp_business_account") for (const entry of payload.entry || []) {
      const wabaId = String(entry.id || "");
      const { data: integration } = await db.from("integration_accounts").select("company_id").eq("provider", "meta").eq("channel", "whatsapp").eq("is_active", true).filter("metadata->>waba_id", "eq", wabaId).maybeSingle();
      if (!integration) continue;
      for (const change of entry.changes || []) for (const msg of change.value?.messages || []) {
        const from = String(msg.from || ""); let text = "", attachmentType = null;
        if (msg.type === "text") text = String(msg.text?.body || ""); else if (msg.type === "image") { text = String(msg.image?.caption || ""); attachmentType = "image"; } else if (msg.type === "audio") attachmentType = "audio"; else if (msg.type === "document") { text = String(msg.document?.caption || ""); attachmentType = "file"; } else if (msg.type === "video") { text = String(msg.video?.caption || ""); attachmentType = "video"; } else if (msg.type === "button") text = String(msg.button?.text || "");
        if (from && (text || attachmentType)) {
          const saved = await saveMessage(integration.company_id, "whatsapp", from, text, msg.id || null, attachmentType, "customer");
          if (saved) { await tryCreateOrder(integration.company_id, saved.conversationId, saved.customerId, msg.id || null); await markDeliveredFromCustomerMessage(integration.company_id, saved.conversationId, text); }
        }
      }
    }
    else if (payload.object === "instagram") for (const entry of payload.entry || []) {
      const igId = String(entry.id || "");
      const { data: integration } = await db.from("integration_accounts").select("company_id,access_token").eq("provider", "meta").eq("channel", "instagram").eq("external_account_id", igId).eq("is_active", true).maybeSingle();
      if (!integration) continue;
      for (const ev of entry.messaging || []) { const senderId = String(ev.sender?.id || ""); const text = String(ev.message?.text || ev.postback?.title || ""); const attachmentType = ev.message?.attachments?.[0]?.type || null; if (senderId && senderId !== igId && (text || attachmentType)) { const saved = await saveMessage(integration.company_id, "instagram", senderId, text, ev.message?.mid || ev.postback?.mid || null, attachmentType, "customer", integration.access_token || null); if (saved) { await tryCreateOrder(integration.company_id, saved.conversationId, saved.customerId, ev.message?.mid || ev.postback?.mid || null); await markDeliveredFromCustomerMessage(integration.company_id, saved.conversationId, text); } } }
    }
    return json({ ok: true });
  } catch (e) { console.error(e); return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); }
});