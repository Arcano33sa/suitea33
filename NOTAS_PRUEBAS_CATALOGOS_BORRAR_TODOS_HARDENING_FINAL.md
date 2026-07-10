# Suite A33 Catálogos — Borrar todos — Hardening final

Fecha: 22/06/2026

Cambios técnicos aplicados:
- Se endureció el borrado de Productos, Extras, Bancos, Proveedores y Productos del proveedor con manejo defensivo de errores.
- Se unificó visualmente Proveedores y Productos del proveedor para usar botón Borrar en estilo peligro.
- POS ahora respeta las marcas de borrado del catálogo para no resembrar productos/bancos base eliminados al abrir el módulo o cuando el catálogo queda con pocos registros.
- Restaurar productos base en POS vuelve a habilitar explícitamente la semilla de productos, como acción voluntaria.
- Exportación JSON personalizada ahora incluye marcas de borrado de Productos, Envases, Tapas/Corchos, Extras, Bancos y Clientes cuando se seleccionan esas partes.
- Se actualizó el cache/versionado del módulo Catálogos para reflejar los cambios en PWA.

Pruebas ejecutadas:
- node --check ejecutado en JS modificados: catalogos/script.js, pos/app.js y configuracion/script.js.
- Revisión estática de flujo de borrado y render posterior en Catálogos, incluyendo Productos, Envases, Tapas/Corchos, Extras, Bancos, Clientes, Proveedores y Productos del proveedor.
- Revisión de compatibilidad POS/JSON para evitar reaparición de maestros borrados.
