/* Safe, isolated UI enhancement layer for Conversations. No data/service changes. */
(function () {
  if (document.body?.dataset?.page !== "conversations") return;

  function escape(value) {
    return typeof escapeHtml === "function" ? escapeHtml(value) : String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
  }

  function getIdentity() {
    const header = document.querySelector("#conversationThread .thread-header");
    if (!header) return null;
    const strong = header.querySelector("strong");
    const name = strong?.textContent?.trim() || "عميل";
    const channel = header.querySelector(".channel-tag")?.textContent?.trim() || "غير محددة";
    const text = header.textContent || "";
    const phone = text.match(/(?:\+?20\s*)?01[0-25]\d{8}/)?.[0] || "";
    return { name, channel, phone };
  }

  function ensureCustomerPanel() {
    const layout = document.querySelector(".split-layout");
    const thread = document.getElementById("conversationThread");
    if (!layout || !thread) return;

    let host = layout.querySelector(".conversation-customer-panel-host");
    if (!host) {
      host = document.createElement("aside");
      host.className = "conversation-customer-panel-host";
      host.innerHTML = '<div class="conversation-customer-panel"><div class="customer-panel-placeholder">اختَر محادثة لعرض بيانات العميل</div></div>';
      layout.appendChild(host);
    }

    const identity = getIdentity();
    const panel = host.querySelector(".conversation-customer-panel");
    if (!identity || !panel) return;
    const displayName = /^\+?\d/.test(identity.name) ? "عميل" : identity.name;
    const initial = escape(displayName.charAt(0) || "ع");
    panel.innerHTML = `
      <div class="customer-panel-heading"><span>بيانات العميل</span><span class="customer-panel-live">● نشط</span></div>
      <div class="customer-panel-avatar">${initial}</div>
      <h3 class="customer-panel-name">${escape(displayName)}</h3>
      <div class="customer-panel-item"><span>الهاتف</span><strong dir="ltr">${escape(identity.phone || "غير متوفر")}</strong></div>
      <div class="customer-panel-item"><span>القناة</span><strong>${escape(identity.channel)}</strong></div>
      <div class="customer-panel-actions">
        ${identity.phone ? '<button type="button" class="customer-panel-copy" data-copy-phone>نسخ الرقم</button>' : ""}
        <button type="button" class="customer-panel-open" data-open-customer>فتح العميل</button>
      </div>`;

    panel.querySelector("[data-copy-phone]")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(identity.phone); } catch {}
    });
    panel.querySelector("[data-open-customer]")?.addEventListener("click", () => {
      const params = new URLSearchParams(window.location.search);
      // Preserve current query context; Customers can still be opened normally.
      window.location.href = `customers.html${params.toString() ? `?${params}` : ""}`;
    });
  }

  function enhanceAttachments() {
    const thread = document.getElementById("conversationThread");
    if (!thread) return;
    thread.querySelectorAll("a.message-file").forEach((link) => {
      const href = link.getAttribute("href") || "";
      const ext = (href.split("?")[0].split(".").pop() || "").toLowerCase();
      if (["jpg","jpeg","png","gif","webp","avif"].includes(ext)) {
        const img = document.createElement("img");
        img.className = `message-image${ext === "webp" ? " message-sticker" : ""}`;
        img.src = href; img.alt = ext === "webp" ? "استيكر" : "صورة"; img.loading = "lazy";
        const wrap = document.createElement("a");
        wrap.className = "message-image-link"; wrap.href = href; wrap.target = "_blank"; wrap.rel = "noopener"; wrap.dataset.mediaEnhanced = "1";
        wrap.appendChild(img); link.replaceWith(wrap);
      } else if (["mp4","webm","mov"].includes(ext)) {
        const video = document.createElement("video");
        video.className = "message-video"; video.controls = true; video.preload = "metadata"; video.src = href;
        const wrap = document.createElement("div"); wrap.className = "message-media-wrap"; wrap.appendChild(video); link.replaceWith(wrap);
      }
    });

    thread.querySelectorAll(".message-image-link").forEach((link) => {
      if (link.dataset.lightboxBound === "1") return;
      link.dataset.lightboxBound = "1";
      link.addEventListener("click", (event) => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        const src = link.getAttribute("href"); if (!src) return;
        const overlay = document.createElement("div"); overlay.className = "conversation-lightbox";
        overlay.innerHTML = `<button type="button" class="conversation-lightbox-close" aria-label="إغلاق">×</button><img src="${escape(src)}" alt="مرفق">`;
        const close = () => overlay.remove();
        overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
        overlay.querySelector(".conversation-lightbox-close")?.addEventListener("click", close);
        document.body.appendChild(overlay);
      });
    });
  }

  function run() { ensureCustomerPanel(); enhanceAttachments(); }

  const thread = document.getElementById("conversationThread");
  if (thread && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => requestAnimationFrame(run)).observe(thread, { childList: true, subtree: true });
  }
  window.addEventListener("load", () => setTimeout(run, 250));
  setTimeout(run, 600);
})();
