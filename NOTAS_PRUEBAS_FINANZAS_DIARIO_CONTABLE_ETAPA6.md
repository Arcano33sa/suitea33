# Suite A33 Finanzas — Diario Contable Etapa 6/9

## Cambios aplicados

- Se sustituyó visualmente la parte superior de Finanzas → Diario y Ajustes por el nuevo formulario de Diario Contable.
- La sección visible ahora se muestra como “Diario Contable” sin crear una sección duplicada.
- Se agregó cabecera de asiento con fecha automática editable, moneda C$/US$, descripción general, referencia opcional y T/C de Configuración → Moneda para US$.
- Se agregaron líneas múltiples Cuenta / Debe / Haber usando el selector contable reutilizable de Etapa 5.
- Se implementó validación visual: mínimo dos líneas, cuentas posteables activas, Debe/Haber excluyentes, sin negativos, cuadre Debe = Haber y T/C obligatorio para US$.
- Se agregó botón “Validar asiento” sin persistencia real: no crea asientos definitivos ni movimientos en historial.
- Se mantuvo el historial inferior visible y funcional.
- Se reubicaron filtros del historial dentro del panel de historial, debajo del nuevo formulario.
- Se hizo bump conservador de release/revisión y query strings de Finanzas.

## Protección de alcance

- No se modificó POS.
- No se modificó Firebase.
- No se modificó Caja Chica.
- No se modificaron reportes ni exportaciones Excel.
- No se crearon rutas Firebase nuevas.
- No se generaron archivos TXT ni CSV.
- No se agregaron dependencias nuevas.
- No se guardan asientos definitivos en esta etapa.

## Pruebas realizadas

- `node --check` en todos los archivos JS propios del proyecto: OK.
- Validación estructural básica de `finanzas/index.html`: OK.
- Confirmación estática de que el formulario legacy `form-movimiento` ya no existe visualmente en Finanzas.
- Confirmación de que existe el nuevo `form-diario-contable`, líneas iniciales dinámicas, totales, estado visual y botón de validación.

## Nota

La prueba de navegador con Playwright no pudo ejecutarse por restricción del entorno sobre navegación local; se completaron pruebas estáticas y de sintaxis sin errores.
