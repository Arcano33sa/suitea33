# Suite A33 — Moneda Etapa 8/9: POS

## Cambios aplicados
- POS lee el T/C central desde `A33Currency` / Configuración → Moneda.
- El cobro USD con vuelto en C$ usa el T/C central y bloquea conversiones si no existe T/C.
- Los visores/campos de T/C en POS quedan protegidos como lectura desde Moneda.
- Ventas y cierres históricos no se recalculan ni se migran.
- No se muestra ni se agrega comisión por venta.
- Se incrementó revisión/cache POS a r9 para PWA.

## Validaciones realizadas
- `node --check pos/app.js`
- `node --check pos/sw.js`
- `node --check assets/js/a33-release.js`
- `node --check assets/js/a33-currency.js`
- Revisión estática de referencias de cache POS r9.
