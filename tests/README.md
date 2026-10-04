# Pruebas de Suite A33

## Lecturas del tablero financiero — E4.4

`node tests/run-suite.cjs --test a33-finanzas-e44-lecturas.smoke.cjs` verifica fuentes vacías, ausencia de base POS, base sin inicializar, almacenes opcionales ausentes, fallos de apertura/lectura, resultados inválidos y aborto posterior al éxito de `getAll`. Comprueba que el tablero marque resultados parciales y no confunda una lectura fallida con ausencia de registros.

`node tests/run-suite.cjs --browser --test a33-finanzas-e44-lecturas.browser.smoke.cjs --timeout-ms 60000` verifica avisos visibles y recuperación en Chrome, errores POS/recibos/carga principal, un esquema POS anterior y registros intactos. Los fallos y abortos se inyectan únicamente en un origen y contexto temporal. Consulta [informe E4.4](RESULTADOS_ETAPA4_4.md).

## Apertura offline — E4.3

`node tests/run-suite.cjs --test a33-exportaciones-e43-workers.smoke.cjs` comprueba recursos/precache, nombres de caché/build, activación inicial, espera de actualizaciones, fallo de instalación y aislamiento.

`node tests/run-suite.cjs --browser --test a33-exportaciones-e43-apertura-offline.browser.smoke.cjs --timeout-ms 60000` prepara Finanzas y Analítica en Chrome temporal, espera activación/control del SW, desconecta la red y verifica recarga, entrada desde una pestaña nueva, exportaciones y conservación de registros y caché ajena. Simula una actualización y mantiene ambos módulos abiertos para comprobar que no se activa sola y aparece en Configuración. El reporte PWA reconoce ahora once módulos. No usa datos reales ni aplica la actualización; no acredita instalación como app o todos los flujos financieros. Consulta [informe E4.3](RESULTADOS_ETAPA4_3.md).

## XLSX local — E4.2

`node tests/run-suite.cjs --browser --test a33-exportaciones-e42-xlsx-local.browser.smoke.cjs --timeout-ms 60000` verifica en Chrome temporal que Finanzas y Analítica carguen la copia local de XLSX existente en POS. Bloquea las solicitudes externas y desconecta la red después de cargar cada módulo. Descarga y lee los tres Excel de Analítica y un archivo del generador de reportes financiero, comprobando contenido. La fuente Google opcional existente permanece bloqueada. No acredita todas las exportaciones financieras ni apertura/recarga offline, pendiente de E4.3. Consulta [informe E4.2](RESULTADOS_ETAPA4_2.md).

## Exportaciones de Analítica — E4.1

`node tests/run-suite.cjs --test a33-analitica-e41-exportaciones.smoke.cjs` ejecuta el script completo de Analítica en VM, conecta los tres botones mediante un DOM simulado y genera/lee XLSX reales en memoria con la copia existente de POS. Comprueba importes de venta, cortesía y devolución, identidad de producto, lotes como texto, ausencia de datos y librería no disponible. No abre un navegador ni utiliza almacenamiento real. La carga local/offline de XLSX en la aplicación queda para E4.2. Consulta [informe E4.1](RESULTADOS_ETAPA4_1.md).

No se necesitan dependencias nuevas. Usa Node disponible en tu entorno (`node` en los ejemplos). El ejecutor usa el mismo binario Node para cada proceso y trabaja desde la raíz del proyecto.

## Catálogo y ejecución

```sh
node tests/run-suite.cjs --list
node tests/run-suite.cjs
node tests/run-suite.cjs --group funcional
node tests/run-suite.cjs --group publicacion
node tests/run-suite.cjs --historical
node tests/run-suite.cjs --test a33-pwa-e1-componentes-vigentes.smoke.cjs
node tests/run-suite.cjs --browser --test a33-pwa-e2-offline.smoke.cjs --timeout-ms 90000
node tests/run-suite.cjs --report /tmp/a33-informe-nuevo.json
node tests/runner.spec.cjs
```

`catalogo.json` distingue vigentes, históricas, por verificar y aliases. El ejecutor comprueba que el catálogo incluya todos los archivos `.smoke.cjs`, sin duplicados. Las altas requieren actualizarlo. Los aliases se convierten en su prueba de destino y se ejecutan una sola vez, incluso si se solicitan junto con el destino.

Por defecto ejecuta pruebas locales vigentes y por verificar. Informa cuántas históricas excluyó y cuáles no ejecutó por requerir navegador. `--historical` incluye las históricas; `--test` permite seleccionar cualquiera expresamente. Las históricas que se ejecutan conservan su resultado real y sus fallos no se silencian.

Cada prueba corre en un proceso separado, en secuencia. El límite por defecto es 20 segundos; `--timeout-ms` acepta de 100 a 300000 ms. Un timeout termina el proceso y, en macOS/Linux, su grupo de procesos. La salida retenida tiene un límite de 131072 caracteres; el informe indica truncamiento.

## Resultados y códigos de salida

- `APROBADA`: el proceso terminó con código 0. No acredita cobertura completa de la aplicación.
- `FALLIDA`: salida no exitosa; requiere diagnóstico de la prueba, simulador o aplicación. Incluye timeouts internos de selectores del navegador.
- `BLOQUEADA_ENTORNO`: error explícito de permiso para escuchar en localhost, navegador ausente o dependencia Playwright ausente.
- `INCONCLUSA`: se alcanzó el límite del ejecutor. No se supone que sea un problema del entorno ni un fallo funcional.
- `NO_EJECUTADA`: prueba de navegador sin `--browser`. No equivale a aprobada o a bloqueo comprobado.

Código 0: aprobaron todas las pruebas seleccionadas que se ejecutaron, sin pendientes dentro de esa selección. Código 1: existe al menos una fallida. Código 2: error del ejecutor o una selección con bloqueos, pruebas inconclusas o no ejecutadas, sin fallidas. Las históricas excluidas intencionalmente se detallan aparte; nunca se afirma que aprobó la batería completa por excluirlas.

`--report` guarda JSON con resultados, salidas y exclusiones. La carpeta debe existir y el archivo debe ser nuevo: no se sobrescriben informes anteriores. Sin esa opción no se escribe un informe. El ejecutor no modifica la aplicación, no publica ni instala dependencias; las pruebas existentes mantienen sus propios efectos (por ejemplo, capturas temporales del navegador).

## Navegador y datos

Las pruebas de navegador utilizan servidores localhost y perfiles temporales, sin los datos reales del usuario. Requieren Chrome/Playwright disponibles y permiso del entorno para abrir el servidor. La prueba PWA acepta `A33_PLAYWRIGHT_PATH`; ambas conservan sus localizadores actuales del runtime. No se normalizaron dependencias ni simuladores en 2.1.

El nombre `.smoke.cjs` no garantiza un recorrido completo: puede ser una verificación textual, un escenario VM o una prueba de navegador. Consulta modo, clasificación y observaciones en el catálogo y la [línea base de 2.1](RESULTADOS_ETAPA2_1.md).

## Separación aplicada en E2.2

Las 32 pruebas con comprobaciones históricas de publicación conservan sus escenarios funcionales. Las comprobaciones de versiones y precache se concentran en `a33-publicacion-coherencia.smoke.cjs`, usando la versión vigente de `a33-release.js`. `--group funcional` y `--group publicacion` permiten ejecutar ambos grupos por separado; sin filtro se incluyen ambos.

La prueba de publicación contrasta release, build, cachés de nueve módulos, recursos locales, referencias HTML/precache, registro de SW y destinos de manifiestos. No exige antiguas revisiones numéricas: verifica relaciones actuales. El `r` del inicio del manifiesto puede diferir del recurso precargado porque la navegación tiene fallback; su versión y destino sí se verifican. Finanzas, Analítica y Configuración se verifican únicamente en las referencias compartidas de almacenamiento; esto no acredita disponibilidad offline de esos módulos.

`node tests/publication-contract.spec.cjs` comprueba que desajustes introducidos en memoria sean detectados y que una revisión coherente nueva sea aceptada. No modifica archivos de la aplicación. Los fallos de simuladores y expectativas visuales o de fórmulas quedan registrados para las siguientes etapas; no se convierten en aprobados. Consulta [resultados de E2.2](RESULTADOS_ETAPA2_2.md).

## Simuladores revisados en E2.3

`runtime-fixtures.cjs` carga funciones auxiliares reales de Calculadora y el adaptador real de avisos. La salida de avisos se registra en memoria y no acredita su renderizado visual. Checklist distingue claves de lotes y producción; POS incluye estado y elemento del modal de compra y verifica bloqueo/restauración. Las expectativas antiguas siguen visibles cuando fallan. Consulta [resultados de E2.3](RESULTADOS_ETAPA2_3.md).

## Navegador en E2.4

```sh
node tests/run-suite.cjs --browser --timeout-ms 90000
node tests/run-suite.cjs --browser --test a33-flujos-principales-e24.browser.smoke.cjs --timeout-ms 90000
```

Hay tres pruebas de navegador. POS busca al cliente antes de seleccionarlo en sus grupos plegables. El nuevo recorrido verifica Catálogos/Atrás, cierre y consulta de Checklist y pedido rápido con catálogo compartido. Usa datos sembrados en un origen localhost aleatorio y un contexto temporal. La prueba nueva requiere Chrome instalado en macOS y el runtime Playwright existente; no instala dependencias. Las comprobaciones de navegador no sustituyen revisión manual ni acreditan cobertura exhaustiva. Consulta [resultados y siete pendientes de E2.4](RESULTADOS_ETAPA2_4.md).

## Exportación segura E3.1

```sh
node tests/run-suite.cjs --test a33-backup-e31-lecturas-completas.smoke.cjs
node tests/run-suite.cjs --browser --test a33-backup-e31-exportacion.browser.smoke.cjs --timeout-ms 90000
```

Comprueban el formato histórico completo/parcial y el bloqueo ante fallos de enumeración, esquema, lectura de datos o localStorage. El navegador usa origen localhost y contexto temporal. No importa respaldos ni modifica datos reales. Consulta [informe E3.1](RESULTADOS_ETAPA3_1.md).

### Protección de datos — E3.2

- `a33-backup-e32-cobertura.smoke.cjs`: contrasta la cobertura personalizada con los almacenes definidos por Finanzas; verifica selección sin dependencias automáticas, listas de producción, borrador de Pedidos, preferencias POS, avisos y formato parcial histórico.
- `a33-backup-e32-personalizado.browser.smoke.cjs`: selección real de casillas y descarga JSON en Chrome, con contexto y origen temporales; no utiliza almacenamiento del usuario.
- Resultados y límites: [RESULTADOS_ETAPA3_2.md](RESULTADOS_ETAPA3_2.md).

### Protección de datos — E3.3

- `a33-backup-e33-validacion.smoke.cjs`: verifica rechazo previo a escritura de contenedores, registros y metadatos malformados; compatibilidad de archivos sin esquema; distinción entre bloques ausentes y listas vacías explícitas.
- `a33-backup-e33-importacion.browser.smoke.cjs`: carga un archivo inválido y realiza una importación histórica en Chrome con almacenamiento temporal, comprobando conservación de Materia Prima, Productos y claves ausentes.
- Resultados y límites: [RESULTADOS_ETAPA3_3.md](RESULTADOS_ETAPA3_3.md).

### Protección de datos — E3.4

- `a33-backup-e34-fallos-escritura.smoke.cjs`: rechazo/lectura de verificación de localStorage, errores síncronos y asíncronos de transacción, almacenes ausentes, identidad insuficiente, cierre y aborto.
- `a33-backup-e34-recuperacion.browser.smoke.cjs`: lectura previa bloqueada, descarga obligatoria antes de importar, aborto real de reemplazo por error, error tardío de localStorage en importación parcial y descarga repetida del mismo respaldo previo. Contexto temporal sin datos reales.
- `a33-backup-e33-importacion.browser.smoke.cjs` sigue verificando conservación de datos y ahora atraviesa la descarga/confirmación del respaldo previo.
- Resultados: [RESULTADOS_ETAPA3_4.md](RESULTADOS_ETAPA3_4.md).

### Protección de datos — E3.5

- `a33-backup-e35-diagnostico.smoke.cjs`: solo lectura, conteos IndexedDB, errores, APIs no disponibles y estimaciones inválidas.
- `a33-backup-e35-diagnostico.browser.smoke.cjs`: reporte y fallos de count reales en Chrome; compara todo el almacenamiento antes/después y prohíbe escrituras durante la consulta.
- Los fixtures de navegador de E3.1/E3.3/E3.4 esperan la apertura efectiva de IndexedDB antes de sembrar datos temporales.
- Resultados y límites: [RESULTADOS_ETAPA3_5.md](RESULTADOS_ETAPA3_5.md).

### Protección de datos — E3.6

- `a33-backup-e36-antiguedad.smoke.cjs`: fecha/tipo tras descarga solicitada, edad del contenido, ausencia de actualización al preparar, fallo del registro y exclusión del seguimiento de exportación/importación.
- `a33-backup-e36-antiguedad.browser.smoke.cjs`: descarga completa/parcial real, cancelación, recarga, cambio entre pestañas y registro inválido.
- Resultados y continuidad del bloque de protección de datos: [RESULTADOS_ETAPA3_6.md](RESULTADOS_ETAPA3_6.md).

### Analítica ampliada — E4.5

- `a33-analitica-e45-resultados.smoke.cjs`: resultados, comisión POS y conciliación Finanzas con el mismo período y fuentes; cortesías, devoluciones, desconocidas, históricos incompletos, agrupaciones y XLSX real.
- `a33-analitica-e45-resultados.browser.smoke.cjs`: Chrome con almacenamiento temporal, fechas inclusivas, KPI, tablas en escritorio/móvil y tres exportaciones sin conexión.
- Alcance, resultados y límites: [RESULTADOS_ETAPA4_5.md](RESULTADOS_ETAPA4_5.md).

### Analítica y merma final — E4.6

- `a33-analitica-e46-merma.smoke.cjs`: merma final confirmada, conciliación con Finanzas, exclusiones, fechas inclusivas, eventos sin ventas, IDs históricos, errores de lectura y costos inciertos.
- `a33-analitica-e46-merma.browser.smoke.cjs`: KPI/tablas y tres XLSX offline en Chrome; períodos sin ventas y lectura fallida con almacenamiento temporal intacto.
- Alcance y límites: [RESULTADOS_ETAPA4_6.md](RESULTADOS_ETAPA4_6.md).

### Cierre integrado — E4.7

- `a33-e47-conciliacion-integrada.browser.smoke.cjs`: páginas reales de Finanzas/Analítica y funciones vigentes de reporte POS sobre las mismas fuentes persistidas, con snapshots y tasas actuales diferentes. Verifica conciliación, diferencias por fuentes adicionales/cierres, tres XLSX de Analítica y exportación real de Balanza offline, comisiones desconocidas y período solo con merma.
- Cierre: 86 pruebas únicas ejecutadas en dos tandas, 79 aprobadas y los mismos siete fallos históricos; 15 pruebas de navegador aprobadas, sin omisiones ni bloqueos. La batería completa no está totalmente aprobada.
- [Informe y límites E4.7](RESULTADOS_ETAPA4_7.md), [registro completo de ejecuciones](RESULTADOS_ETAPA4_7.json).

### Guardado seguro — E5.9

- Cierre integrado de E5.1–E5.8 mediante el catálogo funcional completo, incluidas sus pruebas de navegador y las regresiones de otros módulos.
- E5.1 verifica fallos de datos/revisión y confirmación parcial; E5.2 verifica pendientes y reintento de Checklist; E5.3–E5.6 verifican recuperación explícita sin registrar operaciones, fuentes conservadas y validaciones vigentes; E5.7–E5.8 verifican escritores, registros modificados/eliminados y cambios independientes.
- Las pruebas usan almacenamiento en memoria u orígenes/contextos temporales. La prueba de Checklist monta controles temporales porque su pantalla heredada no está presente en el HTML vigente; no demuestra un recorrido visible de esa pantalla.
- Resultados, alcance y limitaciones: [RESULTADOS_ETAPA5_9.md](RESULTADOS_ETAPA5_9.md). Registro completo: [RESULTADOS_ETAPA5_9.json](RESULTADOS_ETAPA5_9.json).

### Revisión de errores — E1: contratos estructurales

- Agenda, Catálogos y lot-code E5/E6 se verifican contra funciones y rutas vigentes, preservando históricos; no se exige una revisión antigua del marcador ni una tarjeta retirada de Centro de Mando.
- Regresión local: 75 aprobadas y tres pendientes de Calculadora/comisiones. Smoke de Centro de Mando y Chrome de flujos principales aprobados; 21 pruebas adicionales de navegador no se repitieron.
- [Informe y límites](RESULTADOS_ERRORES_E1.md), [resultados de ejecución](RESULTADOS_ERRORES_E1.json). Los informes anteriores se conservan como evidencia histórica.

### Revisión de errores — E2: Checklist de Calculadora

- Letras/sirope y pendientes/histórico verifican sus contratos actuales; las revisiones históricas exactas se sustituyen por la comprobación separada de coherencia vigente de publicación.
- Clasificación explícita, Hecho solo para pendientes, consulta histórica y conservación de códigos; dependencias reales en el simulador. Chrome verifica cierre y recarga.
- Regresión local: 77 aprobadas y un fallo de tarjeta/reportes pendiente de E3. Las otras 21 pruebas de navegador no se repitieron.
- [Informe y límites](RESULTADOS_ERRORES_E2.md), [resultados](RESULTADOS_ERRORES_E2.json). E1 y sus informes se conservan.

### Revisión de errores — E3: comisiones y cierre completo

- La prueba de tarjeta/reportes conserva snapshots y backfill e incorpora resultados numéricos del cálculo vigente de Finanzas con merma, cortesías, ingresos y gastos; versiones/publicación se comprueban por separado.
- Cierre conjunto E1–E3: **101 pruebas aprobadas, incluidas 22 de navegador; ninguna fallida, omitida, inconclusa, bloqueada o histórica excluida**. Tres aliases deduplicados.
- Los siete fallos anteriores eran expectativas/simuladores desfasados y ahora verifican contratos vigentes. No se modificaron fórmulas ni aplicación; los informes previos se conservan.
- [Informe y límites](RESULTADOS_ERRORES_E3.md), [ejecución completa](RESULTADOS_ERRORES_E3.json).
