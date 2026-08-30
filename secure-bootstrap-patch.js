(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  let needsBootstrap = null;

  const $ = selector => document.querySelector(selector);
  const normalizeCode = value => String(value ?? '').trim().toUpperCase();

  function getLoginCode() {
    return normalizeCode($('#cloudBootstrapLoginCode')?.value);
  }

  function getCreateCode() {
    return normalizeCode($('#cloudBootstrapCreateCode')?.value);
  }

  function setError(selector, text) {
    const node = $(selector);
    if (node) node.textContent = text || '';
  }

  function mapBootstrapError(code) {
    if (code === 'INVALID_BOOTSTRAP_CODE') return 'Código de activación incorrecto.';
    if (code === 'BOOTSTRAP_CODE_REQUIRED') return 'Ingresa el código de activación inicial.';
    if (code === 'BOOTSTRAP_UNAVAILABLE') return 'La activación inicial ya no está disponible.';
    return null;
  }

  function injectLoginField() {
    if (needsBootstrap !== true || $('#cloudBootstrapLoginWrap')) return;
    const box = $('#operatorLoginBox');
    if (!box) return;
    const actions = box.querySelector('.operator-login-actions');
    if (!actions) return;

    const label = document.createElement('label');
    label.id = 'cloudBootstrapLoginWrap';
    label.innerHTML = `Código de activación inicial
      <input id="cloudBootstrapLoginCode" type="text" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Código de activación">`;
    box.insertBefore(label, actions);

    const note = document.createElement('div');
    note.className = 'operator-login-note';
    note.id = 'cloudBootstrapLoginNote';
    note.textContent = 'Solo se solicita una vez al migrar el primer administrador al registro central.';
    box.insertBefore(note, actions);
  }

  function injectCreateField() {
    if (needsBootstrap !== true || $('#cloudBootstrapCreateWrap')) return;
    const box = $('#operatorCreateBox');
    if (!box) return;
    const actions = box.querySelector('.operator-login-actions');
    if (!actions) return;

    const label = document.createElement('label');
    label.id = 'cloudBootstrapCreateWrap';
    label.innerHTML = `Código de activación inicial
      <input id="cloudBootstrapCreateCode" type="text" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Código de activación">`;
    box.insertBefore(label, actions);

    const note = document.createElement('div');
    note.className = 'operator-login-note';
    note.id = 'cloudBootstrapCreateNote';
    note.textContent = 'Solo se solicita una vez al crear el primer administrador.';
    box.insertBefore(note, actions);
  }

  function removeBootstrapFields() {
    ['#cloudBootstrapLoginWrap', '#cloudBootstrapLoginNote', '#cloudBootstrapCreateWrap', '#cloudBootstrapCreateNote']
      .forEach(selector => $(selector)?.remove());
  }

  function syncFields() {
    if (needsBootstrap === true) {
      injectLoginField();
      injectCreateField();
    } else if (needsBootstrap === false) {
      removeBootstrapFields();
    }
  }

  function scheduleBootstrapError(code) {
    const text = mapBootstrapError(code);
    if (!text) return;
    setTimeout(() => {
      const createOpen = $('#operatorCreateBox')?.classList.contains('open');
      setError(createOpen ? '#operatorCreateError' : '#operatorLoginError', text);
    }, 0);
  }

  async function inspectResponse(response, type) {
    try {
      const data = await response.clone().json();
      if (type === 'list' && typeof data?.bootstrapped === 'boolean') {
        needsBootstrap = !data.bootstrapped;
        queueMicrotask(syncFields);
      }
      if (type === 'bootstrap') scheduleBootstrapError(data?.code);
    } catch {}
  }

  window.fetch = async function secureBootstrapFetch(input, init) {
    let url = typeof input === 'string' ? input : String(input?.url || input || '');
    let nextInput = input;
    let nextInit = init;
    let type = null;

    if (url.includes('/rpc/core_list_operators_service')) {
      type = 'list';
    }

    if (url.includes('/rpc/core_bootstrap_admin_service') && !url.includes('/rpc/core_bootstrap_admin_service_v2')) {
      type = 'bootstrap';
      const body = (() => {
        try { return JSON.parse(init?.body || '{}'); } catch { return {}; }
      })();
      const createOpen = $('#operatorCreateBox')?.classList.contains('open');
      const code = createOpen ? getCreateCode() : getLoginCode();

      url = url.replace('/rpc/core_bootstrap_admin_service', '/rpc/core_bootstrap_admin_service_v2');
      nextInput = typeof input === 'string' ? url : new Request(url, input);
      nextInit = {
        ...(init || {}),
        body: JSON.stringify({...body, p_bootstrap_code: code})
      };
    }

    const response = await nativeFetch(nextInput, nextInit);
    if (type) inspectResponse(response, type);
    return response;
  };

  function requireCode(selector, errorSelector, message) {
    const value = normalizeCode($(selector)?.value);
    if (needsBootstrap !== true || value) return false;
    setError(errorSelector, message);
    $(selector)?.focus();
    return true;
  }

  document.addEventListener('click', event => {
    if (event.target.closest?.('#operatorLoginBtn')) {
      if (requireCode('#cloudBootstrapLoginCode', '#operatorLoginError', 'Ingresa el código de activación inicial.')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
      return;
    }

    if (event.target.closest?.('#operatorCreateBtn')) {
      if (requireCode('#cloudBootstrapCreateCode', '#operatorCreateError', 'Ingresa el código de activación inicial.')) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
      }
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;

    if (event.target?.id === 'operatorPin' && requireCode('#cloudBootstrapLoginCode', '#operatorLoginError', 'Ingresa el código de activación inicial.')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      return;
    }

    if (event.target?.id === 'operatorCreatePin2' && requireCode('#cloudBootstrapCreateCode', '#operatorCreateError', 'Ingresa el código de activación inicial.')) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  }, true);

  const observer = new MutationObserver(syncFields);
  if (document.documentElement) observer.observe(document.documentElement, {childList: true, subtree: true});
})();
