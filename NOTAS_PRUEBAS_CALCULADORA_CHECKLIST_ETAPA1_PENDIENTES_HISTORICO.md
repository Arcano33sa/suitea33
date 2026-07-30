# Suite A33 — Calculadora de Producción — Checklist — Etapa 1/3

## Cambios aplicados
- Se agregó la sección **Pendientes** encima de **Histórico**.
- Los lotes sin marca explícita de cierre permanecen en Pendientes, incluso si todos sus checkbox están marcados.
- Pendientes conserva Fecha, Lote, Volumen y Acción con botón **Usar**.
- Histórico conserva Fecha, Lote, Volumen y Acción con botón **Ver** para registros cerrados explícitamente.
- Los checklist históricos se cargan en modo consulta, con checkbox deshabilitados.
- Fecha, Lote, Volumen, Acción y encabezados quedan centrados.
- Los lotes largos permiten ajuste interno sin provocar scroll horizontal general.
- Se mantuvo intacta la lógica de producción, inventario, recetas, lotes, consecutivos, Calculadora Temporal, POS, Finanzas, Centro de Mando, Firebase y JSON.
- Se incrementó únicamente la revisión de caché del módulo Calculadora para servir el HTML modificado en PWA.

## Smoke test automatizado
- `tests/a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs`
- Resultado: **PASS 27/27 controles**.
- Sintaxis del JavaScript inline de Calculadora: válida.
- Sintaxis del Service Worker de Calculadora: válida.
- Regresión POS Efectivo/CDM: PASS 33/33.
- Selector GLOBAL/Evento CDM: PASS.

## Alcance de esta etapa
- No se implementó botón **Hecho**.
- No se cierra ningún checklist automáticamente.
- No se modifican los checkbox ni los datos productivos de los registros pendientes.
