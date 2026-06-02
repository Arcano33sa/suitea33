# Suite A33 Finanzas — Diario Contable Etapa 1/9

## Resumen
- Preparación interna no destructiva para Catálogo de Cuentas jerárquico.
- Definición de raíces fijas futuras: 1000, 2000, 3000, 4000, 5000, 6000 y 7000.
- Helpers de compatibilidad legacy, cuentas posteables, código automático sugerido y etiqueta automática futura.
- Metadatos jerárquicos seguros agregados solo si faltan; no se borran cuentas ni históricos.
- POS, Firebase, Configuración → Moneda y Caja Chica no fueron modificados.

## Validaciones técnicas ejecutadas
- node --check finanzas/script.js
- node --check assets/js/a33-release.js
- Verificación de ausencia de .git en el ZIP final
