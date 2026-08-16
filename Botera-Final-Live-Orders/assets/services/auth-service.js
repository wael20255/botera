// ============================================================================
// services/auth-service — real Supabase Auth. Every page calls ONLY the
// functions below (never supabaseClient.auth.* directly), so this file is
// the single place that knows how auth actually works.
// ============================================================================
const AuthService = (function () {
  const PENDING_KEY = "botera-pending-company"; // see registerCompany() below

  // Turns whatever Supabase/the network throws into a short, friendly
  // Arabic message — used by every function here.
  function friendlyError(error, fallback) {
    if (!error) return new Error(fallback);
    if (error instanceof TypeError || error.message === "Failed to fetch") {
      return new Error("تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.");
    }
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("already registered") || msg.includes("already exists") || (error.status === 422 && msg.includes("user"))) {
      return new Error("هذا البريد الإلكتروني مسجّل بالفعل.");
    }
    if (msg.includes("invalid login credentials")) {
      return new Error("الإيميل أو كلمة السر غير صحيحة.");
    }
    if (msg.includes("password") && msg.includes("least")) {
      return new Error("كلمة السر قصيرة جدًا — لازم تكون 8 أحرف على الأقل.");
    }
    return new Error(error.message || fallback);
  }

  async function login(email, password) {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw friendlyError(error, "تعذر تسجيل الدخول");
    return data;
  }

  // company: { name, logo, industry, country, timezone, currency, language }
  // user: { fullName, email, password }
  //
  // Step 1: create the auth user.
  // Step 2+3: create the company and the owner's profile TOGETHER, inside
  //   one atomic Postgres function (register_company — see
  //   supabase/03-register-transaction.sql) so a failure partway can never
  //   leave an orphaned company with no owner, or vice versa.
  // Step 4: the session from signUp already logs the user in — nothing
  //   else to do, UNLESS the Supabase project requires email confirmation,
  //   in which case there is no session yet. In that case the company
  //   details are safely staged (see below) and finished automatically the
  //   moment the person actually logs in after confirming their email.
  // Step 5: redirect to the dashboard — the caller (register.js) does this.
  async function registerCompany({ company, user }) {
    let signUpData;
    try {
      const result = await supabaseClient.auth.signUp({
  email: user.email,
  password: user.password,
  options: {
    data: {
      full_name: user.fullName,
    },
    emailRedirectTo: `${window.location.origin}/login.html`,
  },
});
      if (result.error) throw result.error;
      signUpData = result.data;
    } catch (error) {
      throw friendlyError(error, "تعذر إنشاء الحساب");
    }

    if (!signUpData.session) {
      // Email confirmation is required — there is no authenticated request
      // we could use to create the company/profile yet. Stage the details
      // and finish the job on their first real login (see
      // completePendingRegistration, called from login.js).
      localStorage.setItem(PENDING_KEY, JSON.stringify({ company, fullName: user.fullName }));
      return { requiresEmailConfirmation: true };
    }

    await createCompanyAndProfile(company, user.fullName);
    return { requiresEmailConfirmation: false };
  }

  async function createCompanyAndProfile(company, fullName) {
    const { error } = await supabaseClient.rpc("register_company", { p_company: company, p_full_name: fullName });
    if (error) {
      // The Postgres function is transactional — either both the company
      // and the profile were created, or NEITHER was. Nothing to roll back
      // by hand here; we only need to tell the person what happened.
      throw friendlyError(error, "تعذر إنشاء بيانات الشركة");
    }
  }

  // Called right after a successful login — finishes a signup that had to
  // wait for email confirmation. A no-op for every normal login.
  async function completePendingRegistration() {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return;
    try {
      const { company, fullName } = JSON.parse(raw);
      await createCompanyAndProfile(company, fullName);
    } finally {
      // Always clear the stash, even on failure — a stale retry with
      // half-remembered data is worse than asking the person to contact
      // support once, which the caller's error message handles.
      localStorage.removeItem(PENDING_KEY);
    }
  }

  async function requestPasswordReset(email) {
    const redirectTo = `${window.location.origin}${window.location.pathname.replace(/[^/]+$/, "")}reset-password.html`;
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw friendlyError(error, "تعذر إرسال رابط إعادة التعيين");
  }

  // Called on reset-password.html after the user clicks the emailed link —
  // Supabase's SDK reads the recovery token from the URL itself
  // (detectSessionInUrl: true in lib/supabase-client.js) and turns it into a
  // temporary session; this just sets the new password on that session.
  async function resetPassword(newPassword) {
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    if (error) throw friendlyError(error, "تعذر تحديث كلمة السر");
  }

  async function logout() {
    await supabaseClient.auth.signOut();
  }

  // Loads { user, profile (with its company) } for the current session, or
  // null if nobody is signed in. This is the one function hooks/use-auth.js
  // calls to populate lib/store.js.
  async function loadCurrentUser() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return null;
    const { data: profile, error } = await supabaseClient
      .from("profiles")
      .select("*, company:companies(*)")
      .eq("id", session.user.id)
      .single();
    if (error || !profile) return null;
    return { user: session.user, profile, company: profile.company };
  }

  return { login, registerCompany, completePendingRegistration, requestPasswordReset, resetPassword, logout, loadCurrentUser };
})();
