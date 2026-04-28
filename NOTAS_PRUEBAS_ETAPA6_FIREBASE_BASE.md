# NOTAS — PRUEBAS MANUALES — ETAPA 6 — FIREBASE BASE

Objetivo: confirmar que la Suite A33 queda preparada para Firebase sin romper el flujo actual y que el diagnóstico es claro cuando falta la configuración real.

## 1) Entrada a Configuración
1. Abrir `index.html`.
2. Entrar a **Configuración**.
3. Confirmar que aparecen 4 carriles:
   - Vista general
   - Respaldo
   - Usuarios y Roles
   - Firebase base
   - Ajustes globales

## 2) Firebase base sin config real
1. Abrir **Firebase base** con el placeholder intacto.
2. Verificar:
   - La suite no se cae.
   - El estado indica que falta configuración real.
   - Se muestran claves pendientes.
   - El host actual y el origen se reflejan en el diagnóstico.

## 3) Botones del diagnóstico
1. Pulsar **Refrescar diagnóstico**.
2. Confirmar que la vista se vuelve a renderizar sin errores.
3. Pulsar **Probar base Firebase**.
4. Sin config real, debe mantenerse el diagnóstico seguro sin romper la app.

## 4) Regresión de Usuarios y Roles
1. Entrar a **Usuarios y Roles**.
2. Confirmar CRUD local:
   - agregar
   - editar
   - asignar rol
   - borrar
3. Confirmar que sigue persistiendo en el navegador actual.

## 5) Respaldo
1. Exportar JSON.
2. Confirmar que no cambia el formato del respaldo.
3. Confirmar que la importación sigue disponible.

## Resultado esperado
- La base técnica de Firebase queda visible y aislada.
- No hay login real todavía.
- La app sigue funcional aunque no exista config real.
- Queda lista para la siguiente etapa.
