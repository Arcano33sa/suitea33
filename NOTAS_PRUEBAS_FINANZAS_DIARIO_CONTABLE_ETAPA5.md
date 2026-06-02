# Suite A33 Finanzas — Diario Contable Etapa 5/9

## Cambios aplicados
- Se creó helper central `getPostableAccountsForSelector()` / `getSelectablePostingAccounts()` para obtener únicamente cuentas activas, posteables, no raíz, no agrupadoras, sin hijos, no legacy y no bloqueadas para posteo.
- Se agregó selector reutilizable `createAccountSelect()` con aliases `renderAccountSelector()` y `setupAccountSearchSelector()`.
- Se agregó modal `openAccountPicker()` con búsqueda por código, nombre, tipo, naturaleza, ruta y moneda.
- Se integró una prueba segura dentro de Finanzas → Catálogo de Cuentas, sin registrar movimientos ni sustituir Diario y Ajustes.
- Se conservó intacta la lógica actual de Diario, POS, Firebase, Moneda, Caja Chica y reportes.
- Se hizo bump conservador de release/cache a `4.20.77 r36`, `finanzas/script.js r28` y `finanzas/style.css r23`.

## Pruebas realizadas
- `node --check finanzas/script.js` sin errores.
- Prueba aislada en Node/VM del helper `getPostableAccountsForSelector()` confirmando que excluye raíces, agrupadoras e inactivas, y devuelve cuentas posteables activas.
- Revisión estática de `finanzas/index.html`, `finanzas/style.css` y `assets/js/a33-release.js`.
- Verificación de que no se agregaron dependencias nuevas.
- Verificación de que no se generaron formatos TXT/CSV financieros.
- Verificación de que no se modificaron archivos POS ni rutas Firebase.

## Alcance respetado
- No se creó todavía el Diario Contable visual.
- No se sustituyó Diario y Ajustes.
- No se crearon cuentas automáticamente.
- No se cargó catálogo grande.
- No se borraron históricos ni movimientos legacy.
