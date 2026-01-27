# NOTAS — PRUEBAS MANUALES — VERSION 4.20.13 (ETAPA 3)

Objetivo: confirmar que **toda la Suite A33** opera bajo **una sola versión: 4.20.13** y que **no existen referencias residuales** a versiones anteriores.

## Caso A — Menú principal
1) Abrir `index.html` (menú principal).
2) Navegar a cualquier módulo desde el menú.
3) Verificar que **no hay cargas de assets** con query `?v=` apuntando a versiones anteriores (ej.: `?v=4.20.` + `7` / `8`).

## Caso B — Ver versión en cada módulo
Entrar a cada módulo y verificar que la UI muestra **v4.20.13** (donde aplique):
- Calculadora
- Analítica
- Inventario
- Lotes
- Finanzas
- Planificador (Pedidos)
- POS
- Centro de Mando

## Caso C — Instalado como PWA
1) Instalar la Suite/módulos como PWA (según el flujo actual).
2) Cerrar completamente.
3) Reabrir.
4) Confirmar que todo sigue en **4.20.13** (sin “versiones mezcladas”).

## Caso D — Offline
1) Abrir cada módulo al menos una vez online (para precache actual).
2) Activar modo avión / cortar internet.
3) Entrar a cada módulo (según su soporte offline actual).
4) Confirmar que:
   - No intenta pedir assets de versiones anteriores.
   - Si cae en offline page, el tip de caché muestra `a33-v4.20.13-<modulo>`.

## Caso E — Verificación de strings antiguas (búsqueda interna)
Dentro del proyecto, ejecutar una búsqueda interna por:
- `4.20.` + `7`
- `4.20.` + `8`

Resultado esperado: **0 coincidencias** (excluyendo binarios / PDFs si el buscador no los filtra).
