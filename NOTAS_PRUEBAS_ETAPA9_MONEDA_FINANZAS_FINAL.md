# Suite A33 — Moneda Etapa 9/9: Finanzas, bancos y cierre final

## Cambios aplicados
- Finanzas lee la configuración central de Moneda mediante `A33Currency` / `A33ExportCurrency`.
- Se agregó una referencia monetaria discreta en Finanzas: C$ / NIO, US$ / USD, T/C y aviso seguro cuando no hay T/C.
- El formato monetario visible en Finanzas usa helpers centrales sin recalcular históricos.
- Banco / Caja se mantienen como saldos base en C$; no se alteran movimientos ni saldos históricos.
- Exportaciones financieras continúan exclusivamente en Excel y agregan hoja de referencia monetaria cuando aplica.
- No se generaron TXT ni CSV para Finanzas.
- Se mantuvo la regla de no inventar T/C y no convertir valores sin T/C configurado.
- Se incrementó revisión global/cache a r10 y referencias compartidas de Moneda para evitar archivos viejos en PWA.

## Validaciones estáticas realizadas
- `node --check finanzas/script.js`
- `node --check pos/app.js`
- `node --check pos/sw.js`
- `node --check assets/js/a33-release.js`
- `node --check assets/js/a33-build.js`
- `node --check assets/js/a33-currency.js`
- `node --check assets/js/a33-export-currency.js`
- `node --check` en service workers de POS, Inventario, Lotes, Pedidos y Centro de Mando.
- Búsqueda de exportaciones TXT/CSV en Finanzas: sin coincidencias.
- Búsqueda de referencias antiguas de `a33-release`, `a33-currency` y `a33-export-currency`: sin referencias viejas.

## Criterios de cierre
- Moneda base: C$ / NIO.
- Moneda secundaria: US$ / USD.
- T/C no se inventa.
- Finanzas no recalcula históricos.
- Banco no recalcula movimientos históricos.
- POS conserva la regla de no mostrar comisión por venta; la comisión solo permanece en configuración de bancos/tarjetas.
