# NOTAS_PRUEBAS_POS_CAJA_CHICA_ETAPA2.md

Checklist manual — POS > Caja Chica — **Etapa 2 (Limpieza idempotente de llaves por día)**

> Objetivo: si existen llaves de día duplicadas o no-canónicas (por ejemplo `2026-01-17` vs `17/01/2026`), al abrir Caja Chica se consolida todo a una sola llave **YYYY-MM-DD**, sin perder información, y sin repetir la limpieza en aperturas futuras.

---

## Caso A — Data con 2 llaves del mismo día

1. En IndexedDB (`a33-pos` → `pettyCash`) crea/edita un registro del evento con dos llaves que representen el mismo día, por ejemplo:
   - `days["2026-01-17"] = {...}`
   - `days["17/01/2026"] = {...}`
2. Abre **POS → Caja Chica** y selecciona ese evento.
3. Verifica:
   - En `pettyCash.days` queda **solo** `"2026-01-17"`.
   - **Initial**: se conserva el más reciente por `savedAt`.
   - **Final/Arqueo**: se conserva el más reciente.
   - **Movimientos**: están todos, sin duplicados, orden estable (por timestamp si existe).
   - En **Estado** aparece un registro tipo: `Se consolidaron X llaves duplicadas → 2026-01-17`.

## Caso B — Guardar saldo inicial luego de limpieza

1. Con el mismo evento ya “limpio”, en Caja Chica registra un saldo inicial.
2. Presiona **Guardar saldo inicial**.
3. Verifica:
   - No se resetean inputs inesperadamente.
   - Re-abre Caja Chica y confirma que el saldo inicial quedó persistido.

## Caso C — Sync desde Finanzas después de limpieza

1. Con el evento ya “limpio”, presiona **Sincronizar (Finanzas → POS)**.
2. Verifica:
   - La sincronización se completa (o muestra diagnóstico claro si está bloqueada).
   - Los datos siguen canónicos (sin llaves duplicadas por día).

## Caso D — Idempotencia (no re-limpia)

1. Cierra y vuelve a abrir Caja Chica varias veces.
2. Verifica:
   - No vuelve a ejecutar “limpieza” si ya está canónico.
   - No aparecen entradas repetidas de limpieza en **Estado** por el mismo evento/día.

---

### Notas
- Auditoría mínima: en `localStorage` se guarda un historial compacto en `a33_pc_cleanup_audit_v1` con `{eventId, day, keys, atISO}`.
