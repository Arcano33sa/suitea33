# Suite A33 POS — Costos, descuentos, cortesías y utilidad dinámica — Etapa 5/6

Fecha: 21/06/2026 21:26

Cambios aplicados:
- POS guarda snapshot económico ampliado por venta: subtotal, descuento, venta neta, costo unitario, costo total, utilidad y fuente de costo.
- La resolución de costo prioriza Lotes/FIFO si existe costo, luego Reempaque, luego costo del producto en Catálogos y finalmente costos legacy de Calculadora para presentaciones conocidas.
- Productos dinámicos sin costo confiable no caen por accidente en Galón/Pulso; quedan con fuente `sin_costo_confiable` y advertencia visible.
- Vaso conserva lógica de producto vendible normal: usa su propio costo si existe y no calcula conversión desde Galón para ventas nuevas.
- Finanzas usa cuentas genéricas para productos dinámicos desconocidos en vez de mapearlos a Galón.
- Cierres/resúmenes diarios incluyen costos guardados de productos dinámicos por productId/snapshot, no solo presentaciones legacy.
- Exportación de ventas toma costo desde snapshot económico defensivo.
- Cache/versión POS actualizada para reflejar app.js nuevo.

Validaciones realizadas:
- node --check pos/app.js
- node --check pos/sw.js
- node --check assets/js/a33-release.js
