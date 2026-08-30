(() => {
  'use strict';

  const previousFetch = window.fetch.bind(window);
  let bootstrapped = null;
  let centralOperators = [];

  function getSelect() {
    return document.querySelector('#operatorSelect');
  }

  function reconcileCentralOperators() {
    if (bootstrapped !== true || !centralOperators.length) return;
    const select = getSelect();
    if (!select) return;

    const current = select.value;
    const active = centralOperators
      .filter(operator => operator && operator.id && operator.name && operator.active !== false)
      .slice()
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'es'));

    if (!active.length) return;

    const existing = [...select.options];
    const alreadyCentral = existing.length === active.length && existing.every((option, index) => {
      const operator = active[index];
      return option.value === operator.id && option.dataset.cloudCentral === 'true';
    });

    if (!alreadyCentral) {
      const fragment = document.createDocumentFragment();
      active.forEach(operator => {
        const option = document.createElement('option');
        option.value = operator.id;
        option.textContent = `${operator.name}${operator.role === 'admin' ? ' · Admin' : ''}`;
        option.dataset.cloudCentral = 'true';
        fragment.appendChild(option);
      });
      select.replaceChildren(fragment);
    }

    if (active.some(operator => operator.id === current)) select.value = current;

    const loginButton = document.querySelector('#operatorLoginBtn');
    if (loginButton) loginButton.disabled = false;

    const loginBox = document.querySelector('#operatorLoginBox');
    const createBox = document.querySelector('#operatorCreateBox');
    loginBox?.classList.remove('hidden');
    createBox?.classList.remove('open');
  }

  function publishState(data) {
    if (typeof data?.bootstrapped !== 'boolean') return;
    bootstrapped = data.bootstrapped;
    centralOperators = Array.isArray(data.operators) ? data.operators : [];
    window.__MATCH_CLOUD_BOOTSTRAPPED__ = bootstrapped;
    window.__MATCH_CLOUD_OPERATORS__ = centralOperators.map(operator => ({
      id: operator?.id,
      name: operator?.name,
      role: operator?.role,
      active: operator?.active !== false
    }));

    setTimeout(reconcileCentralOperators, 0);
    setTimeout(reconcileCentralOperators, 80);
    setTimeout(reconcileCentralOperators, 300);
  }

  window.fetch = async function centralOperatorFetch(input, init) {
    const response = await previousFetch(input, init);
    const url = typeof input === 'string' ? input : String(input?.url || input || '');
    if (url.includes('/rpc/core_list_operators_service')) {
      response.clone().json().then(publishState).catch(() => {});
    }
    return response;
  };

  const observer = new MutationObserver(() => {
    if (bootstrapped === true) reconcileCentralOperators();
  });

  if (document.documentElement) {
    observer.observe(document.documentElement, {childList: true, subtree: true});
  }
})();
