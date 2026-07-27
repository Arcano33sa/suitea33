# Suite A33 — Centro de Mando — Selector GLOBAL / Evento — Fix

Fecha: 27/07/2026

## Cambios verificados

- El selector dejó de ser un campo de escritura y ahora funciona como lista desplegable táctil.
- Al tocar “Evento visualizado” aparecen directamente GLOBAL y todos los eventos disponibles.
- No se abre teclado ni se requiere escribir, borrar o filtrar nombres.
- La lista se despliega dentro del flujo del bloque para evitar que otros bloques oculten eventos en Safari/iPad.
- Selección GLOBAL → evento, evento → GLOBAL y evento → otro evento sin cambiar el evento activo del POS.
- Cierre de lista, liberación de foco y sincronización inmediata del nombre visible.
- Blindaje contra respuestas asíncronas obsoletas y doble procesamiento conservado.
- Revisión PWA actualizada: app r21, estilos r17, manifest r4 y caché de módulo m4.

## Smoke test

- Todos los smoke tests de Centro de Mando Etapas 1 a 5: OK.
- Smoke específico del selector con GLOBAL, Julio 2026 y Agosto 2026: OK.
- Cinco ciclos GLOBAL → evento: OK.
- Separación entre evento visualizado y evento activo del POS: OK.
- Sintaxis JavaScript: OK.
- Safari/iPad físico y PWA instalada requieren validación final en dispositivo real.
