// services/messages-service — messages are scoped to a conversation, which
// is itself company-scoped; RLS enforces that chain (see setup.sql).
//
// Real column names (confirmed directly against the live database):
//   messages.message             — the text content (not "body")
//   conversations.last_message   — cached preview (not "last_message_preview")
//   conversations.last_message_at
const MessagesService = (function () {
  async function listCompany(companyId) {
    // Dashboard AI stats only need sender + created_at. Fetch them in one
    // request instead of paging through the entire messages table in 1000-row
    // sequential batches, which made dashboard startup unnecessarily slow.
    const { data, error } = await supabaseClient
      .from("messages")
      .select("sender,created_at,conversations!inner(company_id)")
      .eq("conversations.company_id", companyId)
      .order("created_at", { ascending: true })
      .range(0, 49999);

    if (error) throw error;
    return (data || []).map(({ conversations, ...message }) => message);
  }

  async function list(conversationId) {
    const { data, error } = await supabaseClient
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  function attachmentPreviewLabel(type) {
    if (type === "image") return "📷 صورة";
    if (type === "audio") return "🎙️ رسالة صوتية";
    return "📎 ملف مرفق";
  }

  function sanitizeFileName(name) {
    return (name || "file").replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(-80);
  }

  // Uploads an image/audio file to the real "message-attachments" bucket
  // (see supabase/04-message-attachments.sql) under
  // {companyId}/{conversationId}/... and returns its public URL + a simple
  // type ('image' | 'audio' | 'file').
  async function uploadAttachment(companyId, conversationId, file) {
    const path = `${companyId}/${conversationId}/${Date.now()}-${sanitizeFileName(file.name)}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("message-attachments")
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (uploadError) {
      if (/bucket/i.test(uploadError.message || "")) {
        throw new Error("لا يوجد مكان تخزين (Storage bucket) بعد لحفظ المرفقات — شغّل supabase/04-message-attachments.sql في Supabase SQL Editor.");
      }
      throw uploadError;
    }
    const { data: publicData } = supabaseClient.storage.from("message-attachments").getPublicUrl(path);
    const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("audio/") ? "audio" : "file";
    return { url: publicData.publicUrl, type };
  }

  // Sends a reply. `attachment` is optional — `{ url, type }` from
  // uploadAttachment(), or omitted for a plain text reply.
  async function send(conversationId, text, attachment) {
    const { data: conversation, error: conversationError } = await supabaseClient
      .from("conversations")
      .select("id, company_id, channel")
      .eq("id", conversationId)
      .single();
    if (conversationError) throw conversationError;

    const { data, error } = await supabaseClient.functions.invoke("messaging-gateway-v2", {
      body: {
        action: "send",
        company_id: conversation.company_id,
        conversation_id: conversationId,
        message: text || "",
        attachment_url: attachment?.url || null,
        attachment_type: attachment?.type || null
      }
    });
    if (error) {
      let message = error.message || "تعذر إرسال الرسالة.";
      try {
        const body = await error.context?.json?.();
        message = body?.details || body?.error || message;
      } catch (_) {}
      throw new Error(message);
    }
    if (!data?.ok) throw new Error(data?.details || data?.error || "تعذر إرسال الرسالة.");
    return data;
  }

  return { list, listCompany, send, uploadAttachment, attachmentPreviewLabel };
})();
