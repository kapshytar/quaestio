(function registerAttachFileScript(global) {
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function run() {
    try {
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((el) => !el.disabled);
      if (fileInputs.length > 0) {
        fileInputs[0].click();
        return JSON.stringify({ success: true, mode: 'input-file' });
      }

      const buttons = Array.from(document.querySelectorAll('button,[role="button"],label')).filter(isVisible);
      const attachBtn = buttons.find((el) => {
        const joined = `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.className || ''}`.toLowerCase();
        return joined.includes('attach') || joined.includes('upload') || joined.includes('file');
      });

      if (attachBtn) {
        attachBtn.click();
        return JSON.stringify({ success: true, mode: 'attach-button' });
      }

      return JSON.stringify({ success: false, error: 'Attach control not found' });
    } catch (error) {
      return JSON.stringify({ success: false, error: error?.message || String(error) });
    }
  }

  global.VeritySharedAttachFile = {
    run,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
