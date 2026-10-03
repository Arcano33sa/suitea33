# Línea base de pruebas — Etapa 2.1

Se ejecutaron los 61 escenarios independientes de los 64 archivos smoke. Los tres aliases no agregan cobertura.

- 24 aprobaron y 37 fallaron.
- Clasificación: 24 vigentes, 32 históricas, 5 por verificar y 3 aliases.
- Ninguna prueba fue corregida. No se modificó código de la aplicación.
- Histórica significa que contiene expectativas de versiones/cachés anteriores; también puede contener verificaciones funcionales útiles o fallos del simulador. No equivale a una prueba aprobada ni enteramente obsoleta.
- Un fallo del archivo no demuestra por sí solo un error de la aplicación. Las comprobaciones posteriores al primer fallo pueden no haberse ejecutado.
- Las dos pruebas de navegador se ejecutaron con servidores localhost y perfiles temporales. PWA aprobó; compras POS falló al buscar el botón Cliente Prueba.

## Pendientes de diagnóstico

- `a33-calculadora-checklist-detalle-letras-sirope.smoke.cjs`: ReferenceError: a33SortPresentaciones is not defined
- `a33-calculadora-checklist-etapa1-pendientes-historico.smoke.cjs`: AssertionError [ERR_ASSERTION]: Orden visual Checklist incorrecto
- `a33-catalogos-vistas-independientes-etapa1.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta marcador de historial
- `a33-pos-compra-multiproducto-etapa2.browser.smoke.cjs`: La prueba de navegador no encontró el selector de Cliente Prueba; requiere diagnóstico de selector/flujo en 2.4.
- `a33-pos-tarjeta-etapa2-integracion-reportes.smoke.cjs`: AssertionError [ERR_ASSERTION]: Falta integración Finanzas: totals.utilidadBruta - totals.costoCortesias - totals.comisionesTarjeta + totals.ingresosAdicionales - totals.gastos

## Continuidad

2.2 revisará y separará expectativas históricas; 2.3 completará simuladores; 2.4 revisará selectores y smoke tests principales. No se avanzó a esas subetapas.

Los informes completos de esta ejecución se guardaron fuera del repositorio en `/tmp/a33-etapa2-1-informe-completo.json` y los tres informes parciales `/tmp/a33-etapa2-1-{locales,historicas,navegador}.json`. Son artefactos temporales; el catálogo y esta línea base quedan en el proyecto. La clasificación se mantiene explícitamente, no se cambia automáticamente por el ejecutor.
