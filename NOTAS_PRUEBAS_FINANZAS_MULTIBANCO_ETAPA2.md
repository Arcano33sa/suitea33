# Suite A33 Finanzas — Multibanco / Multimoneda — Etapa 2/10

## Alcance aplicado
- Se amplió el catálogo contable base para Caja general C$, Caja general US$, Caja eventos C$ y Caja eventos US$.
- Se conservó la cuenta 1200 como Banco legacy / histórico, protegida y compatible con movimientos anteriores.
- Se agregó metadata interna de moneda, rol financiero, cuenta de caja/banco y etapa multibanco sin migrar journalEntries ni journalLines.
- Se preparó lectura segura de Catálogos → Bancos desde la base `a33-pos` para generar cuentas contables por banco y moneda cuando existan bancos activos.
- No se creó catálogo paralelo de bancos dentro de Finanzas.
- No se modificaron formularios de registro, Compras, Recibos, POS, Caja Chica, Configuración → Moneda ni Firebase.

## Cuentas base
- 1100 — Caja general C$
- 1105 — Caja general US$
- 1110 — Caja eventos C$
- 1115 — Caja eventos US$
- 1200 — Banco legacy / histórico

## Bancos desde Catálogos
Cuando Catálogos → Bancos tenga bancos activos, Finanzas prepara cuentas protegidas por banco y moneda, por ejemplo:
- Banco / BAC C$
- Banco / BAC US$

La generación es idempotente y se basa únicamente en lectura segura de los bancos maestros existentes.

## Blindaje
- No se migraron históricos.
- No se reclasificaron saldos.
- No se recalcularon cierres POS, compras, recibos ni asientos.
- Los cálculos de Caja + Banco reconocen las nuevas cuentas financieras sin romper 1100, 1110 ni 1200.
- Finanzas mantiene C$ / NIO como moneda contable base.

## Validación técnica ejecutada
- node --check finanzas/script.js
- node --check catalogos/script.js
- node --check pos/app.js
- node --check configuracion/script.js
- node --check assets/js/a33-release.js

Resultado: sin errores de sintaxis.
