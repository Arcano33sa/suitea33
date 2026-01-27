# NOTAS PRUEBAS — ETAPA 3 — CANONICAL WRITE + READBACK (Caja Chica POS)

**Objetivo:** comprobar que **Guardar saldo inicial (manual)** y **Sincronizar (Finanzas→POS)**:
1) escriben **siempre** en la **llave canónica del día** (YYYY-MM-DD),
2) confirman el guardado haciendo **readback directo** de esa misma llave (sin listas mergeadas),
3) si algo falla, muestran un **Motivo técnico** claro: `WRITE_NO_CHANGE` o `READBACK_MISMATCH` (o `DUP_DAY_COLLISION` si hay colisión).

---

## Conceptos a verificar

- **Llave canónica del día:** `YYYY-MM-DD` (se normaliza aunque el UI muestre DD/MM/YYYY).
- **Confirmación real (readback):** después de guardar, POS vuelve a leer en IndexedDB exactamente:
  - store: `pettyCash`
  - key: `eventId`
  - dayKey: `YYYY-MM-DD`

> Nota: si existen llaves legacy (p. ej. `17/01/2026`), **no se borran** en esta etapa; se preservan bajo `__legacyDays` para compatibilidad.

---

## Caso A — Guardar saldo inicial (Manual) confirma por llave canónica

1. POS → **Caja Chica**.
2. Seleccionar **Evento activo**.
3. En **Día**, escoger un día (ideal: hoy).
4. Digitar valores en NIO y/o USD (al menos 2 denominaciones).
5. Clic **Guardar saldo inicial**.

**Esperado:**
- Toast de éxito y/o estado visible.
- Si recargas la PWA (o sales y entras a Caja Chica), los valores **persisten**.
- En diagnóstico (si lo tienes visible), el resultado debe ser OK y **no** debe aparecer “No se pudo aplicar desde Finanzas”.

**Anti-fallo clave:**
- No debe ocurrir el síntoma: “guardé y al volver aparece en cero”.

---

## Caso B — Sync (Finanzas→POS) confirma por llave canónica

Precondición:
- Finanzas tiene **Caja Chica** configurada y existe snapshot válido para el evento.

1. POS → **Caja Chica**.
2. Elegir el mismo **Evento** y **Día**.
3. Encender el switch de Sync (si aplica en tu UX).
4. Clic **Sincronizar**.

**Esperado:**
- Estado: “Aplicado desde Finanzas: …” (o equivalente).
- El saldo inicial se actualiza y **persiste** tras recargar.
- Si presionas Sync de nuevo sin cambios, debe comportarse **idempotente** (mensaje “Ya aplicado” o similar).

---

## Caso C — Fallo controlado muestra Motivo técnico (WRITE_NO_CHANGE / READBACK_MISMATCH)

Este caso no siempre es trivial de reproducir “a mano” porque depende de condiciones de base (IndexedDB) o de colisiones de llaves.

### C1) Si ocurre WRITE_NO_CHANGE
- Debe aparecer un mensaje que incluya el motivo técnico `WRITE_NO_CHANGE`.
- Los valores digitados deben **quedarse en pantalla** (no perderse).

### C2) Si ocurre READBACK_MISMATCH
- Debe aparecer un mensaje que incluya el motivo técnico `READBACK_MISMATCH`.
- Los valores digitados deben **quedarse en pantalla**.

### C3) Si existe colisión de llaves por el mismo día (legacy vs canónica)
- El motivo puede aparecer como `DUP_DAY_COLLISION`.
- El diagnóstico debe indicar llaves involucradas (p. ej. lista de keys del mismo día normalizado).

---

## Resultado final esperado de la etapa

- Manual y Sync **escriben y leen** el mismo `dayKey` canónico.
- No hay “guardó pero leyó otro”.
- Si algo falla, el usuario no pierde lo digitado y ve el **motivo técnico**.
