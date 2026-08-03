# Suite A33 — POS — Inventario — Lotes cargados — Etapa 2/3

Fecha de cierre: 02/08/2026 19:12

## Cambios
- Tabla histórica con columnas fijas Código y Fecha.
- Letras dinámicas obtenidas únicamente de la Letra almacenada en cada movimiento de carga.
- Una Letra nueva se agrega al final sin reordenar las ya existentes.
- Registros sin Letra histórica permanecen visibles sin conversión ni recálculo.
- Scroll horizontal contenido dentro de la tabla para muchas Letras.
- Caché PWA POS coordinada a módulo m48.

## Blindajes
- Sin consulta a Productos/Catálogos para reconstruir Letras históricas.
- Sin derivación por nombre de producto.
- Sin modificación de Inventario, Reversar asignación ni Crear lote sobrante.
- Sin mutación o conversión de registros históricos.

## Pruebas
- node --check: 75 archivos JS/CJS sin errores de sintaxis.
- Smoke Etapa 1 separación segura: OK.
- Smoke Agregar desde lote / contenido por Letras: OK.
- Smoke Etapa 2 Letras dinámicas: OK.
- Casos cubiertos: Letra nueva, históricos, registro legacy sin Letra, reverso, muchas cargas y 30 Letras.
- PWA: manifest, start_url, precache, revisiones de assets y cache m48 coordinados.
- Regresión amplia: 18 pruebas pasan y 15 pruebas legacy fallan por expectativas antiguas ya presentes en la base; la base original registró 17 aprobadas y las mismas 15 fallas. No se agregó ninguna falla nueva.
