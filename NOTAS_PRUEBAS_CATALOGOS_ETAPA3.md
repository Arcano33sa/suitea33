# Suite A33 — Catálogos Etapa 3/4

Cambios aplicados:
- Catálogos → Extras ahora administra extras maestros con crear/editar/activar/inactivar.
- Catálogos → Bancos ahora administra bancos maestros con tipo, moneda, referencia, comisión y estado.
- POS mantiene extras por evento y permite importar Extras maestros como snapshot del evento activo.
- POS sigue leyendo bancos desde el store maestro compartido `banks`.
- Se agregó store IndexedDB `extras` y se subió `a33-pos` a versión 34.
- Se actualizó cache/versionado local de Catálogos y POS para evitar PWA con archivos viejos.

Validaciones técnicas ejecutadas:
- `node --check catalogos/script.js`
- `node --check pos/app.js`

Regla histórica:
- No se recalculan ventas pasadas, cierres, asientos ni movimientos históricos.
