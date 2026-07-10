# Suite A33 POS — Filtro de productos vendibles desde Catálogos — Etapa 1

Fecha y hora de entrega: 21/06/2026 21:07

## Cambios aplicados

- POS ahora filtra productos de venta usando Activo + POS marcado.
- Receta no se usa como filtro de venta.
- Vaso puede venderse aunque no tenga Receta, siempre que POS esté marcado.
- Productos nuevos con POS marcado aparecen en POS.
- Productos nuevos sin POS marcado no aparecen automáticamente.
- Productos internos, envases, botellas, tapas y corchos sin POS marcado quedan fuera del selector/listado de venta.
- Se mantuvo compatibilidad segura para productos legacy conocidos: Pulso, Media, Djeba, Litro, Galón y Vaso.
- Se actualizó el cache busting local del POS para app.js e index.html.

## Alcance preservado

- No se cambiaron descuentos.
- No se cambiaron costos.
- No se cambiaron cierres.
- No se cambió Finanzas.
- No se cambió Caja Chica.
- No se cambió Recibos.
- No se cambió lógica profunda de inventario.
- No se borraron productos, ventas, lotes, históricos ni datos locales.

## Pruebas realizadas

- node --check pos/app.js
- node --check pos/sw.js
- node --check catalogos/script.js
- node --check lotes/script.js
- Prueba lógica estática del filtro Activo + POS con casos Pulso, Vaso, Catrina, Botella Catrina, Corcho Catrina, Galón legacy y producto inactivo.

Resultado: OK.
