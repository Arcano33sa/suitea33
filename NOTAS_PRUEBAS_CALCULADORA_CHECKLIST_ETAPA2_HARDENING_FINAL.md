# Suite A33 — Calculadora de Producción — Checklist — Etapa 2/2

- Persistencia integrada dentro de cada lote mediante `checklistProduccion` (schema 1).
- Recuperación automática de casillas al volver a seleccionar el lote.
- Cambio entre lotes sin compartir ni mezclar estados.
- Histórico refrescado después de guardar una producción.
- Vista responsive sin scroll horizontal general; tablas adaptadas a tarjetas en iPad vertical y móvil.
- Release global 4.20.94 r1; referencias de assets, manifest y Service Worker actualizadas.
- Service Worker de Calculadora usa caché de módulo m4 y elimina únicamente cachés obsoletos de Calculadora.
- No se agregaron claves paralelas ni se alteraron Inventario, Producción, Firebase, JSON o datos históricos.
