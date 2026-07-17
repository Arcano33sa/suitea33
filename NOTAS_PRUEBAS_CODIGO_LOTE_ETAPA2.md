# Suite A33 — Código de lote — Etapa 2/6

## Alcance aplicado

- Calculadora de Producción y Calculadora Temporal cargan `assets/js/a33-lot-code.js` como fuente oficial.
- Los nuevos códigos usan `A33{MES_HEBREO}{AÑO_HEBREO}-{CONSECUTIVO_COMPRIMIDO}`.
- Se eliminó de la generación nueva el día hebreo, la fecha gregoriana y el respaldo `OFF`.
- Ambos módulos validan por componentes y reconocen formatos históricos y nuevos.
- Los códigos históricos se conservan para consulta y no pueden reutilizarse como creación nueva sin pulsar **Regenerar**.
- Calculadora Temporal mantiene su consecutivo independiente y, al cargar histórico, conserva el código original sin reemplazar la fecha actual de trabajo.
- Las colisiones bloquean el guardado sin sobrescribir ni limpiar el formulario.
- Checklist conserva su persistencia por lote y muestra el código guardado desde el campo oficial existente.
- La PWA de Calculadora de Producción precachea el generador central y renueva su caché de módulo.

## Archivos funcionales modificados

- `calculadora/index.html`
- `calculadora_temporal/index.html`
- `calculadora/sw.js`

## Smoke tests

```bash
node tests/a33-lot-code.smoke.cjs
node tests/a33-lot-code-calculators.smoke.cjs
```

También se ejecutó validación sintáctica de los scripts inline de ambas calculadoras y del Service Worker.
