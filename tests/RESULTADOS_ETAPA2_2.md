# E2.2 — Separación de funcionalidad y publicación

Objetivo autorizado: retirar expectativas numéricas históricas de publicación de 32 pruebas y verificar coherencia vigente por separado. Se conservan escenarios funcionales, pruebas offline en VM y expectativas pendientes. No se reparan simuladores ni se cambian reglas, interfaz, fórmulas o runtime. E2.2 es la segunda de cuatro subetapas acordadas.

## Archivos y acuerdos

Se modificaron 32 archivos smoke (identificables por el comentario inicial de coherencia). Se añadieron `a33-publicacion-coherencia.smoke.cjs`, `publication-contract.cjs`, `publication-contract.spec.cjs` y este informe. Se actualizaron catálogo, ejecutor, pruebas del ejecutor y README creados en E2.1. La línea base `RESULTADOS_ETAPA2_1.md` se conserva. Todos los cambios están en `tests/`.

Las verificaciones nuevas contrastan la release vigente con build, referencias y precache de nueve módulos, archivos presentes, manifiestos, registro de SW y nombres de caché. Las revisiones válidas futuras se aceptan cuando son coherentes. Los fixtures offline obtienen el índice vigente del precache, manteniendo el escenario de recuperación sin red. Se permite una revisión distinta en el inicio del manifiesto cuando existe fallback de navegación; se verifica versión, módulo y archivo.

## Verificación

Ejecución final local: **48 aprobadas, 12 fallidas, 2 de navegador no ejecutadas**, sin históricas excluidas y con tres aliases deduplicados. Son 65 entradas, 62 pruebas únicas. El ejecutor terminó con código 1 y conserva los fallos. Informe detallado temporal: `/tmp/a33-etapa2-2-final.json`.

- Comprobación central de publicación: aprobada.
- Contrapruebas en memoria de versiones, precache, archivos ausentes, manifiesto y caché: aprobadas; una revisión nueva coherente se acepta.
- Pruebas del ejecutor, filtros de grupo, aliases, timeout, truncamiento y protección contra sobrescritura: aprobadas.
- Smoke local incluye PWA E1, E3, E4 y escenarios offline POS en VM: aprobados.
- Sintaxis de archivos CJS y revisión del diff: sin errores.
- No se repitieron recorridos de navegador en E2.2. La línea base de E2.1 conserva PWA aprobada y POS fallido por selector. No se presenta como verificación nueva.

## Fallos que permanecen visibles

- `a33-agenda-purchases-grouped-stage3-final.smoke.cjs`: TypeError: Cannot read properties of undefined (reading 'show')
- `a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs`: ReferenceError: a33SortPresentaciones is not defined
- `a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs`: AssertionError [ERR_ASSERTION]: Orden visual Checklist incorrecto
- `a33-calculadora-checklist-etapa2-boton-hecho-consulta.smoke.cjs`: ReferenceError: a33NormalizeLetter is not defined
- `a33-calculadora-checklist-etapa3-hardening-final.smoke.cjs`: ReferenceError: a33NormalizeLetter is not defined
- `a33-catalogos-modal-edit-hardening.smoke.cjs`: TypeError: Cannot read properties of undefined (reading 'show')
- `a33-catalogos-vistas-independientes-etapa1.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta marcador de historial
- `a33-lot-code-stage3.smoke.cjs`: ReferenceError: a33IsStandaloneProduction is not defined
- `a33-lot-code-stage5.smoke.cjs`: AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
- `a33-lot-code-stage6.smoke.cjs`: AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value:
- `a33-pos-cliente-rapido-etapa1.smoke.cjs`: ReferenceError: purchaseModalStatePOS is not defined
- `a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta integración Finanzas: totals.utilidadBruta - totals.costoCortesias - totals.comisionesTarjeta + totals.ingresosAdicionales - totals.gastos

Estos fallos requieren diagnóstico en E2.3/E2.4 según su alcance. Los errores de símbolos ausentes sugieren simuladores incompletos; las expectativas visuales, marcadores y fórmula literal deben contrastarse antes de cambiarlas. No se altera la aplicación para satisfacerlas.

## Compatibilidad, riesgos y Git

No se modificaron datos reales, históricos, respaldos, dependencias, HTML de aplicación, SW, cachés ni versiones de runtime. Las comprobaciones estáticas y VM no sustituyen recorridos en navegador ni acreditan todas las operaciones. Queda pendiente revisión manual del informe y autorización independiente para E2.3.

Git conserva cambios locales de E2.1 y E2.2 exclusivamente en tests. No se hizo commit ni push.

## Resumen para el chat principal

E2.2 completada: separadas las comprobaciones históricas de versión de 32 pruebas; agregado grupo de coherencia de publicación basado en contratos actuales y filtros funcional/publicación. Resultado local: 48 aprobadas, 12 fallidas conservadas para diagnóstico, 2 de navegador no repetidas. Contrapruebas y ejecutor aprobados; diff revisado. Aplicación y datos intactos. Sin commit ni push. Se detiene para revisión; E2.3 requiere autorización.
