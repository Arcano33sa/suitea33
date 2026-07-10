# Suite A33 — Catálogos → Costos — Etapa 1/4

Fecha y hora de entrega: 10/07/2026 13:16

## Cambios aplicados
- Se incorporó la tarjeta/pestaña visible Costos en el espacio operativo dejado por Proveedores.
- Se mantuvieron intactos los datos y estructuras históricas de Proveedores; no se reactivó su navegación ni su lógica.
- Se creó la pantalla base Costos con encabezado A33 de Catálogos, título, descripción y tabla preparada para etapas futuras.
- Se agregaron las referencias fijas Vino, Vodka, Jugo, Sirope, Agua pura, Botella, Calcomanía y Total, en el orden acordado.
- Precio y ML son editables únicamente para los cinco líquidos.
- Botella, Calcomanía y Total muestran campos no aplicables bloqueados visualmente.
- Se agregó almacenamiento persistente en la clave `a33_catalog_costos_v1`, compatible con A33Storage y con respaldo localStorage.
- Se agregó botón Guardar con validación de números, negativos y ML igual a cero, permitiendo configuración inicial vacía.
- Se actualizaron revisiones de assets y Service Worker del módulo Catálogos para refresco PWA.

## Pruebas realizadas
- `node --check catalogos/script.js`: correcto.
- `node --check catalogos/sw.js`: correcto.
- Validación HTML: IDs únicos, pestaña/panel Costos únicos y ausencia de accesos Proveedores.
- Validación del orden exacto de las ocho filas fijas.
- Prueba automatizada de lógica: guardado, lectura persistente, restauración de valores, campos vacíos, rechazo de negativos y rechazo de ML igual a cero.
- Verificación estática de cinco campos Precio y cinco campos ML, sin inputs para Botella, Calcomanía ni Total.
- Verificación de que solo se modificaron Catálogos y el cacheado propio del módulo.

## Seguridad
- No se borró ni limpió localStorage.
- No se borraron históricos ni IndexedDB.
- No se modificaron Productos, recetas, Calculadoras, Lotes, Inventario, POS ni Planificación de Pedidos.
- No se agregaron dependencias nuevas.
