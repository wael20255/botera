(async function () {
  if (await AuthService.loadCurrentUser()) {
    window.location.href = "index.html";
    return;
  }

  function escapeHtmlLocal(v) { const n = document.createElement("div"); n.textContent = v ?? ""; return n.innerHTML; }
  const form = document.getElementById("registerForm");
  const errorBox = document.getElementById("registerError");
  const submitBtn = document.getElementById("registerSubmit");

  // Logo upload: read the file as a data URL for an instant local preview.
  // In a real backend this would upload to storage and store a URL instead —
  // fine for now since nothing here is connected to Supabase yet.
  const logoInput = document.getElementById("companyLogo");
  const logoPreview = document.getElementById("logoPreview");
  let logoDataUrl = null;
  document.getElementById("logoTrigger").addEventListener("click", () => logoInput.click());
  logoInput.addEventListener("change", () => {
    const file = logoInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      logoDataUrl = reader.result;
      logoPreview.innerHTML = `<img src="${logoDataUrl}" alt="شعار الشركة">`;
    };
    reader.readAsDataURL(file);
  });

  function showError(message) {
    errorBox.textContent = message;
    errorBox.style.display = "block";
  }
  function clearError() {
    errorBox.textContent = "";
    errorBox.style.display = "none";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearError();

    const companyName = document.getElementById("companyName").value.trim();
    const industry = document.getElementById("industry").value;
    const country = document.getElementById("country").value;
    const timezone = document.getElementById("timezone").value;
    const currency = document.getElementById("currency").value;
    const language = document.getElementById("language").value;
    const fullName = document.getElementById("fullName").value.trim();
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const confirmPassword = document.getElementById("confirmPassword").value;

    if (!companyName || !industry || !country) { showError("من فضلك أكمل بيانات الشركة الأساسية."); return; }
    if (!fullName || !email) { showError("من فضلك أكمل اسمك وإيميلك."); return; }
    if (password.length < 8) { showError("كلمة السر لازم تكون 8 أحرف على الأقل."); return; }
    if (password !== confirmPassword) { showError("كلمتا السر غير متطابقتين."); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = "جارٍ الإنشاء…";
    try {
      const { requiresEmailConfirmation } = await AuthService.registerCompany({
        company: { name: companyName, logo: logoDataUrl, industry, country, timezone, currency, language },
        user: { fullName, email, password },
      });
      if (requiresEmailConfirmation) {
        form.innerHTML = "";
        clearError();
        form.insertAdjacentHTML("beforeend", `<div class="form-success">تفقّد بريدك الإلكتروني (${escapeHtmlLocal(email)}) وأكّد حسابك. هنكمّل إنشاء شركتك تلقائيًا أول ما تسجّل دخولك بعد التأكيد.</div>`);
        submitBtn.remove();
      } else {
        window.location.href = "index.html";
      }
    } catch (error) {
      showError(error.message || "تعذر إنشاء الشركة. حاول مرة أخرى.");
      submitBtn.disabled = false;
      submitBtn.textContent = "إنشاء الشركة";
    }
  });
})();
