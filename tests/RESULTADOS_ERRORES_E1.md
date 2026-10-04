# Revisión de errores — E1 de 3: contratos estructurales

Autorización: «procede e1». Objetivo: actualizar cuatro pruebas anteriores a los contratos funcionales vigentes, sin modificar la aplicación. E2 (Calculadora) y E3 (comisiones y cierre) no están autorizadas por esta instrucción.

## Cambios y evidencia

- Agenda: reemplaza la exigencia literal `type === 'compra'` por ejecución del código vigente de Centro de Mando. Comprueba normalización de compra/purchase/tarea, artículos y presupuesto de compras agrupadas e históricas, fecha programada e inmutabilidad. Conserva las comprobaciones funcionales de compras y responsive. Corrige la etiqueta de conteo 45 a 40, acorde con los checks reales existentes; se agregan además assertions de integración.
- Catálogos: utiliza estados creados por el código real, sin fijar una revisión del marcador. Se completan removeAttribute y requestAnimationFrame del DOM simulado y se conserva la entrada inicial del historial. Se verifican portada, sección única, doble toque, Atrás, popstate vigente y resolución de un marcador histórico mediante su URL. El recorrido existente Chrome verifica los ocho apartados y Atrás.
- Lote E5: sustituye la frase antigua de Configuración por funciones reales de identidad y lectura literal de respaldo. Se comprueban equivalencia X/x, conservación de códigos históricos/nuevos y campos del registro. Las comprobaciones de la tarjeta «Último lote» retirada de Centro de Mando se sustituyen por exportación de Lotes como celda de texto con códigos completos; se conservan verificaciones POS, Analítica, búsqueda y contratos de respaldo.
- Lote E6: sustituye el selector de esa tarjeta retirada por reglas vigentes de ajuste de códigos en Analítica, conservando reglas de Lotes y comprobaciones de códigos, exportación, históricos y service workers existentes. No se recrea ninguna tarjeta antigua.
- Catálogo: solo las cuatro entradas se actualizan a vigente/APROBADA tras su ejecución; Lote E5 pasa de static a vm por la ejecución de sus funciones reales. Los tres fallos restantes conservan su estado y resultados.

## Verificación final

- Cuatro pruebas corregidas: aprobadas.
- Smoke adicional de Centro de Mando E3: aprobado, incluyendo compras pendientes, agrupaciones, artículos, presupuestos y exclusión de canceladas.
- Chrome de flujos principales E2.4: aprobado, con ocho apartados de Catálogos y Atrás, Checklist y Pedidos; contexto temporal y localhost aislado.
- Cuatro contrapruebas: aprobadas. Mediante interceptación temporal en memoria, sin escribir archivos de aplicación, se alteraron reconocimiento de compra, pushState, identidad X/x y ajuste de texto en Analítica. Cada prueba falló con AssertionError ante el defecto introducido. No se presentan como ejecuciones normales aprobadas, sino como evidencia de que los contratos detectan errores.
- Regresión local: **75 aprobadas, 3 fallidas y 22 pruebas de navegador omitidas por el ejecutor local**. La de flujos principales se ejecutó aparte y aprobó; las otras 21 no se repitieron en E1. El proceso termina con código 1 por los tres pendientes, no con batería completamente verde.
- runner.spec.cjs, sintaxis de las cuatro pruebas modificadas y git diff --check: aprobados.
- Diff revisado: solamente pruebas y documentación; árbol inicial limpio en main, commit previo 73e743e.

Las primeras ejecuciones dirigidas mostraron una colisión de nombre en el nuevo fixture Agenda y carencias del simulador Catálogos (removeAttribute y conservación inicial de historial). Se corrigieron en pruebas; la ejecución final de las cuatro aprobó. Los informes históricos y los intentos previos se conservan.

Registro de ejecución: [RESULTADOS_ERRORES_E1.json](RESULTADOS_ERRORES_E1.json).

## Archivos

- tests/a33-agenda-purchases-grouped-stage3-final.smoke.cjs
- tests/a33-catalogos-vistas-independientes-etapa1.smoke.cjs
- tests/a33-lot-code-stage5.smoke.cjs
- tests/a33-lot-code-stage6.smoke.cjs
- tests/catalogo.json
- tests/README.md
- tests/RESULTADOS_ERRORES_E1.md (nuevo)
- tests/RESULTADOS_ERRORES_E1.json (nuevo)

## Límites y cierre

No se ejecutó un recorrido visual nuevo de códigos largos en Lotes/Analítica; su protección se verifica mediante contratos de estilos y funciones de exportación. Las funciones de identidad probadas no sustituyen por sí solas una importación integral; se conserva la cobertura existente de respaldos de la regresión local.

La revisión de estos cuatro contratos no requirió corregir aplicación, datos, interfaz, fórmulas, códigos históricos, PWA, service workers, cachés, versiones o dependencias. No hubo commit, push ni publicación. Se conservan informes anteriores que muestran siete fallos: representan sus ejecuciones históricas, no se sobrescriben.

Quedan tres fallos: dos de Calculadora para E2 y uno de integración tarjeta/reportes para E3. E1 terminada localmente y detenida para revisión. No se inicia otra etapa automáticamente.
