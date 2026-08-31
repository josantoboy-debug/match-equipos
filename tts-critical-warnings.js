(() => {
  'use strict';

  const VERSION = '20260831-critical2';
  const WARNING_TEXT = 'Precaución. Asegúrate de guardar o exportar el registro antes de iniciar otra sesión.';

  function announceNewSessionWarning() {
    window.MatchVoiceTTS?.announce?.(WARNING_TEXT, {
      priority:'critical',
      interrupt:true,
      dedupeMs:4000,
      key:'critical:new-session-save-warning'
    });
  }

  function bind() {
    const button = document.querySelector('#equipmentNewSessionBtn');
    if (!button || button.dataset.ttsCriticalWarningBound === '1') return !!button;
    button.dataset.ttsCriticalWarningBound = '1';
    button.addEventListener('click', announceNewSessionWarning, {capture:true});
    return true;
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
  document.addEventListener('operator:login', () => setTimeout(bind, 0));

  window.MatchCriticalWarnings = {version:VERSION, warningText:WARNING_TEXT, bind, announceNewSessionWarning};
})();