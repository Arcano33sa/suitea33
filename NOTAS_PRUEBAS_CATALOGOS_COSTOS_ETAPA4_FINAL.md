# Suite A33 — Catálogos → Costos — Etapa 4/4

Fecha y hora de cierre: 10/07/2026 13:53 (America/Managua)

## Implementación cerrada

- Esquema de Costos actualizado a versión 2 sin cambiar la llave histórica `a33_catalog_costos_v1`.
- Costos de Botella y Calcomanía guardados por ID estable del producto.
- Datos de productos inactivos, desmarcados de Receta o borrados se conservan en almacenamiento.
- Productos nuevos no heredan consumibles de productos borrados por nombre o volumen.
- Total por producto calculado al vuelo: cinco líquidos + Botella + Calcomanía.
- Total de solo lectura, formato C$ con dos decimales y separadores de miles.
- Resumen compacto de productos, completos y pendientes.
- Estado vacío controlado cuando no hay productos activos con Receta.
- Validaciones de negativos, ML cero con Precio, vacíos y resultados no finitos.
- Inputs numéricos con `inputmode="decimal"` y selección completa al enfocar.
- Scroll horizontal limitado al contenedor de la tabla.
- Caché de Catálogos incrementada a módulo r23; JS r23 y CSS r19.

## Pruebas ejecutadas

- Sintaxis de `catalogos/script.js`: OK.
- Sintaxis de `catalogos/sw.js`: OK.
- Estructura HTML de Costos: OK.
- Migración compatible de esquema 1 a esquema 2: OK.
- Persistencia por ID y conservación de históricos: OK.
- Producto nuevo sin herencia de costos borrados: OK.
- Validación de consumible negativo: OK.
- Validación de ML cero con Precio: OK.
- Cálculo unitario controlado: C$12.96 en escenario de prueba: OK.
- Formato monetario C$1,245.50: OK.
- Protección contra NaN, undefined e Infinity: OK.
- Revisión de cambios: solo Catálogos (HTML, JS, CSS y SW) más estas notas.
- Verificación de referencias de caché r23/r19: OK.
- No se detectaron operaciones de limpieza de localStorage ni borrado de base de datos agregadas.

La comprobación final en un iPad físico y como PWA instalada corresponde al smoke test posterior al despliegue; el código responsive, el Service Worker y la caché quedaron preparados para esa validación.
