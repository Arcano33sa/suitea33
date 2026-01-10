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
