# Suite A33 Finanzas — Multibanco y Multimoneda — Etapa 3/10

## Cambios aplicados

- Se agregó la sección Finanzas → Cuentas Financieras.
- Se creó la store local IndexedDB `financialAccounts` dentro de `finanzasDB`.
- Se inicializan cuentas financieras base para:
  - Caja general C$
  - Caja general US$
  - Caja eventos C$
  - Caja eventos US$
- Se leen bancos desde Gestión Operativa → Catálogos → Bancos (`a33-pos.banks`) sin crear un CRUD paralelo en Finanzas.
- Para cada banco activo se prepara representación C$ y US$.
- Cada cuenta financiera permite ver y guardar:
  - tipo caja/banco
  - banco asociado si aplica
  - moneda
  - cuenta contable asociada
  - estado activa/inactiva
- La cuenta 1200 Banco se mantiene como legacy/histórica y no se usa como mapeo bancario nuevo por defecto cuando existen cuentas específicas.

## No tocado por diseño

- No se modificó Diario y Ajustes.
- No se modificó Compras.
- No se modificó Compras a Proveedor.
- No se modificó Recibos.
- No se modificó Caja Chica.
- No se modificaron históricos, saldos, cierres ni movimientos.
- No se agregó ninguna ruta Firebase.
- No se implementó todavía T/C por movimiento.
- No se implementaron todavía transferencias internas.

## Validaciones técnicas realizadas

- `node --check finanzas/script.js` sin errores.
- Revisión por grep: `financialAccounts` solo quedó en Finanzas local; no se agregó ruta Firebase.
- Se bumpó cache/rev de archivos modificados de Finanzas y release global.
