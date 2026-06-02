# NOTAS — Finanzas Diario Contable Etapa 9C — iPad/PWA Catálogo

- Se blindó el render del Catálogo de Cuentas para que las 7 raíces se muestren aunque otra sección de Finanzas falle durante la carga.
- Se protegió `refreshAllFin()` con renders seguros por bloque para evitar que un error previo impida pintar Catálogo.
- Botón Actualizar del Catálogo ahora asegura raíces base y normalización antes de refrescar.
- Botón Nueva subcuenta hace recuperación previa de raíces si el cache local aún no cargó.
- Pintado preventivo de raíces al iniciar Finanzas, útil para iPad/PWA.
- Bump de release/cache a 4.20.77 r41 y query de Finanzas: style r27 / script r34.

Pruebas ejecutadas:
- node --check finanzas/script.js
- node --check assets/js/a33-release.js
