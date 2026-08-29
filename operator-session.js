(() => {
  'use strict';

  const APP_VERSION = '1.0.0';
  const loaded = new Map();

  window.OperatorSession = {
    getCurrentOperator: () => window.ProductionCore?.AuthService?.operator || null,
    saveNow: () => window.ProductionCore?.SyncService?.flush?.(),
    logout: () => window.ProductionCore?.AuthService?.logout?.(),
    nextExportName: (kind = 'EXPORT', ext = 'xlsx') => {
      const name = window.ProductionCore?.AuthService?.operator?.name || 'OPERADOR';
      const safe = String(name).toUpperCase().replace(/[^A-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'OPERADOR';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      return `${safe}_${String(kind).toUpperCase()}_${stamp}.${ext}`;
    }
  };

  function addHeadMetadata() {
    if (!document.querySelector('link[rel="manifest"]')) {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = `manifest.json?v=${APP_VERSION}`;
      document.head.appendChild(manifest);
    }
    if (!document.querySelector('link[rel="icon"]')) {
      const icon = document.createElement('link');
      icon.rel = 'icon'; icon.type = 'image/svg+xml'; icon.href = `icon.svg?v=${APP_VERSION}`;
      document.head.appendChild(icon);
    }
  }

  function loadScript(src) {
    if (loaded.has(src)) return loaded.get(src);
    const promise = new Promise((resolve, reject) => {
      if ([...document.scripts].some(script => script.src && script.src.includes(src))) { resolve(); return; }
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
    loaded.set(src, promise);
    return promise;
  }

  function renderVersion() {
    const meta = document.querySelector('.app-footer .footer-meta');
    if (meta && !meta.querySelector('[data-app-version]')) {
      const dot = document.createElement('span'); dot.setAttribute('aria-hidden','true'); dot.textContent = '·';
      const version = document.createElement('span'); version.dataset.appVersion = APP_VERSION; version.textContent = `v${APP_VERSION}`;
      const button = meta.querySelector('#creditsBtn');
      if (button) { meta.insertBefore(dot, button); meta.insertBefore(version, button); }
      else { meta.append(dot, version); }
    }
    const credits = document.querySelector('.credits-joint');
    if (credits && !credits.textContent.includes('Versión')) credits.textContent = `${credits.textContent.trim()} · Versión ${APP_VERSION}`;
    const footnote = document.querySelector('.footnote');
    if (footnote) footnote.textContent = 'Supabase es la fuente central. El navegador conserva caché y cambios pendientes para continuar temporalmente sin conexión.';
  }

  async function bootProductionRuntime() {
    addHeadMetadata();
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.4');
      await loadScript(`config.js?v=${APP_VERSION}`);
      await loadScript(`production-core.js?v=${APP_VERSION}`);
      await loadScript(`cloud-session.js?v=${APP_VERSION}`);
      await loadScript(`app-integration.js?v=${APP_VERSION}`);
      renderVersion();
      document.dispatchEvent(new CustomEvent('production:loader-ready'));
    } catch (error) {
      console.error('Production runtime failed to load', error);
      let banner = document.getElementById('productionLoaderError');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'productionLoaderError';
        banner.setAttribute('role','alert');
        banner.style.cssText = 'position:fixed;inset:auto 12px 12px 12px;z-index:9000;padding:11px 13px;border:1px solid #ef4444;border-radius:10px;background:#220b0b;color:#fecaca;font:600 12px/1.35 system-ui;text-align:center';
        document.body.appendChild(banner);
      }
      banner.textContent = 'No se pudo iniciar la sincronización segura. La aplicación conserva los datos locales; recarga cuando tengas conexión.';
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootProductionRuntime, { once:true });
  else bootProductionRuntime();
})();
