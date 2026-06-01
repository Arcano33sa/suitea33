# Suite A33 — Proveedores Etapa 2/3

## Cambios aplicados

- Finanzas mantiene la lectura de Proveedores desde `finanzasDB.suppliers`, la misma fuente local usada por Gestión Operativa → Catálogos → Proveedores.
- Compras a Proveedor conserva snapshots de proveedor/producto y ahora agrega snapshot de unidades por caja y precio usado.
- Al editar una compra existente, si no se cambia proveedor/producto, se conserva el snapshot histórico ya guardado.
- Si proveedor/producto fue borrado del catálogo, no aparece como opción normal para compras nuevas, pero los históricos conservan datos guardados.
- Compras de planificación/histórico refuerza snapshots de proveedor/producto, precio ref., precio usado y unidades por caja.
- No se agregaron rutas Firebase para Proveedores ni se tocó sincronización de Firebase.
- Bump de release/cache: 4.20.77 r25, Finanzas script r11, Catálogos script r8 / SW r7.

## Validación técnica ejecutada

- `node --check finanzas/script.js`
- `node --check catalogos/script.js`
- `node --check catalogos/sw.js`
- `node --check pos/app.js`
- `node --check configuracion/script.js`
- `node --check assets/js/a33-release.js`
- Grep de rutas Firebase de Proveedores: sin resultados.

## Observación

La limpieza visual final de la administración vieja de Proveedores en Finanzas queda para Etapa 3/3, tal como se acordó para reducir riesgo.
