# Suite A33 — Código de lote — Etapa 1/6

## Alcance aplicado

- Se agregó `assets/js/a33-lot-code.js` como fuente oficial reutilizable del nuevo Código de lote.
- No se conectó todavía el generador a Calculadora de Producción, Calculadora Temporal ni otros consumidores.
- No se modificaron consecutivos, lotes, inventario, producción, costos, almacenamiento ni Firebase.

## Formato nuevo

`A33{MES_HEBREO}{AÑO_HEBREO}-{CONSECUTIVO_COMPRIMIDO}`

Ejemplo: `A33KIS5786-0xx1`.

## Meses

Se conservan las abreviaturas históricas derivadas de la lógica existente. Ajustes puntuales:

- `Av` → `AV`.
- `Adar I` → `ADI`.
- `Adar II` → `ADII`.

## Smoke test

Ejecutar desde la raíz del proyecto:

```bash
node tests/a33-lot-code.smoke.cjs
```

El test cubre compresión, Kislev 5786, Av 5786, ausencia de `OFF`, ausencia de año gregoriano, Adar I/II, formato histórico y formato nuevo.
