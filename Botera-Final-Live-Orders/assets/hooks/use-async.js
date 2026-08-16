// ============================================================================
// hooks/use-async — the loading/empty/error pattern every data section in
// the app follows, in one place:
//   1. show a skeleton immediately
//   2. run the loader
//   3. if it throws → error state
//   4. if the result is "empty" → empty state
//   5. otherwise → hand the data to the page's own render function
// ============================================================================
const useAsync = (function () {
  async function run(container, loader, render, options = {}) {
    const {
      skeletonHeight = "80px",
      skeletonRows = 3,
      isEmpty = (data) => Array.isArray(data) && data.length === 0,
      emptyTitle = "لا توجد بيانات بعد",
      emptyDescription = "",
      errorTitle = "تعذر تحميل البيانات",
    } = options;

    container.innerHTML = skeletonBlock(skeletonHeight, skeletonRows);
    try {
      const data = await loader();
      if (isEmpty(data)) {
        container.innerHTML = emptyState(emptyTitle, emptyDescription);
        return data;
      }
      render(data, container);
      return data;
    } catch (error) {
      const message = isSupabaseConfigured()
        ? "تحقق من اتصالك بالإنترنت وحاول مرة أخرى."
        : "لسه معملتش ربط مشروع Supabase — راجع assets/lib/supabase-client.js.";
      container.innerHTML = errorState(errorTitle, message);
      throw error;
    }
  }
  return { run };
})();
