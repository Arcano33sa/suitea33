# PWA — E3: validación de actualización y reapertura

Fecha: 04/10/2026. Entrega corregida: `4.20.98 · PWA-E3`.

## Resultado

La validación inicial reprodujo un estado persistido incorrecto después de una activación automática al cerrar el módulo. Tras autorización explícita del usuario, se corrigió la reconciliación en Configuración. La corrección está verificada en Chrome y VM; Safari/iPad físico sigue pendiente. Los cambios locales de E2 y E3 siguen pendientes de revisión y commit.

## Corrección

- Al abrir, recibir `pageshow` o `focus`, o recuperar visibilidad, consulta los registros locales sin descargar, registrar módulos, aplicar ni recargar páginas.
- Mientras comprueba el estado, bloquea ambos botones. Una actualización ya activa deja de ofrecerse como pendiente.
- Observa la transición a `activated` del objeto worker pendiente, sin inferir identidad a partir de la URL.
- Si observa la activación fuera del flujo manual, persiste un aviso con fecha. Actualiza la fecha global únicamente cuando no hay módulos pendientes sin verificar. Esa fecha corresponde a la observación del evento, no a una estimación de una activación ocurrida mientras la página estaba cerrada.
- Si solo descubre que el pendiente desapareció, conserva la fecha histórica y muestra que no pudo confirmar su activación. Un registro antiguo de otra activación no demuestra una nueva.
- Espera brevemente las activaciones en curso y conserva errores de búsquedas o aplicaciones incompletas.
- Identificador `4.20.98 · PWA-E3`; referencia de Configuración `script.js` r42. Sin cambios en workers, cachés ni datos operacionales.

## Comprobaciones aprobadas

- `a33-pwa-e2-offline.smoke.cjs --activation`: nueve módulos conservan el trabajo de prueba mientras la actualización espera; activan tras el mensaje explícito y cargan sus recursos y navegación sin conexión.
- `a33-exportaciones-e43-apertura-offline.browser.smoke.cjs`: Finanzas y Analítica abren, recargan y funcionan en una pestaña nueva sin conexión; exportan y conservan datos y caché ajena. Sus actualizaciones aparecen en Configuración sin aplicarse durante la búsqueda. Se corrigió una expectativa histórica del botón para comprobar los dos botones acordados.
- `a33-pwa-e4-resultados.smoke.cjs`: preparación central, errores, timeout, resultados completos/parciales, reconciliación sin descargas, activación observada, evidencia antigua y conservación de fechas sin evidencia.
- `a33-pwa-e3-activacion-controlada.smoke.cjs`: instalación/activación de nueve módulos, buscar no aplica, cancelar no modifica el estado, confirmar aplica sin recargar, bloqueo de doble ejecución.
- `a33-pwa-e2-offline.smoke.cjs --config-report`: actualización manual, fallo de red, recuperación y regreso a primer plano sin conexión, conservación de fechas, dos botones y ancho móvil/iPad en Chrome.
- `a33-pwa-e2-offline.smoke.cjs --config-report --reopen-report`: activación automática observada, botón deshabilitado, aviso/fecha persistentes al reabrir y recargar.
- El mismo comando con `--unconfirmed-evidence`: simula un reporte antiguo sin evidencia en un perfil temporal; al reabrir muestra `No hay actualización pendiente`, deshabilita el botón, muestra incertidumbre y conserva `01/01/2020 00:00`. Aprobado.
- `git diff --check`: sin errores.

## Fallo inicial y regresión

Comando: `node tests/a33-pwa-e2-offline.smoke.cjs --config-report --reopen-report`.

1. Configuración prepara los once módulos.
2. Con POS abierto, se publica una actualización simulada y se busca desde Configuración.
3. Se cierra POS; la prueba confirma que el nuevo worker se activó automáticamente.
4. Se cierra y vuelve a abrir Configuración, conservando el almacenamiento del contexto temporal.
5. Configuración muestra `Actualización disponible`, habilita `Actualizar Suite` y conserva `Última actualización: Sin registros`.

Antes de la corrección, la prueba terminó con código 1: el botón ofrecía aplicar una actualización ya activa porque la pantalla restauraba el reporte guardado sin reconciliarlo con los workers existentes.

Después de la corrección, la reapertura con evidencia muestra `Activación automática confirmada`, el botón deshabilitado y la fecha confirmada. La prueba mantiene viva Configuración hasta que recibe el evento; no afirma poder recuperar ese evento si la página terminó antes de observarlo. El caso sin evidencia se verifica también en VM y mantiene la fecha histórica.

## Límites

Pruebas en Chrome con perfiles temporales y servidores localhost; no se utilizaron datos reales. WebKit de Playwright no está instalado; no se instaló ninguna dependencia. No se validó Safari, iPadOS ni la PWA instalada en un iPad físico. La reapertura comprobada corresponde a páginas dentro de un contexto de navegador, no a reiniciar el dispositivo o terminar el proceso de Safari.

No se hizo commit, push ni publicación. Archivos de la aplicación modificados en esta corrección: `configuracion/index.html` y `configuracion/script.js`. Las demás modificaciones de E3 corresponden a pruebas y este informe.
