# Suite A33 Finanzas — Multibanco / Multimoneda — Etapa 1/10

## Alcance aplicado
- Se agregó capa interna de compatibilidad financiera legacy para centralizar Caja general 1100, Caja eventos 1110 y Banco 1200.
- Se prepararon helpers internos para cuentas de caja, banco, cuenta legacy, moneda base NIO y normalización NIO/USD.
- Se reemplazaron usos rígidos en tablero/flujo, movimiento manual, compras y cierres POS por helpers equivalentes.
- No se crearon cuentas multibanco nuevas.
- No se implementó captura multimoneda real.
- No se tocaron históricos ni se recalcularon journalEntries / journalLines.
- Cuenta 1200 Banco permanece como legacy histórica.

## Blindaje
- Finanzas mantiene C$ / NIO como moneda contable base.
- Configuración → Moneda solo queda como referencia ya existente; no se alteró su lógica.
- Firebase, syncQueue y rutas de sincronización no fueron modificadas.
- Pestaña Proveedores no se reintrodujo en Finanzas.

## Validación técnica ejecutada
- node --check finanzas/script.js
- node --check catalogos/script.js
- node --check pos/app.js
- node --check configuracion/script.js
- node --check assets/js/a33-release.js

Resultado: sin errores de sintaxis.
