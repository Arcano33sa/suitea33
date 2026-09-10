/* Suite A33 — preparación segura de la carga inicial JSON (E4). */
(function(g){
  'use strict';

  const SDK_VERSION = '10.12.5';
  const SCRIPT_ID = 'a33-firebase-sdk-firestore-compat';
  const SCRIPT_URL = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/firebase-firestore-compat.js';
  const APP_NAME = 'Suite A33';
  const MAX_FILE_BYTES = 50 * 1024 * 1024;
  const MAX_CHUNK_BYTES = 400000;
  const MAX_CHUNKS = 498;
  const WRITES_PER_BATCH = 20;
  const STATE_KEY = 'suite_a33_firebase_initial_import_v1';
  const FORBIDDEN_STORAGE_KEY = /(firebase|passphrase|password|credential|secret|token|private[_-]?key|service[_-]?account|auth|login|session|profile|access|unlock|pin)/i;
  const FORBIDDEN_PROPERTY = /^(password|passwordhash|passphrase|secret|token|idtoken|refreshtoken|accesstoken|credential|credentials|pinhash|private_?key|service_?account|client_?email)$/i;
  let prepared = null;

  function clean(value, maxLen){
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLen || 320);
  }

  function byteLength(value){
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(String(value || '')).length;
    return unescape(encodeURIComponent(String(value || ''))).length;
  }

  function allowedStorageKey(key){
    const name = clean(key, 260);
    return /^(arcano33_|a33_|suite_a33_)/i.test(name) && !FORBIDDEN_STORAGE_KEY.test(name);
  }

  function scrubValue(value, depth){
    if (depth > 30) return null;
    if (Array.isArray(value)) return value.map(function(item){ return scrubValue(item, depth + 1); });
    if (!value || typeof value !== 'object') return value;
    const out = {};
    Object.keys(value).forEach(function(key){
      if (FORBIDDEN_PROPERTY.test(key)) return;
      out[key] = scrubValue(value[key], depth + 1);
    });
    return out;
  }

  function sanitizeLocalStorage(value){
    if (Array.isArray(value)){
      return value.filter(function(item){
        const key = item && typeof item === 'object' ? (item.key || item.name || '') : '';
        return allowedStorageKey(key);
      }).map(function(item){ return scrubValue(item, 0); });
    }
    const source = value && typeof value === 'object' ? value : {};
    const out = {};
    Object.keys(source).forEach(function(key){
      if (allowedStorageKey(key)) out[key] = scrubValue(source[key], 0);
    });
    return out;
  }

  function sanitizeIndexedDB(value){
    const allowedDatabase = function(name){
      const safe = clean(name, 260).toLowerCase();
      return safe === 'finanzasdb' || safe.includes('a33') || safe.includes('arcano') || safe.includes('finanzas');
    };
    if (Array.isArray(value)){
      return value.filter(function(item){
        const name = clean(item && (item.name || item.dbName || item.database), 260);
        return allowedDatabase(name) && !FORBIDDEN_STORAGE_KEY.test(name);
      }).map(function(item){ return scrubValue(item, 0); });
    }
    const source = value && typeof value === 'object' ? value : {};
    const out = {};
    Object.keys(source).forEach(function(key){
      if (allowedDatabase(key) && !FORBIDDEN_STORAGE_KEY.test(key)) out[key] = scrubValue(source[key], 0);
    });
    return out;
  }

  function validateBackup(source){
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('El archivo no contiene un objeto JSON válido.');
    if (!source.meta || typeof source.meta !== 'object') throw new Error('El JSON no incluye la sección meta del respaldo.');
    if (!source.data || typeof source.data !== 'object') throw new Error('El JSON no incluye la sección data del respaldo.');
    const appName = clean(source.meta.appName || source.meta.application || source.meta.app, 100);
    if (appName !== APP_NAME) throw new Error('El archivo no corresponde a un respaldo de Suite A33.');
    const backupType = clean(source.meta.backupType || source.meta.exportMode, 40).toLowerCase();
    if (backupType && backupType !== 'full') throw new Error('La carga inicial requiere un respaldo completo, no uno parcial o personalizado.');
    if (!Object.prototype.hasOwnProperty.call(source.data, 'localStorage') || !Object.prototype.hasOwnProperty.call(source.data, 'indexedDB')){
      throw new Error('El respaldo debe incluir localStorage e indexedDB.');
    }
    return true;
  }

  function sanitizeBackup(source){
    validateBackup(source);
    const safeMeta = scrubValue(source.meta, 0);
    delete safeMeta.firebase;
    delete safeMeta.credentials;
    delete safeMeta.authentication;
    return {
      meta: Object.assign({}, safeMeta, {
        appName: APP_NAME,
        cloudStaging: { schemaVersion:1, sanitized:true, applied:false }
      }),
      data: {
        localStorage: sanitizeLocalStorage(source.data.localStorage),
        indexedDB: sanitizeIndexedDB(source.data.indexedDB)
      }
    };
  }

  function checksum(text){
    let hash = 2166136261;
    const value = String(text || '');
    for (let index = 0; index < value.length; index += 1){
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  function splitUtf8(text, limit){
    const chunks = [];
    let start = 0;
    let bytes = 0;
    for (let index = 0; index < text.length; index += 1){
      const code = text.codePointAt(index);
      const units = code > 0xffff ? 2 : 1;
      const size = code <= 0x7f ? 1 : (code <= 0x7ff ? 2 : (code <= 0xffff ? 3 : 4));
      if (bytes + size > limit && index > start){
        chunks.push(text.slice(start, index));
        start = index;
        bytes = 0;
      }
      bytes += size;
      if (units === 2) index += 1;
    }
    if (start < text.length) chunks.push(text.slice(start));
    return chunks;
  }

  function countItems(value){
    if (Array.isArray(value)) return value.length;
    return value && typeof value === 'object' ? Object.keys(value).length : 0;
  }

  function describe(safe){
    const indexed = safe.data.indexedDB;
    let stores = 0;
    let records = 0;
    const visit = function(value, depth){
      if (depth > 6 || !value || typeof value !== 'object') return;
      if (Array.isArray(value)){
        records += value.length;
        value.forEach(function(item){ visit(item, depth + 1); });
        return;
      }
      Object.keys(value).forEach(function(key){
        if (/stores?|objectstores?/i.test(key)) stores += countItems(value[key]);
        visit(value[key], depth + 1);
      });
    };
    visit(indexed, 0);
    return {
      localKeys: countItems(safe.data.localStorage),
      databases: countItems(indexed),
      stores: stores,
      records: records
    };
  }

  function prepareObject(source, fileInfo){
    const safe = sanitizeBackup(source);
    const json = JSON.stringify(safe);
    const size = byteLength(json);
    if (size > MAX_FILE_BYTES) throw new Error('El respaldo limpio supera el límite seguro de 50 MB.');
    const parts = splitUtf8(json, MAX_CHUNK_BYTES);
    if (!parts.length || parts.length > MAX_CHUNKS) throw new Error('El respaldo requiere demasiados bloques para una carga atómica segura.');
    const sum = checksum(json + ':' + size);
    prepared = {
      importId:'initial-' + sum + '-' + size.toString(36),
      checksum:sum,
      bytes:size,
      chunks:parts,
      summary:describe(safe),
      fileName:clean(fileInfo && fileInfo.name, 180) || 'respaldo-suite-a33.json',
      sourceBytes:Number(fileInfo && fileInfo.size) || 0,
      preparedAt:new Date().toISOString(),
      sanitized:safe
    };
    return getPrepared();
  }

  async function prepareFile(file){
    if (!file) throw new Error('Seleccioná un archivo JSON.');
    if (Number(file.size || 0) > MAX_FILE_BYTES) throw new Error('El archivo supera el límite seguro de 50 MB.');
    let source;
    try{ source = JSON.parse(await file.text()); }
    catch(_){ throw new Error('No se pudo leer el archivo como JSON válido.'); }
    return prepareObject(source, { name:file.name, size:file.size });
  }

  function getPrepared(){
    if (!prepared) return null;
    return {
      importId:prepared.importId,
      checksum:prepared.checksum,
      bytes:prepared.bytes,
      chunkCount:prepared.chunks.length,
      summary:Object.assign({}, prepared.summary),
      fileName:prepared.fileName,
      sourceBytes:prepared.sourceBytes,
      preparedAt:prepared.preparedAt
    };
  }

  function clearPrepared(){ prepared = null; return null; }

  function loadScript(){
    return new Promise(function(resolve, reject){
      if (g.firebase && typeof g.firebase.firestore === 'function') return resolve();
      if (!g.document) return reject(new Error('Firestore requiere un navegador.'));
      const current = document.getElementById(SCRIPT_ID);
      if (current){
        current.addEventListener('load', resolve, { once:true });
        current.addEventListener('error', function(){ reject(new Error('No se pudo cargar Firestore.')); }, { once:true });
        return;
      }
      const script = document.createElement('script');
      script.id=SCRIPT_ID; script.src=SCRIPT_URL; script.async=true; script.crossOrigin='anonymous';
      script.onload=resolve; script.onerror=function(){ reject(new Error('No se pudo cargar Firestore.')); };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  function requireAdmin(){
    const auth = g.A33FirebaseAuth && g.A33FirebaseAuth.getState ? g.A33FirebaseAuth.getState() : {};
    const access = g.A33Access && g.A33Access.getState ? g.A33Access.getState() : {};
    if (!auth.authenticated || !auth.user) throw new Error('Iniciá sesión con el usuario maestro antes de cargar el JSON.');
    if (!access.isAdmin || !access.profile || access.profile.status !== 'active') throw new Error('La sesión no tiene un perfil Admin activo en Firestore.');
    return { user:auth.user, access:access };
  }

  async function upload(){
    if (!prepared) throw new Error('Primero seleccioná y revisá un respaldo JSON.');
    const settings = g.A33FirebaseSettings && g.A33FirebaseSettings.read ? g.A33FirebaseSettings.read() : null;
    if (!settings || !settings.enabled || !settings.configured) throw new Error('Firebase debe estar activado y configurado.');
    const session = requireAdmin();
    if (!g.A33Firebase || typeof g.A33Firebase.initFirebaseApp !== 'function') throw new Error('No está disponible el motor Firebase.');
    const app = await g.A33Firebase.initFirebaseApp(settings);
    await loadScript();
    const db = g.firebase.firestore(app);
    const workspaceId = clean(settings.workspaceId || session.access.workspaceId, 80) || 'arcano33';
    const root = db.collection('workspaces').doc(workspaceId).collection('imports').doc(prepared.importId);
    const now = new Date().toISOString();
    for (let offset = 0; offset < prepared.chunks.length; offset += WRITES_PER_BATCH){
      const chunkBatch = db.batch();
      prepared.chunks.slice(offset, offset + WRITES_PER_BATCH).forEach(function(content, localIndex){
        const index = offset + localIndex;
        chunkBatch.set(root.collection('chunks').doc(String(index).padStart(4, '0')), {
          schemaVersion:1,
          workspaceId:workspaceId,
          importId:prepared.importId,
          index:index,
          total:prepared.chunks.length,
          encoding:'json-utf8',
          checksum:checksum(content),
          bytes:byteLength(content),
          content:content,
          createdAt:now,
          createdBy:session.user.uid
        });
      });
      await chunkBatch.commit();
      try{
        if (g.dispatchEvent && typeof g.CustomEvent === 'function'){
          g.dispatchEvent(new CustomEvent('a33:initial-import-progress', {
            detail:{ processed:Math.min(offset + WRITES_PER_BATCH, prepared.chunks.length), total:prepared.chunks.length }
          }));
        }
      }catch(_){ }
    }
    const manifestBatch = db.batch();
    manifestBatch.set(root, {
      schemaVersion:1,
      kind:'initial-json',
      importId:prepared.importId,
      workspaceId:workspaceId,
      fileName:prepared.fileName,
      checksum:prepared.checksum,
      bytes:prepared.bytes,
      chunkCount:prepared.chunks.length,
      status:'staged',
      applied:false,
      sanitized:true,
      summary:prepared.summary,
      createdAt:now,
      createdBy:session.user.uid
    });
    await manifestBatch.commit();
    const result = Object.assign(getPrepared(), { workspaceId:workspaceId, status:'staged', applied:false, uploadedAt:now });
    try{ localStorage.setItem(STATE_KEY, JSON.stringify(result)); }catch(_){ }
    try{ if (g.dispatchEvent && typeof g.CustomEvent === 'function') g.dispatchEvent(new CustomEvent('a33:initial-import-staged', { detail:result })); }catch(_){ }
    return result;
  }

  function readLast(){
    try{ const raw = localStorage.getItem(STATE_KEY); return raw ? JSON.parse(raw) : null; }catch(_){ return null; }
  }

  g.A33FirebaseImport = Object.freeze({
    prepareFile:prepareFile,
    prepareObject:prepareObject,
    getPrepared:getPrepared,
    clearPrepared:clearPrepared,
    upload:upload,
    readLast:readLast,
    limits:Object.freeze({ maxFileBytes:MAX_FILE_BYTES, maxChunkBytes:MAX_CHUNK_BYTES, maxChunks:MAX_CHUNKS })
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
