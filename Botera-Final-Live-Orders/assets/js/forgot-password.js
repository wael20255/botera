(function () {
  const form = document.getElementById("forgotForm");
  const errorBox = document.getElementById("forgotError");
  const successBox = document.getElementById("forgotSuccess");
  const submitBtn = document.getElementById("forgotSubmit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.style.display = "none";
    successBox.style.display = "none";

    const email = document.getElementById("email").value.trim();
    submitBtn.disabled = true;
    submitBtn.textContent = "جارٍ الإرسال…";
    try {
      await AuthService.requestPasswordReset(email);
      // Same message whether or not the email is registered, on purpose —
      // this form can't be used to discover which emails have accounts.
      successBox.textContent = "لو الإيميل ده مسجّل عندنا، هيوصلك إيميل فيه رابط إعادة تعيين كلمة السر.";
      successBox.style.display = "block";
      form.reset();
    } catch (error) {
      errorBox.textContent = "حصل خطأ غير متوقع. حاول مرة أخرى.";
      errorBox.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "إرسال رابط إعادة التعيين";
    }
  });
})();
