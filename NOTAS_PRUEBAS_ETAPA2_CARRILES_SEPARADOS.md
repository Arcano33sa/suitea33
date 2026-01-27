# NOTAS PRUEBAS — ETAPA 2/5 — Caja Chica POS: carriles separados (Manual vs Sync)

Objetivo de estas pruebas: validar que el switch "Usar saldo inicial desde Finanzas" afecta **solo** el carril de **Sincronizar** y **nunca** bloquea el guardado manual.

## Caso A — Toggle OFF → Manual OK; Sync bloqueado por TOGGLE_SYNC_OFF

**Preparación**
1) POS > Caja Chica.
2) Activa un evento con Caja Chica habilitada.
3) Selecciona un día **abierto** (no histórico, no cerrado).
4) Asegura el switch **OFF**: "Usar saldo inicial desde Finanzas".

**Pasos**
1) Digita cantidades en NIO/USD (saldo inicial).
2) Presiona **Guardar saldo inicial**.
3) Presiona **Sincronizar**.

**Esperado**
- (Manual) Guarda correctamente, persiste y re-renderiza con los mismos valores.
- (Sync) No aplica nada y muestra mensaje accionable: "Sync apagado: enciende el switch...".
- Diagnóstico/Estado: al intentar Sync se registra motivo técnico **TOGGLE_SYNC_OFF**.

## Caso B — Toggle ON → Sync intenta aplicar; si falla, NO es TOGGLE_SYNC_OFF

**Preparación**
1) Mismo evento/día abierto.
2) Enciende el switch **ON**.

**Pasos**
1) Presiona **Sincronizar**.

**Esperado**
- Si Finanzas está configurada y el snapshot existe: aplica y confirma por relectura.
- Si falla, el motivo técnico debe ser el correspondiente al carril Sync (ej.: SNAPSHOT_MISSING, SNAPSHOT_PARSE_ERROR, SNAPSHOT_SHAPE_INVALID, DAY_CLOSED, EVENT_MISMATCH, IDB_*).
- Importante: NO debe ser **TOGGLE_SYNC_OFF**.

## Caso C — Manual falla por algo real → motivo coherente (IDB_* / EVENT_MISMATCH / DAY_CLOSED)

**Variantes sugeridas**
- **DAY_CLOSED**: intenta guardar manual en un día cerrado.
- **EVENT_MISMATCH**: cambia evento en otro tab/flujo y regresa sin re-render completo; intenta guardar.
- **IDB_***: solo si ocurre un error real de IndexedDB (muy raro en operación normal).

**Esperado**
- Manual no debe caer en mensajes genéricos.
- El diagnóstico debe mostrar una causa real (IDB_* / EVENT_MISMATCH / DAY_CLOSED) u otra causa de consistencia real ya instrumentada (p.ej. WRITE_NO_CHANGE / READBACK_MISMATCH / DUP_DAY_COLLISION).
