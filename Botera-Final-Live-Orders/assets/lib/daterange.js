// ============================================================================
// Global date range selector — shared across every page.
// Persists the selection in localStorage so it survives navigation and
// browser refreshes. Fires a "boteradaterangechange" event on `window`
// whenever the range changes, so each page's own script can re-fetch/
// re-render whatever it shows, filtered to the new range.
// ============================================================================
const DateRange = (function () {
  const STORAGE_KEY = "botera-date-range";

  function startOfDay(d) { const c = new Date(d); c.setHours(0, 0, 0, 0); return c; }
  function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
  function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function startOfYear(d) { return new Date(d.getFullYear(), 0, 1); }
  // Parses a "YYYY-MM-DD" <input type="date"> value as a LOCAL calendar day
  // (new Date("YYYY-MM-DD") parses as UTC, which can land on the wrong local
  // day depending on the visitor's timezone — this avoids that entirely).
  function parseDateInput(str) {
    const [y, m, d] = str.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  // Every preset's `range()` returns { start, end } as Date objects, where
  // `end` is an EXCLUSIVE upper bound (start of the day after the last
  // included day) — this makes every downstream comparison a simple `>=`/`<`.
  const PRESETS = [
    { id: "today",     label: "اليوم",           chip: "Today",     range: () => { const s = startOfDay(new Date()); return { start: s, end: addDays(s, 1) }; } },
    { id: "yesterday", label: "أمس",             chip: "Yesterday", range: () => { const s = addDays(startOfDay(new Date()), -1); return { start: s, end: addDays(s, 1) }; } },
    { id: "last7",     label: "آخر 7 أيام",      chip: "7D",        range: () => { const e = addDays(startOfDay(new Date()), 1); return { start: addDays(e, -7), end: e }; } },
    { id: "last30",    label: "آخر 30 يوم",      chip: "30D",       range: () => { const e = addDays(startOfDay(new Date()), 1); return { start: addDays(e, -30), end: e }; } },
    { id: "last90",    label: "آخر 90 يوم",      chip: "90D",       range: () => { const e = addDays(startOfDay(new Date()), 1); return { start: addDays(e, -90), end: e }; } },
    { id: "thisMonth", label: "هذا الشهر",       range: () => { const s = startOfMonth(new Date()); return { start: s, end: addDays(startOfDay(new Date()), 1) }; } },
    { id: "lastMonth", label: "الشهر الماضي",    range: () => { const now = new Date(); const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = startOfMonth(now); return { start: s, end: e }; } },
    { id: "thisYear",  label: "هذه السنة",       range: () => { const s = startOfYear(new Date()); return { start: s, end: addDays(startOfDay(new Date()), 1) }; } },
  ];
  const QUICK_CHIPS = ["today", "yesterday", "last7", "last30", "last90"];

  let state = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (raw && raw.preset === "custom" && raw.start && raw.end) {
        return { preset: "custom", start: raw.start, end: raw.end };
      }
      if (raw && PRESETS.some((p) => p.id === raw.preset)) return { preset: raw.preset };
    } catch (e) { /* ignore malformed storage */ }
    return { preset: "last30" };
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable — range still works for this page load */ }
  }

  // Returns { id, label, start, end, previous: { start, end } } for whatever
  // is currently selected. `previous` is the immediately preceding period of
  // equal length, used for "vs previous period" comparisons everywhere.
  function getCurrent() {
    let start, end, label, id = state.preset;
    if (state.preset === "custom") {
      start = parseDateInput(state.start);
      end = addDays(parseDateInput(state.end), 1);
      label = `${state.start} → ${state.end}`;
    } else {
      const preset = PRESETS.find((p) => p.id === state.preset) || PRESETS[3];
      id = preset.id;
      ({ start, end } = preset.range());
      label = preset.label;
    }
    const duration = end.getTime() - start.getTime();
    const previous = { start: new Date(start.getTime() - duration), end: new Date(start.getTime()) };
    return { id, label, start, end, previous };
  }

  // Convenience predicates used by every page when filtering rows client-side.
  function within(dateStr, range) {
    if (!dateStr) return false;
    const t = new Date(dateStr).getTime();
    return t >= range.start.getTime() && t < range.end.getTime();
  }
  function inCurrent(dateStr) { return within(dateStr, getCurrent()); }
  function inPrevious(dateStr) { return within(dateStr, getCurrent().previous); }

  // Splits a range into chart-friendly buckets: daily if the range spans up
  // to ~3 months, monthly for anything longer (e.g. "This Year") — so no
  // chart ever tries to render 365 daily bars.
  function buckets(range) {
    const spanDays = Math.round((range.end.getTime() - range.start.getTime()) / 86400000);
    const out = [];
    if (spanDays <= 92) {
      let cursor = new Date(range.start);
      while (cursor < range.end) {
        const next = addDays(cursor, 1);
        out.push({ label: cursor.toLocaleDateString("ar-EG", { day: "numeric", month: "short" }), start: new Date(cursor), end: next });
        cursor = next;
      }
    } else {
      let cursor = startOfMonth(range.start);
      while (cursor < range.end) {
        const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        const bucketStart = cursor < range.start ? range.start : cursor;
        const bucketEnd = next > range.end ? range.end : next;
        out.push({ label: cursor.toLocaleDateString("ar-EG", { month: "short", year: "2-digit" }), start: bucketStart, end: bucketEnd });
        cursor = next;
      }
    }
    return out;
  }

  function setPreset(id) {
    state = { preset: id };
    save(); render(); notify();
  }
  function setCustom(startStr, endStr) {
    if (!startStr || !endStr || startStr > endStr) return;
    state = { preset: "custom", start: startStr, end: endStr };
    save(); render(); notify();
  }
  function notify() {
    window.dispatchEvent(new CustomEvent("boteradaterangechange", { detail: getCurrent() }));
  }

  // ---- widget rendering -----------------------------------------------------
  function render() {
    const root = document.getElementById("dateRangeRoot");
    if (!root) return;
    const current = getCurrent();

    const chips = root.querySelector("#dateRangeChips");
    if (chips) {
      chips.innerHTML = QUICK_CHIPS.map((id) => {
        const preset = PRESETS.find((p) => p.id === id);
        return `<button type="button" class="daterange-chip ${current.id === id ? "active" : ""}" data-chip="${id}">${preset.chip}</button>`;
      }).join("");
      chips.querySelectorAll("[data-chip]").forEach((btn) => btn.addEventListener("click", () => setPreset(btn.dataset.chip)));
    }

    const labelEl = root.querySelector("#dateRangeLabel");
    if (labelEl) labelEl.textContent = current.label;

    const panel = root.querySelector("#dateRangePanel");
    if (panel && !panel.dataset.built) {
      panel.dataset.built = "true";
      panel.innerHTML = `
        <div class="daterange-presets">
          ${PRESETS.map((p) => `<button type="button" class="daterange-option" data-preset="${p.id}">${p.label}</button>`).join("")}
        </div>
        <div class="daterange-custom">
          <div class="daterange-custom-title">فترة مخصّصة</div>
          <div class="daterange-custom-row">
            <label class="form-label" for="dateRangeStart">من</label>
            <input class="form-input" type="date" id="dateRangeStart">
          </div>
          <div class="daterange-custom-row">
            <label class="form-label" for="dateRangeEnd">إلى</label>
            <input class="form-input" type="date" id="dateRangeEnd">
          </div>
          <button type="button" class="btn" id="dateRangeApply" style="width:100%;margin-top:var(--space-2);">تطبيق</button>
        </div>`;
      panel.querySelectorAll("[data-preset]").forEach((btn) => btn.addEventListener("click", () => { setPreset(btn.dataset.preset); closePanel(); }));
      panel.querySelector("#dateRangeApply").addEventListener("click", () => {
        setCustom(panel.querySelector("#dateRangeStart").value, panel.querySelector("#dateRangeEnd").value);
        closePanel();
      });
    }
    if (panel) {
      panel.querySelectorAll("[data-preset]").forEach((btn) => btn.classList.toggle("active", btn.dataset.preset === current.id));
      if (state.preset === "custom") {
        panel.querySelector("#dateRangeStart").value = state.start;
        panel.querySelector("#dateRangeEnd").value = state.end;
      }
    }
  }

  function closePanel() { document.getElementById("dateRangePanel")?.classList.add("hidden"); }
  function togglePanel() { document.getElementById("dateRangePanel")?.classList.toggle("hidden"); }

  function init() {
    const root = document.getElementById("dateRangeRoot");
    if (!root) return; // page has no date-range widget (none currently, but safe to skip)
    root.innerHTML = `
      <div class="daterange-chips" id="dateRangeChips"></div>
      <div class="daterange-picker">
        <button type="button" class="daterange-trigger" id="dateRangeTrigger">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          <span id="dateRangeLabel"></span>
          <svg class="daterange-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="daterange-panel hidden" id="dateRangePanel"></div>
      </div>`;
    document.getElementById("dateRangeTrigger").addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });
    document.addEventListener("click", (e) => { if (!root.contains(e.target)) closePanel(); });
    render();
  }

  return { init, getCurrent, inCurrent, inPrevious, within, buckets };
})();
