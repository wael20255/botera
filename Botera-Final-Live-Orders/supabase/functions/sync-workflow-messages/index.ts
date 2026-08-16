import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-workflow-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });

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

    return out({ ok: true, customer_id: customer.data.id, conversation_id: conv.data.id, inserted });
  } catch (e) {
    console.error(e);
    return out({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
