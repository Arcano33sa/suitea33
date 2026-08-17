/* Suite A33 — Navegación global compacta entre módulos. */
(function (g) {
  'use strict';

  const MODULES = Object.freeze([
    { id: 'produccion', label: 'Producción', href: '/calculadora/index.html' },
    { id: 'lotes', label: 'Lotes', href: '/lotes/index.html' },
    { id: 'inventario', label: 'Inventario', href: '/inventario/index.html' },
    { id: 'pos', label: 'POS', href: '/pos/index.html' },
    { id: 'analitica', label: 'Analítica', href: '/analitica/index.html' },
    { id: 'pedidos', label: 'Pedidos', href: '/pedidos/index.html' },
    { id: 'finanzas', label: 'Finanzas', href: '/finanzas/index.html' },
    { id: 'catalogos', label: 'Catálogos', href: '/catalogos/index.html' },
    { id: 'agenda', label: 'Agenda', href: '/agenda/index.html' },
    { id: 'centro-mando', label: 'CdM', href: '/centro-mando/index.html' },
    { id: 'configuracion', label: 'Config.', href: '/configuracion/index.html' },
    { id: 'temporal', label: 'Temporal', href: '/calculadora_temporal/index.html' }
  ]);

  const CONTEXTS = Object.freeze({
    configuracion: {
      rootLabel: 'Configuración',
      panelSelector: '.cfg-panel-view[data-panel]',
      backSelector: '[data-cfg-back]'
    },
    catalogos: {
      rootLabel: 'Catálogos',
      panelSelector: '.cat-panel[data-panel]',
      backSelector: '[data-cat-back]'
    },
    agenda: {
      rootLabel: 'Agenda',
      panelSelector: '#agendaOperationalView, #agendaPurchasesView',
      backSelector: '[data-agenda-back]'
    }
  });

  function contextLabel(panel) {
    if (!panel) return '';
    const labelledBy = panel.getAttribute('aria-labelledby');
    const labelSource = labelledBy ? document.getElementById(labelledBy) : null;
    const explicit = labelSource && labelSource.querySelector('strong, .cfg-tab-title');
    if (explicit && explicit.textContent) return explicit.textContent.trim();
    if (panel.id === 'agendaPurchasesView') return 'Compras';
    if (panel.id === 'agendaOperationalView') {
      const agendaTitle = panel.querySelector('#agenda-title');
      if (agendaTitle && agendaTitle.textContent) return agendaTitle.textContent.trim();
    }
    return String(panel.dataset.panel || '').replace(/-/g, ' ').replace(/^./, function (letter) {
      return letter.toUpperCase();
    });
  }

  function initContext(header, contextId) {
    const definition = CONTEXTS[contextId];
    if (!definition) return;

    const bar = document.createElement('div');
    bar.className = 'a33-context-bar';
    bar.hidden = true;
    bar.setAttribute('aria-label', 'Navegación interna');

    const back = document.createElement('button');
    back.className = 'a33-context-back';
    back.type = 'button';
    back.textContent = '← ' + definition.rootLabel;

    const label = document.createElement('span');
    label.className = 'a33-context-label';

    bar.appendChild(back);
    bar.appendChild(label);
    header.appendChild(bar);

    function activePanel() {
      return Array.from(document.querySelectorAll(definition.panelSelector)).find(function (panel) {
        return !panel.hidden && panel.getAttribute('aria-hidden') !== 'true';
      }) || null;
    }

    function syncContext() {
      const panel = activePanel();
      const active = Boolean(panel);
      const shouldHide = !active;
      if (bar.hidden !== shouldHide) bar.hidden = shouldHide;
      header.classList.toggle('has-a33-context', active);
      document.body.classList.toggle('a33-has-module-context', active);
      const nextLabel = active ? contextLabel(panel) : '';
      if (label.textContent !== nextLabel) label.textContent = nextLabel;
    }

    back.addEventListener('click', function () {
      const panel = activePanel();
      const sourceBack = panel && panel.querySelector(definition.backSelector)
        ? panel.querySelector(definition.backSelector)
        : document.querySelector(definition.backSelector);
      if (sourceBack && typeof sourceBack.click === 'function') sourceBack.click();
    });

    const observer = new MutationObserver(syncContext);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden'],
      childList: true,
      characterData: true
    });
    syncContext();
  }

  function init(header) {
    if (!header || header.dataset.a33ModuleNavReady === '1') return;

    const currentId = String(header.dataset.a33Module || '').trim();
    if (!currentId) return;

    const title = header.querySelector('.a33-title');
    const version = header.querySelector('.a33-version');
    const oldMenu = header.querySelector('.a33-btn-menu');
    if (!title || !oldMenu) return;

    header.dataset.a33ModuleNavReady = '1';
    header.classList.add('a33-header--module-nav');
    document.body.classList.add('a33-has-module-nav');
    oldMenu.textContent = '⌂ Inicio';
    oldMenu.setAttribute('aria-label', 'Ir al Menú principal');

    const controls = document.createElement('div');
    controls.className = 'a33-module-controls';

    const toggle = document.createElement('button');
    toggle.className = 'a33-module-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Módulos');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-haspopup', 'true');
    toggle.innerHTML = '<span>Módulos</span><span class="a33-module-chevron" aria-hidden="true">▾</span>';

    const panelId = 'a33-module-panel';
    const panel = document.createElement('nav');
    panel.className = 'a33-module-panel';
    panel.id = panelId;
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Módulos de Suite A33');
    toggle.setAttribute('aria-controls', panelId);

    MODULES.forEach(function (module) {
      const link = document.createElement('a');
      link.className = 'a33-module-link';
      link.href = module.href;
      link.textContent = module.label;
      link.dataset.a33ModuleTarget = module.id;
      if (module.id === currentId) {
        link.classList.add('is-current');
        link.setAttribute('aria-current', 'page');
      }
      panel.appendChild(link);
    });

    function setOpen(open, options) {
      const shouldOpen = Boolean(open);
      panel.hidden = !shouldOpen;
      header.classList.toggle('is-module-nav-open', shouldOpen);
      toggle.setAttribute('aria-expanded', String(shouldOpen));
      const chevron = toggle.querySelector('.a33-module-chevron');
      if (chevron) chevron.textContent = shouldOpen ? '▴' : '▾';
      if (!shouldOpen && options && options.restoreFocus) toggle.focus();
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    panel.addEventListener('click', function (event) {
      if (event.target.closest('.a33-module-link')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setOpen(false, { restoreFocus: true });
      }
    });

    document.addEventListener('pointerdown', function (event) {
      if (toggle.getAttribute('aria-expanded') === 'true' && !header.contains(event.target)) {
        setOpen(false);
      }
    });

    controls.appendChild(toggle);
    if (version) controls.appendChild(version);
    header.appendChild(controls);
    header.appendChild(panel);
    initContext(header, String(header.dataset.a33Context || '').trim());

    function syncHeaderHeight() {
      document.documentElement.style.setProperty('--a33-module-header-height', header.offsetHeight + 'px');
    }

    syncHeaderHeight();
    if (typeof ResizeObserver === 'function') {
      const headerObserver = new ResizeObserver(syncHeaderHeight);
      headerObserver.observe(header);
    } else {
      g.addEventListener('resize', syncHeaderHeight, { passive: true });
    }
  }

  function initAll() {
    document.querySelectorAll('.a33-header[data-a33-module]').forEach(init);
  }

  g.A33ModuleNav = Object.assign({}, g.A33ModuleNav || {}, {
    modules: MODULES,
    init: initAll
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll, { once: true });
  } else {
    initAll();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
