# Suite A33 — Etapa 5/11 — Configuración: CRUD local provisional de Usuarios y Roles

## Validaciones rápidas realizadas
- Alta local de usuario con persistencia en `a33_configuracion_usuarios_roles_ui_v1`.
- Edición local de nombre/correo/estado/alcance/notas.
- Cambio local de rol entre `ADMIN` y `MIEMBRO`.
- Borrado local completo, incluyendo caso de lista vacía.
- Prevención de correos duplicados en la base local.
- Revisión sintáctica del script inline con `node --check`.

## Resultado esperado
- La sección **Configuración > Usuarios y Roles** ya opera como CRUD provisional/local.
- Sigue dejando claro que **no es seguridad real** ni bloqueo de módulos.
- La base local puede reconstruirse desde cero o restaurarse con el ejemplo visual.
