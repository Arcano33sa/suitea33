# NOTAS_PRUEBAS_ETAPA2_DIAGNOSTICO_CAJA_CHICA

Objetivo: validar que **Estado > Motivo** nunca quede en “—”, que el diagnóstico sea explícito y que los **flags** reflejen el bloqueo.

## Checklist (manual)

### Caso A — Modo histórico
1) POS > Caja Chica.
2) Activar **Histórico** y seleccionar un día anterior.
3) Verificar:
   - **Motivo = MODO_HISTORICO**.
   - Flags:
     - Histórico: SI
     - Día Cerrado: (según día) SI/NO
     - Caja Activa: SI
     - Finanzas Snapshot: OK/NO/ERROR
     - Toggle Sync: ON/OFF
     - Evento Match: OK
4) Botones **Manual** y **Sincronizar** deben estar bloqueados (solo lectura).

### Caso B — Día cerrado
1) POS > Caja Chica.
2) Ir al día operativo (no histórico).
3) Cerrar el día (candado) o usar un día que ya esté cerrado.
4) Verificar:
   - **Motivo = DIA_CERRADO**.
   - Flags:
     - Día Cerrado: SI
5) Botones **Manual** y **Sincronizar** bloqueados.

### Caso C — Caja Chica desactivada
1) En el evento activo, desactivar Caja Chica (si aplica) o usar un evento que la tenga desactivada.
2) POS > Caja Chica.
3) Verificar:
   - Banner de desactivada visible.
   - **Motivo = CAJA_CHICA_DESACTIVADA**.
   - Flag “Caja Activa: NO”.

### Caso D — Snapshot Finanzas no existe
1) Borrar/renombrar (temporal) el snapshot de Finanzas (simular instalación nueva) **o** usar un perfil sin configuración.
2) POS > Caja Chica.
3) Verificar:
   - **Motivo = FINANZAS_NO_CONFIGURADA** (cuando el bloqueo es por Sync).
   - Flag “Finanzas Snapshot: NO”.
   - Botón “Sincronizar” bloqueado por falta de snapshot.

### Caso E — Snapshot corrupto (parse)
1) Corromper el JSON del snapshot (simulación) o introducir datos inválidos.
2) POS > Caja Chica.
3) Verificar:
   - **Motivo = FINANZAS_PARSE_ERROR**.
   - Flag “Finanzas Snapshot: ERROR”.

### Caso F — Normal
1) Día operativo (no histórico), día abierto, evento abierto, caja activa.
2) Verificar:
   - **Motivo = OK**.
   - Botones habilitados según toggle:
     - Toggle Sync ON -> “Sincronizar” habilitado.
     - Toggle Sync OFF -> motivo/estado indica TOGGLE_SYNC_OFF y “Sincronizar” bloqueado.

