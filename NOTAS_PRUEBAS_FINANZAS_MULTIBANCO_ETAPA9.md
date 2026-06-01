# Suite A33 Finanzas — Multibanco y Multimoneda — Etapa 9/10

## Cambios implementados

- Se agregó dentro de **Finanzas → Estados Financieros** el bloque de **Reportes Contables** multicuenta y multimoneda, sin crear un módulo paralelo.
- Se añadieron subtabs nuevos:
  - Mayor por cuenta
  - Estado de cuenta financiera
  - Balanza de comprobación
  - Libro Diario mejorado
  - Resumen por moneda
- Los reportes leen `journalEntries`, `journalLines`, `accounts` y `financialAccounts` locales.
- La cuenta **1200 Banco legacy / histórico** se mantiene visible para reportes históricos y se agregó como opción virtual en Estado de cuenta cuando no existe como cuenta financiera activa.
- Los movimientos USD muestran monto original, T/C snapshot y equivalente C$ cuando la metadata existe.
- Los movimientos legacy sin metadata se tratan como C$ legacy, sin inventar moneda ni recalcular históricos.
- Se agregaron exportaciones Excel para los cinco reportes nuevos.
- No se modificó POS, Caja Chica, Firebase, Configuración → Moneda ni la lógica de registro de Diario/Transferencias/Compras/Recibos.

## Validaciones estáticas realizadas

- `node --check finanzas/script.js` ejecutado correctamente.
- Se revisó que los nuevos accesos queden dentro de la vista existente de Estados Financieros.
- Se incrementaron query strings de Finanzas:
  - `style.css` r17 → r18
  - `script.js` r21 → r22

## Notas funcionales

- La Balanza no corrige descuadres: solo muestra advertencia visual si DEBE y HABER no cuadran.
- El Estado de cuenta calcula saldos principales en US$ solo cuando existe metadata original suficiente; si falta, no inventa USD.
- El Resumen por moneda usa cuentas financieras/caja/bancos como base de actividad para evitar duplicar contraparte contable.
