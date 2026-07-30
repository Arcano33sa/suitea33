# Suite A33 — POS — Cliente Rápido — Etapa 2/3

## Alcance aplicado
- POS y Catálogos conservan una sola fuente oficial: `a33_pos_customersCatalog`.
- El cliente creado desde POS queda seleccionado y disponible en el selector sin catálogo paralelo.
- Catálogos → Clientes relee la fuente compartida al abrir el apartado, volver a la página, recuperar foco o recibir cambios de otra pestaña.
- Agrupación visual por la inicial del Nombre, ignorando espacios iniciales, mayúsculas/minúsculas y tildes para la letra base.
- Orden alfabético estable dentro de cada letra, con comparación natural para números.
- Celular opcional: cuando está vacío, la tabla no muestra `undefined` ni guiones artificiales.
- Detección consistente de duplicados por nombre normalizado en POS y Catálogos.
- Edición conserva el mismo identificador, historial y referencias; al cambiar el Nombre, el registro pasa a la letra correspondiente.
- Debounce y token de render para evitar actualizaciones dobles o cruzadas.
- Listeners de actualización del POS protegidos contra enlaces duplicados.
- Bump local de caché PWA en POS y Catálogos para servir los JavaScript actualizados.

## Validaciones ejecutables
```bash
node --check pos/app.js
node --check pos/sw.js
node --check catalogos/script.js
node --check catalogos/sw.js
node tests/a33-pos-cliente-rapido-etapa1.smoke.cjs
node tests/a33-pos-cliente-rapido-etapa2.smoke.cjs
node tests/a33-pos-efectivo-etapa1-creditos.smoke.cjs
node tests/a33-pos-efectivo-etapa2-blindaje.smoke.cjs
node tests/a33-pos-efectivo-etapa3-cdm-creditos.smoke.cjs
```

## Cobertura del smoke de Etapa 2
- Fuente oficial única y persistencia compartida.
- Creación desde POS, selección automática y confirmación de persistencia.
- Casos Ana, Carlos, María, Carmen, Cecilia y Álvaro.
- Celular presente y Celular vacío.
- Agrupación A, C, M, números y símbolos.
- Orden alfabético dentro de C.
- Duplicados por espacios, tildes y mayúsculas/minúsculas.
- Conservación de ID durante edición y trazabilidad de cambio de Nombre.
- Actualización al abrir Clientes, `storage`, `pageshow`, foco y visibilidad.
- Responsive estructural, scroll interno, modo claro y contención de nombres largos.
- Versionado y precaché PWA de POS y Catálogos.
