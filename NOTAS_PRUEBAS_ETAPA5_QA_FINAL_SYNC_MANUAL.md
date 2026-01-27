# Suite A33 — POS > Caja Chica
## ETAPA 5 — QA FINAL (Sync Finanzas → POS + Manual)

**Objetivo:** validar que el Sync (Finanzas → POS) deje evidencia real (**Último Sync**), sea **idempotente** (mismo snapshot no re-aplica), y que los fallos expliquen el **Motivo técnico** (sin mensajes genéricos).

### Referencias rápidas
- Snapshot de Finanzas en POS se lee desde: `localStorage['a33_finanzas_caja_chica_v1']`.
- El panel **Estado** en Caja Chica muestra: Activo, UI, Último Sync, Motivo y chips de flags.
- En **Diagnóstico/Forense** se ve `snapshotSig` y hashes antes/después para confirmar readback.

### Caso A — Snapshot no existe → `SNAPSHOT_MISSING`
**Preparación:** en POS, abrir DevTools → Application → Local Storage y borrar la llave `a33_finanzas_caja_chica_v1`.

**Pasos:**
1) Ir a POS → Caja Chica.
2) Encender el switch “Usar saldo inicial desde Finanzas”.
3) Presionar **Sincronizar**.

**Esperado:**
- Toast de error con sufijo **(SNAPSHOT_MISSING)**.
- Estado muestra mensaje con CTA: **Ir a Finanzas**.
- “Último Sync” NO cambia.

### Caso B — Snapshot corrupto → `SNAPSHOT_PARSE_ERROR`
**Preparación:** setear `a33_finanzas_caja_chica_v1` a texto inválido (ej.: `{bad-json`).

**Pasos:**
1) POS → Caja Chica.
2) Presionar **Sincronizar**.

**Esperado:**
- Toast de error con sufijo **(SNAPSHOT_PARSE_ERROR)**.
- Motivo técnico menciona parse/JSON (detalle corto).
- “Último Sync” NO cambia.

### Caso C — Snapshot válido → aplica + evidencia “Último Sync”
**Preparación:** en Finanzas, guardar Caja Chica y volver a POS.

**Pasos:**
1) POS → Caja Chica.
2) Switch ON.
3) Presionar **Sincronizar**.

**Esperado:**
- Toast de éxito: “Aplicado desde Finanzas”.
- Estado: “Aplicado desde Finanzas: DD/MM/YYYY HH:MM”.
- Panel Estado: **Último Sync** se actualiza SOLO en este caso.
- Diagnóstico: `snapshotSig` visible (no “—”).

### Caso D — Repetir mismo snapshot → `YA_APLICADO` (idempotente)
**Pasos:**
1) Sin cambiar nada en Finanzas, presionar **Sincronizar** de nuevo.

**Esperado:**
- Estado: “Ya aplicado …”.
- Toast de éxito corto (no error).
- No hay cambios en cantidades.
- “Último Sync” permanece igual (no se re-escribe por reintento idempotente).

### Caso E — Guardar manual con Sync OFF → OK + persistencia
**Pasos:**
1) Apagar el switch de Sync.
2) Ingresar cantidades en saldo inicial.
3) Presionar **Guardar saldo inicial**.
4) Recargar la página.

**Esperado:**
- Guardado manual funciona aunque el switch esté OFF.
- Tras recarga, los valores permanecen.
- No aparece bloqueo cruzado por Sync.

### Caso F — Colisiones legacy presentes → se reparan (o Motivo lo explica) y luego OK
**Objetivo:** verificar que, si existen llaves legacy por día, el sistema sanea sin misterio.

**Pasos sugeridos:**
1) Abrir POS → Caja Chica en un evento con data vieja.
2) Revisar Diagnóstico: debe aparecer “Caja Chica · Saneamiento/Limpieza” si hubo reparación.
3) Luego intentar **Sincronizar**.

**Esperado:**
- Si hubo duplicados, el saneamiento se aplica de forma idempotente y queda registrado en Diagnóstico.
- Si no se puede persistir la reparación, el Motivo técnico explica (por ejemplo: `DUP_DAY_COLLISION`, `IDB_ABORT`), sin mensaje genérico.
- Tras quedar estable, Sync aplica correctamente y deja “Último Sync”.

### Caso G — Multi‑tab (si aplica) → `IDB_BLOCKED` visible
**Objetivo:** que no exista “misterio” cuando IndexedDB se bloquea por otra pestaña.

**Pasos:**
1) Abrir POS en 2 pestañas (A y B).
2) En A, quedarse en Caja Chica.
3) En B, recargar duro (Cmd/Ctrl+Shift+R) y navegar a Caja Chica.
4) Intentar **Sincronizar** o guardar manual desde una de las pestañas.

**Esperado:**
- Si ocurre bloqueo, el toast/diagnóstico reporta **(IDB_BLOCKED)**.
- El Estado muestra Motivo técnico (no genérico).
- No se borran inputs sin confirmación de guardado.

---
## Criterios de aceptación
- Sync funciona y deja evidencia: **Último Sync**.
- Errores se reportan con motivo técnico: `SNAPSHOT_MISSING`, `SNAPSHOT_PARSE_ERROR`, `SNAPSHOT_SHAPE_INVALID`, `IDB_BLOCKED`, etc.
- Idempotencia: mismo snapshot → “Ya aplicado”, sin re-aplicar.
- Manual y Sync conviven: manual no se rompe por toggle.
- UI iPad‑friendly (sin scroll horizontal; pills compactas).
