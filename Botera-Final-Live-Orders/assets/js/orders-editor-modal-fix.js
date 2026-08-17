// Orders editor safety guard: the editor rebuilds the dialog and calls showModal()
// after the initial open. Make only this editor dialog idempotent so a rebuild
// cannot throw InvalidStateError when it is already open.
(function () {
  function patch() {
    const modal = document.getElementById("orderEditorModal");
    if (!modal || modal.__boteraSafeShowModal) return;
    const nativeShowModal = modal.showModal.bind(modal);
    modal.showModal = function () {
      if (modal.open) return;
      nativeShowModal();
    };
    modal.__boteraSafeShowModal = true;
  }

  const observer = new MutationObserver(patch);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("load", patch);
  setTimeout(patch, 100);
  setTimeout(patch, 500);
})();
