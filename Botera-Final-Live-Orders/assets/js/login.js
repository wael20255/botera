(async function init() {
  if (await AuthService.loadCurrentUser()) {
    window.location.href = "index.html";
    return;
  }

  const form = document.getElementById("loginForm");
  const errorBox = document.getElementById("loginError");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.style.display = "none";
    try {
      await AuthService.login(document.getElementById("email").value, document.getElementById("password").value);
      // Finishes an earlier signup that had to wait for email confirmation
      // (a no-op for every normal login — see auth-service.js).
      await AuthService.completePendingRegistration();
      window.location.href = "index.html";
    } catch (error) {
      errorBox.textContent = error.message || "تعذر تسجيل الدخول.";
      errorBox.style.display = "block";
    }
  });
})();
