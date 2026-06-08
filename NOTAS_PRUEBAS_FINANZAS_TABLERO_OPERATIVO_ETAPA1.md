# Suite A33 Finanzas — Tablero Operativo Etapa 1/5

## Cambios realizados
- Se agregó el mapa técnico interno `FIN_OPERATIONAL_DASHBOARD_SOURCE_MAP` para documentar fuentes actuales y futuras del Tablero operativo.
- Se agregaron helpers defensivos de lectura para POS, movimientos manuales, Recibos, Caja Chica y Configuración → Moneda.
- `getAllFinData()` ahora adjunta `operationalDashboardSources` como snapshot interno de preparación, sin alterar la UI.
- No se ocultaron módulos pesados y no se rediseñó el Tablero en esta etapa.
- Se hizo bump global de versión a `4.20.83 r1` y query strings/cache asociados.

## Reglas respetadas
- No se borraron históricos.
- No se limpió localStorage.
- No se migraron datos.
- No se tocó Firebase.
- No se agregaron dependencias nuevas.
- No se cambió flujo de POS, Caja Chica/Efectivo ni Recibos.

## Pruebas estáticas realizadas
- `node --check finanzas/script.js`
- `node --check pos/app.js`
- `node --check configuracion/script.js`
- `node --check assets/js/a33-release.js`
- `node --check assets/js/a33-build.js`
- Verificación de ausencia de `.git` y `.DS_Store` en el paquete final.
