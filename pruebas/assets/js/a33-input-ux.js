(() => {
  // Helper público (opcional): marca un input para UX numérica A33.
  // - select-all automático si hay valor
  // - si el valor es 0, limpia al enfocar
  // - si queda vacío al salir, aplica defaultValue
  // Nota: Los listeners abajo hacen el trabajo; esto solo configura el input.
  try {
    window.markA33Num = function markA33Num(input, { defaultValue = '0', mode = 'decimal' } = {}) {
      try {
        if (!input || !(input instanceof HTMLInputElement)) return;
        if (input.readOnly || input.disabled) return;
        input.classList.add('a33-num');
        if (input.dataset) {
          input.dataset.a33Num = '1';
          input.dataset.a33Default = String(defaultValue ?? '0');
        }
        try { input.inputMode = String(mode || 'decimal'); } catch (_) {}
      } catch (_) {}
    };
  } catch (_) {}

  const parseNum = (v) => {
    if (v == null) return NaN;
    const s = String(v).trim().replace(',', '.');
    if (s === '') return NaN;
    return Number(s);
  };

  const shouldHandle = (el) => {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.readOnly || el.disabled) return false;
    return el.classList.contains('a33-num') || (el.dataset && el.dataset.a33Num === '1');
  };

  const getDefault = (el) => (el.dataset && el.dataset.a33Default != null)
    ? String(el.dataset.a33Default)
    : '0';

  const safeSelect = (el) => {
    try {
      requestAnimationFrame(() => {
        try { el.select(); } catch (_) {}
      });
    } catch (_) {
      try { setTimeout(() => { try { el.select(); } catch (_) {} }, 0); } catch (_) {}
    }
  };

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!shouldHandle(el)) return;

    const raw = String(el.value ?? '').trim();
    const n = parseNum(raw);

    if (!Number.isNaN(n) && n === 0) {
      el.value = '';
      return;
    }

    if (raw !== '') safeSelect(el);
  });

  document.addEventListener('focusout', (e) => {
    const el = e.target;
    if (!shouldHandle(el)) return;

    if (String(el.value ?? '').trim() === '') {
      el.value = getDefault(el);
    }
  });
})();
