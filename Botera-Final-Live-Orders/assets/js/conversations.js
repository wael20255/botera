// ============================================================================
// js/conversations — real conversation list + thread from Supabase, with:
//   - search by account name / phone number / text inside the messages
//   - the chat's displayed name follows the channel: WhatsApp shows the
//     phone number, social channels (Instagram/Facebook/Messenger/TikTok)
//     show the account name saved on the customer.
// ============================================================================

// Brand-ish colors reused from the dashboard's own channel palette
// (assets/css/dashboard.css: .whatsapp/.facebook/.instagram) so this page
// stays visually consistent with the rest of the app.
const CHANNEL_COLORS = {
  whatsapp: "#25D366",
  facebook: "#1877F2",
  instagram: "linear-gradient(135deg,#f97316,#ec4899,#8b5cf6)",
  messenger: "#6d5dfc",
  tiktok: "linear-gradient(135deg,#25F4EE,#FE2C55)",
};

function messageBody(message) {
  return message.message ?? message.body ?? message.text ?? message.content ?? "";
}

function supabaseErrorText(error) {
  return error?.message || error?.error_description || error?.hint || "خطأ غير معروف";
}

function messageAttachment(message) {
  const rawAttachment = typeof message.attachment === "string" && /^https?:\/\//i.test(message.attachment) ? message.attachment : null;
  const url = message.attachment_url ?? rawAttachment ?? message.media_url ?? message.image_url ?? message.audio_url ?? message.file_url ?? null;
  if (!url) return null;
  let type = message.attachment_type ?? message.media_type ?? message.type ?? null;
  if (!["image", "audio", "file"].includes(type)) {
    const ext = (String(url).split("?")[0].split(".").pop() || "").toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) type = "image";
    else if (["mp3", "ogg", "wav", "m4a", "opus", "webm", "aac"].includes(ext)) type = "audio";
    else type = "file";
  }
  return { url, type };
}

function renderAttachment(attachment) {
  const safeUrl = escapeHtml(attachment.url);
  if (attachment.type === "image") {
    return `<a class="message-image-link" href="${safeUrl}" target="_blank" rel="noopener"><img class="message-image" src="${safeUrl}" alt="صورة" loading="lazy"></a>`;
  }
  if (attachment.type === "audio") {
    return `<audio class="message-audio" controls src="${safeUrl}"></audio>`;
  }
  return `<a class="message-file" href="${safeUrl}" target="_blank" rel="noopener">📎 فتح الملف المرفق</a>`;
}

function channelColor(channel) {
  return CHANNEL_COLORS[channel] || "var(--color-surface-2)";
}

function chatIdentity(conversation) {
  const customer = conversation.customers || {};
  const channel = conversation.channel || customer.channel || "";
  const isWhatsapp = channel === "whatsapp";
  const primary = isWhatsapp
    ? (customer.phone || customer.name || "رقم غير معروف")
    : (customer.name || customer.phone || "عميل غير معروف");
  const secondary = !isWhatsapp && customer.name && customer.phone ? customer.phone : null;
  return { channel, primary, secondary, isWhatsapp };
}

function avatarHtml(identity) {
  const bg = channelColor(identity.channel);
  const style = `background:${bg};`;
  if (identity.isWhatsapp) {
    return `<span class="conversation-avatar" style="${style}"><svg viewBox="0 0 24 24" fill="none" stroke="#06240f" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.34 1.79.65 2.65a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.43-1.43a2 2 0 0 1 2.11-.45c.86.31 1.75.53 2.65.65A2 2 0 0 1 22 16.92z"/></svg></span>`;
  }
  const letter = escapeHtml((identity.primary || "؟").trim().charAt(0).toUpperCase() || "؟");
  return `<span class="conversation-avatar" style="${style}">${letter}</span>`;
}

function highlightMatch(text, term) {
  const safeText = escapeHtml(text ?? "");
  if (!term) return safeText;
  const safeTerm = escapeHtml(term);
  const idx = safeText.toLocaleLowerCase().indexOf(safeTerm.toLocaleLowerCase());
  if (idx === -1) return safeText;
  return `${safeText.slice(0, idx)}<mark class="search-highlight">${safeText.slice(idx, idx + safeTerm.length)}</mark>${safeText.slice(idx + safeTerm.length)}`;
}

(async function init() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_conversations" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init();

  let allConversations = [];
  let conversations = [];
  let selectedId = null;
  let activeChannel = "all";
  let searchTerm = "";
  let messageMatchIds = new Set();
  let searchGeneration = 0;
  let searchDebounceTimer = null;
  const requestedCustomerId = new URLSearchParams(window.location.search).get("customer");
  let autoOpenedFromQuery = false;

  const list = document.getElementById("conversationList");
  const thread = document.getElementById("conversationThread");
  const filters = document.getElementById("channelFilters");
  const searchInput = document.getElementById("conversationSearch");
  const searchStatus = document.getElementById("conversationSearchStatus");

  function matchesSearch(conversation) {
    if (!searchTerm) return true;
    const term = searchTerm.toLocaleLowerCase();
    const customer = conversation.customers || {};
    const nameMatch = (customer.name || "").toLocaleLowerCase().includes(term);
    const phoneMatch = (customer.phone || "").toLocaleLowerCase().includes(term);
    const previewMatch = (conversation.last_message_preview || "").toLocaleLowerCase().includes(term);
    return nameMatch || phoneMatch || previewMatch || messageMatchIds.has(conversation.id);
  }
  function searchFiltered() { return conversations.filter(matchesSearch); }

  function renderFilters() {
    const base = searchFiltered();
    const channels = [...new Set(conversations.map((conversation) => conversation.channel).filter(Boolean))];
    filters.innerHTML = ["all", ...channels].map((channel) => {
      const count = channel === "all" ? base.length : base.filter((c) => c.channel === channel).length;
      return `<button class="filter-button ${channel === activeChannel ? "active" : ""}" data-channel="${channel}">${channel === "all" ? "الكل" : channelLabel(channel)} (${count})</button>`;
    }).join("");
    filters.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
      activeChannel = button.dataset.channel;
      renderFilters(); renderList();
    }));
  }

  function renderList() {
    const base = searchFiltered();
    const visible = base.filter((conversation) => activeChannel === "all" || conversation.channel === activeChannel);
    list.innerHTML = visible.length ? visible.map((conversation) => {
      const identity = chatIdentity(conversation);
      const nameHasMatch = searchTerm && identity.primary.toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase());
      const previewHasMatch = searchTerm && (conversation.last_message_preview || "").toLocaleLowerCase().includes(searchTerm.toLocaleLowerCase());
      const matchedInMessage = searchTerm && !nameHasMatch && !previewHasMatch && messageMatchIds.has(conversation.id);
      return `<button class="conversation-item ${conversation.id === selectedId ? "active" : ""}" data-id="${conversation.id}">
        ${avatarHtml(identity)}
        <span class="conversation-body">
          <span class="conversation-item-head">
            <strong class="conversation-name" dir="${identity.isWhatsapp ? "ltr" : "auto"}">${highlightMatch(identity.primary, searchTerm)}</strong>
            <span class="message-time">${relativeTime(conversation.last_message_at)}</span>
          </span>
          <span class="conversation-meta">
            <span class="channel-tag">${channelLabel(identity.channel)}</span>
            ${identity.secondary ? `<span dir="ltr">${escapeHtml(identity.secondary)}</span>` : ""}
          </span>
          <span class="conversation-preview">${matchedInMessage ? `<span class="match-tag">تطابق في رسالة</span>` : ""}${highlightMatch(conversation.last_message_preview || "لا توجد رسالة بعد", searchTerm)}</span>
        </span>
        ${conversation.unread_count ? `<span class="unread-badge">${conversation.unread_count}</span>` : ""}
      </button>`;
    }).join("") : emptyState(
      searchTerm ? "لا نتائج مطابقة" : "لا توجد محادثات",
      searchTerm ? "جرّب كلمة بحث مختلفة، أو امسح البحث." : "ستظهر المحادثات عندما تصل رسائل من القنوات المتصلة."
    );
    list.querySelectorAll(".conversation-item").forEach((item) => item.addEventListener("click", () => loadThread(item.dataset.id)));
  }

  async function loadThread(conversationId) {
    selectedId = conversationId;
    const localConversation = allConversations.find((item) => item.id === conversationId);
    if (localConversation && Number(localConversation.unread_count || 0) > 0) {
      localConversation.unread_count = 0;
      renderList();
      try {
        await supabaseClient.from("conversations").update({ unread_count: 0, updated_at: new Date().toISOString() }).eq("id", conversationId);
      } catch (error) { console.warn("Could not mark conversation as read:", error); }
    } else {
      renderList();
    }
    thread.innerHTML = skeletonBlock("48px", 3);
    try {
      const messages = await MessagesService.list(conversationId);
      const conversation = conversations.find((item) => item.id === conversationId) || allConversations.find((item) => item.id === conversationId);
      const identity = chatIdentity(conversation);
      const messageHtml = messages.length ? messages.map((message) => {
        const attachment = messageAttachment(message);
        const text = messageBody(message);
        const bodyParts = [];
        if (attachment) bodyParts.push(renderAttachment(attachment));
        if (text) bodyParts.push(`<p class="message-text">${escapeHtml(text)}</p>`);
        return `<div class="message message-${message.sender}">${bodyParts.join("")}<time class="message-time" datetime="${message.created_at}">${formatDate(message.created_at)}</time></div>`;
      }).join("") : emptyState("لا توجد رسائل بعد", "يمكنك بدء الرد من المربع بالأسفل.");
      thread.innerHTML = `<div class="thread-header">
          ${avatarHtml(identity)}
          <span class="thread-header-meta">
            <strong dir="${identity.isWhatsapp ? "ltr" : "auto"}">${escapeHtml(identity.primary)}</strong>
            <span class="conversation-meta"><span class="channel-tag">${channelLabel(identity.channel)}</span>${identity.secondary ? `<span dir="ltr">${escapeHtml(identity.secondary)}</span>` : ""}</span>
          </span>
        </div>
        <div class="thread-content">${messageHtml}</div>
        <form class="reply-form" id="replyForm">
          <div class="reply-attachment-preview" id="replyAttachmentPreview" style="display:none;"></div>
          <div class="reply-row">
            <input type="file" id="replyFileInput" accept="*/*" hidden>
            <button type="button" class="icon-btn" id="attachBtn" title="إرفاق صورة أو ملف">📎</button>
            <button type="button" class="icon-btn" id="recordBtn" title="تسجيل رسالة صوتية">🎙️</button>
            <label class="sr-only" for="replyBody">الرد</label>
            <textarea class="form-input" id="replyBody" placeholder="اكتب ردك هنا"></textarea>
            <button class="btn" type="submit">إرسال</button>
          </div>
          <p class="error-message" id="replyError"></p>
        </form>`;

      let pendingFile = null;
      let mediaRecorder = null;
      let recordedChunks = [];
      const fileInput = document.getElementById("replyFileInput");
      const attachBtn = document.getElementById("attachBtn");
      const recordBtn = document.getElementById("recordBtn");
      const attachmentPreview = document.getElementById("replyAttachmentPreview");
      const errorBox = document.getElementById("replyError");

      function setPendingFile(file) {
        pendingFile = file;
        const isImage = file.type.startsWith("image/");
        const isAudio = file.type.startsWith("audio/");
        const label = isImage ? `🖼️ ${file.name}` : isAudio ? "🎙️ رسالة صوتية جاهزة للإرسال" : `📎 ${file.name}`;
        attachmentPreview.style.display = "flex";
        attachmentPreview.innerHTML = `<span>${escapeHtml(label)}</span><button type="button" class="attachment-remove" id="removeAttachmentBtn">إزالة ✕</button>`;
        document.getElementById("removeAttachmentBtn").addEventListener("click", clearPendingFile);
      }
      function clearPendingFile() {
        pendingFile = null;
        fileInput.value = "";
        attachmentPreview.style.display = "none";
        attachmentPreview.innerHTML = "";
      }

      attachBtn.addEventListener("click", () => fileInput.click());
      fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) setPendingFile(fileInput.files[0]);
      });

      recordBtn.addEventListener("click", async () => {
        if (mediaRecorder && mediaRecorder.state === "recording") {
          mediaRecorder.stop();
          return;
        }
        errorBox.textContent = "";
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          recordedChunks = [];
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (event) => { if (event.data.size) recordedChunks.push(event.data); };
          mediaRecorder.onstop = () => {
            stream.getTracks().forEach((track) => track.stop());
            const blob = new Blob(recordedChunks, { type: "audio/webm" });
            setPendingFile(new File([blob], `voice-${Date.now()}.webm`, { type: "audio/webm" }));
            recordBtn.textContent = "🎙️";
            recordBtn.classList.remove("recording");
          };
          mediaRecorder.start();
          recordBtn.textContent = "⏹️";
          recordBtn.classList.add("recording");
        } catch (error) {
          errorBox.textContent = "تعذر الوصول إلى الميكروفون — تأكد من إعطاء الإذن للمتصفح.";
        }
      });

      document.getElementById("replyForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const input = document.getElementById("replyBody");
        const submitBtn = event.target.querySelector('button[type="submit"]');
        errorBox.textContent = "";
        const text = input.value.trim();
        if (!text && !pendingFile) {
          errorBox.textContent = "اكتب رسالة أو أرفق ملف أولاً.";
          return;
        }
        submitBtn.disabled = true;
        attachBtn.disabled = true;
        recordBtn.disabled = true;
        try {
          let attachment = null;
          if (pendingFile) attachment = await MessagesService.uploadAttachment(profile.company_id, conversationId, pendingFile);
          const message = await MessagesService.send(conversationId, text, attachment);
          const updated = conversations.find((item) => item.id === conversationId);
          updated.last_message_preview = messageBody(message) || (attachment ? MessagesService.attachmentPreviewLabel(attachment.type) : "");
          updated.last_message_at = message.created_at;
          updated.unread_count = 0;
          conversations.sort((a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0));
          renderList();
          await loadThread(conversationId);
        } catch (error) {
          console.error("Sending reply failed:", error);
          errorBox.textContent = `تعذر إرسال الرد: ${supabaseErrorText(error)}`;
          submitBtn.disabled = false;
          attachBtn.disabled = false;
          recordBtn.disabled = false;
        }
      });

      document.getElementById("replyBody").addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
          event.preventDefault();
          document.getElementById("replyForm\").requestSubmit();
        }
      });
    } catch (error) {
      console.error("MessagesService.list failed:", error);
      thread.innerHTML = errorState("تعذر تحميل الرسائل", supabaseErrorText(error));
    }
  }

  async function runMessageSearch(term) {
    const generation = ++searchGeneration;
    searchStatus.textContent = "جاري البحث داخل الرسائل…";
    try {
      const ids = conversations.map((c) => c.id);
      const matches = await ConversationsService.searchMessageMatches(ids, term);
      if (generation !== searchGeneration || term !== searchTerm) return;
      messageMatchIds = new Set(matches);
      searchStatus.textContent = "";
      renderFilters(); renderList();
    } catch (error) {
      if (generation !== searchGeneration) return;
      searchStatus.textContent = "تعذر البحث داخل الرسائل الآن.";
    }
  }

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim();
    renderFilters(); renderList();
    clearTimeout(searchDebounceTimer);
    if (!searchTerm) { messageMatchIds = new Set(); searchStatus.textContent = ""; return; }
    searchDebounceTimer = setTimeout(() => runMessageSearch(searchTerm), 400);
  });

  async function load() {
    if (!allConversations.length) list.innerHTML = skeletonBlock("64px", 5);
    try {
      if (!allConversations.length) allConversations = await ConversationsService.list(profile.company_id);
      const range = DateRange.getCurrent();
      conversations = allConversations.filter((c) => c.last_message_at && DateRange.within(c.last_message_at, range));
      messageMatchIds = new Set();
      renderFilters(); renderList();
      if (selectedId && conversations.some((c) => c.id === selectedId)) {
        await loadThread(selectedId);
      } else if (!selectedId) {
        thread.innerHTML = conversations.length
          ? emptyState("اختر محادثة", "اختر محادثة من القائمة لعرض الرسائل.")
          : emptyState("لا توجد محادثات في هذه الفترة", "جرّب فترة زمنية أطول من الأعلى.");
      }
      if (searchTerm) runMessageSearch(searchTerm);
      if (requestedCustomerId && !autoOpenedFromQuery) {
        const match = allConversations.find((c) => c.customer_id === requestedCustomerId);
        if (match) {
          autoOpenedFromQuery = true;
          await loadThread(match.id);
        }
      }
    } catch (error) {
      console.error(error);
      list.innerHTML = errorState("تعذر تحميل المحادثات", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
      thread.innerHTML = "";
    }
  }
  await load();
  window.addEventListener("boteradaterangechange", load);
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => { allConversations = []; load(); }, 180);
  });
})();