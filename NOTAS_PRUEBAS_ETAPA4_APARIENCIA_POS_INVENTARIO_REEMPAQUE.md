# Suite A33 — Apariencia Etapa 4/5

## Alcance aplicado
- POS conectado al puente global de Apariencia.
- Inventario conectado al puente global de Apariencia.
- Reempaque dentro del POS tematizado visualmente en modo claro.
- Se agregaron overrides visuales para fondos, tarjetas, formularios, tablas, badges, botones, modales y barra inferior.

## Cuidado de lógica
No se modificó app.js del POS ni lógica de ventas/inventario/reempaque.
En Inventario solo se actualizó la URL de registro del service worker para bump de caché.

## PWA
- POS: cache local r33.
- Apariencia/global: r6.
- Inventario: r6.
- Service workers precargan a33-theme.css y a33-theme.js.

## Validación estática realizada
- node --check en scripts propios.
- Revisión de referencias de tema global en POS e Inventario.
- Revisión de ausencia de cambios en app.js del POS.
