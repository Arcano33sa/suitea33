(() => {
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
