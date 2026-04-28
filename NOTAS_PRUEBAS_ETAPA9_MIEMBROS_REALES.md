# Suite A33 — Etapa 9/11 — Miembros reales, unión por código y roles reales

## Smoke técnico ejecutado
- `node --check assets/js/a33-firebase-workspace.js`
- `node --check assets/js/a33-firebase-members.js`
- `node --check` sobre el script inline extraído desde `index.html`

## Cobertura funcional preparada
- Usuarios y Roles ahora consume miembros reales desde Firestore.
- Unión por código `A33-XXXX-XXXX`.
- Generación y revocación de código activo por ADMIN.
- Cambio real de rol `ADMIN` / `MIEMBRO`.
- Remoción operativa marcando membresía como `REMOVIDO`.
- Hardening base: si falta membresía activa, el contexto ya no se re-crea como `OWNER/ADMIN` por accidente.

## Paso externo mínimo
- Publicar `firebase/firestore.rules` en Firebase Console > Firestore Database > Reglas.
