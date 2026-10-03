/* Suite A33 — Build meta (compatibilidad; versión global desde A33_RELEASE)
   - VERSION: numero de version visible en UI.
   - REV: revision de cache para forzar limpieza cuando haya "fantasmas".
   - NO meter logica de negocio aqui. Solo metadatos de build.
*/
(function(global){
  'use strict';

  const release = global.A33_RELEASE || {};
  const VERSION = String(release.suiteVersion || '4.20.98');
  const REV = String(release.rev != null ? release.rev : '5'); // revisión global; distinta de la revisión de cada recurso

  const MODULE_REVISIONS = Object.freeze({
    calculadora:'17', catalogos:'44', inventario:'24', lotes:'28', pedidos:'24', pos:'61',
    agenda:'8', 'centro-mando':'10', 'calculadora-temporal':'6', finanzas:'2', analitica:'3'
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
  try{ global.A33_CALCULADORA_CACHE_NAME = cacheName('calculadora'); }catch(_){ }
  try{ global.A33_CATALOGOS_CACHE_NAME = cacheName('catalogos'); }catch(_){ }
  try{ global.A33_POS_CACHE_NAME = cacheName('pos'); }catch(_){ }
  try{ global.A33_LOTES_CACHE_NAME = cacheName('lotes'); }catch(_){ }
  try{ global.A33_INVENTARIO_CACHE_NAME = cacheName('inventario'); }catch(_){ }
  try{ global.A33_PEDIDOS_CACHE_NAME = cacheName('pedidos'); }catch(_){ }

})(typeof window !== 'undefined' ? window : self);
