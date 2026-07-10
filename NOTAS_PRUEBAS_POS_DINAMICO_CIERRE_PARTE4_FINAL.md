# Suite A33 POS Dinámico — Parte 4/4 Etapa 6/6

## Cambios principales
- Cierres diarios POS reforzados con métricas dinámicas: venta bruta, descuentos, venta neta, costos, utilidad, cortesías y devoluciones.
- CostBreakdown del cierre conserva productId/nombre snapshot de productos dinámicos y legacy.
- Resumen/Tablero POS usa nombre snapshot en agregaciones por producto, descuentos y cortesías.
- Finanzas: importación de cierres POS evita mapear productos dinámicos desconocidos como Galón; usa cuentas genéricas/posteables para inventario/costo cuando no hay presentación legacy reconocida.
- Exportaciones/eventos/cortes siguen leyendo nombre y precio snapshot, sin depender de nombres quemados.
- PWA POS: cache bump final para reflejar app.js, index, manifest y release central.

## Guardas preservadas
- No se borran ventas, productos, lotes, inventario, históricos, localStorage ni IndexedDB.
- No se cambia la versión de IndexedDB porque no se agregan stores ni índices.
- No se agregan dependencias, backend ni Firebase.
