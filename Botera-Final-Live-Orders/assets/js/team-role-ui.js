// Team-only enhancement: add a job selector and member management controls to the existing team UI.
// The permissions checkboxes remain completely independent.
(function () {
  const ROLES = [
    { id: "859e0e60-affc-43d2-bea0-d6967f2afba2", name: "Owner", label: "مالك" },
    { id: "c08e612d-05d5-4126-b8bd-49d04da9db38", name: "Admin", label: "مدير" },
    { id: "79e653b0-c798-4f85-9f4a-6e2a7d0703eb", name: "Sales", label: "مبيعات" },
    { id: "30d03264-de66-4b72-be3e-e32722f0d86a", name: "Support", label: "خدمة عملاء" },
    { id: "1faff941-6176-422f-a941-a4218b3b7700", name: "Shipping", label: "شحن" },
    { id: "02532c17-643d-4cbc-97be-1a8ef70df3ac", name: "Ads", label: "إعلانات" },
  ];

  let installedForForm = null;
  let inviteWrapped = false;
  const enhancedRows = new WeakSet();

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
        ${ROLES.map((role) => `<option value="${role.id}" data-role-name="${role.name}">${role.label}</option>`).join("")}
      </select>`;
    form.insertBefore(field, permissionsField);
    installedForForm = form;
  }

  function wrapInvite() {
    if (inviteWrapped || !window.TeamService?.invite) return;
    const originalInvite = window.TeamService.invite;
    window.TeamService.invite = async function ({ fullName, email, password, permissions }) {
      const roleEl = document.getElementById("memberRole");
      const roleId = roleEl?.value || "";
      const roleName = roleEl?.selectedOptions?.[0]?.dataset?.roleName || "";
      if (!roleId && !roleName) throw new Error("من فضلك اختر الوظيفة.");
      return originalInvite.call(this, { fullName, email, password, permissions, roleId, roleName });
    };
    inviteWrapped = true;
  }

  async function manageMember(memberId, action) {
    const { data, error } = await supabaseClient.functions.invoke("manage-team-member", {
      body: { member_id: memberId, action },
    });
    if (error) {
      let message = error.message || "تعذر تنفيذ العملية.";
      try {
        const body = await error.context?.json?.();
        message = body?.error || body?.details || message;
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function installMemberControls(row) {
    if (!row || enhancedRows.has(row)) return;
    const saveButton = row.querySelector("[data-save-member]");
    if (!saveButton) return; // owner row or an unexpected row
    const memberId = saveButton.dataset.saveMember;
    const actionCell = saveButton.closest("td");
    if (!memberId || !actionCell || actionCell.querySelector("[data-member-delete]")) return;

    enhancedRows.add(row);

    const deleteButton = document.createElement("button");
    deleteButton.className = "btn-secondary";
    deleteButton.type = "button";
    deleteButton.dataset.memberDelete = memberId;
    deleteButton.textContent = "حذف";
    deleteButton.style.marginInlineStart = "6px";

    const toggleButton = document.createElement("button");
    toggleButton.className = "btn-secondary";
    toggleButton.type = "button";
    toggleButton.dataset.memberToggle = memberId;
    toggleButton.textContent = "...";
    toggleButton.style.marginInlineStart = "6px";

    actionCell.append(deleteButton, toggleButton);

    try {
      const { data, error } = await supabaseClient
        .from("profiles")
        .select("is_active")
        .eq("id", memberId)
        .single();
      if (error) throw error;
      toggleButton.textContent = data?.is_active ? "إيقاف" : "تشغيل";
      toggleButton.dataset.active = data?.is_active ? "1" : "0";
    } catch (_) {
      toggleButton.textContent = "تشغيل / إيقاف";
    }

    deleteButton.addEventListener("click", async () => {
      if (!confirm("هل تريد حذف هذا العضو نهائيًا؟")) return;
      deleteButton.disabled = true;
      toggleButton.disabled = true;
      const original = deleteButton.textContent;
      deleteButton.textContent = "جارٍ الحذف…";
      try {
        await manageMember(memberId, "delete");
        row.remove();
      } catch (error) {
        deleteButton.disabled = false;
        toggleButton.disabled = false;
        deleteButton.textContent = original;
        alert(error.message || "تعذر حذف العضو.");
      }
    });

    toggleButton.addEventListener("click", async () => {
      toggleButton.disabled = true;
      deleteButton.disabled = true;
      const original = toggleButton.textContent;
      toggleButton.textContent = "جارٍ التغيير…";
      try {
        const result = await manageMember(memberId, "toggle");
        const active = !!result?.is_active;
        toggleButton.textContent = active ? "إيقاف" : "تشغيل";
        toggleButton.dataset.active = active ? "1" : "0";
      } catch (error) {
        toggleButton.textContent = original;
        alert(error.message || "تعذر تغيير حالة العضو.");
      } finally {
        toggleButton.disabled = false;
        deleteButton.disabled = false;
      }
    });
  }

  function installMemberControlsOnPage() {
    document.querySelectorAll("#teamTab tbody tr[data-member-row]").forEach((row) => {
      void installMemberControls(row);
    });
  }

  const observer = new MutationObserver(() => {
    const form = document.getElementById("addMemberForm");
    if (form) installRoleField(form);
    wrapInvite();
    installMemberControlsOnPage();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  const initialForm = document.getElementById("addMemberForm");
  if (initialForm) installRoleField(initialForm);
  wrapInvite();
  installMemberControlsOnPage();
})();
