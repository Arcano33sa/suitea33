# Suite A33 — JSON Personalizado — Etapa 1/4

Fecha y hora de entrega: 22/06/2026 08:24

## Cambios
- Se mantuvo intacta la exportación completa existente.
- Se agregó botón “Exportar respaldo personalizado” en Configuración → Respaldo.
- Se agregó modal A33 con checks por módulo y submódulo.
- Se agregó selección principal por módulo con estado completo/parcial.
- Se genera JSON parcial con metadata clara: backupType, exportMode, módulos, submódulos, módulos parciales y origen.
- Se bloquea la importación del JSON parcial en el importador completo actual, para no confundir respaldo parcial con respaldo completo.

## Verificaciones técnicas realizadas
- `node --check configuracion/script.js` sin errores.
- Confirmado botón de respaldo completo existente.
- Confirmado nuevo botón de respaldo personalizado.
- Confirmada metadata `backupType: partial` y `exportMode: custom`.
- Confirmada validación para no exportar selección vacía.
- Confirmado rechazo de respaldo parcial en importación completa actual.
