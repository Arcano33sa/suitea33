# Etapa E3.2 — Cobertura de respaldos personalizados

## Objetivo y acuerdos

Actualizar la selección personalizada frente a los datos vigentes y explicar sus dependencias. Se mantienen los identificadores existentes, el formato parcial schemaVersion 7, el formato completo 8 y los códigos históricos literales. No se agregan dependencias automáticamente ni se cambian reglas de importación. Esta es una de las seis etapas acordadas de protección de datos; cerrar E3.2 no autoriza E3.3.

## Cambios

- Calculadora de Producción incluye `arcano33_produccion_checklists`. Las listas temporales ya estaban cubiertas por su prefijo y se verificaron. Las listas asociadas a lotes siguen requiriendo Lotes.
- Finanzas completo cubre sus 11 almacenes actuales: accounts, journalEntries, journalLines, suppliers, receipts, financialAccounts, internalTransfers, settings, receivableItems, payableItems y posDailyCloseImports.
- Bancos/cuentas incluye financialAccounts; movimientos incluye internalTransfers; se ofrecen partes explícitas para proveedores, cuentas por cobrar y cuentas por pagar. El tablero incluye su clave actual de caché de uso de cuentas.
- POS ofrece preferencias/secuencia de históricos (almacén meta) como selección independiente. Los registros contables utilizados por POS pertenecen a finanzasDB y se seleccionan desde Finanzas.
- Pedidos incluye su borrador ya existente; no se modifica cómo se guarda o recupera.
- Se corrige el identificador de Agenda en sus avisos de materia prima y se agregan avisos de cuentas/proveedores/asientos y listas históricas. Se explica que las opciones de Inventario comparten un registro completo: seleccionar una incluye ese registro, sin fragmentarlo ni cambiar su formato.

## Archivos de esta etapa

- configuracion/script.js (solo catálogo personalizado y avisos de dependencias).
- tests/a33-backup-e32-cobertura.smoke.cjs (nuevo).
- tests/a33-backup-e32-personalizado.browser.smoke.cjs (nuevo).
- tests/catalogo.json y tests/README.md.
- tests/RESULTADOS_ETAPA3_2.md (nuevo).

Los cambios locales anteriores de E3.1 se conservan. No se modificaron módulos, estilos, Service Workers, cachés PWA, versiones ni dependencias.

## Verificación

- Cuatro pruebas dirigidas E3.1/E3.2: APROBADAS, incluidas ambas pruebas de navegador. Reporte temporal: /tmp/a33-e32-dirigidas.json.
- Regresión del catálogo local: 55 APROBADAS, los mismos 7 fallos documentados en E2 y E3.1, 5 pruebas de navegador omitidas en esa ejecución local. Las dos de respaldo se ejecutaron separadamente y aprobaron; no se repitieron las tres anteriores de otros flujos. Reporte: /tmp/a33-e32-locales.json.
- Los siete fallos corresponden a Agenda stage3, Calculadora detalle/checklist etapa1, Catálogos vistas etapa1, lot-code etapas5/6 y POS tarjeta integración etapa2. No se presentan como regresiones nuevas ni como fallos operacionales confirmados.
- Smoke real: casillas de Finanzas/Producción/Agenda, avisos visibles, resumen y descarga parcial JSON. No se incluyen cuentas por pagar o lotes sin seleccionarlos.
- Chrome usa contexto temporal, origen localhost aleatorio y Service Workers bloqueados. El primer intento sandbox no permitió abrir el puerto (EPERM); la repetición autorizada completó el smoke.
- Revisión del diff contra el estado previo a E3.2: cambios limitados al catálogo y avisos, más pruebas/documentación. Sin escrituras sobre datos reales.

## Compatibilidad, riesgos y pendientes

No se borraron ni sobrescribieron datos, históricos o respaldos. Se mantienen formatos y reglas de importación existentes; esta etapa verifica exportación y validación estructural, no garantiza recuperación íntegra al importar. E3.3 abordará validación y conservación de bloques ausentes. Persiste la restricción de E3.1: sin enumeración IndexedDB fiable, la exportación se bloquea. Las lecturas no forman una transacción atómica entre bases/pestañas. La descarga confirma generación y entrega al navegador, no guardado final en disco.

Revisión manual pendiente: comprobar en el navegador habitual las nuevas opciones, los avisos y un respaldo personalizado, sin importar sobre datos reales durante esta revisión.

## Git

E3.1 y E3.2 permanecen locales, sin commit ni push. Se detiene el trabajo después del informe para revisión del usuario.

## Resumen para el chat principal

E3.2 completada: cobertura actualizada del respaldo personalizado para producción, Finanzas, preferencias POS y borrador de Pedidos; avisos de dependencias corregidos y ampliados, sin inclusión automática. Formatos históricos y reglas de importación conservados. Cuatro pruebas dirigidas aprobadas, con descarga real en Chrome. Regresión local: 55 aprobadas y los mismos siete fallos anteriores; ninguna regresión nueva. Datos reales intactos. Sin cambios PWA/versiones, sin commit ni push. Pendiente revisión manual y autorización independiente para E3.3.
