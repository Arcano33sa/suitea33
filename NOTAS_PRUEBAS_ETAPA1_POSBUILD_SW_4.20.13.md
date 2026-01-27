# NOTAS — PRUEBAS MANUALES (Etapa 1)

Objetivo: confirmar que **POS Build** y **SW Cache** ya no se desalinean y que no vuelve a aparecer ningun "4.20.14 fantasma".

## Caso A — Navegador normal
1) Abrir POS (web) con internet.
2) Ir a: **POS > Caja Chica > Estado**.
3) Verificar:
   - `POS Build: 4.20.13`
   - `SW Cache: a33-v4.20.13-pos-r1`

## Caso B — PWA instalada
1) Instalar PWA de POS.
2) Cerrar completamente la PWA.
3) Reabrir.
4) En **Estado** verificar lo mismo que Caso A.

## Caso C — Refrescar con internet
1) Con internet, refrescar (reload) estando en POS.
2) Verificar que **NO** vuelve a mostrar `4.20.14`.

## Caso D — Offline
1) Abrir POS (PWA o web) y luego poner el dispositivo **offline**.
2) Confirmar que POS abre (segun soporte offline actual).
3) Verificar que **no** hay intentos de assets viejos (4.20.14 / 4.20.8 / 4.20.7).

## Caso E — Busqueda interna del proyecto
1) Buscar en el proyecto (ripgrep/grep):
   - `4.20.14`
   - `4.20.8`
   - `4.20.7`
2) Resultado esperado: **cero coincidencias**.
