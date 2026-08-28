(() => {
  'use strict';

  const targets = () => [
    document.querySelector('header.topbar'),
    document.querySelector('main.app'),
    ...document.querySelectorAll('body > .modal'),
    document.querySelector('#toast')
  ].filter(Boolean);

  function setLocked(locked) {
    targets().forEach(node => {
      node.inert = !!locked;
      if (locked) node.setAttribute('aria-hidden', 'true');
      else node.removeAttribute('aria-hidden');
    });
    document.body.classList.toggle('operator-access-locked', !!locked);
  }

  document.addEventListener('DOMContentLoaded', () => {
    setLocked(!window.OperatorSession?.getCurrentOperator?.());
  });

  document.addEventListener('operator:login', () => setLocked(false));
})();