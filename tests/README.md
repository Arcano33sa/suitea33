# Pruebas de Suite A33

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
