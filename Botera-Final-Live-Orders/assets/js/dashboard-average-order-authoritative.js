// Keep Dashboard average order aligned with the authoritative ecommerce metric.
(function () {
  async function renderAverageOrder() {
    try {
      const profile = window.__boteraLiveProfile || await useAuth.ensureAuthenticated();
      if (!profile || !window.DateRange || !window.supabaseClient) return;

      const range = DateRange.getCurrent();
      const { data, error } = await supabaseClient
        .from("orders")
        .select("created_at,status,total,currency")
        .eq("company_id", profile.company_id);

      if (error) throw error;

      const delivered = (data || []).filter((o) =>
        o.status === "delivered" && DateRange.within(o.created_at, range)
      );

      const el = document.getElementById("averageOrderValue");
      if (!el) return;

      if (!delivered.length) {
        el.textContent = "—";
        return;
      }

      const revenue = delivered.reduce((sum, order) => sum + Number(order.total || 0), 0);
      const average = revenue / delivered.length;
      const currency = delivered.find((o) => o.currency)?.currency || profile.company?.currency || "EGP";
      el.textContent = formatMoney(average, currency);
    } catch (error) {
      console.warn("Dashboard authoritative average order failed:", error);
    }
  }

  window.addEventListener("boteradaterangechange", () => setTimeout(renderAverageOrder, 80));
  window.addEventListener("boterarealtimechange", () => setTimeout(renderAverageOrder, 180));
  window.addEventListener("pageshow", () => setTimeout(renderAverageOrder, 180));
  setTimeout(renderAverageOrder, 500);
})();
