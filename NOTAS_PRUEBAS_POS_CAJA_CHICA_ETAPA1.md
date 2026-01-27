# NOTAS PRUEBAS — POS > Caja Chica — Etapa 1

**Objetivo:** validar que el **SALDO INICIAL** (manual y aplicado desde Finanzas) se guarda, se re-lee y se confirma correctamente, incluso cuando existe data vieja con **días duplicados** (distintas llaves que normalizan al mismo `YYYY-MM-DD`).

---

## Caso A: Evento con caja activa → guardar saldo inicial manual → recargar vista → se mantiene

**Pasos**
1. POS > Vender: selecciona un evento abierto con Caja Chica activa.
2. POS > Caja Chica: elige el día operativo.
3. Digita cantidades en algunas denominaciones (NIO y/o USD).
4. Presiona **Guardar saldo inicial**.
5. Verifica que no aparezca error y que el panel **Estado** marque OK.
6. Recarga la vista (F5) o sal de Caja Chica y vuelve a entrar.

**Resultado esperado**
- Los valores se mantienen exactamente como quedaron guardados.
- No aparece el mensaje de fallo.

---

## Caso B: Sync con Finanzas (key presente) → aplicar → OK → recargar → se mantiene

**Pasos**
1. Finanzas: asegúrate de tener Caja Chica configurada (snapshot válido).
2. POS > Caja Chica: activa el switch de usar saldo inicial desde Finanzas.
3. Presiona **Sincronizar (Finanzas → POS)**.
4. Verifica mensaje de éxito en Estado y/o toast.
5. Recarga la vista.

**Resultado esperado**
- Se aplica el saldo inicial desde Finanzas.
- No aparece “No se pudo aplicar desde Finanzas” si sí quedó guardado.
- Tras recargar, sigue igual.

---

## Caso C: Simular día duplicado (data vieja existente) → guardar manual → gana el más reciente

**Preparación (solo si no tienes data vieja):**
1. Abre DevTools del navegador.
2. Application/Almacenamiento → IndexedDB → base de POS → object store `pettyCash`.
3. En el registro del evento, dentro de `days`, crea una segunda llave del mismo día en otro formato (ej.: `17/01/2026`) con un `initial.savedAt` más viejo.

**Pasos**
1. En la app, guarda un saldo inicial manual para ese mismo día.
2. Recarga la vista.

**Resultado esperado**
- El merge conserva el **SALDO INICIAL** con `savedAt` más reciente.
- No se repintan valores viejos.
- La confirmación post-escritura pasa.

---

## Caso D: Si falla por motivo real, NO se resetean inputs

**Pasos (elige uno)**
- Opción 1: entra a **Histórico** (solo lectura) e intenta guardar saldo inicial o sincronizar.
- Opción 2: usa un día ya cerrado y vuelve a intentar guardar.

**Resultado esperado**
- Se muestra un mensaje de bloqueo/error coherente.
- Los inputs NO se limpian ni regresan a valores anteriores.
- En **Estado** queda registro con acción, timestamp, OK/FAIL y motivo.
