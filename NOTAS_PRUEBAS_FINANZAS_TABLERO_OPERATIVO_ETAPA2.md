# Suite A33 Finanzas — Tablero Operativo Etapa 2/5

## Alcance cerrado

- Normalización operativa preparada para movimientos manuales de Recibos y Efectivo/POS cashV2.
- Clasificaciones compatibles:
  - Ingreso Adicional
  - Gasto
  - Entrada de efectivo / fondo
  - Salida de efectivo / retiro
- Fondos y retiros quedan preparados como movimientos de flujo/caja/bancos, sin sumarse/restarse a utilidad.
- Ingresos Adicionales y Gastos quedan marcados para alimentar utilidad en la Etapa 3.
- Históricos se leen de forma defensiva; no se borran, no se migran masivamente y no se recalculan.
- Recibos conserva folios, borradores, emisión, impresión, historial y exportación.
- POS Efectivo conserva cashV2, conteo físico, cierre y compatibilidad con movimientos legacy IN/OUT/ADJUST.

## Helpers preparados para Etapa 3

- `finGetOperationalReceiptsSource(...)`
- `finGetOperationalManualMovementsSource(...)`
- `finGetOperationalPosCashMovementsSource(...)`
- `finBuildOperationalManualTotals(...)`
- Filtros por mes/año y evento en `finApplyOperationalFilters(...)`.

## Pruebas realizadas en sandbox

- `node --check finanzas/script.js`
- `node --check pos/app.js`
- `node --check pos/sw.js`
- `node --check assets/js/a33-release.js`
- Verificación de bump de versión/cache/release a `4.20.83 r2` para fuente global y query strings principales de Finanzas/POS.
- Verificación de que no se agregaron dependencias nuevas.
- Verificación de empaquetado sin `.git`.

## Observación

Las pruebas visuales reales en iPad/PWA deben confirmarse en dispositivo, porque el sandbox no ejecuta Safari iPad ni la instalación PWA real.
