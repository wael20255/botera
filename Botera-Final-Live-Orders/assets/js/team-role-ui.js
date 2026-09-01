// Team-only enhancement: add a job selector to the existing team-member form.
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

  const observer = new MutationObserver(() => {
    const form = document.getElementById("addMemberForm");
    if (form) installRoleField(form);
    wrapInvite();
  });

  observer.observe(document.body, { childList: true, subtree: true });
  const initialForm = document.getElementById("addMemberForm");
  if (initialForm) installRoleField(initialForm);
  wrapInvite();
})();
