import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERIFY_TOKEN = "botera_fb_webhook_2026";
const WEBHOOK_URL = "https://bbixzcaxlvotdhhqfatw.supabase.co/functions/v1/facebook-webhook-v2";
const API = "v23.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "missing_authorization" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ ok: false, error: "server_configuration_missing" }, 500);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const token = auth.slice(7);
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return json({ ok: false, error: "invalid_session" }, 401);

    const body = await req.json().catch(() => ({}));
    const companyId = String(body.company_id ?? "").trim();
    if (!companyId) return json({ ok: false, error: "company_id_required" }, 400);

    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("company_id,role,is_platform_owner,can_manage_team,can_view_settings")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError) return json({ ok: false, error: "profile_lookup_failed", details: profileError.message }, 500);
    if (!profile || profile.company_id !== companyId)
      return json({ ok: false, error: "forbidden" }, 403);

    if (!(profile.is_platform_owner || profile.role === "owner" || profile.can_manage_team || profile.can_view_settings))
      return json({ ok: false, error: "insufficient_permissions" }, 403);

    const { data: integration, error: intError } = await db
      .from("integration_accounts")
      .select("id,external_account_id,access_token,metadata,is_active")
      .eq("company_id", companyId)
      .eq("provider", "meta")
      .eq("channel", "facebook")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (intError) return json({ ok: false, error: "integration_lookup_failed", details: intError.message }, 500);
    if (!integration?.access_token) return json({ ok: false, error: "facebook_access_token_missing" }, 400);

    const pageId = String(integration.external_account_id || integration.metadata?.page_id || "").trim();
    if (!pageId || pageId.startsWith("meta:")) return json({ ok: false, error: "facebook_page_id_missing" }, 400);

    const graphRes = await fetch(
      `https://graph.facebook.com/${API}/${encodeURIComponent(pageId)}?fields=id,name,link&access_token=${encodeURIComponent(integration.access_token)}`
    );
    const graph = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok || graph.error) {
      const message = graph?.error?.message || `Meta Graph API returned HTTP ${graphRes.status}`;
      await db.from("integration_accounts").update({
        is_active: false,
        metadata: {
          ...(integration.metadata || {}),
          connection_status: "error",
          connection_error: message,
          last_validated_at: new Date().toISOString(),
        },
      }).eq("id", integration.id).eq("company_id", companyId);

      return json({
        ok: false,
        error: "facebook_token_validation_failed",
        details: message,
        meta_code: graph?.error?.code ?? null,
        meta_type: graph?.error?.type ?? null,
      }, 400);
    }

    const subscribedRes = await fetch(
      `https://graph.facebook.com/${API}/${encodeURIComponent(graph.id)}/subscribed_apps`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscribed_fields: [
            "messages",
            "messaging_postbacks",
            "messaging_optins",
            "message_deliveries",
            "message_reads",
            "message_echoes",
          ],
          access_token: integration.access_token,
        }),
      }
    );
    const subscribed = await subscribedRes.json().catch(() => ({}));

    const webhook = {
      url: WEBHOOK_URL,
      subscribed: subscribedRes.ok && subscribed?.success !== false,
      response: subscribed,
    };

    const metadata = {
      ...(integration.metadata || {}),
      connection_status: "connected",
      last_validated_at: new Date().toISOString(),
      validated_page_id: String(graph.id),
      validated_page_name: graph.name ?? null,
      webhook,
    };

    const { error: updateError } = await db.from("integration_accounts").update({
      is_active: true,
      external_account_id: String(graph.id),
      external_account_name: graph.name ?? null,
      metadata,
    }).eq("id", integration.id).eq("company_id", companyId);

    if (updateError) return json({ ok: false, error: "integration_status_update_failed", details: updateError.message }, 500);

    return json({
      ok: true,
      status: "connected",
      page: { id: graph.id, name: graph.name ?? null, link: graph.link ?? null },
      webhook,
    });
  } catch (error) {
    console.error(error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
