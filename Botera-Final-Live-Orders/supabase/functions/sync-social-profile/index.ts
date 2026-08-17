import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (d: unknown, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ ok: false, error: "missing_authorization" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ ok: false, error: "server_configuration_missing" }, 500);
  const db = createClient(url, key, { auth: { persistSession: false } });
  try {
    const { data: userData, error: userError } = await db.auth.getUser(auth.slice(7));
    if (userError || !userData.user) return json({ ok: false, error: "invalid_session" }, 401);
    const body = await req.json();
    const { data: profile } = await db.from("profiles").select("company_id").eq("id", userData.user.id).maybeSingle();
    if (!profile) return json({ ok: false, error: "profile_not_found" }, 403);
    const { data: customer } = await db.from("customers").select("id,name,source,external_id,company_id").eq("id", String(body.customer_id || "")).eq("company_id", profile.company_id).maybeSingle();
    if (!customer) return json({ ok: false, error: "customer_not_found" }, 404);
    if (!["facebook", "instagram"].includes(customer.source)) return json({ ok: false, error: "unsupported_channel" }, 400);
    const { data: integration } = await db.from("integration_accounts").select("access_token,external_account_id,is_active").eq("company_id", profile.company_id).eq("provider", "meta").eq("channel", customer.source).eq("is_active", true).maybeSingle();
    if (!integration?.access_token) return json({ ok: false, error: "missing_social_token" }, 400);
    const graphUrl = `https://graph.facebook.com/${encodeURIComponent(customer.external_id)}?fields=name&access_token=${encodeURIComponent(integration.access_token)}`;
    const response = await fetch(graphUrl);
    const graph = await response.json().catch(() => ({}));
    if (!response.ok || !graph?.name) return json({ ok: false, error: "profile_lookup_failed", details: graph?.error?.message || `HTTP ${response.status}` }, 400);
    const { error: updateError } = await db.from("customers").update({ name: graph.name, updated_at: new Date().toISOString() }).eq("id", customer.id).eq("company_id", profile.company_id);
    if (updateError) return json({ ok: false, error: "customer_update_failed", details: updateError.message }, 500);
    return json({ ok: true, name: graph.name });
  } catch (e) { return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500); }
});