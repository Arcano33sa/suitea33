/* Suite A33 — contrato Firestore y progreso local de migración (E2/9). */
(function (g) {
  'use strict';

  const CONTRACT_VERSION = 1;
  const SCHEMA_VERSION = 1;
  const PROGRESS_VERSION = 1;
  const PROGRESS_KEY = 'suite_a33_firestore_progress_v1';
  const MAX_DOCUMENT_BYTES = 900000;
  const TOAST_ID = 'a33-firestore-sync';
  const STATUS_VALUES = Object.freeze(['pending', 'process', 'success', 'warning', 'error']);
  const TERMINAL_VALUES = Object.freeze(['success', 'warning', 'error']);

  const MODULES = Object.freeze([
    moduleSpec('configuracion', 'Configuración', ['identidad', 'apariencia', 'reportes', 'moneda', 'pwa', 'firebase']),
    moduleSpec('catalogos', 'Catálogos', ['productos', 'materia_prima', 'envases', 'tapas', 'extras', 'bancos', 'clientes']),
    moduleSpec('inventario', 'Inventario y Producción', ['existencias', 'movimientos', 'recetas', 'calculadora_produccion', 'calculadora_temporal']),
    moduleSpec('lotes', 'Lotes', ['lotes', 'productos_lote', 'historico']),
    moduleSpec('pos', 'POS y Ventas', ['eventos', 'ventas', 'cierres_diarios', 'efectivo', 'inventario_evento', 'reempaques', 'resumenes']),
    moduleSpec('pedidos', 'Pedidos', ['pedidos', 'pedidos_rapidos', 'historico']),
    moduleSpec('agenda', 'Agenda', ['reuniones', 'tareas', 'compras']),
    moduleSpec('finanzas', 'Finanzas', ['cuentas', 'asientos', 'lineas_asiento', 'recibos', 'compras', 'caja_chica', 'cobrar', 'pagar']),
    moduleSpec('seguridad', 'Seguridad y Usuarios', ['usuarios', 'roles', 'permisos', 'auditoria'])
  ]);

  const MODULE_MAP = new Map(MODULES.map(function (spec) { return [spec.id, spec]; }));

  function moduleSpec(id, label, entities) {
    return Object.freeze({ id: id, label: label, entities: Object.freeze(entities.slice()) });
  }

  function clean(value, maxLength) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maxLength || 240);
  }

  function safeId(value, fallback) {
    let raw = clean(value || fallback || '', 180).toLowerCase();
    try { raw = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) {}
    const normalized = raw.replace(/[^a-z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return normalized || clean(fallback || 'registro', 80) || 'registro';
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value == null ? null : value)); } catch (_) { return null; }
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (_) { return ''; }
  }

  function makeRunId() {
    try { if (g.crypto && typeof g.crypto.randomUUID === 'function') return g.crypto.randomUUID(); } catch (_) {}
    return 'fs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  function getStorage() {
    try { return g.localStorage || null; } catch (_) { return null; }
  }

  function readJson(key, fallback) {
    try {
      if (g.A33Storage && typeof g.A33Storage.getJSON === 'function') return g.A33Storage.getJSON(key, fallback, 'local');
    } catch (_) {}
    try {
      const storage = getStorage();
      const raw = storage ? storage.getItem(key) : '';
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function writeJson(key, value) {
    try {
      if (g.A33Storage && typeof g.A33Storage.setJSON === 'function') return !!g.A33Storage.setJSON(key, value, 'local');
    } catch (_) {}
    try {
      const storage = getStorage();
      if (!storage) return false;
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) { return false; }
  }

  function getModule(moduleId) {
    return MODULE_MAP.get(safeId(moduleId, '')) || null;
  }

  function hasEntity(moduleId, entityId) {
    const spec = getModule(moduleId);
    return !!(spec && spec.entities.includes(safeId(entityId, '')));
  }

  function workspacePath(workspaceId) {
    return 'workspaces/' + safeId(workspaceId, 'arcano33');
  }

  function modulePath(workspaceId, moduleId) {
    const module = getModule(moduleId);
    if (!module) throw new Error('firestore_module_not_allowed');
    return workspacePath(workspaceId) + '/modules/' + module.id;
  }

  function entityPath(workspaceId, moduleId, entityId) {
    const module = getModule(moduleId);
    const entity = safeId(entityId, '');
    if (!module) throw new Error('firestore_module_not_allowed');
    if (!module.entities.includes(entity)) throw new Error('firestore_entity_not_allowed');
    return modulePath(workspaceId, module.id) + '/entities/' + entity;
  }

  function recordsPath(workspaceId, moduleId, entityId) {
    return entityPath(workspaceId, moduleId, entityId) + '/records';
  }

  function recordPath(workspaceId, moduleId, entityId, recordId) {
    return recordsPath(workspaceId, moduleId, entityId) + '/' + safeId(recordId, 'registro');
  }

  function createDocument(input) {
    const source = input && typeof input === 'object' ? input : {};
    const workspaceId = safeId(source.workspaceId, 'arcano33');
    const module = getModule(source.moduleId || source.module);
    const entityId = safeId(source.entityId || source.entity, '');
    if (!module) throw new Error('firestore_module_not_allowed');
    if (!hasEntity(module.id, entityId)) throw new Error('firestore_entity_not_allowed');
    const recordId = safeId(source.recordId || source.id, 'registro');
    const timestamp = clean(source.updatedAt, 80) || nowIso();
    const createdAt = clean(source.createdAt, 80) || timestamp;
    const payload = clone(source.payload);
    return {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      workspaceId: workspaceId,
      moduleId: module.id,
      entityId: entityId,
      recordId: recordId,
      sourceId: clean(source.sourceId || source.id || recordId, 240),
      path: recordPath(workspaceId, module.id, entityId, recordId),
      payload: payload && typeof payload === 'object' ? payload : {},
      createdAt: createdAt,
      updatedAt: timestamp,
      updatedBy: clean(source.updatedBy, 180),
      deviceId: safeId(source.deviceId, 'device'),
      rev: Math.max(1, parseInt(source.rev || 1, 10) || 1),
      deleted: source.deleted === true
    };
  }

  function estimateBytes(value) {
    const serialized = JSON.stringify(value == null ? null : value);
    try { return new TextEncoder().encode(serialized).length; } catch (_) { return serialized.length * 2; }
  }

  function validateDocument(document) {
    const value = document && typeof document === 'object' ? document : {};
    const errors = [];
    const moduleAllowed = !!getModule(value.moduleId);
    const entityAllowed = moduleAllowed && hasEntity(value.moduleId, value.entityId);
    if (value.contractVersion !== CONTRACT_VERSION) errors.push('contractVersion inválida');
    if (value.schemaVersion !== SCHEMA_VERSION) errors.push('schemaVersion inválida');
    if (!moduleAllowed) errors.push('Módulo no permitido');
    if (!entityAllowed) errors.push('Entidad no permitida');
    if (!clean(value.workspaceId)) errors.push('workspaceId requerido');
    if (!clean(value.recordId)) errors.push('recordId requerido');
    if (moduleAllowed && entityAllowed && clean(value.path) !== recordPath(value.workspaceId, value.moduleId, value.entityId, value.recordId)) errors.push('Ruta Firestore inconsistente');
    if (!value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) errors.push('payload debe ser un objeto');
    const bytes = estimateBytes(value);
    if (bytes > MAX_DOCUMENT_BYTES) errors.push('Documento excede el límite seguro de 900 KB');
    return { ok: errors.length === 0, errors: errors, bytes: bytes };
  }

  function defaultModuleProgress(spec) {
    return {
      id: spec.id,
      label: spec.label,
      status: 'pending',
      detail: 'Pendiente de configuración e importación.',
      processed: 0,
      total: 0,
      updatedAt: ''
    };
  }

  function defaultProgress() {
    return {
      version: PROGRESS_VERSION,
      contractVersion: CONTRACT_VERSION,
      status: 'idle',
      runId: '',
      label: 'Preparación local',
      message: 'Contrato Firestore listo. Todavía no se han cargado datos.',
      startedAt: '',
      finishedAt: '',
      updatedAt: '',
      modules: MODULES.map(defaultModuleProgress)
    };
  }

  function normalizeModuleProgress(value, spec) {
    const source = value && typeof value === 'object' ? value : {};
    const status = STATUS_VALUES.includes(clean(source.status, 20)) ? clean(source.status, 20) : 'pending';
    return {
      id: spec.id,
      label: spec.label,
      status: status,
      detail: clean(source.detail, 320) || defaultModuleProgress(spec).detail,
      processed: Math.max(0, Number(source.processed || 0) || 0),
      total: Math.max(0, Number(source.total || 0) || 0),
      updatedAt: clean(source.updatedAt, 80)
    };
  }

  function normalizeProgress(value) {
    const source = value && typeof value === 'object' ? value : {};
    const byId = new Map((Array.isArray(source.modules) ? source.modules : []).map(function (item) { return [safeId(item && item.id, ''), item]; }));
    const status = ['idle', 'running', 'success', 'warning', 'error'].includes(clean(source.status, 20)) ? clean(source.status, 20) : 'idle';
    return {
      version: PROGRESS_VERSION,
      contractVersion: CONTRACT_VERSION,
      status: status,
      runId: clean(source.runId, 180),
      label: clean(source.label, 120) || defaultProgress().label,
      message: clean(source.message, 420) || defaultProgress().message,
      startedAt: clean(source.startedAt, 80),
      finishedAt: clean(source.finishedAt, 80),
      updatedAt: clean(source.updatedAt, 80),
      modules: MODULES.map(function (spec) { return normalizeModuleProgress(byId.get(spec.id), spec); })
    };
  }

  function progressSummary(progress) {
    const state = normalizeProgress(progress);
    const summary = { total: state.modules.length, processed: 0, loaded: 0, warnings: 0, errors: 0, pending: 0, running: 0, percent: 0 };
    state.modules.forEach(function (module) {
      if (TERMINAL_VALUES.includes(module.status)) summary.processed += 1;
      if (module.status === 'success') summary.loaded += 1;
      else if (module.status === 'warning') { summary.loaded += 1; summary.warnings += 1; }
      else if (module.status === 'error') summary.errors += 1;
      else if (module.status === 'process') summary.running += 1;
      else summary.pending += 1;
    });
    summary.percent = summary.total ? Math.round((summary.processed / summary.total) * 100) : 0;
    return summary;
  }

  function dispatch(progress) {
    try {
      if (typeof g.CustomEvent === 'function' && g.dispatchEvent) g.dispatchEvent(new CustomEvent('a33:firestore-progress', { detail: clone(progress) }));
    } catch (_) {}
  }

  function readProgress() {
    return normalizeProgress(readJson(PROGRESS_KEY, defaultProgress()));
  }

  function saveProgress(progress) {
    const normalized = normalizeProgress(progress);
    normalized.updatedAt = nowIso();
    const saved = writeJson(PROGRESS_KEY, normalized);
    dispatch(normalized);
    return { ok: saved, state: clone(normalized), summary: progressSummary(normalized) };
  }

  function startProgress(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const startedAt = nowIso();
    const progress = defaultProgress();
    progress.status = 'running';
    progress.runId = clean(settings.runId, 180) || makeRunId();
    progress.label = clean(settings.label, 120) || 'Actualizando datos';
    progress.message = clean(settings.message, 420) || 'Preparando los nueve bloques de datos…';
    progress.startedAt = startedAt;
    progress.updatedAt = startedAt;
    const result = saveProgress(progress);
    try { if (settings.toast !== false && g.A33Toast && typeof g.A33Toast.process === 'function') g.A33Toast.process(progress.message, { id: TOAST_ID }); } catch (_) {}
    return result;
  }

  function setModuleProgress(moduleId, status, detail, counts) {
    const module = getModule(moduleId);
    const nextStatus = clean(status, 20);
    if (!module) return { ok: false, error: 'Módulo no permitido', state: readProgress() };
    if (!STATUS_VALUES.includes(nextStatus)) return { ok: false, error: 'Estado no permitido', state: readProgress() };
    const progress = readProgress();
    const target = progress.modules.find(function (item) { return item.id === module.id; });
    target.status = nextStatus;
    target.detail = clean(detail, 320) || target.detail;
    target.processed = Math.max(0, Number(counts && counts.processed || 0) || 0);
    target.total = Math.max(0, Number(counts && counts.total || 0) || 0);
    target.updatedAt = nowIso();
    if (progress.status === 'idle') {
      progress.status = 'running';
      progress.runId = makeRunId();
      progress.startedAt = target.updatedAt;
    }
    progress.label = 'Actualizando datos';
    progress.message = module.label + ': ' + target.detail;
    return saveProgress(progress);
  }

  function finishProgress(options) {
    const settings = options && typeof options === 'object' ? options : {};
    const progress = readProgress();
    const summary = progressSummary(progress);
    const hasPending = summary.pending > 0 || summary.running > 0;
    progress.status = summary.errors ? 'error' : (summary.warnings || hasPending ? 'warning' : 'success');
    progress.label = progress.status === 'success' ? 'Actualización completada' : (progress.status === 'error' ? 'Actualización con errores' : 'Actualización con avisos');
    progress.message = clean(settings.message, 420) || (summary.loaded + ' de ' + summary.total + ' módulos cargados.');
    progress.finishedAt = nowIso();
    const result = saveProgress(progress);
    try {
      if (settings.toast !== false && g.A33Toast && typeof g.A33Toast.replace === 'function') g.A33Toast.replace(TOAST_ID, progress.message, progress.status === 'success' ? 'success' : (progress.status === 'error' ? 'error' : 'warning'));
    } catch (_) {}
    return result;
  }

  function resetProgress() {
    return saveProgress(defaultProgress());
  }

  const contract = Object.freeze({
    name: 'Suite A33 Firestore Contract',
    contractVersion: CONTRACT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    maxDocumentBytes: MAX_DOCUMENT_BYTES,
    rootCollection: 'workspaces',
    modules: MODULES,
    remoteWritesEnabled: false
  });

  g.A33FirestoreData = Object.freeze({
    contract: contract,
    progressKey: PROGRESS_KEY,
    modules: MODULES,
    getModule: getModule,
    hasEntity: hasEntity,
    workspacePath: workspacePath,
    modulePath: modulePath,
    entityPath: entityPath,
    recordsPath: recordsPath,
    recordPath: recordPath,
    createDocument: createDocument,
    validateDocument: validateDocument,
    estimateBytes: estimateBytes,
    readProgress: readProgress,
    progressSummary: progressSummary,
    startProgress: startProgress,
    setModuleProgress: setModuleProgress,
    finishProgress: finishProgress,
    resetProgress: resetProgress,
    isRemoteEnabled: function () { return false; }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
