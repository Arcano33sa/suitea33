# Suite A33 — POS > Caja Chica — Notas de pruebas (Etapa 1: Evidencia forense en UI)

**Objetivo:** que cualquier fallo deje **Motivo técnico** + **Detalle (forense)** visible en el panel **Estado** (sin consola).

## Dónde mirar
POS → **Caja Chica** → panel **Estado**:
- **Último:** Acción + OK/ERROR
- **Motivo técnico:** código
- **Detalle:** frase corta
- **Detalle (forense):** (colapsable) muestra `eventId`, `dayKey`, `normalizedDay`, `snapshotSig`, `before`, `after`.

---

## Caso A — Sync con toggle OFF → `TOGGLE_SYNC_OFF`
**Preparación:** en el Evento activo, apagar el switch **“Sincronizar con Finanzas”**.
1) Caja Chica → tocar **Sincronizar**.
2) Verificar:
   - Último: **Sincronizar ERROR**
   - Motivo técnico: **TOGGLE_SYNC_OFF**
   - Detalle: menciona que el toggle está apagado.
   - Forense: `snapshotSig` debe quedar en **—**.

## Caso B — Sync sin snapshot → `SNAPSHOT_MISSING`
**Preparación:** en el navegador, abrir DevTools → Application/Storage → Local Storage y eliminar `a33_finanzas_caja_chica_v1` (o usar un ambiente sin Finanzas configurada).
1) Caja Chica → tocar **Sincronizar**.
2) Verificar:
   - Motivo técnico: **SNAPSHOT_MISSING**
   - Detalle: “Sin snapshot de Finanzas”.

## Caso C — Sync con snapshot corrupto → `SNAPSHOT_PARSE_ERROR`
**Preparación:** en Local Storage, poner `a33_finanzas_caja_chica_v1` con texto inválido (ej.: `{{{` ).
1) Caja Chica → **Sincronizar**.
2) Verificar:
   - Motivo técnico: **SNAPSHOT_PARSE_ERROR**
   - Detalle: “Snapshot corrupto”.

## Caso D — Guardar manual bloqueado por BD → `IDB_BLOCKED` / `IDB_ABORT` / `IDB_QUOTA`
**Ideas de reproducción (según navegador):**
- Abrir POS en dos pestañas y forzar bloqueos/cierres mientras se guarda.
- Simular almacenamiento lleno para disparar cuota.
1) Caja Chica → ingresar cantidades → **Guardar saldo inicial**.
2) Si falla:
   - Motivo técnico debe ser **IDB_BLOCKED** o **IDB_ABORT** o **IDB_QUOTA**.
   - Detalle debe explicar el tipo (bloqueada/abortada/cuota).

## Caso E — El error “No se pudo aplicar…” se vuelve motivo específico
1) Forzar un fallo de confirmación (readback) o no-cambio (por ejemplo, bloquear escritura o provocar colisión de llaves vieja).
2) Verificar:
   - No aparece texto genérico “No se pudo aplicar desde Finanzas”.
   - Motivo técnico es **WRITE_NO_CHANGE** o **READBACK_MISMATCH** o **DUP_DAY_COLLISION**.
   - Forense muestra claramente `dayKey` y el `before/after`.
