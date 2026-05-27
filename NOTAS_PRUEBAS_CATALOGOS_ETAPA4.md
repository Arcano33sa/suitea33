# Suite A33 — Catálogos Etapa 4/4

## Cambios aplicados
- Planificación de Pedidos lee precios actuales desde Catálogos/POS con selección canónica por presentación.
- Se corrigió la prioridad de duplicados legacy para evitar que Galón tome C$800 cuando existe Galón canónico activo.
- Agenda/Pedidos lee productos activos desde Catálogos/POS, deduplica por presentación y conserva snapshots de pedidos previos.
- Agenda/Pedidos ya no usa precios fallback inventados si Catálogos no tiene productos disponibles.
- Reempaque usa productos maestros activos y canónicos para evitar duplicados en selectores.
- Se mantiene Finanzas separada de productos de venta; no se tocaron productos de proveedor ni reglas contables.
- Se hizo bump de release/cache a 4.20.77 r13 para evitar PWA sirviendo archivos viejos.

## Validación técnica local
- node --check OK en POS, Pedidos, Agenda, Catálogos, release y Service Workers tocados.
- POS no contiene pestaña Productos en la tabbar.
- Finanzas no contiene exportaciones TXT/CSV dentro del módulo.
