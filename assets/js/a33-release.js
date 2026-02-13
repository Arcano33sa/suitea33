// Suite A33 — Release/Rev (fuente única)
// Compatible: window/globalThis + Service Worker (self/globalThis)
(function (g) {
  'use strict';

  const suiteVersion = '4.20.77';
  const rev = 1;
  const revLabel = `r${rev}`;
  const label = `${suiteVersion} ${revLabel}`;

  const release = {
    suiteVersion,
    rev,
    revLabel,
    label
  };

  // Global single source of truth
  g.A33_RELEASE = release;

  // Minimal helper (para uso futuro; no cambia UI en esta etapa)
  g.A33_getReleaseLabel = function () {
    try {
      return (g.A33_RELEASE && g.A33_RELEASE.label) ? String(g.A33_RELEASE.label) : '';
    } catch (_) {
      return '';
    }
  };

  // UI helper: versión visible arriba (si existe en el DOM)
  // - Lee A33_RELEASE.label
  // - Si no existe A33_RELEASE, deja el valor anterior (fallback)
  // - Si el valor anterior es vacío/placeholder, usa '4.20.77 r1' como último recurso
  g.A33_applyReleaseLabel = function () {
    try {
      if (typeof document === 'undefined' || !document || !document.querySelectorAll) return;

      const fromRelease = (g.A33_RELEASE && g.A33_RELEASE.label) ? String(g.A33_RELEASE.label) : '';
      const lastResort = '4.20.77 r1';

      const isPlaceholder = (t) => {
        const s = (t || '').toString().trim().toLowerCase();
        return !s || s === 'v...' || s === '...' || s === 'v…' || s === '…' || s === 'v..' || s === '..' || s === 'v';
      };

      const apply = (el) => {
        if (!el) return;
        const fallback = (el.getAttribute && el.getAttribute('data-a33-fallback')) || (el.textContent || '');
        const fb = (fallback || '').toString().trim();
        const hasV = fb.startsWith('v');
        const prefix = hasV ? 'v' : '';

        if (fromRelease) {
          el.textContent = prefix + fromRelease;
          return;
        }

        if (!isPlaceholder(fb)) {
          // mantener valor anterior
          el.textContent = fb;
          return;
        }

        // último recurso
        el.textContent = prefix + lastResort;
      };

      // Preferir elementos marcados explícitamente
      document.querySelectorAll('[data-a33-version]')
        .forEach((el) => { try { apply(el); } catch (_) {} });

      // Compat: módulos legacy que no estén marcados (seguro: solo si no tienen hijos)
      document.querySelectorAll('.cmd-version, .fin-version')
        .forEach((el) => { try { apply(el); } catch (_) {} });

      document.querySelectorAll('.a33-version')
        .forEach((el) => {
          try {
            if (el && el.children && el.children.length) return; // no romper contenedores
            // Si ya fue marcado, ya pasó por arriba
            if (el && el.hasAttribute && el.hasAttribute('data-a33-version')) return;
            apply(el);
          } catch (_) {}
        });
    } catch (_) {
      // silencioso
    }
  };

  // Auto-apply (sin tocar layout)
  try {
    if (typeof document !== 'undefined' && document) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
          try { g.A33_applyReleaseLabel(); } catch (_) {}
        }, { once: true });
      } else {
        g.A33_applyReleaseLabel();
      }
    }
  } catch (_) { }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
