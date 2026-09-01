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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "غير مسجل الدخول." }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: { user: caller } } = await callerClient.auth.getUser();
  if (!caller) return json({ error: "غير مسجل الدخول." }, 401);

  const { data: callerProfile, error: callerProfileError } = await callerClient
    .from("profiles")
    .select("company_id, can_manage_team, is_platform_owner")
    .eq("id", caller.id)
    .single();
  if (callerProfileError || !callerProfile) return json({ error: "تعذر التحقق من صلاحياتك." }, 403);
  if (!callerProfile.can_manage_team && !callerProfile.is_platform_owner) return json({ error: "ليس لديك صلاحية إضافة أعضاء فريق." }, 403);
  if (!callerProfile.company_id) return json({ error: "حسابك غير مرتبط بشركة." }, 400);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "بيانات الطلب غير صحيحة." }, 400); }

  const fullName = (payload.full_name || "").trim();
  const email = (payload.email || "").trim();
  const password = payload.password || "";
  const roleId = String(payload.role_id || "").trim();
  const permissions = payload.permissions || {};

  if (!fullName) return json({ error: "من فضلك أدخل اسم العضو." }, 400);
  if (!email) return json({ error: "من فضلك أدخل بريد إلكتروني صحيح." }, 400);
  if (!password || password.length < 8) return json({ error: "كلمة السر لازم تكون 8 أحرف على الأقل." }, 400);
  if (!roleId) return json({ error: "من فضلك اختر الوظيفة." }, 400);

  const { data: roleRow, error: roleError } = await adminClient.from("roles").select("id, name").eq("id", roleId).maybeSingle();
  if (roleError || !roleRow) return json({ error: "الوظيفة المختارة غير صحيحة." }, 400);

  const grantedPermissions: Record<string, boolean> = {};
  for (const key of PERMISSION_KEYS) grantedPermissions[key] = !!permissions[key];

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (createError) {
    const msg = (createError.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered")) return json({ error: "هذا البريد الإلكتروني مسجّل بالفعل." }, 409);
    return json({ error: createError.message || "تعذر إنشاء الحساب." }, 400);
  }

  const newUserId = created.user?.id;
  if (!newUserId) return json({ error: "تعذر إنشاء الحساب." }, 400);

  const { error: profileError } = await adminClient.from("profiles").insert({
    id: newUserId,
    company_id: callerProfile.company_id,
    role_id: roleId,
    full_name: fullName,
    role: roleRow.name,
    is_platform_owner: false,
    ...grantedPermissions,
  });

  if (profileError) {
    await adminClient.auth.admin.deleteUser(newUserId);
    return json({ error: profileError.message || "تعذر إنشاء بيانات العضو." }, 400);
  }

  return json({ id: newUserId, email, role_id: roleId, role: roleRow.name });
});
