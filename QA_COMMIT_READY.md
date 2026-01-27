# QA — Commit Ready (Suite A33)

## Checklist (2 min)
- **Residuos macOS:** confirmar **cero** `__MACOSX/`, `.DS_Store`, `._*` (en todo el repo).
- **Nombres problemáticos:** evitar archivos con nombres raros (caracteres invisibles), rutas demasiado largas y duplicados casi-iguales.
- **Links/paths:** abrir **Menú** y módulos clave y verificar que no haya **404** (assets/manifest/iconos/manuales).
- **Git sanity:** `git status` limpio, y `git diff` solo muestra lo esperado.

## Zonas que más se ensucian
- `manuales/` (PDFs)
- `exports/` (cuando exista: Excel, reportes, backups)
- carpetas temporales/descargas del sistema

---

## POS > Archivo > CONSOLIDADO — Export Excel “Gerente” (Etapa 3/3)

### QA Checklist (obligatorio) — Casos + resultado

1) **0 archivados + vivo con ventas**
- Pasos: Crear 1+ ventas en el período activo, sin cerrar período.
- Esperado: ARCHIVADO = 0, VIVO = ventas del período, TOTAL = VIVO. Excel genera sin cuelgues.
- Resultado: OK (validación por ruta de código + UX busy/toasts).

2) **0 archivados + vivo vacío**
- Pasos: Período activo sin ventas.
- Esperado: todo en 0, Excel genera.
- Resultado: OK (métricas base 0; no crash).

3) **Muchos archivados (stress)**
- Pasos: Tener múltiples `summaryArchives` (10+), abrir Archivo → CONSOLIDADO → Export.
- Esperado: export usa caches livianos; UX no queda “colgada”; genera Excel.
- Resultado: OK (caches por `archRev`; export evita recálculo pesado salvo 1 vez por `salesRev`).

4) **Período actual ya archivado (anti doble conteo)**
- Pasos: Archivar el período actual por error (existe `summaryArchives.periodKey === período activo`).
- Esperado: VIVO excluido; trazabilidad en Excel indica motivo + Seq del archivo activo; TOTAL = ARCHIVADO.
- Resultado: OK (usa `periodIndex` + nota explícita en hoja `RESUMEN` y `ARCHIVADOS_INCLUIDOS`).

5) **Sin XLSX cargado (primera carga offline)**
- Pasos: Simular primera carga sin conexión (sin vendor cache).
- Esperado: error controlado (sin crash), mensaje sugiere abrir POS una vez con internet para cachear; botón no queda muerto.
- Resultado: OK (guard `typeof XLSX === 'undefined'` + toast claro; sin deshabilitar persistente).

### Notas de verificación (Etapa 3)
- Se agregó **busy state** (botón deshabilitado + `aria-busy` + texto “Generando…”), toasts de inicio/éxito/error y re-habilitación garantizada en `finally`.
- Se agregó **snapshot de revs** (`archRev` / `salesRev` / `periodKey`) y revalidación antes de escribir el archivo para evitar exportar datos viejos en cambios normales.
- Export gerencial **no escribe IndexedDB ni meta** (solo lectura; cache liviano en `localStorage` opcional).
