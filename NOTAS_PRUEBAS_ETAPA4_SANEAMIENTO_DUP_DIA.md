# NOTAS — PRUEBAS ETAPA 4

## Objetivo
Validar que el **saneamiento idempotente de duplicados por día** (llaves legacy) consolida de forma determinista en la llave canónica `YYYY-MM-DD`, **sin perder movimientos**, y que después de reparar ya no aparecen síntomas de `READBACK_MISMATCH`/`DUP_DAY_COLLISION` en el flujo normal.

> Contexto: pueden existir días duplicados por llaves distintas (ej. `17/01/2026`, `17-01-2026`, `2026-01-17`). La Etapa 4 consolida todo en `2026-01-17` y preserva los registros legacy bajo `__legacyDays` marcados con `mergedInto`.

---

## Caso A — Dataset con duplicados (debe consolidar y quedar 1 canónico operativo)

1) En POS, entrar a **Caja Chica** con un evento que tenga data vieja.
2) Forzar/confirmar que existan duplicados (histórico o data importada):
   - mismo día con 2+ llaves en la base (ej. `2026-01-17` y `17/01/2026`).
3) Abrir el panel **Estado** de Caja Chica.

**Esperado**
- En el intento de carga/saneamiento puede aparecer temporalmente el motivo técnico **`DUP_DAY_COLLISION`** con detalle corto (“Colisión por llaves distintas del mismo día. Reparando…”).
- Luego debe quedar en **OK** y registrar **“Reparación aplicada: SI”**.
- Operación normal:
  - `Guardar saldo inicial` funciona.
  - `Sincronizar (Finanzas → POS)` funciona (si el switch está ON y Finanzas está configurada).
- El día queda operando con **una sola llave canónica** `YYYY-MM-DD`.

---

## Caso B — Re-ejecutar (idempotencia)

1) Sin cambiar datos, recargar la página (Ctrl+R) y volver a Caja Chica.
2) Repetir entrar a **Estado**.

**Esperado**
- No se crean nuevos duplicados.
- No hay cambios repetitivos (misma estructura de días, mismos movimientos).
- No se “mueve” información entre llaves.
- Si el saneamiento ya se aplicó, NO debe estar reaplicándose como si fuera nuevo.

---

## Caso C — Después del saneamiento (evitar READBACK_MISMATCH por colisión)

1) En el día operable `YYYY-MM-DD`, capturar un saldo inicial y presionar **Guardar saldo inicial**.
2) Verificar que:
   - No se borren los inputs (si falla debe mantener draft; si guarda debe confirmarse por readback).
   - El estado final muestre **Guardado y confirmado (readback)**.
3) Ejecutar **Sincronizar (Finanzas → POS)** (si aplica).

**Esperado**
- No cae en `READBACK_MISMATCH` por choques de llaves.
- Si se ve un error, debe traer causa técnica explícita y NO “Motivo: —”.

---

## Nota de verificación de compatibilidad
- La data legacy no se borra de forma destructiva.
- Las llaves viejas preservadas quedan bajo `__legacyDays` con marca `mergedInto: YYYY-MM-DD`.
