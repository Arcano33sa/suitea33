# Suite A33 — Costos de cortesías — Etapa 2/2

- Lectura central defensiva: `lineCost`, `costTotal`, equivalentes legacy y `costPerUnit × cantidad`.
- Cortesías: ingreso real cero, valor comercial informativo y costo real aplicado una sola vez.
- POS, Resumen, Analítica, Tablero operativo, cierres y exportaciones usan snapshots congelados.
- Históricos sin costo permanecen en cero; no se reconstruyen desde inventario actual.
- PWA: versión global 4.20.91 r2 y cachés de módulos invalidados por versión.
