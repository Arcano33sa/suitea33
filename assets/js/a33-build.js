/* Suite A33 — Build meta (fuente unica de verdad)
   - VERSION: numero de version visible en UI.
   - REV: revision de cache para forzar limpieza cuando haya "fantasmas".
   - NO meter logica de negocio aqui. Solo metadatos de build.
*/
(function(global){
  'use strict';

  const VERSION = '4.20.85';
  const REV = '1'; // subir cuando haya que forzar limpiar caches sin cambiar VERSION

  const MODULE_REVISIONS = Object.freeze({
    catalogos:'30', inventario:'16', lotes:'17', pedidos:'17', pos:'29'
  });

  function cacheName(module){
    const name = String(module || 'app');
    const moduleRev = MODULE_REVISIONS[name];
    return 'a33-v' + VERSION + '-' + name + '-r' + REV + (moduleRev ? ('-m' + moduleRev) : '');
  }

  try{ global.A33_VERSION = VERSION; }catch(_){ }
  try{ global.A33_ASSET_REV = REV; }catch(_){ }
  try{ global.A33_BUILD_TAG = VERSION + '-r' + REV; }catch(_){ }
  try{ global.A33_CACHE_NAME = cacheName; }catch(_){ }

  // Conveniencia: nombres por modulo (solo lectura)
  try{ global.A33_CATALOGOS_CACHE_NAME = cacheName('catalogos'); }catch(_){ }
  try{ global.A33_POS_CACHE_NAME = cacheName('pos'); }catch(_){ }
  try{ global.A33_LOTES_CACHE_NAME = cacheName('lotes'); }catch(_){ }
  try{ global.A33_INVENTARIO_CACHE_NAME = cacheName('inventario'); }catch(_){ }
  try{ global.A33_PEDIDOS_CACHE_NAME = cacheName('pedidos'); }catch(_){ }

})(typeof window !== 'undefined' ? window : self);
