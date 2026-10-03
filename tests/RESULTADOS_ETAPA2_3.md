# E2.3 — Simuladores compatibles con el runtime actual

Tercera de cuatro subetapas acordadas. Objetivo autorizado: reparar simuladores incompletos conservando las comprobaciones funcionales y el comportamiento de la aplicación.

## Acuerdos y cambios

Se cargan desde el código real las funciones de normalización de Letras, orden de presentaciones y detección de producción independiente. Se incorporan los catálogos de prueba y la clave actual del Checklist de producción. El almacenamiento simulado distingue claves para evitar devolver los mismos lotes desde ambos almacenes.

Se carga el adaptador real de avisos con una salida registrada en memoria: comprueba la integración, no su renderizado visual. POS incorpora estado y elemento del modal de compra y comprueba su bloqueo/restauración al abrir/cerrar cliente rápido, sin guardados adicionales.

No se retiraron comprobaciones funcionales. Las expectativas textuales, visuales, de fórmulas y versiones históricas permanecen visibles para revalidación. No se cambia la aplicación para satisfacerlas.

## Archivos de E2.3

- `tests/a33-agenda-purchases-grouped-stage3-final.smoke.cjs`
- `tests/a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs`
- `tests/a33-calculadora-checklist-etapa2-boton-hecho-consulta.smoke.cjs`
- `tests/a33-calculadora-checklist-etapa3-hardening-final.smoke.cjs`
- `tests/a33-catalogos-modal-edit-hardening.smoke.cjs`
- `tests/a33-lot-code-stage3.smoke.cjs`
- `tests/a33-pos-cliente-rapido-etapa1.smoke.cjs`
- `tests/runtime-fixtures.cjs` (nuevo): dependencias reales y adaptador de avisos.
- `tests/catalogo.json`: resultados y clasificación actualizados.
- `tests/README.md`: alcance de los simuladores.
- `tests/RESULTADOS_ETAPA2_3.md` (nuevo): informe y continuidad.

Los informes anteriores se conservan.

## Pruebas y resultados

- Ejecución final local: **53 aprobadas, 7 fallidas, 2 de navegador no ejecutadas**. 62 pruebas únicas, tres aliases deduplicados, ninguna histórica excluida. Salida 1: la batería no está completamente aprobada.
- Antes de E2.3: 48 aprobadas y 12 fallidas. Cinco pruebas adicionales aprueban; otros dos simuladores corregidos avanzan hasta expectativas históricas/textuales.
- Pruebas dirigidas de Checklist etapas 2/3, lote etapa 3 y cliente rápido POS: cuatro aprobadas. Conservan escenarios de cierre incompleto, persistencia, histórico, concurrencia y no duplicación.
- Pruebas del ejecutor y contrapruebas de publicación: aprobadas.
- Smoke local PWA E1/E3/E4 y recuperación offline en VM: aprobado.
- Sintaxis de 70 archivos CJS y diff: sin errores.
- Informe detallado temporal: `/tmp/a33-e23-final.json`.
- Navegador no se repitió; se reserva para E2.4.

## Pendientes visibles

- `a33-agenda-purchases-grouped-stage3-final.smoke.cjs`: AssertionError [ERR_ASSERTION]: 40. Responsive y Centro de Mando conservan integración de compras
- `a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs`: AssertionError [ERR_ASSERTION]: Registro SW no actualizado
- `a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs`: AssertionError [ERR_ASSERTION]: Orden visual Checklist incorrecto
- `a33-catalogos-vistas-independientes-etapa1.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta marcador de historial
- `a33-lot-code-stage5.smoke.cjs`: AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
- `a33-lot-code-stage6.smoke.cjs`: AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
- `a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta integración Finanzas: totals.utilidadBruta - totals.costoCortesias - totals.comisionesTarjeta + totals.ingresosAdicionales - totals.gastos

Agenda supera el bloqueo de avisos y falla en la expectativa literal de integración de compras de Centro de Mando. Detalle de Letras y sirope supera sus escenarios informativos y falla en la revisión histórica del SW. Los demás pendientes requieren revalidar texto, disposición, selectores o fórmula literal. No se consideran por sí solos fallos operacionales comprobados de la aplicación.

## Compatibilidad, protección y riesgos

Todos los cambios están en tests. Interfaz, fórmulas, archivos de aplicación, versiones, SW, cachés, dependencias, datos reales, históricos y respaldos intactos. Los escenarios usan almacenamiento y DOM simulados. Las pruebas VM no sustituyen navegador; los avisos no se verifican visualmente. Queda pendiente revisión del usuario y revalidación de las expectativas señaladas.

## Git y cierre

Cambios locales de E2.1–E2.3 exclusivamente en tests. Sin commit ni push. Se detiene para revisión; E2.4 requiere autorización independiente.

## Resumen para copiar al chat principal

E2.3 completada: corregidos simuladores de siete pruebas con dependencias reales de Calculadora, adaptador de avisos y estado de compra POS; almacenamiento de Checklist distingue claves. Cinco pruebas adicionales aprueban. Resultado local: 53 aprobadas, 7 fallidas visibles, 2 de navegador no ejecutadas. Smoke local, ejecutor, contrapruebas, sintaxis y diff verificados. Aplicación y datos intactos; sin commit ni push. Pendiente revalidación de expectativas textuales/históricas y recorridos de E2.4, con autorización independiente.
