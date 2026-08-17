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
      script.src = `${src}?v=20260817-authfix`;
      script.dataset.ordersEditorSrc = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function boot(){
    if(loaded || booting) return;
    booting = true;
    try {
      const profile = window.AuthStore?.get?.()?.profile || await window.useAuth?.ensureAuthenticated?.({ requiredPermission: "can_view_orders" });
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
