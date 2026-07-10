# Suite A33 — Catálogos: edición en ventana para Envases, Tapas, Extras y Bancos

Fecha y hora de entrega: 21/06/2026 21:50

## Cambios aplicados
- Envases: el botón Editar ahora abre ventana/modal propia y ya no carga los datos en el formulario de creación.
- Tapas: el botón Editar ahora abre ventana/modal propia y ya no carga los datos en el formulario de creación.
- Extras: el botón Editar ahora abre ventana/modal propia y ya no carga los datos en el formulario de creación.
- Bancos: el botón Editar ahora abre ventana/modal propia y ya no carga los datos en el formulario de creación.
- Los formularios principales quedaron para agregar nuevos registros.
- Las ventanas de edición tienen Guardar cambios, Cancelar, Cerrar, cierre por clic fuera y cierre con Escape.
- Se mantiene el patrón visual existente de Productos, Clientes y Proveedores.
- No se tocaron POS, Finanzas, Lotes, Calculadoras, datos históricos ni almacenamiento de usuario.
- Se actualizó cache/versionado de Catálogos para reflejar los cambios en PWA.

## Pruebas técnicas
- node --check catalogos/script.js: OK.
- node --check catalogos/sw.js: OK.
- node --check assets/js/a33-release.js: OK.
- Verificación de presencia de modales y botones nuevos en HTML/JS: OK.
