# Suite A33 — POS — Cliente Rápido — Etapa 1/3

## Alcance aplicado
- Botón compacto **Nuevo** junto al selector Cliente.
- Modal centrado con únicamente **Nombre** y **Celular**.
- Nombre obligatorio y Celular opcional.
- Crear verde y Cancelar rojo.
- Creación sobre `a33_pos_customersCatalog`, sin catálogo paralelo.
- Detección de duplicados por nombre normalizado.
- Selección automática del cliente creado o del equivalente ya existente.
- Guardias contra doble apertura, doble envío y listeners duplicados.
- Conservación del formulario de venta: el bloque de cliente rápido no accede a productos, cantidades, descuentos, pago, banco, notas, fecha, evento ni totales.
- Bump local del Service Worker del POS únicamente para servir `index.html`, `styles.css` y `app.js` modificados.

## Validaciones ejecutables
```bash
node --check pos/app.js
node --check pos/sw.js
node tests/a33-pos-cliente-rapido-etapa1.smoke.cjs
```
