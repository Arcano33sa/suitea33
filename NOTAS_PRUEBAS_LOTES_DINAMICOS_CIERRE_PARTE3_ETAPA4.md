# Suite A33 — Lotes dinámicos — Cierre Parte 3 / Etapa 4

## Cambios técnicos
- Se agregó contrato defensivo de salida para POS desde Lotes mediante `salidaPOS`, `contratoPOS` y `disponibilidadPOS`.
- La salida preparada trabaja por `productId` e incluye `nombreSnapshot`, `Letra`, lote origen, fecha, cantidad producida, disponibilidad cuando existe y costo solo cuando ya viene guardado como snapshot.
- Se conserva compatibilidad con P/M/D/L/G y con `remainingByKey` usado por eventos/sobrantes/FIFO actuales.
- Se agregó API defensiva `window.A33LotesPOSContract` para consumo futuro en Parte 4 / POS.
- Se reforzó normalización compartida de `productosProducidos` para conservar `productId` aunque venga como `productoId` o `id` en respaldos.
- Se actualizó cache/query de Lotes para reflejar archivos nuevos.

## Reglas respetadas
- No se modificó `pos/app.js`.
- No se tocó lógica de venta POS.
- No se tocaron cierres POS, Finanzas, Caja Chica ni Recibos.
- No se borran datos, históricos, lotes, inventario, localStorage ni IndexedDB.

## Pruebas realizadas
- `node --check lotes/script.js`
- `node --check assets/js/a33-storage.js`
- `node --check pos/app.js`
- Verificación de hash: `pos/app.js` quedó idéntico al ZIP base recibido.
- Smoke de contrato POS: producto dinámico por `productId`, legacy P/M/D/L/G y remanente `remainingByKey`.
