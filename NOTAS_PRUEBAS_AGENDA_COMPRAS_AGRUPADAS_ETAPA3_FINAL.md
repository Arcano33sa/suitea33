# Suite A33 — Agenda — Compras agrupadas — Etapa 3/3

## Alcance aplicado

- Calendario `.ics` con un evento por Fecha necesaria y solo compras Pendientes.
- Varias compras agrupadas de una misma fecha combinadas dentro del mismo evento.
- Descripción con compras, artículos, cantidades, unidades, precios históricos, subtotales, notas y presupuesto total por fecha.
- Contrato JSON compatible con compras agrupadas y compras antiguas de un artículo.
- Normalización no destructiva, IDs estables y fusión sin duplicados.
- Resumen de Agenda dentro de respaldo/importación JSON.
- Serialización segura para Firebase/Firestore y reglas compatibles con `purchaseGroup.items`.
- Cache PWA de Agenda actualizado.

## Pruebas ejecutadas

- `node --check agenda/purchases.js`
- `node --check agenda/sw.js`
- `node --check configuracion/script.js`
- `node tests/a33-agenda-purchases-grouped-stage1.smoke.cjs`
- `node tests/a33-agenda-purchases-grouped-stage1-hardening.smoke.cjs`
- `node tests/a33-agenda-purchases-grouped-stage3-final.smoke.cjs`
- Suite completa de pruebas Agenda: OK.

## Resultado

Smoke test final automatizado: **OK (45/45)**.

Los módulos no relacionados permanecen sin modificaciones funcionales. No se agregaron dependencias nuevas ni se borraron datos/históricos.
