# Suite A33 Finanzas — Multibanco y Multimoneda — Etapa 4/10

## Cambios aplicados

- Finanzas lee el tipo de cambio vigente desde la configuración central de Moneda (`suite_a33_currency_settings_v1` / `A33Currency`).
- Se agregó una referencia visual informativa de T/C en la parte superior de Finanzas y dentro de Cuentas Financieras.
- El T/C se muestra como solo lectura; la fuente oficial sigue siendo Configuración → Moneda.
- Se agregaron helpers internos seguros para:
  - obtener moneda base y secundaria,
  - validar T/C vigente,
  - convertir USD → C$ con 2 decimales,
  - detectar cuándo un movimiento requiere T/C,
  - preparar snapshot conceptual del T/C para movimientos USD futuros.
- Si no existe T/C válido, Finanzas muestra advertencia suave y no inventa valores ni usa 1.00.
- Se expuso `window.A33FinanzasCurrency` como capa interna para etapas posteriores.

## No tocado por diseño

- No se modificó Diario y Ajustes para multimoneda completa.
- No se modificaron Transferencias internas.
- No se modificó Compras ni Compras a Proveedor.
- No se modificó Recibos.
- No se modificó Caja Chica.
- No se recalcularon históricos, saldos, cierres ni movimientos anteriores.
- No se creó ninguna ruta Firebase ni se tocó la sincronización.

## Validaciones técnicas realizadas

- `node --check finanzas/script.js` sin errores.
- `node --check assets/js/a33-release.js` sin errores.
- Revisión por grep: no se crearon rutas nuevas tipo `tipoCambioFinanzas`, `financialExchangeRate` ni equivalentes.
- Se bumpó release global a `4.20.77 r29` y query string de Finanzas para evitar caché viejo.
