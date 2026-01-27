# NOTAS_PRUEBAS_ETAPA4_SYNC_FINANZAS_POS

Fecha: 2026-01-17
Build objetivo: POS 4.20.13 (POS SW rev r2)

## Caso A — Snapshot no existe
1) En el navegador, abrir DevTools → Application → Local Storage.
2) Borrar la llave `a33_finanzas_caja_chica_v1`.
3) En POS → Caja Chica, activar toggle “Usar saldo inicial desde Finanzas” y pulsar **Sincronizar**.

**Esperado**
- Mensaje visible: “Caja Chica (Finanzas) no configurada” + CTA a Finanzas.
- Diagnóstico (Estado) muestra Motivo: `FINANZAS_NO_CONFIGURADA`.
- No se borran inputs digitados (draft se conserva).

## Caso B — Snapshot corrupto
1) En Local Storage, setear `a33_finanzas_caja_chica_v1` a un JSON inválido (ej.: `{` o texto).
2) Ejecutar sincronización.

**Esperado**
- Mensaje visible: `FINANZAS_PARSE_ERROR` (con detalle corto).
- Estado muestra Motivo: `FINANZAS_PARSE_ERROR`.
- No se borran inputs.

## Caso C — Snapshot válido
1) En Finanzas → Caja Chica, guardar un snapshot válido.
2) En POS → Caja Chica, activar toggle y pulsar **Sincronizar**.

**Esperado**
- Estado muestra “Sincronizando…” mientras opera.
- Luego “Aplicado desde Finanzas: DD/MM/YYYY HH:MM”.
- En Estado aparece “Último Sync: DD/MM/YYYY HH:MM”.
- Inputs del saldo inicial se pintan desde lectura persistida.

## Caso D — Repetir sync con el mismo snapshot
1) Sin cambiar el snapshot en Finanzas, volver a pulsar **Sincronizar**.

**Esperado**
- No re-escribe ni duplica (idempotente): muestra “Ya estaba aplicado (idempotente)” y/o status “Ya aplicado: …”.
- “Último Sync” no cambia si es el mismo snapshot aplicado.

## Caso E — Offline
1) Poner el dispositivo en modo offline (según soporte actual).
2) Intentar sync.

**Esperado**
- La UI no se rompe.
- Si el snapshot existe localmente, puede aplicar; si no, mensaje coherente (A/B).
- No silencios: siempre hay status/resultado.
