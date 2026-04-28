# NOTAS PRUEBAS — ETAPA 8 — Firebase contexto real mínimo

## Objetivo validado
- Usuario real en Firestore.
- Espacio de trabajo real en Firestore.
- Vínculo usuario ↔ espacio en subcolección `members`.
- Base lista para miembros y roles `ADMIN` / `MIEMBRO`.

## Flujo manual sugerido
1. Abrir **Configuración > Acceso**.
2. Guardar config Firebase local si aún no existe.
3. Iniciar sesión con un usuario real de Firebase Auth.
4. Abrir **Configuración > Espacio compartido**.
5. Confirmar que aparezcan:
   - correo/UID del usuario,
   - nombre/ID del espacio,
   - rol `ADMIN`,
   - estado del vínculo.
6. Pulsar **Preparar / reparar contexto** y verificar que no falle.

## Estructura mínima esperada
- `users/{uid}`
- `workspaces/{workspaceId}`
- `workspaces/{workspaceId}/members/{uid}`

## Si falla
- Verificar que **Firestore Database** exista en Firebase Console.
- Verificar que el usuario esté autenticado.
- Si aparece `permission-denied`, usar reglas que permitan al usuario autenticado leer/escribir su contexto base.
