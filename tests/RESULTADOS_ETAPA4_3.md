# E4.3 — Apertura offline de Finanzas y Analítica

Tercera de siete subetapas acordadas. Autorización: «procede e4.3».

## Objetivo y resultado

Después de abrir cada módulo online y completar su instalación inicial de Service Worker, Finanzas y Analítica pueden abrirse y recargarse sin red, con sus recursos locales y XLSX. No se cambia su interfaz ni reglas de negocio; no se añade instalación como app independiente o manifiestos.

Se crean workers con alcance `/finanzas/` y `/analitica/`, cachés propias `a33-v4.20.98-<modulo>-r5-m1`, y recursos exactamente alineados con los HTML. Incluyen scripts y estilos locales/compartidos, vendor XLSX de POS, imagen de Analítica y logo de recibos financiero. La navegación a la raíz o `index.html` de cada módulo usa red primero y fallback al HTML precargado; las URLs conocidas de recursos usan solo la caché del propio módulo. No interceptan navegación ajena ni solicitudes externas.

La primera instalación se activa al completarse el precache. Las actualizaciones esperan mientras haya clientes controlados; aceptan el mensaje existente `SKIP_WAITING`. Como ocurre en el ciclo normal del navegador, pueden activarse naturalmente cuando dejan de existir clientes del worker anterior. No se recargan pestañas automáticamente. La activación no elimina ninguna caché.

Se agregan ambos módulos a los metadatos de build y a la lista PWA de Configuración para conservar su búsqueda/aplicación controlada existente. No se modifica la revisión global ni workers de otros módulos. Configuración muestra once módulos, y las dos pruebas que esperaban nueve se actualizan a ese contrato.

## Archivos propios de E4.3

- `finanzas/sw.js`, `analitica/sw.js`: nuevos workers.
- `finanzas/index.html`, `analitica/index.html`: registro de SW.
- `assets/js/a33-build.js`: revisión inicial de los dos módulos.
- `configuracion/script.js`: reconocimiento de ambos módulos PWA, sin alterar las confirmaciones.
- `tests/a33-exportaciones-e43-workers.smoke.cjs`: contrato estático/VM.
- `tests/a33-exportaciones-e43-apertura-offline.browser.smoke.cjs`: recorrido Chrome.
- `tests/a33-pwa-e4-resultados.smoke.cjs`, `tests/a33-pwa-e2-offline.smoke.cjs`: contrato del reporte de once módulos.
- `tests/catalogo.json`, `tests/README.md`, `tests/RESULTADOS_ETAPA4_3.md`: registro y documentación.

Los cambios pendientes de E4.1/E4.2 se conservan sin commit. HTML, README y catálogo contienen cambios acumulados; no se atribuye todo su diff a esta subetapa.

## Pruebas, smoke y resultados

- Chrome E4.3: APROBADA. Contexto temporal, origen localhost aleatorio. Recarga offline de ambos módulos, entrada por `/analitica/` y Finanzas con query/hash en pestaña nueva; XLSX disponible y ventas leídas del POS temporal.
- Exportaciones: tres botones Analítica y generador de reportes Finanzas con red desconectada; descarga y lectura real de XLSX con contenido comprobado. No acredita todos los flujos de preparación financiera.
- Conservación: venta POS, registro `settings` financiero y caché de otro módulo intactos. Sin errores JavaScript de página. Fuente Google opcional bloqueada, sin acceso externo requerido.
- Actualización real simulada: nuevos workers instalados quedan esperando; controlador sin cambio mientras hay clientes abiertos; Configuración informa ambas actualizaciones y ofrece aplicar. No se aplica en el recorrido.
- VM workers E4.3: APROBADA. Precache existente/coherente, build, primera activación, espera/mensaje, instalación fallida y alcance de fetch.
- Regresiones locales: E4.1 exportaciones, PWA activación controlada, PWA resultados y coherencia de publicación: las cuatro APROBADAS.
- Chrome E4.2: APROBADA con workers bloqueados, validando que la librería local también funciona sin depender del SW.
- Contrapruebas de publicación: APROBADAS. Sintaxis y diff: revisados sin errores.

La prueba inicial E4.3 usó `key` en un registro de `settings`; se corrigió el fixture a `id`, según el esquema vigente. En la extensión del recorrido, se ajustó el texto esperado del reporte y se mantuvieron clientes de ambos módulos: cerrar todos los clientes permite activar naturalmente un worker en espera y no verifica la protección del trabajo abierto. Las ejecuciones finales pasan. No se cambió la aplicación para satisfacer estas expectativas incorrectas de la prueba.

No se ejecutó la batería completa ni se revalidaron los siete fallos anteriores. La prueba histórica PWA E2 completa de nueve módulos no se repitió; su ajuste puntual de conteos está cubierto por el reporte VM y el reporte real E4.3.

## Límites y cierre

La preparación requiere conexión inicial, origen seguro/localhost, Service Workers disponibles y precache instalado correctamente. Si el navegador elimina las cachés o no permite almacenarlas, habrá que preparar nuevamente los módulos online. Este mecanismo conserva la aplicación local y no crea una instantánea ni una copia de seguridad de sus datos. Los enlaces a otros módulos necesitan que estos estén disponibles por sus propios mecanismos.

No se alteran ni eliminan datos reales, históricos, respaldos o cachés existentes. No se cambian fórmulas ni se añaden dependencias. Se conservan todas las cachés previas; cualquier mantenimiento posterior tendrá alcance propio.

Sin commit, push ni publicación. E4.3 se detiene para revisión manual. E4.4 no iniciada.
