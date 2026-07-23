# Suite A33 — Catálogos: reparación de edición y limpieza visual

Fecha y hora de entrega: 23/07/2026 11:06

## Cambios aplicados
- Se restauró la función compartida para abrir y cerrar ventanas modales de Catálogos.
- Envases, Tapas, Extras y Bancos vuelven a abrir su ventana de edición al presionar Editar.
- Se conectaron los controles Guardar cambios, Cancelar y Cerrar de las cuatro ventanas.
- Se habilitó cierre por clic en el fondo y tecla Escape.
- Se mantiene el bloqueo de desplazamiento del fondo mientras una ventana está abierta.
- Se eliminó por completo el bloque introductorio superior de Catálogos y la franja “Datos maestros”.
- No se alteraron registros, fuentes de datos, POS, Inventario, Producción, Lotes, Finanzas, Firebase ni JSON.
- Se incrementó el caché del Service Worker de Catálogos y sus referencias de actualización.

## Pruebas realizadas
- `node --check catalogos/script.js`: OK.
- `node --check catalogos/sw.js`: OK.
- Smoke test nuevo de modales, cierres, limpieza visual y caché PWA: OK.
- Regresión Lotes Disponibilidad Etapa 3: 19/19 OK.
- Regresión Lotes Disponibilidad Etapa 2: 11/11 OK.
- Regresión Código de lote Etapa 6: OK.
- Parseo de HTML de Catálogos: OK.

## Alcance del smoke
La apertura/cierre de ventanas se verificó mediante simulación del DOM y revisión de contratos HTML/JS. El entorno de pruebas automatizado disponible bloqueó la navegación de Chromium por política administrativa, por lo que no se declara una prueba física en Safari o Chrome real desde este contenedor.
