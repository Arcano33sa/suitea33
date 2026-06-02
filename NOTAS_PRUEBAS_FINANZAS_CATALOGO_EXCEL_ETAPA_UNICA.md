# Suite A33 Finanzas — Catálogo de Cuentas desde Excel depurado

## Alcance aplicado

- Se cargó en Finanzas el catálogo depurado proveniente de `Catalogo_Cuentas_Arcano33_Recomendado_v2.xlsx`.
- Se mantuvieron las 7 raíces fijas: 1000, 2000, 3000, 4000, 5000, 6000 y 7000.
- Las cuentas del Excel se precargan como cuentas de usuario visibles del Catálogo de Cuentas.
- No se creó importador Excel permanente ni botón nuevo de importación.
- No se tocó Firebase ni se agregaron rutas nuevas.
- No se recalculan históricos ni se limpian datos locales.

## Validación del Excel

- Total de filas útiles del catálogo: 179.
- Raíces fijas detectadas: 7.
- Cuentas de usuario cargadas desde Excel: 172.
- Duplicados de código: 0.
- Padres faltantes: 0.
- Niveles inválidos: 0.
- Cuentas posteables con hijas: 0.

## Comportamiento esperado

- Las raíces siguen protegidas, visibles, no posteables y válidas como cuenta padre.
- Las agrupadoras no aparecen en el selector del Diario Contable.
- Las posteables activas aparecen en el selector del Diario Contable y se buscan por código/nombre.
- Las cuentas cargadas desde Excel no heredan candados legacy, `systemProtected`, `isLegacy`, `isCash`, `isBank` ni `financialAccount`.
- Si un código legacy coincide con el Excel, se reclama para el árbol visible como cuenta de usuario del catálogo.
- Si el usuario edita una cuenta ya cargada, la semilla no debería machacar su edición en recargas posteriores.

## Pruebas estáticas ejecutadas

- `node --check finanzas/script.js`
- `node --check` sobre los archivos JS del proyecto, excluyendo vendor.
- Simulación en Node/VM del flujo `ensureBaseAccounts()` + `normalizeAccountsCatalog()` con almacenamiento en memoria:
  - cuentas visibles: 179
  - raíces visibles: 7
  - cuentas posteables seleccionables: 112
  - 1100 queda como `Efectivo`, agrupadora, editable/no legacy
  - 1200 queda como `Bancos`, agrupadora, editable/no legacy
  - 1111 queda posteable y seleccionable

## Versionado/cache

- A33 release actualizado a `4.20.77 r43`.
- Query string de `finanzas/script.js` actualizado a `r=36`.
- Referencias a `a33-release.js` actualizadas a `r=43`.
