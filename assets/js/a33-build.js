/* Suite A33 — Build meta (fuente unica de verdad)
   - VERSION: numero de version visible en UI.
   - REV: revision de cache para forzar limpieza cuando haya "fantasmas".
   - NO meter logica de negocio aqui. Solo metadatos de build.
*/
(function(global){
  'use strict';

  const VERSION = '4.20.77';
  const REV = '1'; // subir cuando haya que forzar limpiar caches sin cambiar VERSION

  function cacheName(module){
    return 'a33-v' + VERSION + '-' + String(module || 'app') + '-r' + REV;
  }

  try{ global.A33_VERSION = VERSION; }catch(_){ }
  try{ global.A33_ASSET_REV = REV; }catch(_){ }
  try{ global.A33_BUILD_TAG = VERSION + '-r' + REV; }catch(_){ }
  try{ global.A33_CACHE_NAME = cacheName; }catch(_){ }

  // Conveniencia: nombres por modulo (solo lectura)
  try{ global.A33_POS_CACHE_NAME = cacheName('pos'); }catch(_){ }
  try{ global.A33_LOTES_CACHE_NAME = cacheName('lotes'); }catch(_){ }
  try{ global.A33_INVENTARIO_CACHE_NAME = cacheName('inventario'); }catch(_){ }
  try{ global.A33_PEDIDOS_CACHE_NAME = cacheName('pedidos'); }catch(_){ }
  try{ global.A33_CENTRO_MANDO_CACHE_NAME = cacheName('centro_mando'); }catch(_){ }

})(typeof window !== 'undefined' ? window : self);
