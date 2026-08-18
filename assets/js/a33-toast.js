/* Suite A33 — notificaciones globales de proceso, éxito, advertencia y error. */
(function (g) {
  'use strict';

  const TYPES = Object.freeze(['process', 'success', 'warning', 'error']);
  const DURATIONS = Object.freeze({ process: 0, success: 3000, warning: 4000, error: 5000 });
  const LABELS = Object.freeze({ process: 'En proceso', success: 'Confirmado', warning: 'Advertencia', error: 'Error' });
  const ICONS = Object.freeze({ process: '↻', success: '✓', warning: '!', error: '×' });
  const MAX_VISIBLE = 6;
  const DEDUPE_MS = 900;
  const registry = new Map();
  let sequence = 0;

  function clean(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }

  function normalizeType(value) {
    const raw = clean(value).toLowerCase();
    if (raw === 'ok' || raw === 'confirmado' || raw === 'exito' || raw === 'éxito' || raw === 'info') return 'success';
    if (raw === 'warn' || raw === 'advertencia' || raw === 'pending') return 'warning';
    if (raw === 'loading' || raw === 'processing' || raw === 'proceso') return 'process';
    return TYPES.includes(raw) ? raw : 'success';
  }

  function inferType(message, fallback) {
    const explicit = clean(fallback).toLowerCase();
    if (explicit) return normalizeType(explicit);
    const text = clean(message).toLowerCase();
    if (/\b(error|fall[oó]|inv[aá]lid|no se pudo|bloquead|rechazad|denegad)\b/.test(text)) return 'error';
    if (/\b(advertencia|sin cambios|cancelad|pendiente|sin conexi[oó]n|reintentar)\b/.test(text)) return 'warning';
    if (/\b(guardando|actualizando|verificando|cargando|procesando|importando|exportando|sincronizando|preparando|generando|probando)\b/.test(text) || /…$/.test(text)) return 'process';
    return 'success';
  }

  function updateOffset(region) {
    if (!region || !g.document) return;
    const headers = Array.from(document.querySelectorAll('.a33-header, .app-topbar, .topbar, body > header'));
    let bottom = 0;
    headers.forEach(function (header) {
      try {
        const style = g.getComputedStyle(header);
        if (style.position !== 'fixed' && style.position !== 'sticky') return;
        const rect = header.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top <= 8) bottom = Math.max(bottom, rect.bottom);
      } catch (_) {}
    });
    region.style.setProperty('--a33-toast-top', Math.max(10, Math.ceil(bottom + 10)) + 'px');
  }

  function ensureRegion() {
    if (!g.document || !document.body) return null;
    let region = document.getElementById('a33ToastRegion');
    if (!region) {
      region = document.createElement('div');
      region.id = 'a33ToastRegion';
      region.className = 'a33-toast-region';
      region.setAttribute('role', 'region');
      region.setAttribute('aria-live', 'polite');
      region.setAttribute('aria-label', 'Notificaciones de Suite A33');
      document.body.appendChild(region);
    }
    updateOffset(region);
    return region;
  }

  function setContent(node, message, type) {
    const safeType = normalizeType(type);
    const safeMessage = clean(message) || LABELS[safeType];
    node.className = 'a33-global-toast is-' + safeType;
    node.dataset.toastType = safeType;
    node.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-label', LABELS[safeType] + ': ' + safeMessage);
    node.replaceChildren();

    const icon = document.createElement('span');
    icon.className = 'a33-global-toast__icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ICONS[safeType];

    const content = document.createElement('div');
    content.className = 'a33-global-toast__content';
    const label = document.createElement('strong');
    label.textContent = LABELS[safeType];
    const text = document.createElement('span');
    text.textContent = safeMessage;
    content.append(label, text);
    node.append(icon, content);

    if (safeType === 'process') {
      const activity = document.createElement('span');
      activity.className = 'a33-global-toast__activity';
      activity.setAttribute('aria-hidden', 'true');
      activity.appendChild(document.createElement('span'));
      node.appendChild(activity);
    }
  }

  function dismiss(id, options) {
    const key = clean(id);
    const entry = registry.get(key);
    if (!entry) return false;
    if (entry.timer) g.clearTimeout(entry.timer);
    registry.delete(key);
    if (options && options.immediate) { entry.node.remove(); return true; }
    entry.node.classList.remove('is-visible');
    entry.node.classList.add('is-leaving');
    const remove = function () { try { entry.node.remove(); } catch (_) {} };
    entry.node.addEventListener('transitionend', remove, { once: true });
    g.setTimeout(remove, 260);
    return true;
  }

  function schedule(id, type, options) {
    const entry = registry.get(id);
    if (!entry) return;
    if (entry.timer) g.clearTimeout(entry.timer);
    const requested = Number(options && options.duration);
    const duration = Number.isFinite(requested) && requested >= 0 ? requested : DURATIONS[type];
    entry.timer = duration > 0 ? g.setTimeout(function () { dismiss(id); }, duration) : null;
  }

  function recentDuplicate(signature) {
    const now = Date.now();
    for (const pair of Array.from(registry.entries()).reverse()) {
      if (pair[1].signature === signature && now - pair[1].updatedAt <= DEDUPE_MS) return pair[0];
    }
    return '';
  }

  function replace(id, message, type, options) {
    const key = clean(id);
    const entry = registry.get(key);
    if (!entry) return show(message, type, Object.assign({}, options || {}, { id: key }));
    const safeType = normalizeType(type);
    const safeMessage = clean(message) || LABELS[safeType];
    setContent(entry.node, safeMessage, safeType);
    entry.signature = safeType + '|' + safeMessage;
    entry.updatedAt = Date.now();
    entry.node.classList.remove('is-leaving');
    entry.node.classList.add('is-visible');
    schedule(key, safeType, options || {});
    return key;
  }

  function trim() {
    while (registry.size > MAX_VISIBLE) {
      const entries = Array.from(registry.entries());
      const removable = entries.find(function (pair) { return pair[1].node.dataset.toastType !== 'process'; }) || entries[0];
      if (!removable) return;
      dismiss(removable[0], { immediate: true });
    }
  }

  function show(message, type, options) {
    const region = ensureRegion();
    if (!region) return '';
    const opts = options && typeof options === 'object' ? options : {};
    const safeType = inferType(message, type);
    const safeMessage = clean(message) || LABELS[safeType];
    const signature = safeType + '|' + safeMessage;
    const explicitId = clean(opts.id);
    const duplicate = explicitId ? '' : recentDuplicate(signature);
    if (duplicate) return replace(duplicate, safeMessage, safeType, opts);

    sequence += 1;
    const id = explicitId || 'a33-toast-' + Date.now().toString(36) + '-' + sequence;
    if (registry.has(id)) return replace(id, safeMessage, safeType, opts);
    const node = document.createElement('article');
    node.dataset.toastId = id;
    setContent(node, safeMessage, safeType);
    region.appendChild(node);
    registry.set(id, { node: node, timer: null, signature: signature, updatedAt: Date.now() });
    const reveal = function () { node.classList.add('is-visible'); };
    if (g.requestAnimationFrame) g.requestAnimationFrame(reveal); else g.setTimeout(reveal, 0);
    schedule(id, safeType, opts);
    trim();
    return id;
  }

  function clear() { Array.from(registry.keys()).forEach(function (id) { dismiss(id, { immediate: true }); }); }

  g.A33Toast = Object.freeze({
    show: show,
    inferType: inferType,
    process: function (message, options) { return show(message, 'process', options); },
    success: function (message, options) { return show(message, 'success', options); },
    warning: function (message, options) { return show(message, 'warning', options); },
    error: function (message, options) { return show(message, 'error', options); },
    replace: replace,
    dismiss: dismiss,
    clear: clear
  });

  if (g.addEventListener) {
    g.addEventListener('resize', function () { updateOffset(document.getElementById('a33ToastRegion')); }, { passive: true });
    g.addEventListener('orientationchange', function () { updateOffset(document.getElementById('a33ToastRegion')); }, { passive: true });
    g.addEventListener('pagehide', clear, { once: true });
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
