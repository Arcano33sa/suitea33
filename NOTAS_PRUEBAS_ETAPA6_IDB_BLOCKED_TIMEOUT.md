# Suite A33 — POS > Caja Chica — QA Etapa 6

Objetivo: validar que **nunca** quede pegado en “Validando snapshot…”, y que los casos de IndexedDB bloqueada/colgada se traduzcan en **motivo técnico visible** (IDB_BLOCKED / IDB_TIMEOUT) con UX recuperable.

---

## G1 — Multi-tab (bloqueo) → IDB_BLOCKED (no freeze)

**Setup recomendado (realista):**
- Tab A: POS abierto en una versión *vieja* (cacheada/SW) o una instancia que mantiene conexión a IndexedDB.
- Tab B: POS abierto en versión *nueva* que intenta abrir/upgrade la DB (mismo navegador/perfil).

**Pasos:**
1) Dejar Tab A abierto (sin recargar) por 1–2 minutos.
2) Abrir Tab B y entrar a **POS > Caja Chica**.
3) Presionar **Sincronizar con Finanzas** o **Guardar saldo inicial**.

**Esperado:**
- NO queda “Validando snapshot…” infinito.
- En **Estado** aparece **IDB_BLOCKED**.
- Mensaje corto tipo “Otra pestaña está bloqueando la base”.
- Botones se recuperan (no quedan deshabilitados/pegados).

---

## G2 — Versionchange/upgrade → cierra conexión + motivo visible + reintento posible

**Objetivo:** disparar `db.onversionchange` (una pestaña pide upgrade y la otra debe cerrar la conexión).

**Pasos (una forma práctica):**
1) Abrir Tab A en POS y dejarlo abierto.
2) En Tab B abrir POS pero asegurarse de cargar una versión que provoque upgrade (ej: después de un deploy que cambie DB_VER, o abriendo una build diferente).
3) En Tab B navegar/usar una acción que fuerce apertura de la DB.

**Esperado:**
- Tab A recibe aviso (toast) de que “La base se está actualizando…”.
- En Tab A, panel **Estado** registra **IDB_BLOCKED** (por versionchange) y explica que debe reintentar.
- Luego, en cualquiera de las pestañas: al reintentar Sync/Manual, debe poder abrir DB o volver a mostrar IDB_BLOCKED (pero jamás colgarse).

---

## G3 — Sync jamás queda pegado en “Validando snapshot…”

**Pasos:**
1) Forzar un escenario de bloqueo (G1) o uno donde la apertura de IDB tarde demasiado.
2) Ir a **Caja Chica** y presionar **Sincronizar con Finanzas**.

**Esperado:**
- Si hay bloqueo: **IDB_BLOCKED**.
- Si hay cuelgue/latencia extrema: **IDB_TIMEOUT**.
- El estado “Validando snapshot…” no se queda sticky.
- La UI vuelve a estado normal.

---

## G4 — Manual jamás se queda colgado al guardar

**Pasos:**
1) Forzar bloqueo (G1/G2).
2) En Caja Chica, digitar valores y presionar **Guardar saldo inicial**.

**Esperado:**
- NO se queda colgado.
- Aparece **IDB_BLOCKED** o **IDB_TIMEOUT** en Estado (según aplique).
- Se conserva draft/captura para no perder digitación.

---

## Señales de éxito
- Nunca más “Validando snapshot…” infinito.
- Motivo técnico visible (IDB_BLOCKED / IDB_TIMEOUT).
- UX recuperable: botones vuelven, sin estados fantasma.
