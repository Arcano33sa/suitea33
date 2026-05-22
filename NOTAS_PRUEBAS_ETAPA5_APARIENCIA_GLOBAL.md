# Suite A33 — Etapa 5/5 Apariencia global

## Cambios visuales
- Se conectó Apariencia global en Finanzas, Calculadora, Calculadora Temporal y alias legacy de Calculadora.
- Se agregó capa visual clara crema/premium para Finanzas: panel, tarjetas, Caja Chica, Diario/Ajustes, tablas, formularios, botones, modales, compras, proveedores y recibos.
- Se agregó capa visual clara crema/premium para Calculadora y Calculadora Temporal: formularios, recetas, cantidades, resultados, botones, historial y modales.
- Se reforzó theme-color dinámico mediante `a33-theme.js` para Oscuro / Claro / Automático.

## PWA / cache
- Se actualizó `A33_RELEASE` a `4.20.77 r7`.
- Se actualizaron query strings de assets a `r7`.
- Se actualizó cache/rev de service workers para forzar refresco de assets visuales.

## Validación disponible ejecutada
- `node --check` en scripts principales y service workers: OK.
- Revisión estática de etiquetas `body` en HTML principales: OK.
- Revisión de balance de llaves CSS en `a33-theme.css` y `finanzas/style.css`: OK.
- Confirmado que todos los `index.html` visibles cargan `a33-theme.js` y la capa CSS global.

## Nota
No se modificó lógica de negocio: cálculos, caja, ventas, inventario, reempaque, bancos, comisiones, recetas, consecutivos, lotes, exportaciones, importaciones, respaldos, Identidad ni actualización central.
