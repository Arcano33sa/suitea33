# Suite A33 Finanzas — Tablero Operativo Etapa 4/5

## Cambios
- Menú principal: el acceso de Diario Contable fue reemplazado por Tablero Finanzas.
- Finanzas: navegación normal limitada a Tablero Finanzas, Caja Chica y Recibos.
- Diario Contable, Estados Financieros, Catálogo de Cuentas, Compras y Compras a Proveedor quedan ocultos del flujo normal sin borrar código ni datos.
- Rutas/hash legacy de vistas ocultas caen de forma segura al Tablero operativo.
- Centro de Mando: bloque/chip de Compras oculto del uso normal; deep-link redirige seguro al Tablero.
- Texto visible de Finanzas ajustado a enfoque operativo, no contabilidad formal.
- Bump global de versión/cache/query string a 4.20.83 r1.

## Pruebas estáticas realizadas
- node --check finanzas/script.js
- node --check centro-mando/app.js
- node --check pos/app.js
- Validación de pestañas visibles en Finanzas: Tablero Finanzas, Caja Chica, Recibos.
- Validación de pestañas ocultas: Diario Contable, Estados Financieros, Compras, Catálogo de Cuentas.
- Validación de menú principal sin enlace normal a #tab=diario.
- Validación de Centro de Mando con Compras oculto.

## Reglas respetadas
- No se borraron históricos.
- No se limpió localStorage.
- No se tocó Firebase.
- No se agregaron dependencias nuevas.
- No se eliminó lógica legacy de forma agresiva.
