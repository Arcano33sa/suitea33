# Suite A33 — Respaldo JSON Personalizado — Etapa 3/4

## Cambios aplicados
- La importación ahora detecta respaldo completo, parcial personalizado y completo legacy sin backupType.
- Los respaldos parciales muestran resumen previo con tipo, fecha, módulos incluidos, submódulos incluidos, eventos POS incluidos y módulos no incluidos.
- La importación parcial fusiona IndexedDB por ID mediante put sobre stores incluidos, sin borrar stores ni módulos no incluidos.
- La importación parcial fusiona localStorage incluido; cuando detecta JSON compatible, mezcla objetos y arreglos por ID para reducir riesgo de duplicados.
- Los respaldos completos mantienen el comportamiento de reemplazo completo y confirmación fuerte.
- Se agregó registro simple de última importación / archivo / bitácora local tras una importación exitosa.
- El acceso antiguo de Respaldo en el menú raíz redirige al módulo Configuración para usar el importador actualizado.

## Validaciones estáticas realizadas
- `node --check configuracion/script.js`
- `node --check assets/js/a33-release.js`
- Validación sintáctica de scripts inline en `index.html` y `configuracion/index.html`.
- Revisión de textos antiguos que bloqueaban respaldos parciales.

## Reglas conservadas
- No se agregaron dependencias.
- No se agregó backend ni Firebase.
- No se toca POS operativo, Finanzas operativo, Calculadora ni Lotes fuera del flujo de importación.
- El respaldo completo histórico sigue siendo aceptado como completo legacy.
