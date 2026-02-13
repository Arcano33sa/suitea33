# NOTAS — PRUEBAS MANUALES — VERSION 4.20.77 r1

Objetivo: confirmar que **toda la Suite A33** opera bajo **una sola versión: 4.20.77 r1** y que **no existen referencias residuales** a otras versiones en runtime.

## Caso A — Menú principal
1) Abrir `index.html` (menú principal).
2) Navegar a cualquier módulo desde el menú.
3) Verificar que **todas las cargas de assets** usan `?v=4.20.77&r=1`.

## Caso B — Ver versión en cada módulo
Entrar a cada módulo y verificar que la UI muestra **v4.20.77 r1** (donde aplique):
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
4) Confirmar que todo sigue en **4.20.77 r1** (sin “versiones mezcladas”).

## Caso D — Offline
1) Abrir cada módulo al menos una vez online (para precache actual).
2) Activar modo avión / cortar internet.
3) Entrar a cada módulo (según su soporte offline actual).
4) Confirmar que:
   - No intenta pedir assets con `?v=` distinto a `4.20.77`.
   - Si cae en offline page, el tip de caché muestra `a33-v4.20.77-<modulo>-r1`.

## Caso E — Verificación de strings (búsqueda interna)
Dentro del proyecto, ejecutar una búsqueda interna por:
- `4.20` + `.`

Resultado esperado: solo aparece `4.20.77` (excluyendo binarios / PDFs si el buscador no los filtra).
