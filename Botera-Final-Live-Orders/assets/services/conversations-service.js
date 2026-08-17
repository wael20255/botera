// services/conversations-service
const ConversationsService = (function () {
  async function list(companyId) {
    const { data, error } = await supabaseClient
      .from("conversations")
      .select("*, customers(name, phone, source, external_id)")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data;
  }

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
