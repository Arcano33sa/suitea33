# Suite A33 — POS > Caja Chica
## NOTAS_PRUEBAS_ETAPA7_WRITE_NO_CHANGE_FIX

**Objetivo Etapa 7:** eliminar falsos negativos `WRITE_NO_CHANGE / write_no_change` en Guardar saldo inicial y en Sync Finanzas→POS, priorizando confirmación por **hash de contenido persistido** y usando `savedAt` **monotónico**.

---

### Preparación
1) Abrir POS (Vercel) y entrar a **Caja Chica**.
2) Elegir un **evento abierto** con Caja Chica activa.
3) En el panel **Diagnóstico** (detalle forense), verificar que existan campos:
   - `before` (hash @ savedAt)
   - `after` (hash @ savedAt)
   - `expectedHash`

---

## Caso M1 — Guardar manual con valores nuevos
**Pasos**
1) En `Saldo inicial`, digitar cantidades nuevas (NIO y/o USD).
2) Click **Guardar saldo inicial**.

**Esperado**
- Toast: **“Saldo inicial guardado”**.
- Los inputs quedan con los valores guardados.
- Diagnóstico:
  - `expectedHash` **==** `afterHash`.
  - `afterSavedAt` reflejado (puede cambiar aunque la hora sea muy cercana).

---

## Caso M2 — Guardar manual con los mismos valores (sin cambios)
**Pasos**
1) Sin modificar nada (o volver a digitar exactamente lo mismo), click **Guardar saldo inicial**.

**Esperado**
- No debe salir error.
- Toast: **“Sin cambios”** (o equivalente OK).
- No aparece `WRITE_NO_CHANGE` como error.
- Diagnóstico:
  - `beforeHash` y `afterHash` pueden quedar iguales (porque no se re-escribe).

---

## Caso M3 — `savedAt` previo “raro” (adelantado / empata)
**Precondición**
- Existe un registro previo cuyo `savedAt` quede por delante del reloj actual o que empate por resolución.

**Pasos**
1) Cambiar valores en `Saldo inicial`.
2) Click **Guardar saldo inicial**.

**Esperado**
- Guardado **OK**.
- `savedAt` resultante debe ser **estrictamente mayor** al `savedAt` previo (monotónico).
- Confirmación por hash: `expectedHash` **==** `afterHash`.

---

## Caso S1 — Sync aplica snapshot válido (Finanzas → POS)
**Pasos**
1) Activar el switch **“Usar saldo inicial desde Finanzas”**.
2) Click **Sincronizar**.

**Esperado**
- Toast: **“Aplicado desde Finanzas”**.
- `Saldo inicial` se llena con el snapshot.
- Diagnóstico:
  - `expectedHash` **==** `afterHash`.
  - `snapshotSig` visible.
  - `Último Sync` cambia a un valor real.

---

## Caso S2 — Repetir el mismo snapshot (idempotente)
**Pasos**
1) Sin cambiar el snapshot en Finanzas, volver a dar **Sincronizar**.

**Esperado**
- Mensaje: **“Ya aplicado”** / **“Ya estaba aplicado (idempotente)”**.
- NO re-escribe el día.
- No aparece error.

---

### Criterios de aceptación
- Nunca más falso `WRITE_NO_CHANGE` cuando el contenido sí cambió.
- Guardado manual determinista: éxito por hash, no por timestamp.
- Sync determinista: éxito por hash, idempotencia por `snapshotSig`.
