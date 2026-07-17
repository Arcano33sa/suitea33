# Suite A33 — Código de lote — Etapa 5/6

## Integración aplicada
- Fuente central ampliada con presentación literal, identidad técnica X/x, términos de búsqueda y celda Excel tipo texto.
- Excel de Lotes, POS, Reempaque y Analítica conserva códigos como texto y agrega columnas/ancho para Código de lote.
- Analítica muestra códigos completos por evento, producto y Resumen del período.
- Centro de Mando muestra el último lote asignado por evento.
- JSON completo/parcial declara preservación literal y deduplica por identidad sin recalcular códigos.
- Firebase Realtime Database sincroniza `workspaces/{workspaceId}/lotes`, preservando código, consecutivo numérico y relaciones internas.

## Smoke tests ejecutados
- `node tests/a33-lot-code.smoke.cjs`
- `node tests/a33-lot-code-calculators.smoke.cjs`
- `node tests/a33-lot-code-stage3.smoke.cjs`
- `node tests/a33-lot-code-stage5.smoke.cjs`
- `node --check` sobre todos los archivos JavaScript del proyecto.

## Resultado
- Código nuevo `A33KIS5786-0xx1`: preservado literalmente en JSON y Firebase simulado en dos sesiones.
- Código histórico: preservado literalmente.
- X/x: identidad equivalente sin duplicados; valor visible no se normaliza durante importación/sync.
- Excel: celda `t: "s"`, formato texto `@`.
- Sin migración masiva, sin limpieza de localStorage/IndexedDB/Firebase y sin dependencias nuevas.
- Prueba Firebase live no ejecutada por no disponer de credenciales/sesión remota en el entorno; se validó con mock compatible de Realtime Database.
