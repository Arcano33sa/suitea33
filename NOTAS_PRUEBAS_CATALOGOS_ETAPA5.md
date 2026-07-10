# Suite A33 — Catálogos dinámicos — Parte 1/4 Etapa 5/5

Fecha y hora de entrega: 21/06/2026 19:57

## Cambios aplicados

- Se blindó Receta como checkbox independiente de POS.
- Se validó Letra: mayúscula, sin espacios, obligatoria para Receta y única entre productos con Receta marcada.
- Se agregó protección conservadora para evitar cambiar Letra cuando el producto tiene ventas, inventario, lotes o reempaques asociados.
- Se agregó estado visual compacto de producto incompleto para producción futura cuando falten Letra, Envase o Tapa.
- Se mantuvo Envase/Tapa como no obligatorios para compatibilidad, con advertencia visual en productos con Receta incompleta.
- Se reforzó compatibilidad defensiva de productos antiguos y respaldo JSON mediante normalización al cargar Catálogos.
- Se actualizó cache PWA del módulo Catálogos para reflejar script/style nuevos.

## Validación técnica

- `node --check catalogos/script.js`: OK.
- `node --check catalogos/sw.js`: OK.
- No se tocaron Calculadoras, Lotes, POS, Inventario, Finanzas, Caja Chica ni Recibos.
