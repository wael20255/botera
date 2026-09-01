// Team-only enhancement: add a job selector to the existing team-member form.
// The permissions checkboxes remain completely independent.
(function () {
  const ROLES = [
    { id: "859e0e60-affc-43d2-bea0-d6967f2afba2", label: "مالك" },
    { id: "c08e612d-05d5-4126-b8bd-49d04da9db38", label: "مدير" },
    { id: "79e653b0-c798-4f85-9f4a-6e2a7d0703eb", label: "مبيعات" },
    { id: "30d03264-de66-4b72-be3e-e32722f0d86a", label: "خدمة عملاء" },
    { id: "1faff941-6176-422f-a941-a4218b3b7700", label: "شحن" },
    { id: "02532c17-643d-4cbc-97be-1a8ef70df3ac", label: "إعلانات" },
  ];

  let installedForForm = null;
  let submitBoundForForm = null;

  function installRoleField(form) {
    if (!form || installedForForm === form || form.querySelector("#memberRole")) return;

    const permissionsField = form.querySelector('input[name="newMemberPerm"]')?.closest(".form-field");
    if (!permissionsField) return;

    const field = document.createElement("div");
    field.className = "form-field";
    field.innerHTML = `
      <label class="form-label" for="memberRole">الوظيفة</label>
      <select class="form-input" id="memberRole" required>
        <option value="">اختر الوظيفة</option>
        ${ROLES.map((role) => `<option value="${role.id}">${role.label}</option>`).join("")}
      </select>`;
    form.insertBefore(field, permissionsField);
    installedForForm = form;
  }

  function bindDirectSubmit(form) {
    if (!form || submitBoundForForm === form) return;
    submitBoundForForm = form;

    form.addEventListener("submit", async (event) => {
      // settings.js has its own submit handler, but it does not know about the
      // dynamically-added role selector. Handle the submit here first so the
      // selected role_id is always sent to the Edge Function.
      event.preventDefault();
      event.stopImmediatePropagation();

      const fullName = document.getElementById("memberName")?.value.trim() || "";
      const email = document.getElementById("memberEmail")?.value.trim() || "";
      const password = document.getElementById("memberPassword")?.value || "";
      const roleId = document.getElementById("memberRole")?.value || "";
      const errorEl = document.getElementById("addMemberError");
      const submit = document.getElementById("addMemberSubmit");
      const permissions = {};

      form.querySelectorAll('input[name="newMemberPerm"]').forEach((input) => {
        permissions[input.value] = input.checked;
      });

      const showError = (message) => {
        if (errorEl) {
          errorEl.textContent = message;
          errorEl.style.display = "block";
        }
      };

      if (!fullName || !email) {
        showError("من فضلك أكمل الاسم والإيميل.");
        return;
      }
      if (password.length < 8) {
        showError("كلمة السر لازم تكون 8 أحرف على الأقل.");
        return;
      }
      if (!roleId) {
        showError("من فضلك اختر الوظيفة.");
        return;
      }

      if (submit) {
        submit.disabled = true;
        submit.textContent = "جارٍ الإضافة…";
      }
      if (errorEl) errorEl.style.display = "none";

      try {
        const { data, error } = await supabaseClient.functions.invoke("create-team-member", {
          body: {
            full_name: fullName,
            email,
            password,
            role_id: roleId,
            permissions,
          },
        });

        if (error) {
          let detail = null;
          try { detail = (await error.context?.json?.())?.error; } catch (_) {}
          throw new Error(detail || data?.error || error.message || "تعذر إضافة العضو.");
        }
        if (data?.error) throw new Error(data.error);

        form.reset();
        if (errorEl) {
          errorEl.textContent = "تمت إضافة العضو بنجاح ✓";
          errorEl.style.display = "block";
          errorEl.style.color = "var(--color-neon, #39ff75)";
        }
        if (submit) {
          submit.textContent = "تمت الإضافة ✓";
        }

        // Refresh only the team section after a successful add.
        setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        showError(error?.message || "تعذر إضافة العضو.");
        if (submit) {
          submit.disabled = false;
          submit.textContent = "إضافة عضو";
        }
      }
    }, true);
  }

  function install() {
    const form = document.getElementById("addMemberForm");
    if (!form) return;
    installRoleField(form);
    bindDirectSubmit(form);
  }

  const observer = new MutationObserver(install);
  observer.observe(document.body, { childList: true, subtree: true });
  install();
})();
