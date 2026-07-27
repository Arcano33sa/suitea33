# Suite A33 — Catálogos — Vistas independientes — Etapa 2/2

## Hardening aplicado
- Navegación interna reforzada para Productos, Costos, Materia Prima, Envases, Tapas, Extras, Bancos y Clientes.
- Portada limitada a las ocho tarjetas; al abrir un apartado las tarjetas y paneles no activos quedan ocultos e inertes.
- Historial, `popstate`, hash, recarga y restauración de contexto reforzados.
- Restauración razonable del scroll al volver a Catálogos y scroll al inicio al entrar.
- Título visual y título del documento actualizados según el apartado activo.
- Foco accesible al entrar/salir y devolución del foco al cerrar modales.
- Prevención de interacciones sobre contenido oculto y de doble toque accidental.
- Barra interna sticky y responsive con áreas táctiles de 44 px.
- Mayor aprovechamiento de ancho en desktop y ajustes para iPad/móvil sin scroll horizontal general.
- Compatibilidad de contraste conservada en modo claro y oscuro.

## PWA y versión
- Versión general: 4.20.96 r1.
- Caché de Catálogos: revisión de módulo 37.
- Referencias versionadas de `index.html`, `style.css` y `script.js` actualizadas.
- Precaché validado sin rutas faltantes.
- Claves de almacenamiento, IndexedDB, Firebase, JSON y contratos de datos sin cambios.

## Smoke test ejecutado
- Sintaxis de 42 archivos JavaScript: OK.
- Estructura HTML: 8 tarjetas y 8 paneles correspondientes, sin IDs duplicados.
- Apertura/regreso de los ocho apartados: OK.
- Cinco ciclos adicionales de apertura/regreso: OK.
- Un solo panel visible y cero paneles debajo/superpuestos: OK.
- ARIA, `hidden`, `aria-hidden`, `aria-expanded`, `aria-current` e `inert`: OK.
- Modales: apertura, cierre, desbloqueo del body y devolución de foco: OK.
- Desktop, iPad horizontal, iPad vertical y móvil: cero scroll horizontal general.
- Cambio de orientación con apartado abierto: conserva el apartado y la navegación.
- Modo claro y oscuro: contraste visual revisado.
- Service Worker: sintaxis, caché y rutas precargadas validadas.
- Configuración → PWA y módulos ajenos: sin cambios de lógica; solo coherencia de versión general.
