# Suite A33 — Configuración → PWA — Etapa 1/1

## Cambios aplicados
- Mensaje integrado neutral, verde y rojo con texto explícito, roles accesibles y compatibilidad claro/oscuro.
- Separación estricta entre Última búsqueda y Última actualización.
- Confirmación de instalación y activación por cada Service Worker pendiente.
- `controllerchange` exigido únicamente cuando el alcance del SW controla la página actual.
- Resultado de actualización persistido temporalmente en `sessionStorage` y verificado después de la recarga.
- Bloqueo contra doble clic, listeners duplicados y recargas repetidas.
- Service Workers modulares permanecen en `waiting` durante actualizaciones y solo usan `skipWaiting` automático en la primera instalación.
- Versión global actualizada a 4.20.92 r1; cachés y parámetros de assets renovados.

## Validaciones estáticas y smoke test automatizado
- Sintaxis JavaScript validada con Node.
- Estructura HTML/CSS del mensaje verificada.
- Registros PWA, estados, claves de sesión y textos requeridos verificados.
- Service Workers revisados para no ejecutar `skipWaiting` automático en actualizaciones.
- Archivos ZIP completos e integridad comprobada.

## Pruebas que requieren despliegue real
La detección de una versión remota, el fallo de red real, `controllerchange` y el comportamiento de PWA instalada dependen del navegador y del hosting. El código incluye manejo explícito para esos escenarios, pero su confirmación final debe realizarse al publicar esta versión.
