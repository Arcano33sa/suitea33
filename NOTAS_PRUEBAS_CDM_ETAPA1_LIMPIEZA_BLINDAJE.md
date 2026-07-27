# Suite A33 — Centro de Mando — Etapa 1/5

## Alcance aplicado

- Centro de Mando quedó organizado en siete bloques verticales a ancho completo.
- El evento visualizado se conserva de forma independiente del evento activo del POS.
- Consultar, buscar, seleccionar GLOBAL o usar accesos rápidos no cambia `currentEventId`.
- El cambio del evento activo del POS exige el botón **Usar en POS** y una confirmación visible.
- Se retiraron de Centro de Mando los componentes heredados indicados en el prompt.
- Se eliminó la lectura oculta del antiguo bloque de compras de Finanzas.
- No se modificaron datos, históricos, estructuras de IndexedDB, localStorage, Firebase ni JSON.

## Verificaciones ejecutadas

1. `node --check centro-mando/app.js`
2. `node tests/a33-cdm-etapa1.smoke.cjs`
3. `node tests/a33-cdm-etapa1-runtime.smoke.cjs`
4. Validación estructural de HTML con parser.
5. Búsqueda estática de referencias retiradas.
6. Comparación de archivos contra el ZIP base para confirmar que la lógica operativa modificada se limita a Centro de Mando.

## Resultado

Smoke test satisfactorio. La prueba gráfica automatizada con Chromium no estuvo disponible en el contenedor por limitaciones del proceso headless/DBus; la validación se completó mediante sintaxis, parser HTML, contratos estáticos y revisión de integridad del proyecto.
