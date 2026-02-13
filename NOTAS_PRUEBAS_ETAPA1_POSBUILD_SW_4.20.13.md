# NOTAS — PRUEBAS MANUALES (Etapa 1)

Objetivo: confirmar que **POS Build** y **SW Cache** ya no se desalinean y que no vuelve a aparecer ningún *build fantasma* por caché.

## Caso A — Navegador normal
1) Abrir POS (web) con internet.
2) Ir a: **POS > Caja Chica > Estado**.
3) Verificar:
   - `POS Build: 4.20.77`
   - `SW Cache: a33-v4.20.77-pos-r1`

## Caso B — PWA instalada
1) Instalar PWA de POS.
2) Cerrar completamente la PWA.
3) Reabrir.
4) En **Estado** verificar lo mismo que Caso A.

## Caso C — Refrescar con internet
1) Con internet, refrescar (reload) estando en POS.
2) Verificar que **no** aparece ninguna versión distinta a **4.20.77 r1**.

## Caso D — Offline
1) Abrir POS (PWA o web) y luego poner el dispositivo **offline**.
2) Confirmar que POS abre (segun soporte offline actual).
3) Verificar que **no** hay intentos de assets con `?v=` distinto a **4.20.77**.

## Caso E — Busqueda interna del proyecto
1) Buscar en el proyecto (ripgrep/grep):
   - `4.20` + `.`
2) Resultado esperado: solo aparece `4.20.77` (excluyendo binarios / PDFs si el buscador no los filtra).
