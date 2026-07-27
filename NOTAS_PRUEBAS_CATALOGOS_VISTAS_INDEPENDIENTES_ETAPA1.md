# Suite A33 — Catálogos — Vistas independientes — Etapa 1/2

## Alcance aplicado
- Portada inicial con las ocho tarjetas y sin panel precargado.
- Apertura de cada catálogo como vista interna completa.
- Navegación interna común: «← Catálogos» y «⌂ Menú principal».
- Historial con `pushState`/`popstate`, sin duplicar entradas por doble toque.
- Conservación de formularios, listados, modales y lógica CRUD existentes.
- Sin cambios de almacenamiento, datos, inventario, producción, ventas, finanzas ni Firebase.

## Validaciones
- Sintaxis JavaScript.
- Smoke automatizado de estructura y navegación.
- Apertura/regreso de Productos, Costos, Materia Prima, Envases, Tapas, Extras, Bancos y Clientes.
- Un solo panel visible.
- Estados ARIA y ocultamiento real.
- Atrás del navegador/PWA mediante `popstate`.
- Cierre de modal existente.
- Desktop, iPad horizontal, iPad vertical y móvil sin scroll horizontal general.
- Modo claro y oscuro.
