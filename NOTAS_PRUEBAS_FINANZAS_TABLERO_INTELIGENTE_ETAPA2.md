# Suite A33 Finanzas — Tablero Inteligente Etapa 2/3

## Objetivo
Actualizar Tablero Finanzas para mostrar Caja, Bancos y multimoneda con saldos acumulados al cierre del período, usando Diario Contable como fuente central.

## Cambios realizados
- Se agregó cálculo multimoneda de liquidez desde `journalEntries`, `journalLines` y `accounts`.
- Se mantiene compatibilidad con `calcCajaBancoUntilDate`, ahora devolviendo equivalentes C$ y detalle interno.
- Se agregó lectura separada de:
  - Caja C$
  - Caja US$
  - Total caja equivalente C$
  - Bancos C$
  - Bancos US$
  - Bancos por banco/moneda
  - Total bancos equivalente C$
  - Total efectivo + bancos equivalente C$
- Se agregaron alertas informativas para:
  - USD sin T/C snapshot
  - USD sin monto original suficiente
  - moneda inferida por cuenta/nombre/código
  - movimientos legacy sin moneda explícita
  - banco no identificable
  - cuentas raíz/agrupadoras usadas en líneas de liquidez
- Se agregó texto visual aclarando que Caja y Bancos son saldos globales acumulados al corte y no se filtran por evento.
- Se hizo bump de versión a `4.20.79 r1` y query strings del módulo Finanzas.

## Restricciones respetadas
- No se modificó POS.
- No se modificaron cierres POS ni importación POS.
- No se modificó Diario Contable salvo lectura segura desde el Tablero.
- No se modificó Caja Chica.
- No se modificaron Catálogos ni bancos.
- No se reactivaron pestañas ocultas.
- No se tocaron Cuentas Financieras, Transferencias internas ni Compras a Proveedor.
- No se agregaron dependencias nuevas.
- No se crearon datos simulados.
- No se recalcularon históricos.
- No se usa T/C actual para recalcular USD históricos.

## Pruebas técnicas realizadas
- `node --check finanzas/script.js`: OK.
- Revisión estática de IDs nuevos del Tablero: OK.
- Revisión de versionado/query strings en Finanzas: OK.
- Verificación de que no se modificaron archivos POS: OK.
