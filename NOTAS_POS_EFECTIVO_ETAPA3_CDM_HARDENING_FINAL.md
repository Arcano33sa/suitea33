# Suite A33 — POS / Efectivo / Centro de Mando — Etapa 3/3

- Centro de Mando consume ventas al crédito y cobros desde las tiendas canónicas `sales` y `cashV2`.
- Indicador integrado dentro de Atención requerida, con vista por evento y GLOBAL sin duplicados.
- Detalle compacto: cliente, fecha, evento, producto/referencia, original, cobrado, saldo y estado derivado.
- Pagos completos salen de pendientes; abonos conservan el saldo actualizado.
- Señal automática POS → Centro de Mando mediante evento local, `storage` y `BroadcastChannel`; no guarda saldos alternos.
- Refresco defensivo visible cada 15 segundos y al volver a foco, útil para reversiones históricas o cambios externos.
- Responsive reforzado para desktop, iPad horizontal/vertical y móvil, sin scroll horizontal general.
- Versión general actualizada a 4.20.97; cachés y referencias POS/CDM incrementadas.
- Sin cambios en fórmulas, inventario, producción, calculadoras, lotes, catálogos, Agenda, Pedidos, Firebase ni JSON.
