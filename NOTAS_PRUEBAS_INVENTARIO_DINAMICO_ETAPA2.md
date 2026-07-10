# Suite A33 Inventario Dinámico — Etapa 2/3

Fecha y hora de entrega: 22/06/2026 07:34

## Cambios aplicados

- Inventario permite cargar y ajustar existencias de Envases / Botellas dinámicas leídas desde Catálogos.
- Inventario permite cargar y ajustar existencias de Tapas / Corchos dinámicos leídos desde Catálogos.
- Las entradas, salidas y ajustes por conteo físico de envases/tapas registran movimientos técnicos en `inventario.movimientos`.
- Cada movimiento guarda tipo de item, id del item, nombre snapshot, cantidad, delta, tipo de movimiento, fecha, nota, origen, stock anterior y stock nuevo.
- La carga de envases/tapas no crea producción, no aumenta producto terminado y no toca POS, Finanzas ni Recibos.
- Se mantiene compatibilidad con stock legacy y con claves dinámicas ya existentes.
- Se actualizó la persistencia compartida para conservar movimientos por append y no perder trazabilidad en merges.
- Se actualizó cache/query de Inventario para forzar lectura del script nuevo.

## Pruebas realizadas

- `node --check inventario/script.js`
- `node --check inventario/sw.js`
- `node --check assets/js/a33-storage.js`
- `node --check pos/app.js`
- `node --check lotes/script.js`
- `node --check catalogos/script.js`
- Prueba lógica en Node con catálogos dinámicos:
  - Botella Catrina aparece desde Catálogos.
  - Corcho Catrina aparece desde Catálogos.
  - +50 Botella Catrina guarda stock en `bottles.envase_catrina`.
  - +50 Corcho Catrina guarda stock en `caps.tapa_catrina`.
  - Se registran movimientos de tipo `envase` y `tapa`.
  - Catrina terminada permanece en 0.
- Prueba de merge en `A33Storage`:
  - movimientos existentes se conservan.
  - movimientos nuevos se agregan por id sin duplicar.

## Nota técnica

La prueba con Chromium real quedó bloqueada por política del entorno (`ERR_BLOCKED_BY_ADMINISTRATOR`), por eso se ejecutaron pruebas estáticas y pruebas lógicas en VM Node sobre los archivos reales modificados.
