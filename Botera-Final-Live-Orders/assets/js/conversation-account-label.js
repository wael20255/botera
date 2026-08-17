(function () {
  const labelExisting = (root) => {
    if (!root || root.dataset.accountLabelReady === "1") return;
    const meta = root.querySelector(".conversation-meta");
    const name = root.querySelector(".conversation-name, .thread-header-meta > strong");
    if (!meta || !name) return;
    const value = name.textContent.trim();
    if (!value || value === "Facebook Customer" || value === "Instagram Customer") {
      // Still keep the label hidden until the real account name is available.
      return;
    }
    const label = document.createElement("span");
    label.className = "account-name-label";
    label.textContent = `حساب العميل: ${value}`;
    meta.prepend(label);
    root.dataset.accountLabelReady = "1";
  };

  const scan = () => {
    document.querySelectorAll(".conversation-item").forEach(labelExisting);
    const thread = document.getElementById("conversationThread");
    if (thread) labelExisting(thread);
  };

  const style = document.createElement("style");
  style.textContent = `.account-name-label{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--color-text-faint);margin-inline-end:8px}`;
  document.head.appendChild(style);

  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("load", scan);
  setTimeout(scan, 500);
})();
