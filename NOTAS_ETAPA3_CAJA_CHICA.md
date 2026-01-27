Suite A33 — POS > Caja Chica: Etapa 3

Checklist manual (pruebas borde)

- [ ] Evento con caja activa: Guardar saldo inicial.
- [ ] Evento sin caja activa: UX correcta (no guardado).
- [ ] Cambiar evento y volver: luego guardar.
- [ ] Sync con Finanzas configurada (key presente).
- [ ] Sync sin Finanzas configurada (key ausente).
- [ ] Sync con datos corruptos / parse error (simulado).

Notas
- Si un guardado o sync falla, los inputs NO deben “borrarse”. Debe verse toast + registro en “Estado”.
