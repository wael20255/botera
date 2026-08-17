(function bootOrdersEditor(){
  const editorSrc = "assets/js/orders-editor.js";
  const safetySrc = "assets/js/orders-editor-modal-fix.js";
  let loaded = false;

  function readyProfile(){
    try {
      return window.AuthStore?.get?.()?.profile || null;
    } catch {
      return null;
    }
  }

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const existing = document.querySelector(`script[data-orders-editor-src="${src}"]`);
      if(existing){ resolve(); return; }
      const script = document.createElement("script");
      script.src = src;
      script.dataset.ordersEditorSrc = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(script);
    });
  }

  async function boot(){
    if(loaded) return;
    const profile = readyProfile();
    if(!profile){
      setTimeout(boot,100);
      return;
    }
    window.__boteraLiveProfile = profile;
    loaded = true;
    try {
      await loadScript(editorSrc);
      await loadScript(safetySrc);
    } catch(error) {
      console.error("Botera Orders editor boot failed:", error);
    }
  }

  boot();
})();
