# Suite A33 — POS — Inventario — Lotes cargados — Etapa 3/3

Fecha: 02/08/2026

## Cambios
- Fila TOTALES insertada dinámicamente en THEAD antes del encabezado Código/Fecha/Letras.
- TOTALES ocupa Código + Fecha con colspan=2.
- Suma basada exclusivamente en el modelo normalizado ya usado para renderizar las filas.
- Letras dinámicas e históricas conservadas en el mismo orden.
- Valores no finitos y negativos ignorados; columnas sin cantidad muestran 0.
- Estilo compacto premium claro/oscuro y scroll contenido en la tabla.
- Cache POS actualizado: módulo m49, index r32, styles r24, app r45.

## Pruebas
- node --check: pos/app.js y pos/sw.js OK.
- Smoke de totales: G=3, D=3, C=8, L=2, T=1 OK.
- Casos cero/null/NaN/negativo/conflicto: OK.
- Revisión estructural: una sola función de totales, una sola fila dinámica por id, bloque continúa cerrado por defecto.
