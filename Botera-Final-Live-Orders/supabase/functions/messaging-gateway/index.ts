import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "missing_authorization" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  const token = auth.replace("Bearer ", "");
  const { data: { user }, error: userError } = await client.auth.getUser(token);
  if (userError || !user) return json({ error: "invalid_token" }, 401);

  try {
    const body = await req.json();
    const action = body.action ?? "ingest";
    const companyId = body.company_id;
    const channel = String(body.channel ?? "").toLowerCase();
    const platformId = String(body.platform_id ?? "");

    if (!companyId || !channel || !platformId)
      return json({ error: "company_id_channel_platform_id_required" }, 400);

    const { data: profile } = await client
      .from("profiles")
      .select("company_id")
      .eq("id", user.id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (!profile) return json({ error: "forbidden" }, 403);

    if (action === "ingest") {
      const { data, error } = await client.rpc("save_conversation_turn", {
        p_company_id: companyId,
        p_channel: channel,
        p_platform_id: platformId,
        p_customer_message: body.customer_message ?? "",
        p_ai_message: body.ai_message ?? null,
      });
      if (error) throw error;
      return json({ ok: true, data });
    }

    if (action === "send") {
      const conversationId = String(body.conversation_id ?? "").trim();
      const message = String(body.message ?? "").trim();
      const attachmentUrl = body.attachment_url ? String(body.attachment_url) : null;
      const attachmentType = body.attachment_type ? String(body.attachment_type) : null;
      if (!conversationId || (!message && !attachmentUrl)) return json({ error: "conversation_id_and_message_required" }, 400);

      const { data: conversation, error: convError } = await client
        .from("conversations")
        .select("id, company_id, channel, platform_id, customer_id")
        .eq("id", conversationId)
        .eq("company_id", companyId)
        .maybeSingle();
      if (convError) throw convError;
      if (!conversation) return json({ error: "conversation_not_found" }, 404);

      const { data: integration, error: integrationError } = await client
        .from("integration_accounts")
        .select("id, access_token, external_account_id, metadata, is_active")
        .eq("company_id", companyId)
        .eq("provider", "meta")
        .eq("channel", conversation.channel)
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (integrationError) throw integrationError;
      if (!integration?.access_token || !integration.external_account_id) return json({ error: `${conversation.channel}_integration_not_configured` }, 400);

      let graphUrl = "";
      let graphPayload:any = {};
      if (conversation.channel === "facebook") {
        graphUrl = `https://graph.facebook.com/v23.0/${encodeURIComponent(integration.external_account_id)}/messages`;
        graphPayload = { recipient: { id: conversation.platform_id }, messaging_type: "RESPONSE", message: attachmentType === "image" && attachmentUrl ? { attachment: { type: "image", payload: { url: attachmentUrl } } } : { text: message } };
      } else if (conversation.channel === "whatsapp") {
        graphUrl = `https://graph.facebook.com/v23.0/${encodeURIComponent(integration.external_account_id)}/messages`;
        if (attachmentType === "image" && attachmentUrl) graphPayload = { messaging_product: "whatsapp", to: conversation.platform_id, type: "image", image: { link: attachmentUrl, caption: message || undefined } };
        else graphPayload = { messaging_product: "whatsapp", to: conversation.platform_id, type: "text", text: { preview_url: false, body: message } };
      } else if (conversation.channel === "instagram") {
        graphUrl = `https://graph.facebook.com/v23.0/${encodeURIComponent(integration.external_account_id)}/messages`;
        if (attachmentType === "image" && attachmentUrl) graphPayload = { recipient: { id: conversation.platform_id }, message: { attachment: { type: "image", payload: { url: attachmentUrl } } } };
        else graphPayload = { recipient: { id: conversation.platform_id }, message: { text: message } };
      } else return json({ error: "unsupported_channel", channel: conversation.channel }, 400);

      const graphResponse = await fetch(graphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...graphPayload, access_token: integration.access_token })
      });
      const graphBody = await graphResponse.json().catch(() => ({}));
      if (!graphResponse.ok || graphBody?.error) return json({ error: `${conversation.channel}_send_failed`, details: graphBody?.error?.message ?? `Meta rejected the message`, code: graphBody?.error?.code ?? null }, 502);

      const externalMessageId = String(graphBody?.messages?.[0]?.id ?? graphBody?.message_id ?? `manual:${crypto.randomUUID()}`);
      const now = new Date().toISOString();
      const { error: msgError } = await client.from("messages").insert({ conversation_id: conversation.id, sender: "agent", message: message || (attachmentType === "image" ? "[صورة]" : "[مرفق]"), message_type: attachmentType ? "attachment" : "text", attachment_url: attachmentUrl, attachment_type: attachmentType, external_message_id: externalMessageId, created_at: now });
      if (msgError) throw msgError;
      const { error: convUpdateError } = await client.from("conversations").update({ last_message: message || (attachmentType === "image" ? "[صورة]" : "[مرفق]"), last_message_at: now, updated_at: now, unread_count: 0 }).eq("id", conversation.id).eq("company_id", companyId);
      if (convUpdateError) throw convUpdateError;
      return json({ ok: true, external_message_id: externalMessageId, conversation_id: conversation.id });
    }

    return json({ error: "unsupported_action" }, 400);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
