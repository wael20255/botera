(async function init() {
  const profile = await useAuth.ensureAuthenticated({ requiredPermission: "can_view_automation" });
  if (!profile) return;
  setupLayout(profile);
  startBoteraRealtime?.(profile);
  DateRange.init(); // present for layout consistency; recommendations are not date-filtered

  // Priority values are free text (agent-supplied) — matched
  // case-insensitively so "High"/"high"/"HIGH" all land the same badge.
  const PRIORITY_BADGE = { critical: "badge-red", high: "badge-amber", medium: "badge-sky", low: "badge-muted" };
  const PRIORITY_LABEL_AR = { critical: "حرجة", high: "عالية", medium: "متوسطة", low: "منخفضة" };

  // The page's 3 fixed sections. `category` is the exact value the n8n
  // agent (or any other writer) must set on automation_recommendations.category
  // for a row to land here — enforced at the database level too (see
  // supabase/05-recommendation-categories.sql).
  const SECTIONS = [
    { category: "Ads", icon: "📈", accent: "--color-sky", title: "توصيات الإعلانات", desc: "صرف الإعلانات، الاستهداف، والمحتوى الإعلاني." },
    { category: "Growth", icon: "🚀", accent: "--color-neon", title: "توصيات نمو المشروع", desc: "التسعير، العروض، التشغيل، ومسار المبيعات." },
    { category: "Customers", icon: "👤", accent: "--color-violet", title: "توصيات العملاء", desc: "عملاء أو شرائح محددة، وحالتهم الحالية، وإيه اللي يستاهل تعمله معاهم." },
  ];

  let all = [];
  let activePriority = "all";
  let activeStatus = "all"; // all | done | pending — based on the real `completed` boolean

  function timeAgo(iso) {
    const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes < 60) return `منذ ${minutes} دقيقة`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `منذ ${hours} ساعة`;
    return `منذ ${Math.round(hours / 24)} يوم`;
  }

  function priorityKey(priority) {
    return String(priority || "").toLowerCase();
  }

  function renderKpis() {
    const countOf = (category) => all.filter((r) => r.category === category).length;
    document.getElementById("automationKpis").innerHTML = `
      <article class="card kpi-card"><span class="kpi-label">إجمالي التوصيات</span><strong class="kpi-value">${all.length}</strong></article>
      <article class="card kpi-card"><span class="kpi-label">📈 الإعلانات</span><strong class="kpi-value">${countOf("Ads")}</strong></article>
      <article class="card kpi-card"><span class="kpi-label">🚀 نمو المشروع</span><strong class="kpi-value">${countOf("Growth")}</strong></article>
      <article class="card kpi-card"><span class="kpi-label">👤 العملاء</span><strong class="kpi-value">${countOf("Customers")}</strong></article>`;
  }

  function renderFilters() {
    const priorities = ["all", "critical", "high", "medium", "low"];
    document.getElementById("priorityFilters").innerHTML = priorities.map((p) => `<button class="filter-button ${activePriority === p ? "active" : ""}" data-priority="${p}">${p === "all" ? "كل الأولويات" : PRIORITY_LABEL_AR[p]}</button>`).join("");
    document.querySelectorAll("#priorityFilters [data-priority]").forEach((btn) => btn.addEventListener("click", () => { activePriority = btn.dataset.priority; renderFilters(); renderSections(); }));

    document.getElementById("statusFilters").innerHTML = `
      <button class="filter-button ${activeStatus === "all" ? "active" : ""}" data-status="all">الكل</button>
      <button class="filter-button ${activeStatus === "pending" ? "active" : ""}" data-status="pending">لم يُنفّذ بعد</button>
      <button class="filter-button ${activeStatus === "done" ? "active" : ""}" data-status="done">تم التنفيذ</button>`;
    document.querySelectorAll("#statusFilters [data-status]").forEach((btn) => btn.addEventListener("click", () => { activeStatus = btn.dataset.status; renderFilters(); renderSections(); }));
  }

  function matchesFilters(r) {
    const priorityMatch = activePriority === "all" || priorityKey(r.priority) === activePriority;
    const statusMatch = activeStatus === "all" || (activeStatus === "done" ? !!r.completed : !r.completed);
    return priorityMatch && statusMatch;
  }

  async function toggleCompleted(id, completed) {
    try {
      await RecommendationsService.setCompleted(id, completed);
      const row = all.find((r) => r.id === id);
      if (row) row.completed = completed;
      renderSections();
    } catch (error) {
      console.error("Could not update recommendation:", error);
    }
  }

  function recommendationCard(r) {
    const pKey = priorityKey(r.priority);
    return `<article class="card">
        <div class="recommendation-head">
          <div class="recommendation-title">${escapeHtml(r.title)}</div>
          <span class="badge ${PRIORITY_BADGE[pKey] || "badge-muted"}">${PRIORITY_LABEL_AR[pKey] || escapeHtml(r.priority || "—")}</span>
        </div>
        ${r.description ? `<div class="recommendation-field"><div class="recommendation-field-value">${escapeHtml(r.description)}</div></div>` : ""}
        <div class="recommendation-footer">
          <label class="recommendation-done-toggle"><input type="checkbox" data-completed-toggle="${r.id}" ${r.completed ? "checked" : ""}> ${r.completed ? "تم التنفيذ" : "لم يُنفّذ بعد"}</label>
          <span class="list-row-meta" style="margin:0;">${timeAgo(r.created_at)}</span>
        </div>
      </article>`;
  }

  function renderSections() {
    const filtered = all.filter(matchesFilters);
    const target = document.getElementById("automationSections");
    const html = SECTIONS.map((section) => {
      const items = filtered.filter((r) => r.category === section.category);
      const body = items.length
        ? `<div class="automation-section-list">${items.map(recommendationCard).join("")}</div>`
        : emptyState(`لا توجد توصيات ${section.title.replace("توصيات ", "")} بعد`, "هتظهر هنا أول ما توصلها توصية جديدة من أتمتة سير العمل.");
      return `<div class="automation-section" style="--section-accent:var(${section.accent});">
        <div class="automation-section-header">
          <div><div class="automation-section-title">${section.icon} ${section.title}</div><div class="automation-section-desc">${section.desc}</div></div>
          <span class="automation-section-count">${items.length}</span>
        </div>
        ${body}
      </div>`;
    });
    // Defensive: a recommendation whose category isn't one of the 3 above
    // still gets shown here instead of silently vanishing — the DB
    // constraint in supabase/05-recommendation-categories.sql should
    // prevent this, but the UI stays honest either way.
    const known = new Set(SECTIONS.map((s) => s.category));
    const other = filtered.filter((r) => !known.has(r.category));
    if (other.length) {
      html.push(`<div class="automation-section" style="--section-accent:var(--color-red);">
        <div class="automation-section-header"><div><div class="automation-section-title">❓ أخرى</div><div class="automation-section-desc">توصيات بفئة غير معروفة — تحقق من الفئة المرسلة من الأتمتة.</div></div><span class="automation-section-count">${other.length}</span></div>
        <div class="automation-section-list">${other.map(recommendationCard).join("")}</div>
      </div>`);
    }
    target.innerHTML = html.join("");
    target.querySelectorAll("[data-completed-toggle]").forEach((input) => input.addEventListener("change", () => toggleCompleted(input.dataset.completedToggle, input.checked)));
  }

  document.getElementById("automationSections").innerHTML = skeletonBlock("140px", 3);
  async function loadRecommendationsLive() {
    try {
      all = await RecommendationsService.list(profile.company_id);
      renderKpis(); renderFilters(); renderSections();
    } catch (error) {
      console.error("Live recommendations refresh failed:", error);
    }
  }
  try {
    all = await RecommendationsService.list(profile.company_id);
    renderKpis(); renderFilters(); renderSections();
  } catch (error) {
    document.getElementById("automationSections").innerHTML = errorState("تعذر تحميل التوصيات", isSupabaseConfigured() ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى." : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.");
  }
  let realtimeTimer = null;
  window.addEventListener("boterarealtimechange", () => {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(loadRecommendationsLive, 180);
  });
})();
