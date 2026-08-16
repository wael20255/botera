(function () {
  const form = document.getElementById("resetForm");
  const errorBox = document.getElementById("resetError");
  const successBox = document.getElementById("resetSuccess");
  const submitBtn = document.getElementById("resetSubmit");
  const subtitle = document.getElementById("resetSubtitle");

  function lockForm(message) {
    subtitle.textContent = message;
    form.querySelectorAll("input, button").forEach((el) => (el.disabled = true));
  }

  // Supabase reads the recovery token straight from the URL (it's in the
  // link it emailed) and turns it into a short-lived session — we just wait
  // for that to happen before letting the person submit a new password.
  let ready = false;
  supabaseClient.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") ready = true;
  });
  supabaseClient.auth.getSession().then(({ data: { session } }) => {
    if (session) ready = true;
    else setTimeout(() => { if (!ready) lockForm("رابط إعادة التعيين غير صالح أو منتهي الصلاحية — اطلب رابط جديد."); }, 2500);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.style.display = "none";
    successBox.style.display = "none";

    if (!ready) { errorBox.textContent = "الرابط لسه بيتأكد، استنى ثانية وحاول تاني."; errorBox.style.display = "block"; return; }

    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;
    if (password.length < 8) { errorBox.textContent = "كلمة السر لازم تكون 8 أحرف على الأقل."; errorBox.style.display = "block"; return; }
    if (password !== confirmPassword) { errorBox.textContent = "كلمتا السر غير متطابقتين."; errorBox.style.display = "block"; return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "جارٍ التحديث…";
    try {
      await AuthService.resetPassword(password);
      successBox.textContent = "تم تحديث كلمة السر. جارٍ تحويلك لتسجيل الدخول…";
      successBox.style.display = "block";
      form.reset();
      setTimeout(() => { window.location.href = "login.html"; }, 1500);
    } catch (error) {
      errorBox.textContent = error.message || "تعذر تحديث كلمة السر.";
      errorBox.style.display = "block";
      submitBtn.disabled = false;
      submitBtn.textContent = "تحديث كلمة السر";
    }
  });
})();
