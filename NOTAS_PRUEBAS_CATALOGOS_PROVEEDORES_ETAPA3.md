# Suite A33 — Proveedores Etapa 3/3

## Cambios aplicados
- Finanzas deja de mostrar CRUD duplicado de Proveedores.
- Finanzas mantiene una vista informativa con acceso a Gestión Operativa → Catálogos → Proveedores.
- Compras a Proveedor conserva consumo desde la fuente compatible de Catálogos/Finanzas.
- Selectores de compras nuevas priorizan proveedores disponibles y evitan duplicados visuales evidentes sin borrar datos.
- Snapshots de compras se preservan para proveedor/producto/tipo/precio/unidades cuando existen.
- Catálogos puede abrir directamente la pestaña Proveedores usando `#proveedores`.
- No se agregó ruta Firebase para Proveedores.

## Pruebas técnicas realizadas
- `node --check finanzas/script.js`
- `node --check catalogos/script.js`
- `node --check assets/js/a33-release.js`
- Parse HTML básico de `finanzas/index.html` y `catalogos/index.html`
- Grep de ruta Firebase `catalogos/proveedores` sin resultados.
