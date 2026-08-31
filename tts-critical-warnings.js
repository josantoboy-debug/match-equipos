(() => {
  'use strict';

  const VERSION = '20260831-critical4';
  const WARNING_TEXT = 'Precaución. Guarda el registro antes de iniciar otra sesión.';
  const NEW_SESSION_SELECTORS = Object.freeze(['#newSessionBtn', '#equipmentNewSessionBtn']);

  function announceNewSessionWarning() {
    window.MatchVoiceTTS?.announce?.(WARNING_TEXT, {
      priority:'critical',
      interrupt:true,
      dedupeMs:4000,
      key:'critical:new-session-save-warning'
    });
  }

  function bind() {
    let found = 0;
    for (const selector of NEW_SESSION_SELECTORS) {
      const button = document.querySelector(selector);
      if (!button) continue;
      found += 1;
      if (button.dataset.ttsCriticalWarningBound === '1') continue;
      button.dataset.ttsCriticalWarningBound = '1';
      button.addEventListener('click', announceNewSessionWarning, {capture:true});
    }
    return found === NEW_SESSION_SELECTORS.length;
  }

  function watch() {
    if (bind()) return;
    const observer = new MutationObserver(() => {
      if (bind()) observer.disconnect();
    });
    observer.observe(document.documentElement, {childList:true, subtree:true});
    setTimeout(() => observer.disconnect(), 15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch, {once:true});
  else watch();
  document.addEventListener('operator:login', () => setTimeout(watch, 0));

  window.MatchCriticalWarnings = {
    version:VERSION,
    warningText:WARNING_TEXT,
    selectors:[...NEW_SESSION_SELECTORS],
    bind,
    announceNewSessionWarning
  };
})();