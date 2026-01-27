# NOTAS_PRUEBAS_ETAPA3_DESBLOQUEO_MANUAL

Objetivo de pruebas: confirmar que **Caja Chica (POS)** solo se bloquee cuando corresponde, y que cuando se bloquee exista una **salida directa** desde el mismo flujo. Además, que los inputs **no se borren** por re-renders si una guardia aborta.

---

## Caso A — Día abierto + Caja Chica activa (editable)
**Precondición:** Evento activo abierto, Caja Chica activa, día operativo abierto.
1) Ir a POS → Caja Chica.
2) En “Saldo inicial” digitar valores (NIO y/o USD).
3) Presionar “Guardar saldo inicial”.
4) Agregar un movimiento manual (Ingreso/Egreso) y guardar.

**Esperado:**
- Se permite editar y guardar.
- No aparece bloqueo.
- Los valores quedan persistidos (al recargar/repintar, se mantienen).

---

## Caso B — Día cerrado (bloqueado + salida a Resumen/Reabrir)
**Precondición:** Mismo evento, día cerrado desde Resumen/Cierre.
1) Ir a POS → Caja Chica.
2) Intentar “Guardar saldo inicial” o “Sincronizar desde Finanzas”.

**Esperado:**
- Botones bloqueados por motivo **DIA_CERRADO**.
- Aparece acción compacta: **“Ir a Resumen / Reabrir día”**.
3) Presionar “Ir a Resumen / Reabrir día”.

**Esperado:**
- Navega a Resumen.
- Queda seleccionado el evento activo y la fecha del día operativo.
- Se ve el botón **Reabrir día** y se puede ejecutar.

---

## Caso C — Modo histórico (bloqueado + volver al día operativo)
**Precondición:** Activar modo Histórico en Caja Chica.
1) Estando en Histórico, intentar guardar o sincronizar.

**Esperado:**
- Bloqueo por motivo **MODO_HISTORICO**.
- Aparece acción compacta: **“Volver al día operativo”**.
2) Presionar “Volver al día operativo”.

**Esperado:**
- Sale de histórico y regresa al día operativo.
- Los botones vuelven a estado normal según candados reales.

---

## Caso D — Mismatch de evento / refresco pendiente (corrección práctica)
**Precondición:** Reproducir cambio de evento o estado “Actualizando evento…”.
1) Cuando aparezca bloqueo por motivo **MISMATCH_EVENTO** (o refresco pendiente), intentar una acción.

**Esperado:**
- No hay “no se puede” sin salida.
- Aparece botón compacto: **“Re-sincronizar evento”**.
2) Presionar “Re-sincronizar evento”.

**Esperado:**
- Activo/UI quedan alineados.
- Se habilitan acciones si no hay otros candados.

---

## Caso E — Guardias no borran inputs (anti “autodestrucción”)
1) Digitar valores en “Saldo inicial” (y/o en movimiento manual).
2) Provocar un bloqueo (p.ej., estar en histórico o día cerrado) y presionar guardar/sync.

**Esperado:**
- La acción se aborta con motivo claro.
- **Los inputs digitados NO se borran** por el re-render.

---

## Notas
- Validar en iPad: sin scroll horizontal; botones en pastillas compactas.
- Repetir en NIO y USD.
