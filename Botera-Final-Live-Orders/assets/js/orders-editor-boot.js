(function bootOrdersEditor(){
  const editorSrc = "assets/js/orders-editor.js";
  const safetySrc = "assets/js/orders-editor-modal-fix.js";
  let loaded = false;
  let booting = false;

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const existing = document.querySelector(`script[data-orders-editor-src="${src}"]`);
      if(existing){ resolve(); return; }
      const script = document.createElement("script");
      script.src = `${src}?v=20260817-editor-v2`;
      script.dataset.ordersEditorSrc = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function getProfile(){
    try {
      const stored = AuthStore?.get?.()?.profile || null;
      if (stored) return stored;
    } catch {
      // Continue to the authenticated lookup below.
    }

    try {
      if (typeof useAuth !== "undefined" && typeof useAuth.ensureAuthenticated === "function") {
        return await useAuth.ensureAuthenticated({ requiredPermission: "can_view_orders" });
      }
    } catch (error) {
      console.error("Botera Orders auth bootstrap failed:", error);
    }

    return null;
  }

  async function boot(){
    if(loaded || booting) return;
    booting = true;
    try {
      const profile = await getProfile();
      if(!profile){
        booting = false;
        setTimeout(boot,250);
        return;
      }

      window.__boteraLiveProfile = profile;
      await loadScript(editorSrc);
      await loadScript(safetySrc);
      loaded = true;
    } catch(error) {
      console.error("Botera Orders editor boot failed:", error);
      booting = false;
      setTimeout(boot,1000);
    }
  }

  if(document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once:true });
  } else {
    boot();
  }
})();
