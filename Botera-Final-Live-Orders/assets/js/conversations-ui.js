/* Conversations media-only enhancement. The original page layout remains untouched. */
(function () {
  if (document.body?.dataset?.page !== "conversations") return;

  function esc(value) {
    return typeof escapeHtml === "function"
      ? escapeHtml(value)
      : String(value ?? "").replace(/[&<>\"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[c]));
  }

  function installStyles() {
    if (document.getElementById("botera-conversations-media-style")) return;
    const style = document.createElement("style");
    style.id = "botera-conversations-media-style";
    style.textContent = `
      body[data-page="conversations"] .message-image-link{display:block;max-width:380px;border-radius:12px;overflow:hidden;cursor:zoom-in;background:#111;}
      body[data-page="conversations"] .message-image{display:block;max-width:100%;max-height:380px;width:auto;height:auto;object-fit:contain;}
      body[data-page="conversations"] .message-sticker{max-width:190px!important;max-height:190px!important;object-fit:contain;background:transparent;}
      body[data-page="conversations"] .message-video{display:block;width:min(380px,75vw);max-height:380px;border-radius:12px;background:#000;}
      body[data-page="conversations"] .message-media-wrap{max-width:380px;}
      body[data-page="conversations"] .conversation-media-lightbox{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.9);padding:24px;cursor:zoom-out;}
      body[data-page="conversations"] .conversation-media-lightbox img{max-width:94vw;max-height:90vh;object-fit:contain;border-radius:14px;}
      body[data-page="conversations"] .conversation-media-lightbox-close{position:absolute;top:18px;inset-inline-end:22px;width:42px;height:42px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:#10151e;color:#fff;font-size:26px;cursor:pointer;}
    `;
    document.head.appendChild(style);
  }

  function detectVideo(url) {
    const clean = String(url || "").split("?")[0].toLowerCase();
    return ["mp4", "webm", "mov", "m4v"].some(ext => clean.endsWith("." + ext));
  }

  function enhanceMedia() {
    const thread = document.getElementById("conversationThread");
    if (!thread) return;

    /* Original core renderer already shows images, stickers (WebP), audio and generic files. */
    thread.querySelectorAll("a.message-file").forEach((link) => {
      if (link.dataset.mediaEnhanced === "1") return;
      const href = link.getAttribute("href") || "";
      if (!detectVideo(href)) return;

      const video = document.createElement("video");
      video.className = "message-video";
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("playsinline", "");
      video.src = href;

      const wrap = document.createElement("div");
      wrap.className = "message-media-wrap";
      wrap.dataset.mediaEnhanced = "1";
      wrap.appendChild(video);
      link.replaceWith(wrap);
    });

    thread.querySelectorAll(".message-image-link").forEach((link) => {
      if (link.dataset.lightboxBound === "1") return;
      link.dataset.lightboxBound = "1";
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        const img = link.querySelector("img");
        const src = img?.currentSrc || img?.src || link.getAttribute("href");
        if (!src) return;

        const overlay = document.createElement("div");
        overlay.className = "conversation-media-lightbox";
        overlay.innerHTML = `<button type="button" class="conversation-media-lightbox-close" aria-label="إغلاق">×</button><img src="${esc(src)}" alt="مرفق">`;
        const onKey = (e) => { if (e.key === "Escape") close(); };
        const close = () => {
          overlay.remove();
          document.removeEventListener("keydown", onKey);
        };
        overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
        overlay.querySelector(".conversation-media-lightbox-close")?.addEventListener("click", close);
        document.addEventListener("keydown", onKey);
        document.body.appendChild(overlay);
      });
    });
  }

  function unlockAllFileSelection() {
    const input = document.getElementById("replyFileInput");
    if (!input) return;
    /* Keep the existing composer and send flow, but remove the image/audio-only picker restriction. */
    input.accept = "*/*";
  }

  function run() {
    installStyles();
    unlockAllFileSelection();
    enhanceMedia();
  }

  const thread = document.getElementById("conversationThread");
  if (thread && typeof MutationObserver !== "undefined") {
    new MutationObserver(() => requestAnimationFrame(run)).observe(thread, { childList: true, subtree: true });
  }
  window.addEventListener("load", () => setTimeout(run, 250));
  setTimeout(run, 600);
})();
