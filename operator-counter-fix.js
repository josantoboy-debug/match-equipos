(() => {
  'use strict';

  const APP_KEY = 'matchEquipos.operatorAccess.v1';

  function safeJSON(value, fallback) {
    try {
      const parsed = JSON.parse(value);
      return parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function cleanFilenamePart(value) {
    return String(value ?? '')
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
      .replace(/\.+$/g, '')
      .trim()
      .toUpperCase() || 'OPERADOR';
  }

  function counterKey(operatorId) {
    return `${APP_KEY}.${operatorId}.counters`;
  }

  function normalizedCounters(operatorId) {
    const key = counterKey(operatorId);
    const stored = safeJSON(localStorage.getItem(key), {});
    const counters = {
      REGISTRO: Number.isFinite(Number(stored.REGISTRO)) && Number(stored.REGISTRO) >= 0
        ? Math.floor(Number(stored.REGISTRO))
        : 0,
      BUSQUEDA: Number.isFinite(Number(stored.BUSQUEDA)) && Number(stored.BUSQUEDA) >= 0
        ? Math.floor(Number(stored.BUSQUEDA))
        : 0
    };
    localStorage.setItem(key, JSON.stringify(counters));
    return counters;
  }

  function nextExportName(kind, extension) {
    const session = window.OperatorSession;
    const operator = session?.getCurrentOperator?.();
    if (!operator?.id) return null;

    const safeKind = String(kind || '').toUpperCase();
    if (!['REGISTRO', 'BUSQUEDA'].includes(safeKind)) return null;

    const counters = normalizedCounters(operator.id);
    counters[safeKind] += 1;
    localStorage.setItem(counterKey(operator.id), JSON.stringify(counters));

    const number = String(counters[safeKind]).padStart(3, '0');
    const d = new Date();
    const p = value => String(value).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    const ext = String(extension || '').replace(/^\.+/, '').toLowerCase() || 'txt';

    return `${safeKind} #${number} ${cleanFilenamePart(operator.name)} ${stamp}.${ext}`;
  }

  function installFix() {
    const session = window.OperatorSession;
    if (!session) return false;
    const operator = session.getCurrentOperator?.();
    if (operator?.id) normalizedCounters(operator.id);
    session.nextExportName = nextExportName;
    return true;
  }

  document.addEventListener('DOMContentLoaded', () => {
    installFix();
  });

  document.addEventListener('operator:login', () => {
    installFix();
  });

  window.OperatorCounterFix = {
    install: installFix,
    repairCurrent() {
      const operator = window.OperatorSession?.getCurrentOperator?.();
      return operator?.id ? normalizedCounters(operator.id) : {REGISTRO: 0, BUSQUEDA: 0};
    }
  };
})();