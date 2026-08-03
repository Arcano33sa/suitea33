# Suite A33 — POS — Inventario — Lotes cargados — Etapa 1/3

## Cambio aplicado
- Separación estructural entre operaciones de lote e histórico de Lotes cargados.
- Reversar asignación, Crear lote sobrante y sus paneles conservan IDs y lógica existentes, fuera del bloque histórico.
- Lotes cargados inicia cerrado y solo contiene encabezado/contador y tabla histórica.
- Apertura/cierre por cualquier parte del encabezado mediante `closest`, sin dependencia directa de `e.target.id`.
- Al salir de Inventario y volver, el bloque inicia cerrado.

## Pruebas ejecutadas
- `node --check pos/app.js`
- `node --check pos/sw.js`
- Smoke específico de separación segura.
- Smoke previo de Agregar desde lote / Contenido por Letras.
- Smoke de disponibilidad de lotes: 11/11.
- Smoke real en Chromium del desplegable: clic en título, indicador y subtítulo; teclado Enter/Espacio; operaciones visibles; reinicio cerrado; 0 errores de página.
- Responsive real en 390x844, 768x1024, 1024x768 y 1440x900: sin scroll horizontal general.
- ZIP validado, comprimido y reabierto.
