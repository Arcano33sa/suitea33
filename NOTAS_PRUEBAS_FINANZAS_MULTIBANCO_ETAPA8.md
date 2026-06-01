# Suite A33 Finanzas — Multibanco y Multimoneda — Etapa 8/10

## Objetivo
Actualizar Recibos para registrar cobros nuevos con cuenta financiera específica, moneda original, T/C snapshot si aplica y equivalente contable en C$.

## Cambios realizados
- Se agregó selector de Cuenta financiera de cobro en Recibos.
- El selector consume Cuentas Financieras activas existentes.
- La moneda del recibo se detecta desde la cuenta financiera seleccionada.
- En cuentas C$ se guarda total original C$ y equivalente C$ igual al total.
- En cuentas US$ se lee el T/C desde Configuración → Moneda, se calcula equivalente C$ y se guarda snapshot histórico.
- Se bloquea el guardado de recibos US$ si no existe T/C válido.
- Se enriqueció listado, vista/impresión y metadata de recibos sin recalcular recibos históricos.
- No se agregó integración contable nueva porque Recibos no generaba asientos previamente.
- No se tocó Firebase, Caja Chica, Transferencias Internas ni Compras a Proveedor.

## Pruebas técnicas ejecutadas
- `node --check finanzas/script.js`
- `node --check` sobre todos los archivos `.js` del proyecto.

## Nota
No se ejecutó prueba visual con navegador porque el entorno no tiene Chromium/Playwright instalado. La revisión realizada fue estática y de sintaxis.
