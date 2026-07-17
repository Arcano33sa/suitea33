# Suite A33 — Código de lote — Etapa 6/6 — Hardening final

## Ajustes aplicados
- Versión global actualizada a `4.20.95 r1`, con coherencia entre `A33_RELEASE`, `a33-build`, HTML, manifests y Service Workers.
- Recurso central `a33-lot-code.js` actualizado a revisión `r=6` en consumidores y precaché.
- Eliminados generadores eco duplicados y la lectura heredada por posiciones fijas en Calculadora y Calculadora Temporal.
- Calculadora Temporal ahora cuenta con Service Worker acotado a su propio módulo y precaché del generador oficial.
- Código completo visible/adaptable en Calculadoras y Lotes, sin elipsis del Código de lote ni scroll horizontal general provocado por ese campo.
- Cachés de módulos renovadas sin tocar localStorage, IndexedDB, Firebase ni históricos.

## Validaciones ejecutadas
- Compresión obligatoria: 0001, 0002, 0010, 0011, 0111, 1000, 1111 y 1010.
- AV, Kislev, Adar I, Adar II, cambio de mes y cambio de año hebreo.
- Consecutivo numérico separado e intacto antes/después de cambios hebreos.
- Históricos literales sin migración ni recálculo.
- Integración Calculadoras, Lotes, Checklist, Inventario, POS, Reempaque, Costos, Cortesías, Analítica, Centro de Mando, JSON, Excel y Firebase mediante pruebas automáticas existentes.
- Sintaxis de todos los JavaScript externos y scripts inline.
- Existencia de todos los assets declarados en precaché PWA.
- Coherencia de versiones y ausencia de referencias activas a `4.20.94`.

## Resultado
- Smoke técnico automático: OK.
- Firebase se validó con el mock de sincronización incluido en la Etapa 5; no se ejecutó una escritura live por no disponer de sesión/credenciales remotas en este entorno.
- Responsive se validó por reglas y contratos estáticos; no sustituye una prueba física final en cada modelo de iPad/móvil.
