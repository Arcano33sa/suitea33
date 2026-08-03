# Suite A33 — POS — Vasos — Etapa 1/4 — Contrato seguro

- Campo persistente nuevo en Productos: `vasoFisicoId`.
- Referencia manual y opcional al `id` estable de una línea existente de Inventario Varios.
- No existe asociación automática por nombre, mayúsculas, tildes, espacios ni IDs predefinidos.
- No se modifica `arcano33_inventario`, stock, ventas, cortesías, anulaciones ni Reempaque.
- Si la línea asociada ya no existe, el ID se conserva y se muestra como asociación no encontrada hasta que el usuario la cambie o quite.
- JSON completo mantiene compatibilidad porque Productos se respalda como registros íntegros de IndexedDB y el inventario como documento íntegro de localStorage.
- Catálogos PWA: index r33, CSS r24, script r36, manifest r13, SW r8, cache m40.
