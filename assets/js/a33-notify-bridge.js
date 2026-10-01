// Adaptador de avisos de operaciones. No intercepta confirm/prompt ni escribe datos.
(function(g){
  'use strict';
  const aliases = {ok:'success',success:'success',error:'error',danger:'error',warn:'pending',warning:'pending',pending:'pending',process:'process'};
  let recent = null;
  function resolve(message, kind, fallback){
    const text = String(message || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    // Los estados explícitos tienen prioridad sobre palabras dentro de nombres o detalles.
    if (['success','error','process','pending'].includes(kind)) return kind;
    if (kind === 'danger') return 'error';
    if (/\b(error|fallo|fallaron|no se pudo|no se pudieron|no pude|conflicto|no se guardo|no se aplicaron|no fue posible|fallido|fallida|insuficiente|invalido|invalida)\b/.test(text)) return 'error';
    if (kind === 'process' || /^(guardando|generando|cargando|procesando|exportando|importando|actualizando|buscando|verificando|aplicando|preparando|cerrando|archivando|borrando|activando)\b/.test(text) || /\ben curso\b/.test(text)) return 'process';
    if (['warn','warning','pending'].includes(kind)) return 'pending';
    if (/\b(pendientes?|sin guardar|sin cambios|cancelad[oa]|cancelada|seleccion[a-e]|complet[a-e]|ingres[a-e]|escrib[a-e]|obligatori[oa]s?|bloquead[oa]|no hay|no existe|no encontrado|no encontrada|no disponible|no esta disponible|ya existe|ya estaba|ya esta|debe ser|debes|falta|revis[a-e]|corrig[ea]|antes de guardar|listo para guardar|advertencia|demasiado|hay cambios)\b/.test(text)) return 'pending';
    if (/\b(guardad[oa]s?|registrad[oa]s?|cread[oa]s?|actualizad[oa]s?|eliminad[oa]s?|borrad[oa]s?|exportad[oa]s?|descargad[oa]s?|importad[oa]s?|emitid[oa]s?|anulad[oa]s?|copiad[oa]s?|fusionad[oa]s?|refrescad[oa]s?|confirmad[oa]s?|restaurad[oa]s?|reabiert[oa]s?|cerrad[oa]s?|abiert[oa]s?|quitad[oa]s?|reiniciad[oa]s?|aplicad[oa]s?|agregad[oa]s?|activad[oa]s?|inactivad[oa]s?|ocultad[oa]s?|correctamente|listo|exitos[oa])\b/.test(text)) return 'success';
    return aliases[kind] || fallback || 'pending';
  }
  function show(message, kind, fallback){
    if (!String(message || '').trim()) return '';
    const type = resolve(message, kind, fallback);
    if (type !== 'process') g.A33Notify.dismiss('suite-process');
    const signature = type + '|' + String(message);
    const duplicate = recent && recent.signature === signature && Date.now() - recent.at < 1000;
    const options = type === 'process' ? {id:'suite-process'} : (duplicate ? {id:recent.id} : {});
    const id = g.A33Notify.show(message, type, options);
    recent = {signature, id, at:Date.now()};
    return id;
  }
  function alertMessage(message){ return show(message, undefined, 'pending'); }
  function finish(){ g.A33Notify.dismiss('suite-process'); }
  g.A33Notice = Object.freeze({show, alert:alertMessage, resolve, finish});
})(window);
