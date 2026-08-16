// ============================================================================
// lib/format — shared formatting + UI-state helpers used by every page:
// dates, money, badges, and the three states any async section can be in
// (loading skeleton, empty, error).
// ============================================================================
function formatDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function relativeTime(value) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "الآن";
  if (seconds < 3600) return `منذ ${Math.floor(seconds / 60)} د`;
  if (seconds < 86400) return `منذ ${Math.floor(seconds / 3600)} س`;
  return `منذ ${Math.floor(seconds / 86400)} ي`;
}

function escapeHtml(value) {
  const node = document.createElement("div");
  node.textContent = value ?? "";
  return node.innerHTML;
}

function statusBadge(status) {
  const styles = {
    pending: "amber", confirmed: "sky", processing: "violet", shipped: "violet",
    delivered: "neon", cancelled: "red", refunded: "red", unpaid: "amber",
    paid: "neon", failed: "red", new: "sky", recommend: "violet", asking: "violet", hesitant: "amber",
    ready: "neon", collect: "neon", closed: "neon", lost: "red"
  };
  const labels = {
    pending: "قيد الانتظار", confirmed: "مؤكد", processing: "قيد التجهيز", shipped: "تم الشحن",
    delivered: "تم التسليم", cancelled: "ملغي", refunded: "مرتجع", unpaid: "غير مدفوع",
    paid: "مدفوع", failed: "فشل", new: "جديد", recommend: "بيتوصف له", asking: "يسأل", hesitant: "متردد",
    ready: "جاهز", collect: "بيجمع بياناته", closed: "مغلق", lost: "مفقود"
  };
  // A status value we don't have an Arabic label for (e.g. a raw DB slug
  // like "collect_lead") is shown prettified — underscores turned into
  // spaces, no trailing underscore — instead of dumped exactly as stored.
  const fallback = String(status || "").replace(/_+$/, "").replace(/[_-]+/g, " ").trim();
  return `<span class="badge badge-${styles[status] || "sky"}">${labels[status] || escapeHtml(fallback || "—")}</span>`;
}

function channelLabel(channel) {
  const labels = { whatsapp: "WhatsApp", instagram: "Instagram", facebook: "Facebook", messenger: "Messenger", tiktok: "TikTok" };
  return labels[channel] || channel || "—";
}

function formatMoney(amount, currency = "EGP") {
  return new Intl.NumberFormat("ar-EG", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount || 0));
}

// ---- Async section states (loading / empty / error) -----------------------
// Used by every page together with hooks/use-async.js so every data section
// in the app looks and behaves the same way while fetching, when there's
// nothing to show, or when Supabase is unreachable.

function emptyState(title, description) {
  return `<div class="empty-state"><div class="empty-state-icon">···</div><div class="empty-state-title">${title}</div><div class="empty-state-desc">${description}</div></div>`;
}

function errorState(title, description) {
  return `<div class="empty-state error-state"><div class="empty-state-icon">!</div><div class="empty-state-title">${title}</div><div class="empty-state-desc">${escapeHtml(description || "")}</div></div>`;
}

// height: CSS height for the skeleton block (e.g. "180px"). rows: how many
// pulsing placeholder blocks to stack — use 1 for a chart/card area, more
// for a table/list.
function skeletonBlock(height = "80px", rows = 1) {
  return Array.from({ length: rows }, () => `<div class="skeleton" style="height:${height};"></div>`).join("");
}
