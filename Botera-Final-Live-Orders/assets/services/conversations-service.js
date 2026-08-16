// services/conversations-service
const ConversationsService = (function () {
  // customers(name, phone) — name is the account identity for social
  // channels (Instagram/Facebook/Messenger/TikTok), phone is the identity
  // for WhatsApp. The channel itself lives on the conversation row, not on
  // customers, so it isn't selected here.
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("conversations")
      .select("*, customers(name, phone)")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data;
  }

  // Returns the distinct conversation_ids (restricted to `conversationIds`,
  // which the caller already knows belong to their own company) that have
  // at least one message whose text matches `term` — powers "search inside
  // the messages" on the Conversations page. `message` is the real text
  // column (confirmed directly against the live database).
  async function searchMessageMatches(conversationIds, term) {
    if (!conversationIds.length || !term) return [];
    const { data, error } = await supabaseClient
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", conversationIds)
      .ilike("message", `%${term}%`)
      .limit(500);
    if (error) throw error;
    return [...new Set(data.map((row) => row.conversation_id))];
  }

  return { list, searchMessageMatches };
})();
