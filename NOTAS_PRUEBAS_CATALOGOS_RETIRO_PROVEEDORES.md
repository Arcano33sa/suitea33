# NOTAS DE PRUEBAS — Catálogos — Retiro seguro de Proveedores

Fecha y hora de entrega: 22/06/2026 14:12

## Cambios aplicados
- Se retiró la pestaña visible Proveedores de Catálogos.
- Se retiró el panel visible de Proveedores, sus formularios y sus modales.
- Se desactivó la inicialización de Proveedores en Catálogos para no abrir ni operar `finanzasDB.suppliers` desde este módulo.
- Se quitó Proveedores / Productos de proveedor de la exportación JSON personalizada.
- Se ajustó el texto del Home y del encabezado de Catálogos para listar únicamente Productos, Envases, Tapas, Extras, Bancos y Clientes.
- Se actualizó cache/versionado de Catálogos para forzar refresco PWA.

## Seguridad
- No se borraron datos antiguos de proveedores.
- No se limpió localStorage.
- No se limpió IndexedDB.
- No se tocó Finanzas, POS, Inventario, Calculadoras, Lotes ni Planificación de Pedidos.
- El respaldo completo puede conservar datos antiguos; solo se retiraron las opciones visibles del JSON personalizado.

## Pruebas realizadas
- `node --check catalogos/script.js` correcto.
- `node --check configuracion/script.js` correcto.
- Verificación HTML: Catálogos conserva pestañas Productos, Envases, Tapas, Extras, Bancos y Clientes.
- Verificación HTML: ya no existen `tab-proveedores`, `panel-proveedores` ni modales `cat-supplier-*`.
- Verificación JSON personalizado: Catálogos ya no lista Proveedores ni Productos de proveedor.
