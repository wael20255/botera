// ============================================================================
// Edge Function: create-team-member
// ============================================================================
// Why this has to be an Edge Function and not a client-side insert:
// creating a new login (an auth.users row with an email + password) can
// only be done with the Supabase admin API, which requires the
// service_role secret key. That key must never be shipped to the browser
// (see assets/lib/supabase-client.js), so this one step has to run on the
// server. Everything else about team management (listing teammates,
// editing an existing teammate's permissions) is a normal RLS-protected
// query from the browser — see assets/services/team-service.js and
// supabase/07-fixes-team-products.sql.
//
// What this function does, in order:
//   1. Reads the caller's own session from the Authorization header (the
//      browser's supabaseClient.functions.invoke() sends it automatically)
//      and uses it to find the caller's own profile — so we know their
//      real company_id and permissions, never trusting anything the
//      client claims about itself in the request body.
//   2. Refuses unless the caller is the platform owner or has
//      can_manage_team = true.
//   3. Creates the new auth user (email + password, already confirmed —
//      no separate email-confirmation step for teammates added by an
//      owner, since the owner is vouching for them).
//   4. Creates their profile row in the caller's company with the
//      requested can_view_* permissions.
//   5. If step 4 fails for any reason, deletes the auth user created in
//      step 3 so there's never an orphaned login with no profile.
//
// Deploy with the Supabase CLI:
//   supabase functions deploy create-team-member
// (No extra secrets to set — SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// injected automatically into every Edge Function by Supabase.)
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PERMISSION_KEYS = [
  "can_view_conversations",
  "can_view_customers",
  "can_view_orders",
  "can_view_insights",
  "can_view_automation",
  "can_view_settings",
  "can_manage_team",
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "غير مسجل الدخول." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Client scoped as the CALLER (their JWT) — only used to find out who
  // they really are. Never used to write anything.
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  // Admin client (service_role) — bypasses RLS on purpose, only after the
  // caller's permission has been verified below.
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user: caller } } = await callerClient.auth.getUser();
  if (!caller) return json({ error: "غير مسجل الدخول." }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("company_id, can_manage_team, is_platform_owner")
    .eq("id", caller.id)
    .single();
  if (callerProfileError || !callerProfile) return json({ error: "تعذر التحقق من صلاحياتك." }, 403);
  if (!callerProfile.can_manage_team && !callerProfile.is_platform_owner) {
    return json({ error: "ليس لديك صلاحية إضافة أعضاء فريق." }, 403);
  }
  if (!callerProfile.company_id) return json({ error: "حسابك غير مرتبط بشركة." }, 400);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "بيانات الطلب غير صحيحة." }, 400);
  }

  const fullName = (payload.full_name || "").trim();
  const email = (payload.email || "").trim();
  const password = payload.password || "";
  const permissions = payload.permissions || {};

  if (!fullName) return json({ error: "من فضلك أدخل اسم العضو." }, 400);
  if (!email) return json({ error: "من فضلك أدخل بريد إلكتروني صحيح." }, 400);
  if (!password || password.length < 8) return json({ error: "كلمة السر لازم تكون 8 أحرف على الأقل." }, 400);

  // Only pass through recognized permission keys — never trust the request
  // body's shape blindly.
  const grantedPermissions: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) grantedPermissions[key] = !!permissions[key];

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError) {
    const msg = (createError.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) {
      return json({ error: "هذا البريد الإلكتروني مسجّل بالفعل." }, 409);
    }
    return json({ error: createError.message || "تعذر إنشاء الحساب." }, 400);
  }

  const newUserId = created.user?.id;
  if (!newUserId) return json({ error: "تعذر إنشاء الحساب." }, 400);

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: newUserId,
    company_id: callerProfile.company_id,
    full_name: fullName,
    role: "employee",
    is_platform_owner: false,
    ...grantedPermissions,
  });

  if (profileError) {
    // Compensating action — never leave a login with no profile behind.
    await adminClient.auth.admin.deleteUser(newUserId);
    return json({ error: profileError.message || "تعذر إنشاء بيانات العضو." }, 400);
  }

  return json({ id: newUserId, email });
});
