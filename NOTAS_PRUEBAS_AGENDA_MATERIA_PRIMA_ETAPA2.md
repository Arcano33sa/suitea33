# Suite A33 — Catálogos — Etapa 2/3 — Materia Prima

- Nueva sección **Materia Prima** dentro de Catálogos.
- Inicio vacío, sin artículos precargados.
- Operaciones: agregar, editar, activar e inactivar.
- Unidades limitadas a Unidad, Cajas, Litros y Galones.
- Fuente central `window.A33Materials` preparada para Agenda → Compras.
- Store IndexedDB `a33-pos/rawMaterials`, con esquema compartido coherente en v37.
- Respaldo JSON completo y exportación personalizada integrados.
- JSON actual probado en exportación/importación; JSON antiguo probado dejando Materia Prima vacía.
- Sincronización Firebase preparada en `catalogos/materia_prima` y reglas actualizadas.
- Smoke test aprobado: alta, edición, estados, doble toque, servicio de activos, fotografía de precio, responsive iPad/móvil, PWA, POS y consola sin errores de aplicación.
