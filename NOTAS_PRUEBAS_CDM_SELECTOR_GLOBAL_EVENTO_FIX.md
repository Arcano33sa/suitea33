# Suite A33 — Centro de Mando — Selector GLOBAL / Evento — Fix

Fecha: 27/07/2026

## Cambios verificados

- Sincronización inmediata del valor visible al seleccionar GLOBAL o un evento.
- Limpieza de búsqueda, cierre de lista y `blur` táctil para cerrar teclado.
- Cambio GLOBAL → evento repetido cinco veces.
- Cambio evento → GLOBAL → evento y evento → otro evento.
- Separación intacta entre evento visualizado y evento activo del POS.
- Blindaje contra respuestas asíncronas obsoletas y doble procesamiento.
- Revisión PWA actualizada: app r20, manifest r3 y caché de módulo m3.

## Smoke test

- Todos los smoke tests de Centro de Mando: OK.
- Smoke específico del selector: OK.
- Chromium real en modo headless: OK.
- Emulación táctil: escritorio, iPad horizontal, iPad vertical y móvil: OK.
- Safari/iPad físico y PWA instalada no pueden ejecutarse dentro de este entorno automatizado.
