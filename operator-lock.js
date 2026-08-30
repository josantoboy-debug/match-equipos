(() => {
  'use strict';

  const targets = () => [
    document.querySelector('header.topbar'),
    document.querySelector('main.app'),
    ...[...document.querySelectorAll('body > .modal')].filter(node => node.id !== 'operatorLock'),
    document.querySelector('#toast')
  ].filter(Boolean);

  function ensureLoginInteractive() {
    const lock = document.querySelector('#operatorLock');
    if (!lock) return;

    // The login overlay must NEVER inherit the application's locked state.
    lock.inert = false;
    lock.removeAttribute('inert');
    lock.removeAttribute('aria-hidden');
    lock.style.pointerEvents = 'auto';
    lock.style.touchAction = 'manipulation';

    lock.querySelectorAll('button,input,select,label').forEach(node => {
      node.inert = false;
      node.removeAttribute('inert');
      node.style.pointerEvents = 'auto';
      if (node.matches('button,input,select')) node.style.touchAction = 'manipulation';
    });
  }

  function setLocked(locked) {
    targets().forEach(node => {
      node.inert = !!locked;
      if (locked) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    });

    document.body.classList.toggle('operator-access-locked', !!locked);
    ensureLoginInteractive();
  }

  function bootLock() {
    setLocked(!window.OperatorSession?.getCurrentOperator?.());
    ensureLoginInteractive();

    // Some mobile browsers apply inert/layout state one frame later.
    requestAnimationFrame(ensureLoginInteractive);
    setTimeout(ensureLoginInteractive, 100);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootLock, {once: true});
  } else {
    bootLock();
  }

  document.addEventListener('operator:login', () => setLocked(false));
})();