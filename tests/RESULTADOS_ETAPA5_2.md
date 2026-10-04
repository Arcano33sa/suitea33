# E5.2 — Cola de texto del Checklist POS

## Objetivo y alcance

Conservar los cambios pendientes ante fallos de guardado, confirmar al completar IndexedDB y permitir reintento. Se modificó solamente la lógica de texto del Checklist y su render en pos/app.js, más pruebas, catálogo e informe. Las modificaciones anteriores de E5.1 siguen pendientes de commit; no forman parte de E5.2.

## Cambios

- Cada edición pendiente conserva evento, sección, identificador y texto. Cambiar de evento no puede reasignar la cola al evento nuevo.
- La cola y lastSaved se actualizan solamente después de completar la transacción. Un éxito de solicitud seguido de aborto no confirma guardado.
- La lectura y actualización de texto ocurren en una transacción readwrite del almacén events. Se modifica la plantilla del evento leído en esa transacción; no se cambian ventas, caja, inventario ni otros almacenes.
- La confirmación elimina exclusivamente las ediciones del lote confirmado. Una nueva edición del mismo campo recibida durante el guardado permanece pendiente y obtiene un guardado posterior.
- Ante error se conserva el lote pendiente y se muestra aviso con instrucciones de reintento. Las rutas existentes de blur, change, debounce y ciclo de vida pueden reintentar. No hay bucle automático de reintentos ante fallo persistente.
- Un render superpone el texto pendiente del evento correspondiente sobre el texto persistido. Las reglas previas de normalización de texto vacío se conservan.
- Evento o ítem no encontrado produce fallo visible y conserva pendientes; no se borran ni recrean automáticamente registros.

## Verificación

- Prueba dirigida VM: 11 escenarios aprobados, incluyendo aborto posterior a escritura, fallo de lectura/apertura, evento/ítem ausente, evento no identificado, reintento, edición durante guardado, separación entre eventos y normalización/no-op.
- Chrome: fallo simulado, render de texto pendiente y reintento exitoso usando IndexedDB real, contexto temporal y origen localhost aleatorio. No se utilizó almacenamiento real del usuario.
- Hallazgo de alcance: pos/index.html vigente no monta los contenedores del Checklist heredado. La prueba de render usa contenedores DOM temporales en la página de prueba; no demuestra un flujo accesible de Checklist en la interfaz actual. No se añadió pantalla ni navegación a POS.
- Regresión funcional local: 65 aprobadas, los mismos 7 fallos anteriores y 16 pruebas de navegador omitidas en esa ejecución. La prueba Chrome nueva se ejecutó y aprobó por separado; las otras 15 no se repitieron.
- Sintaxis de pos/app.js, tests/runner.spec.cjs y git diff --check aprobados.
- Diff revisado: no se modificaron helpers genéricos put, PWA, Service Workers, cachés, versiones, dependencias ni fórmulas. Sin commit ni push.

## Limitaciones

La cola sigue en memoria: cerrar o recargar pierde los pendientes no guardados. Los eventos de salida siguen siendo best-effort. No se implementó recuperación persistente ni resolución general de conflictos entre pestañas. Cada evento se confirma por separado: si falla un lote posterior, los anteriores ya confirmados permanecen guardados. Otros escritores históricos del evento siguen usando sus mecanismos existentes; no se afirma protección global contra todos sus conflictos.
