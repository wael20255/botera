/* Botera Conversations UI v2 — presentation + attachment enhancements only. */
(function () {
  if (document.body?.dataset?.page !== "conversations") return;

  const esc = (value) => typeof escapeHtml === "function"
    ? escapeHtml(value)
    : String(value ?? "").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

  function identity() {
    const header = document.querySelector("#conversationThread .thread-header");
    if (!header) return null;
    const strong = header.querySelector("strong");
    const name = strong?.textContent?.trim() || "عميل";
    const headerText = header.textContent || "";
    const phone = headerText.match(/(?:\+?20\s*)?01[0-25]\d{8}/)?.[0] || headerText.match(/\d{10,15}/)?.[0] || "";
    const channel = header.querySelector(".channel-tag")?.textContent?.trim() || "غير محددة";
    return { name, phone, channel };
  }

  function ensureLayout() {
    const layout = document.querySelector(".split-layout");
    const thread = document.getElementById("conversationThread");
    if (!layout || !thread) return;
    layout.style.gridTemplateColumns = "minmax(320px,360px) minmax(0,1fr) 270px";
    layout.style.gap = "16px";

    let host = layout.querySelector(".conversation-customer-panel-host");
    if (!host) {
      host = document.createElement("aside");
      host.className = "conversation-customer-panel-host";
      layout.appendChild(host);
    }
    host.style.display = "block";
    host.style.order = "3";
    const info = identity();
    const displayName = info ? (/^\+?\d/.test(info.name) ? "عميل" : info.name) : "عميل";
    const panel = host.querySelector(".conversation-customer-panel") || document.createElement("div");
    panel.className = "conversation-customer-panel";
    if (!panel.parentElement) host.appendChild(panel);
    panel.innerHTML = info ? `
      <div class="customer-panel-heading"><span>بيانات العميل</span><span class="customer-panel-live">● نشط</span></div>
      <div class="customer-panel-avatar">${esc(displayName.charAt(0) || "ع")}</div>
      <h3 class="customer-panel-name">${esc(displayName)}</h3>
      <div class="customer-panel-item"><span>الهاتف</span><strong dir="ltr">${esc(info.phone || "غير متوفر")}</strong></div>
      <div class="customer-panel-item"><span>القناة</span><strong>${esc(info.channel)}</strong></div>
      <div class="customer-panel-actions">
        ${info.phone ? '<button type="button" class="customer-panel-copy" data-copy-phone>نسخ الرقم</button>' : ""}
        <button type="button" class="customer-panel-open" data-open-customer>فتح العميل</button>
      </div>` : '<div class="customer-panel-placeholder">اختَر محادثة لعرض بيانات العميل</div>';

    panel.querySelector("[data-copy-phone]")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(info.phone); } catch (_) {}
    });
    panel.querySelector("[data-open-customer]")?.addEventListener("click", () => {
      window.location.href = "customers.html";
    });
  }

  function openImage(src, title = "مرفق") {
    const overlay = document.createElement("div");
    overlay.className = "conversation-lightbox";
    overlay.innerHTML = `<button type="button" class="conversation-lightbox-close" aria-label="إغلاق">×</button><img src="${esc(src)}" alt="${esc(title)}">`;
    const close = () => overlay.remove();
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    overlay.querySelector(".conversation-lightbox-close")?.addEventListener("click", close);
    document.body.appendChild(overlay);
  }

  function enhanceMedia() {
    const thread = document.getElementById("conversationThread");
    if (!thread) return;

    thread.querySelectorAll("a.message-file").forEach(link => {
      if (link.dataset.uiV2 === "1") return;
      const href = link.getAttribute("href") || "";
      const clean = href.split("?")[0].toLowerCase();
      const ext = clean.split(".").pop() || "";
      if (["jpg","jpeg","png","gif","webp","avif","bmp"].includes(ext)) {
        const img = document.createElement("img");
        img.className = ext === "webp" ? "message-image message-sticker" : "message-image";
        img.src = href; img.alt = ext === "webp" ? "استيكر" : "صورة"; img.loading = "lazy"; img.decoding = "async";
        const wrap = document.createElement("a");
        wrap.className = "message-image-link"; wrap.href = href; wrap.dataset.uiV2 = "1"; wrap.appendChild(img);
        wrap.addEventListener("click", e => { if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) { e.preventDefault(); openImage(href, ext === "webp" ? "استيكر" : "صورة"); } });
        link.replaceWith(wrap);
      } else if (["mp4","webm","mov","m4v"].includes(ext)) {
        const video = document.createElement("video");
        video.className = "message-video"; video.controls = true; video.preload = "metadata"; video.src = href;
        const wrap = document.createElement("div"); wrap.className = "message-media-wrap"; wrap.dataset.uiV2 = "1"; wrap.appendChild(video);
        link.replaceWith(wrap);
      }
    });
  }

  function enableAllAttachments() {
    const input = document.getElementById("replyFileInput");
    if (!input) return;
    input.accept = "*/*";
    input.removeAttribute("capture");
    input.setAttribute("data-all-files-enabled", "1");

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      const preview = document.getElementById("replyAttachmentPreview");
      if (!file || !preview) return;
      preview.style.display = "flex";
      const isImage = file.type.startsWith("image/");
      if (isImage) {
        const reader = new FileReader();
        reader.onload = () => {
          preview.innerHTML = `<div class="attachment-preview-media"><img src="${esc(reader.result)}" alt="معاينة الصورة"></div><div class="attachment-preview-name">${esc(file.name)}</div>`;
        };
        reader.readAsDataURL(file);
      } else {
        const icon = file.type.startsWith("video/") ? "🎬" : file.type.startsWith("audio/") ? "🎧" : "📎";
        preview.innerHTML = `<div class="attachment-preview-icon">${icon}</div><div class="attachment-preview-name">${esc(file.name)}</div>`;
      }
    });
  }

  function styleAndBehavior() {
    if (!document.getElementById("botera-conversations-v2-style")) {
      const style = document.createElement("style");
      style.id = "botera-conversations-v2-style";
      style.textContent = `
        body[data-page="conversations"] .split-layout { grid-template-columns:minmax(320px,360px) minmax(0,1fr) 270px !important; gap:16px !important; align-items:stretch !important; }
        body[data-page="conversations"] .conversation-list, body[data-page="conversations"] .conversation-thread, body[data-page="conversations"] .conversation-customer-panel-host { min-width:0; }
        body[data-page="conversations"] .conversation-customer-panel-host { display:block; height:calc(100vh - 232px); min-height:420px; max-height:720px; background:linear-gradient(180deg,rgba(18,25,37,.98),rgba(10,14,21,.98)); border:1px solid rgba(255,255,255,.08); border-radius:22px; overflow:hidden; box-shadow:0 18px 50px rgba(0,0,0,.25); }
        body[data-page="conversations"] .conversation-customer-panel { display:flex; flex-direction:column; gap:12px; height:100%; padding:22px; box-sizing:border-box; }
        body[data-page="conversations"] .customer-panel-heading { align-items:center; display:flex; justify-content:space-between; color:#b3bdcc; font-size:13px; font-weight:700; }
        body[data-page="conversations"] .customer-panel-live { color:#39ff6a; font-size:11px; }
        body[data-page="conversations"] .customer-panel-avatar { align-items:center; background:linear-gradient(135deg,rgba(57,255,106,.28),rgba(57,255,106,.06)); border:1px solid rgba(57,255,106,.3); border-radius:50%; color:#39ff6a; display:flex; font-size:30px; font-weight:800; height:78px; justify-content:center; margin:14px auto 0; width:78px; }
        body[data-page="conversations"] .customer-panel-name { color:#f5f7fb; font-size:18px; margin:0; text-align:center; }
        body[data-page="conversations"] .customer-panel-item { background:#0b111a; border:1px solid rgba(255,255,255,.06); border-radius:14px; display:flex; flex-direction:column; gap:5px; padding:12px; }
        body[data-page="conversations"] .customer-panel-item span { color:#7f8ba0; font-size:11px; }
        body[data-page="conversations"] .customer-panel-item strong { color:#edf2f7; font-size:13px; }
        body[data-page="conversations"] .customer-panel-actions { display:flex; gap:8px; }
        body[data-page="conversations"] .customer-panel-copy, body[data-page="conversations"] .customer-panel-open { border-radius:12px; cursor:pointer; flex:1; padding:10px 8px; }
        body[data-page="conversations"] .customer-panel-copy { background:rgba(57,255,106,.08); border:1px solid rgba(57,255,106,.2); color:#39ff6a; }
        body[data-page="conversations"] .customer-panel-open { background:#111925; border:1px solid rgba(255,255,255,.08); color:#d6dce7; }
        body[data-page="conversations"] .message-video { display:block; width:min(380px,72vw); max-height:360px; border-radius:14px; background:#000; }
        body[data-page="conversations"] .message-media-wrap { max-width:380px; }
        body[data-page="conversations"] .message-sticker { width:180px; max-height:180px; object-fit:contain; background:transparent; }
        body[data-page="conversations"] .reply-attachment-preview { align-items:center; display:flex; gap:10px; }
        body[data-page="conversations"] .attachment-preview-media img { width:64px; height:64px; object-fit:cover; border-radius:10px; }
        body[data-page="conversations"] .attachment-preview-name { color:#dfe6ef; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        body[data-page="conversations"] .attachment-preview-icon { font-size:26px; }
        body[data-page="conversations"] .conversation-lightbox { position:fixed; inset:0; z-index:99999; display:grid; place-items:center; background:rgba(0,0,0,.9); padding:24px; }
        body[data-page="conversations"] .conversation-lightbox img { max-width:94vw; max-height:90vh; object-fit:contain; border-radius:16px; }
        body[data-page="conversations"] .conversation-lightbox-close { position:absolute; top:18px; inset-inline-end:22px; width:42px; height:42px; border-radius:50%; border:1px solid rgba(255,255,255,.18); background:#10151e; color:#fff; font-size:26px; cursor:pointer; }
        @media (max-width:1179px){body[data-page="conversations"] .conversation-customer-panel-host{display:none!important} body[data-page="conversations"] .split-layout{grid-template-columns:minmax(280px,360px) minmax(0,1fr)!important}}
        @media (max-width:760px){body[data-page="conversations"] .split-layout{grid-template-columns:1fr!important} body[data-page="conversations"] .conversation-list{max-height:360px;min-height:280px} body[data-page="conversations"] .conversation-thread{min-height:560px}}
      `;
      document.head.appendChild(style);
    }
  }

  function run() {
    try { styleAndBehavior(); ensureLayout(); enableAllAttachments(); enhanceMedia(); } catch (error) { console.warn("Conversations v2 enhancement failed:", error); }
  }

  const thread = document.getElementById("conversationThread");
  if (thread && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => requestAnimationFrame(run)).observe(thread, { childList:true, subtree:true });
  }
  window.addEventListener("load", () => setTimeout(run, 350));
  setTimeout(run, 900);
})();
