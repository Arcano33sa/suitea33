# E5.1 — Confirmación de escrituras y revisiones

Objetivo: evitar confirmar guardado completo cuando falla la escritura de datos o de su revisión en las rutas identificadas. No se implementó recuperación de formularios ni se modificaron reglas de fusión.

## Cambios

- A33Storage.sharedSet y sharedReplaceExact devuelven ok:false cuando falla la revisión. Identifican dataWritten:true y revisionWritten:false, conservan los datos ya escritos y descartan solamente la revisión supuesta de la memoria de la pestaña. No hay rollback ni eliminación de datos persistidos.
- Inventario aplica la misma distinción y no actualiza su base de comparación como si el guardado hubiera terminado. Conserva la comparación y fusión existentes por campos.
- Pedidos comprueba el resultado booleano del almacenamiento alternativo. Una excepción del guardado compartido detiene la operación y muestra aviso, sin volver a escribir mediante una ruta alternativa que pudiera ocultar un resultado parcial.
- El mensaje de guardado parcial indica comprobar los datos antes de reintentar. Los contratos y formatos históricos permanecen iguales; las propiedades nuevas del resultado son aditivas.

## Verificación

- 15 escenarios dirigidos aprobados en a33-guardado-seguro-e51.smoke.cjs. Se ejecuta el código real del servicio compartido con almacenamiento en memoria, y las funciones de Pedidos e Inventario en contextos aislados. Incluye éxito, fallo de datos, fallo de revisión, rechazo booleano, excepción y preservación de bloqueo/fusión por revisiones.
- Smoke funcional de guardado normal, bloqueo por revisión y fusión independiente aprobado dentro de la prueba dirigida.
- Regresión funcional local: 64 aprobadas, 7 fallidas y 15 de navegador no ejecutadas. Los siete nombres y fallos coinciden con los documentados antes de esta etapa: Agenda grouped stage3, Calculadora checklist detalle y etapa1, Catálogos vistas independientes, lot-code stage5 y stage6, POS tarjeta etapa2. No se cambiaron reglas para satisfacerlos.
- tests/runner.spec.cjs aprobado.
- Comprobaciones de sintaxis de los tres archivos JS de aplicación y git diff --check aprobadas.
- No se ejecutaron pruebas en navegador ni se validó visualmente el aviso. Los resultados dirigidos son simulaciones de fallos, sin modificar almacenamiento real.

## Alcance y límites

Archivos de aplicación: assets/js/a33-storage.js, inventario/script.js y pedidos/script.js. Archivos de verificación: prueba dirigida, catálogo y este informe. Sin modificaciones de PWA, Service Workers, cachés, versiones, dependencias, fórmulas, respaldos ni históricos; sin commit ni push.

Las escrituras de datos y revisión siguen siendo operaciones separadas. Un fallo de revisión puede dejar datos aplicados; ahora se informa como guardado incompleto. Esta etapa no ofrece transacción global ni resuelve carreras simultáneas o conflictos del mismo registro. La recuperación del formulario de Pedidos y las otras subetapas permanecen pendientes de autorización.
