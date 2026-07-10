// Finanzas – Suite A33 · Fase 3A + Fase 4.2 + Fase 4.3.1 + Fase 6 (Flujo de Caja)
// Contabilidad básica: diario, tablero, ER, BG
// + Rentabilidad por presentación (lectura POS)
// + Comparativo de eventos (lectura Finanzas)
// + Flujo de Caja (Caja + Banco) por periodo.

const FIN_DB_NAME = 'finanzasDB';
// IMPORTANTE: subir versión cuando se agregan stores/nuevas estructuras.
// v3 agrega el store `suppliers` para Proveedores (sin romper data existente).
const FIN_DB_VERSION = 8; // + Transferencias Internas (store `internalTransfers`) + Cuentas Financieras + Recibos + Importación cierres diarios POS
const CENTRAL_EVENT = 'CENTRAL';

// Hardening Etapa 10/10: límites de render visual para reportes largos.
// Excel conserva el detalle completo; la UI evita trabarse en iPad/PWA.
const FIN_REPORT_UI_LIMIT = 120;
const FIN_REPORT_JOURNAL_UI_LIMIT = 80;
const FIN_REPORT_BALANZA_UI_LIMIT = 180;

let finDB = null;
let finCachedData = null; // {accounts, accountsMap, entries, lines, linesByEntry}

// Catálogo de cuentas (UI)
let catQuery = '';
let catUsageCache = null; // {rev, countsObj, updatedAt}
const CAT_USAGE_CACHE_KEY = 'a33_fin_accounts_usage_cache_v1';
let catAutoRootType = true;

// POS: lectura de ventas (solo lectura, sin tocar nada del POS)
const POS_DB_NAME = 'a33-pos';
let posDB = null;

// POS: eventos (solo lectura). Se usa para dropdown Evento y para resolver nombres live por posEventId.
let posEventsMap = new Map(); // id -> {id,name,closedAt,createdAt}
let posActiveEvents = []; // [{id,name,createdAt}] (solo abiertos, sin General/Central)
let posEventsLoadedAt = 0;

const $ = (sel) => document.querySelector(sel);

function finAttachExportCurrencyMetadata(wb, title = 'Referencia monetaria — Finanzas') {
  try {
    if (window.A33ExportCurrency && typeof window.A33ExportCurrency.appendWorkbookMetadataSheet === 'function') {
      window.A33ExportCurrency.appendWorkbookMetadataSheet(wb, XLSX, {
        title,
        sheetName: 'Moneda'
      });
    }
  } catch (_) {}
  return wb;
}

/* ---------- IndexedDB helpers: Finanzas ---------- */

function openFinDB() {
  return new Promise((resolve, reject) => {
    if (finDB) return resolve(finDB);

    const req = indexedDB.open(FIN_DB_NAME, FIN_DB_VERSION);

    // Si hay otra pestaña con la DB abierta en versión vieja, el upgrade puede quedar bloqueado.
    req.onblocked = () => {
      console.warn('IndexedDB upgrade bloqueado: otra pestaña mantiene una conexión abierta.');
      alert('Finanzas necesita actualizar su base de datos, pero está bloqueado por otra pestaña.\n\nCierra otras pestañas/ventanas de la Suite A33 y recarga.');
    };

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('accounts')) {
        db.createObjectStore('accounts', { keyPath: 'code' });
      }

      if (!db.objectStoreNames.contains('journalEntries')) {
        db.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
      }

      if (!db.objectStoreNames.contains('journalLines')) {
        db.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
      }
    

      if (!db.objectStoreNames.contains('suppliers')) {
        db.createObjectStore('suppliers', { keyPath: 'id', autoIncrement: true });
      }



      // Recibos (mínimo): borradores/emitidos/anulados (Etapa 1 crea BORRADOR)
      if (!db.objectStoreNames.contains('receipts')) {
        const st = db.createObjectStore('receipts', { keyPath: 'receiptId' });
        try { st.createIndex('dateISO', 'dateISO', { unique: false }); } catch (e) {}
        try { st.createIndex('status', 'status', { unique: false }); } catch (e) {}
        try { st.createIndex('updatedAt', 'updatedAt', { unique: false }); } catch (e) {}
      } else {
        // Asegurar índices si la store ya existe (idempotente)
        try {
          const st = e.target.transaction.objectStore('receipts');
          if (st && !st.indexNames.contains('dateISO')) st.createIndex('dateISO', 'dateISO', { unique: false });
          if (st && !st.indexNames.contains('status')) st.createIndex('status', 'status', { unique: false });
          if (st && !st.indexNames.contains('updatedAt')) st.createIndex('updatedAt', 'updatedAt', { unique: false });
        } catch (err) {}
      }
      // Cuentas Financieras (configuración multibanco/multimoneda, no contable)
      if (!db.objectStoreNames.contains('financialAccounts')) {
        const st = db.createObjectStore('financialAccounts', { keyPath: 'id' });
        try { st.createIndex('uniqueKey', 'uniqueKey', { unique: true }); } catch (e) {}
        try { st.createIndex('type', 'type', { unique: false }); } catch (e) {}
        try { st.createIndex('currency', 'moneda', { unique: false }); } catch (e) {}
        try { st.createIndex('active', 'activa', { unique: false }); } catch (e) {}
        try { st.createIndex('bankId', 'bancoId', { unique: false }); } catch (e) {}
      } else {
        try {
          const st = e.target.transaction.objectStore('financialAccounts');
          if (st && !st.indexNames.contains('uniqueKey')) st.createIndex('uniqueKey', 'uniqueKey', { unique: true });
          if (st && !st.indexNames.contains('type')) st.createIndex('type', 'type', { unique: false });
          if (st && !st.indexNames.contains('currency')) st.createIndex('currency', 'moneda', { unique: false });
          if (st && !st.indexNames.contains('active')) st.createIndex('active', 'activa', { unique: false });
          if (st && !st.indexNames.contains('bankId')) st.createIndex('bankId', 'bancoId', { unique: false });
        } catch (err) {}
      }


      // Transferencias Internas (movimiento entre cuentas financieras, no ingreso/egreso)
      if (!db.objectStoreNames.contains('internalTransfers')) {
        const st = db.createObjectStore('internalTransfers', { keyPath: 'transferId' });
        try { st.createIndex('fecha', 'fecha', { unique: false }); } catch (e) {}
        try { st.createIndex('journalEntryId', 'journalEntryId', { unique: false }); } catch (e) {}
        try { st.createIndex('cuentaOrigenId', 'cuentaOrigenId', { unique: false }); } catch (e) {}
        try { st.createIndex('cuentaDestinoId', 'cuentaDestinoId', { unique: false }); } catch (e) {}
        try { st.createIndex('createdAtISO', 'createdAtISO', { unique: false }); } catch (e) {}
      } else {
        try {
          const st = e.target.transaction.objectStore('internalTransfers');
          if (st && !st.indexNames.contains('fecha')) st.createIndex('fecha', 'fecha', { unique: false });
          if (st && !st.indexNames.contains('journalEntryId')) st.createIndex('journalEntryId', 'journalEntryId', { unique: false });
          if (st && !st.indexNames.contains('cuentaOrigenId')) st.createIndex('cuentaOrigenId', 'cuentaOrigenId', { unique: false });
          if (st && !st.indexNames.contains('cuentaDestinoId')) st.createIndex('cuentaDestinoId', 'cuentaDestinoId', { unique: false });
          if (st && !st.indexNames.contains('createdAtISO')) st.createIndex('createdAtISO', 'createdAtISO', { unique: false });
        } catch (err) {}
      }

      // Settings / snapshots (no contable): por ejemplo Caja Chica física.
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // Importación cierres diarios del POS (idempotencia + lookup por evento/día)
      if (!db.objectStoreNames.contains('posDailyCloseImports')) {
        const st = db.createObjectStore('posDailyCloseImports', { keyPath: 'closureId' });
        try { st.createIndex('eventDateKey', 'eventDateKey', { unique: false }); } catch (e) {}
      } else {
        // Si la store ya existe (por versiones viejas), asegurar índice.
        try {
          const st = e.target.transaction.objectStore('posDailyCloseImports');
          if (st && !st.indexNames.contains('eventDateKey')) {
            st.createIndex('eventDateKey', 'eventDateKey', { unique: false });
          }
        } catch (err) {}
      }
    };

    req.onsuccess = () => {
      finDB = req.result;

      // Si otra pestaña sube la versión, esta conexión debe cerrarse.
      finDB.onversionchange = () => {
        try { finDB.close(); } catch (e) {}
        finDB = null;
        alert('Se detectó una actualización de Finanzas en otra pestaña.\nCierra esta pestaña y vuelve a abrir Finanzas.');
      };

      resolve(finDB);
    };
    req.onerror = () => {
      const err = req.error;
      if (err && err.name === 'VersionError') {
        console.warn('Finanzas: la base finanzasDB está en una versión más reciente que este código. Se abrirá la versión existente.');
        const req2 = indexedDB.open(FIN_DB_NAME);
        req2.onsuccess = () => {
          finDB = req2.result;

          finDB.onversionchange = () => {
            try { finDB.close(); } catch (e) {}
            finDB = null;
            alert('Se detectó una actualización de Finanzas en otra pestaña.\nCierra esta pestaña y vuelve a abrir Finanzas.');
          };

          // Si por alguna razón falta la store de recibos, hacer un upgrade mínimo (version + 1).
          try {
            if (!finDB.objectStoreNames.contains('receipts')) {
              const currentVersion = finDB.version || 1;
              try { finDB.close(); } catch (e) {}
              finDB = null;

              const req3 = indexedDB.open(FIN_DB_NAME, currentVersion + 1);
              req3.onblocked = () => {
                console.warn('Upgrade (receipts) bloqueado por otra pestaña.');
                alert('Finanzas necesita actualizar su base de datos (Recibos), pero está bloqueado por otra pestaña.\n\nCierra otras pestañas/ventanas de la Suite A33 y recarga.');
              };
              req3.onupgradeneeded = (ev) => {
                const db2 = ev.target.result;
                if (!db2.objectStoreNames.contains('receipts')) {
                  const st = db2.createObjectStore('receipts', { keyPath: 'receiptId' });
                  try { st.createIndex('dateISO', 'dateISO', { unique: false }); } catch (e) {}
                  try { st.createIndex('status', 'status', { unique: false }); } catch (e) {}
                  try { st.createIndex('updatedAt', 'updatedAt', { unique: false }); } catch (e) {}
                }
              };
              req3.onsuccess = () => {
                finDB = req3.result;

                finDB.onversionchange = () => {
                  try { finDB.close(); } catch (e) {}
                  finDB = null;
                  alert('Se detectó una actualización de Finanzas en otra pestaña.\nCierra esta pestaña y vuelve a abrir Finanzas.');
                };

                resolve(finDB);
              };
              req3.onerror = () => reject(req3.error);
              return;
            }
          } catch (_) {}

          resolve(finDB);
        };
        req2.onerror = () => reject(req2.error);
        return;
      }
      reject(err);
    };
  });
}

function finTx(storeName, mode = 'readonly') {
  const tx = finDB.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function finGet(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readonly');
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

function finGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readonly');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function finGetAllByIndex(storeName, indexName, key) {
  return new Promise((resolve, reject) => {
    let store;
    try {
      store = finTx(storeName, 'readonly');
    } catch (err) {
      resolve([]);
      return;
    }
    let idx;
    try {
      idx = store.index(indexName);
    } catch (err) {
      resolve([]);
      return;
    }
    const req = idx.getAll(key);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function finAdd(storeName, val) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readwrite');
    const req = store.add(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finPut(storeName, val) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readwrite');
    const req = store.put(val);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function finDelete(storeName, key) {
  return new Promise((resolve, reject) => {
    const store = finTx(storeName, 'readwrite');
    const req = store.delete(key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

/* ---------- IndexedDB helpers: POS (solo lectura) ---------- */

function openPosDB() {
  return new Promise((resolve) => {
    if (posDB) return resolve(posDB);
    let req;
    try {
      // Sin versión: abre la base existente sin disparar onupgradeneeded
      req = indexedDB.open(POS_DB_NAME);
    } catch (err) {
      console.warn('No se pudo abrir la base de datos del POS', err);
      return resolve(null);
    }
    req.onsuccess = () => {
      posDB = req.result;
      resolve(posDB);
    };
    req.onerror = () => {
      console.warn('Error al abrir a33-pos desde Finanzas', req.error);
      resolve(null); // tratamos como sin datos
    };
  });
}

function posTx(storeName, mode = 'readonly') {
  if (!posDB) throw new Error('POS DB no inicializada');
  const tx = posDB.transaction(storeName, mode);
  return tx.objectStore(storeName);
}

function getAllPosSales() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('sales', 'readonly');
    } catch (err) {
      console.warn('Store sales no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer las ventas del POS', req.error);
      resolve([]);
    };
  });
}


function getAllPosEventsSafe() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('events', 'readonly');
    } catch (err) {
      console.warn('Store events no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer los eventos del POS', req.error);
      resolve([]);
    };
  });
}


function getAllPosBanksSafe() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('banks', 'readonly');
    } catch (err) {
      // Catálogos → Bancos puede no existir todavía en instalaciones viejas.
      console.warn('Store banks no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer los bancos maestros desde Catálogos', req.error);
      resolve([]);
    };
  });
}

function getAllPosDailyClosuresSafe() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('dailyClosures', 'readonly');
    } catch (err) {
      console.warn('Store dailyClosures no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer los cierres diarios del POS', req.error);
      resolve([]);
    };
  });
}

function getAllPosCashV2Safe() {
  return new Promise(async (resolve) => {
    const db = await openPosDB();
    if (!db) {
      resolve([]);
      return;
    }
    let store;
    try {
      store = posTx('cashV2', 'readonly');
    } catch (err) {
      // Instalaciones anteriores pueden no tener Efectivo v2. Lectura defensiva.
      console.warn('Store cashV2 no encontrada en a33-pos', err);
      resolve([]);
      return;
    }
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => {
      console.warn('No se pudieron leer movimientos de Efectivo POS', req.error);
      resolve([]);
    };
  });
}

async function refreshPosEventsCache() {
  // Lee a33-pos (si existe) y construye mapa + lista de eventos abiertos para el dropdown.
  try {
    const events = await getAllPosEventsSafe();
    const map = new Map();
    for (const ev of (Array.isArray(events) ? events : [])) {
      if (!ev) continue;
      const idRaw = ev.id;
      const id = (typeof idRaw === 'number') ? idRaw : parseInt(String(idRaw || '').trim(), 10);
      if (!id) continue;
      const name = String(ev.name || ev.nombre || '').trim();
      map.set(id, { id, name, closedAt: ev.closedAt || null, createdAt: ev.createdAt || null });
    }

    posEventsMap = map;

    const active = [];
    for (const v of map.values()) {
      const nm = String(v.name || '').trim();
      if (!nm) continue;
      if (v.closedAt) continue;
      // Evitar duplicar el evento general del POS; en Finanzas se usa Central.
      if (isCentralEventName(nm)) continue;
      active.push({ id: v.id, name: nm, createdAt: v.createdAt || '' });
    }

    // Orden: más reciente primero (createdAt ISO). Fallback alfabético.
    active.sort((a, b) => {
      const ca = String(a.createdAt || '');
      const cb = String(b.createdAt || '');
      if (ca && cb && ca !== cb) return (ca < cb) ? 1 : -1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'es');
    });

    posActiveEvents = active;
    posEventsLoadedAt = Date.now();
  } catch (err) {
    console.warn('No se pudo refrescar cache de eventos POS', err);
    posEventsMap = new Map();
    posActiveEvents = [];
    posEventsLoadedAt = Date.now();
  }
}

function getPosEventNameLiveById(posEventId) {
  const id = (typeof posEventId === 'number') ? posEventId : parseInt(String(posEventId || '').trim(), 10);
  if (!id) return '';
  const ev = posEventsMap.get(id);
  const nm = ev ? String(ev.name || '').trim() : '';
  return nm;
}

function getPosEventNameSnapshotById(posEventId, snapshot) {
  const live = getPosEventNameLiveById(posEventId);
  if (live) return live;
  const snap = String(snapshot || '').trim();
  if (snap) return snap;
  const id = (typeof posEventId === 'number') ? posEventId : parseInt(String(posEventId || '').trim(), 10);
  return id ? `Evento POS (${id})` : 'Evento POS';
}

function populateMovimientoEventoSelect() {
  const sel = document.getElementById('mov-evento-sel');
  if (!sel) return;

  const prev = sel.value || 'CENTRAL';
  sel.innerHTML = '';

  const optCentral = document.createElement('option');
  optCentral.value = 'CENTRAL';
  optCentral.textContent = 'Central';
  sel.appendChild(optCentral);

  // Eventos activos del POS
  for (const ev of (Array.isArray(posActiveEvents) ? posActiveEvents : [])) {
    const opt = document.createElement('option');
    opt.value = `POS:${ev.id}`;
    opt.textContent = ev.name;
    sel.appendChild(opt);
  }

  // Restaurar selección si todavía existe.
  if (prev && Array.from(sel.options).some(o => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = 'CENTRAL';
  }
}
/* ---------- Catálogo de cuentas base ---------- */

const BASE_ACCOUNTS = [
  // 1xxx Activos · Etapa 2/10: base multimoneda conservadora
  { code: '1100', nombre: 'Caja general C$', tipo: 'activo', systemProtected: true, rootType: 'ACTIVO', accountRole: 'cash_general', currency: 'NIO', currencyCode: 'NIO', isCash: true, financialAccount: true, legacyNames: ['Caja general'] },
  { code: '1105', nombre: 'Caja general US$', tipo: 'activo', systemProtected: true, rootType: 'ACTIVO', accountRole: 'cash_general', currency: 'USD', currencyCode: 'USD', isCash: true, financialAccount: true },
  { code: '1110', nombre: 'Caja eventos C$', tipo: 'activo', systemProtected: true, rootType: 'ACTIVO', accountRole: 'cash_events', currency: 'NIO', currencyCode: 'NIO', isCash: true, financialAccount: true, legacyNames: ['Caja eventos'] },
  { code: '1115', nombre: 'Caja eventos US$', tipo: 'activo', systemProtected: true, rootType: 'ACTIVO', accountRole: 'cash_events', currency: 'USD', currencyCode: 'USD', isCash: true, financialAccount: true },
  { code: '1200', nombre: 'Banco legacy / histórico', tipo: 'activo', systemProtected: true, rootType: 'ACTIVO', accountRole: 'bank_legacy', currency: 'NIO', currencyCode: 'NIO', isBank: true, financialAccount: true, isLegacy: true, legacyFinancialAccount: true, legacyNames: ['Banco'] },
  { code: '1300', nombre: 'Clientes (crédito)', tipo: 'activo', systemProtected: true },
  { code: '1310', nombre: 'Deudores varios', tipo: 'activo', systemProtected: true },
  { code: '1400', nombre: 'Inventario insumos líquidos', tipo: 'activo', systemProtected: true },
  { code: '1410', nombre: 'Inventario insumos de empaque', tipo: 'activo', systemProtected: true },
  { code: '1500', nombre: 'Inventario producto terminado A33', tipo: 'activo', systemProtected: true },
  { code: '1900', nombre: 'Otros activos', tipo: 'activo', systemProtected: false },

  // 2xxx Pasivos
  { code: '2100', nombre: 'Proveedores de insumos', tipo: 'pasivo', systemProtected: true },
  { code: '2110', nombre: 'Proveedores de servicios y eventos', tipo: 'pasivo', systemProtected: true },
  { code: '2200', nombre: 'Acreedores varios', tipo: 'pasivo', systemProtected: true },
  { code: '2900', nombre: 'Otros pasivos', tipo: 'pasivo', systemProtected: false },

  // 3xxx Patrimonio
  { code: '3100', nombre: 'Capital aportado A33', tipo: 'patrimonio', systemProtected: true },
  { code: '3200', nombre: 'Aportes adicionales del dueño', tipo: 'patrimonio', systemProtected: true },
  { code: '3300', nombre: 'Retiros del dueño', tipo: 'patrimonio', systemProtected: true },
  { code: '3900', nombre: 'Resultados acumulados', tipo: 'patrimonio', systemProtected: true },

  // 4xxx Ingresos
  { code: '4100', nombre: 'Ingresos por ventas Arcano 33 (general)', tipo: 'ingreso', systemProtected: true },
  { code: '4200', nombre: 'Ingresos por otros productos', tipo: 'ingreso', systemProtected: false },
  { code: '4210', nombre: 'Ingresos por talleres / workshop', tipo: 'ingreso', systemProtected: false },

  // 5xxx Costos de venta
  { code: '5100', nombre: 'Costo de ventas Arcano 33 (general)', tipo: 'costo', systemProtected: true },

  // 6xxx Gastos de operación
  { code: '6100', nombre: 'Gastos de eventos – generales', tipo: 'gasto', systemProtected: true },
  { code: '6105', nombre: 'Cortesías (Promoción)', tipo: 'gasto', systemProtected: true },
  { code: '6106', nombre: 'Impuesto cuota fija', tipo: 'gasto', systemProtected: true },
  { code: '6110', nombre: 'Servicios (luz/agua/teléfono, etc.)', tipo: 'gasto', systemProtected: true },
  { code: '6120', nombre: 'Gastos de delivery / envíos', tipo: 'gasto', systemProtected: true },
  { code: '6130', nombre: 'Gastos varios A33', tipo: 'gasto', systemProtected: true },

  // 7xxx Otros ingresos/gastos
  { code: '7100', nombre: 'Otros ingresos varios', tipo: 'ingreso', systemProtected: false },
  { code: '7200', nombre: 'Otros gastos varios', tipo: 'gasto', systemProtected: false }
];

function inferTipoFromCode(code) {
  const c = String(code || '').charAt(0);
  if (c === '1') return 'activo';
  if (c === '2') return 'pasivo';
  if (c === '3') return 'patrimonio';
  if (c === '4') return 'ingreso';
  if (c === '5') return 'costo';
  if (c === '6') return 'gasto';
  return 'otro';
}

function getTipoCuenta(acc) {
  return acc.tipo || inferTipoFromCode(acc.code);
}

/* ---------- Compatibilidad financiera legacy / futura multibanco ---------- */

const FIN_LEGACY_ACCOUNT_CODES = Object.freeze({
  cashGeneral: '1100',
  cashEvents: '1110',
  bank: '1200'
});

const FIN_MULTICURRENCY_ACCOUNT_CODES = Object.freeze({
  cashGeneralNIO: '1100',
  cashGeneralUSD: '1105',
  cashEventsNIO: '1110',
  cashEventsUSD: '1115',
  bankLegacy: '1200'
});

const FIN_BASE_CURRENCY_CODE = 'NIO';
const FIN_SUPPORTED_CURRENCY_CODES = Object.freeze(['NIO', 'USD']);
const FIN_MULTICURRENCY_STAGE = 'finanzas_multibanco_etapa_3_10';
const FIN_CORE_FINANCIAL_ACCOUNT_CODES = Object.freeze([
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralNIO,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralUSD,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsNIO,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsUSD,
  FIN_MULTICURRENCY_ACCOUNT_CODES.bankLegacy
]);
const FIN_CASH_ACCOUNT_CODES = Object.freeze([
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralNIO,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralUSD,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsNIO,
  FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsUSD
]);
const FIN_LEGACY_CASH_ACCOUNT_CODES = Object.freeze([
  FIN_LEGACY_ACCOUNT_CODES.cashGeneral,
  FIN_LEGACY_ACCOUNT_CODES.cashEvents
]);
const FIN_LEGACY_BANK_ACCOUNT_CODES = Object.freeze([FIN_LEGACY_ACCOUNT_CODES.bank]);
const FIN_DYNAMIC_BANK_CODE_MIN = 1201;
const FIN_DYNAMIC_BANK_CODE_MAX = 1999;


// Etapa 5/9 Diario Contable: selector contable reutilizable sobre cuentas posteables.
// Las cuentas legacy se conservan internas para históricos y flujos actuales.
const FIN_ACCOUNTING_REDESIGN_STAGE = 'finanzas_diario_contable_etapa_7_9';
const FIN_ACCOUNT_SELECTOR_STAGE = 'finanzas_diario_contable_etapa_7_9_selector_posteables';
const FIN_ACCOUNT_HIERARCHY_VERSION = 7;
const FIN_FIXED_ROOT_ACCOUNTS = Object.freeze([
  Object.freeze({ code: '1000', name: 'Activos', nombre: 'Activos', type: 'activo', tipo: 'activo', rootType: 'ACTIVO', nature: 'deudora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '2000', name: 'Pasivos', nombre: 'Pasivos', type: 'pasivo', tipo: 'pasivo', rootType: 'PASIVO', nature: 'acreedora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '3000', name: 'Capital', nombre: 'Capital', type: 'capital', tipo: 'patrimonio', rootType: 'PATRIMONIO', nature: 'acreedora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '4000', name: 'Ingresos', nombre: 'Ingresos', type: 'ingreso', tipo: 'ingreso', rootType: 'INGRESOS', nature: 'acreedora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '5000', name: 'Costos', nombre: 'Costos', type: 'costo', tipo: 'costo', rootType: 'COSTOS', nature: 'deudora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '6000', name: 'Gastos', nombre: 'Gastos', type: 'gasto', tipo: 'gasto', rootType: 'GASTOS', nature: 'deudora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 }),
  Object.freeze({ code: '7000', name: 'Otros ingresos', nombre: 'Otros ingresos', type: 'otros_ingresos', tipo: 'ingreso', rootType: 'OTROS', nature: 'acreedora', isRoot: true, isLocked: true, isPostable: false, isActive: true, parentId: null, level: 1 })
]);
const FIN_FIXED_ROOT_CODES = Object.freeze(FIN_FIXED_ROOT_ACCOUNTS.map(a => a.code));
const FIN_FIXED_ROOTS_BY_CODE = Object.freeze(FIN_FIXED_ROOT_ACCOUNTS.reduce((acc, root) => {
  acc[root.code] = root;
  return acc;
}, {}));

const FIN_ACCOUNT_CATALOG_VISIBLE_MODE = 'hierarchical_rules_etapa_4_9';


// Catálogo depurado Arcano 33 cargado desde Excel (sin importador permanente en UI).
// Fuente operativa: Catalogo_Cuentas_Arcano33_Recomendado_v2.xlsx.
const FIN_ACCOUNT_EXCEL_SEED_VERSION = 1;
const FIN_ACCOUNT_EXCEL_SEED_SOURCE = 'Catalogo_Cuentas_Arcano33_Recomendado_v2.xlsx';
const FIN_ACCOUNT_EXCEL_SEED_ROWS = Object.freeze([
  {
    "code": "1100",
    "nombre": "Efectivo",
    "parentCode": "1000",
    "level": 2,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1110",
    "nombre": "Caja general",
    "parentCode": "1100",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1111",
    "nombre": "Caja general C$",
    "parentCode": "1110",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1112",
    "nombre": "Caja general US$",
    "parentCode": "1110",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1120",
    "nombre": "Caja eventos",
    "parentCode": "1100",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1121",
    "nombre": "Caja eventos C$",
    "parentCode": "1120",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1122",
    "nombre": "Caja eventos US$",
    "parentCode": "1120",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1130",
    "nombre": "Caja chica",
    "parentCode": "1100",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1131",
    "nombre": "Caja chica C$",
    "parentCode": "1130",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1132",
    "nombre": "Caja chica US$",
    "parentCode": "1130",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1200",
    "nombre": "Bancos",
    "parentCode": "1000",
    "level": 2,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1210",
    "nombre": "Banco 1",
    "parentCode": "1200",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": "Renombrar según banco real"
  },
  {
    "code": "1211",
    "nombre": "Banco 1 C$",
    "parentCode": "1210",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1212",
    "nombre": "Banco 1 US$",
    "parentCode": "1210",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1220",
    "nombre": "Banco 2",
    "parentCode": "1200",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": "Renombrar según banco real"
  },
  {
    "code": "1221",
    "nombre": "Banco 2 C$",
    "parentCode": "1220",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1222",
    "nombre": "Banco 2 US$",
    "parentCode": "1220",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1300",
    "nombre": "Cuentas por cobrar",
    "parentCode": "1000",
    "level": 2,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1310",
    "nombre": "Clientes",
    "parentCode": "1300",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1311",
    "nombre": "Clientes por ventas al crédito C$",
    "parentCode": "1310",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1312",
    "nombre": "Clientes por ventas al crédito US$",
    "parentCode": "1310",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1400",
    "nombre": "Inventarios",
    "parentCode": "1000",
    "level": 2,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1410",
    "nombre": "Materia prima",
    "parentCode": "1400",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1411",
    "nombre": "Vino tinto",
    "parentCode": "1410",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1412",
    "nombre": "Cítricos",
    "parentCode": "1410",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1413",
    "nombre": "Endulzantes / jarabes",
    "parentCode": "1410",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1414",
    "nombre": "Licores / vodka / complementos",
    "parentCode": "1410",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1420",
    "nombre": "Producto terminado",
    "parentCode": "1400",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1421",
    "nombre": "Sangría Artesanal Premium - Galón",
    "parentCode": "1420",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1422",
    "nombre": "Sangría Artesanal Premium - Litro",
    "parentCode": "1420",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1423",
    "nombre": "Sangría Artesanal Premium - Djeba 750 ml",
    "parentCode": "1420",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1424",
    "nombre": "Sangría Artesanal Premium - Media 375 ml",
    "parentCode": "1420",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1425",
    "nombre": "Sangría Artesanal Premium - Pulso 250 ml",
    "parentCode": "1420",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1430",
    "nombre": "Empaque y presentación",
    "parentCode": "1400",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1431",
    "nombre": "Botellas",
    "parentCode": "1430",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1432",
    "nombre": "Tapas / corchos / sellos",
    "parentCode": "1430",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1433",
    "nombre": "Etiquetas",
    "parentCode": "1430",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1434",
    "nombre": "Bolsas / empaques / cajas",
    "parentCode": "1430",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1440",
    "nombre": "Insumos de servicio",
    "parentCode": "1400",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1441",
    "nombre": "Vasos",
    "parentCode": "1440",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1442",
    "nombre": "Hielo",
    "parentCode": "1440",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1443",
    "nombre": "Servilletas / pajillas / decoración",
    "parentCode": "1440",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1500",
    "nombre": "Activos fijos",
    "parentCode": "1000",
    "level": 2,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1510",
    "nombre": "Equipos de producción",
    "parentCode": "1500",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1511",
    "nombre": "Recipientes / dispensadores / utensilios",
    "parentCode": "1510",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1512",
    "nombre": "Equipos de medición",
    "parentCode": "1510",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1520",
    "nombre": "Equipos de oficina y tecnología",
    "parentCode": "1500",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1521",
    "nombre": "Computadoras / tablets / impresoras",
    "parentCode": "1520",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1522",
    "nombre": "Mobiliario y accesorios",
    "parentCode": "1520",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1530",
    "nombre": "Depreciación acumulada",
    "parentCode": "1500",
    "level": 3,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Activo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "1531",
    "nombre": "Depreciación acumulada equipos de producción",
    "parentCode": "1530",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "1532",
    "nombre": "Depreciación acumulada equipos de oficina",
    "parentCode": "1530",
    "level": 4,
    "tipo": "activo",
    "rootType": "ACTIVO",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Activo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2100",
    "nombre": "Cuentas por pagar",
    "parentCode": "2000",
    "level": 2,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2110",
    "nombre": "Proveedores",
    "parentCode": "2100",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2111",
    "nombre": "Proveedores de materia prima",
    "parentCode": "2110",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2112",
    "nombre": "Proveedores de empaque",
    "parentCode": "2110",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2113",
    "nombre": "Proveedores de servicios",
    "parentCode": "2110",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2120",
    "nombre": "Gastos acumulados por pagar",
    "parentCode": "2100",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2121",
    "nombre": "Servicios básicos por pagar",
    "parentCode": "2120",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2122",
    "nombre": "Alquileres por pagar",
    "parentCode": "2120",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2123",
    "nombre": "Publicidad por pagar",
    "parentCode": "2120",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2200",
    "nombre": "Impuestos y retenciones por pagar",
    "parentCode": "2000",
    "level": 2,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2210",
    "nombre": "Impuestos sobre ventas / consumo",
    "parentCode": "2200",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2211",
    "nombre": "IVA por pagar",
    "parentCode": "2210",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": "Validar con contador"
  },
  {
    "code": "2212",
    "nombre": "IVA acreditable / compensable",
    "parentCode": "2210",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": "Validar con contador"
  },
  {
    "code": "2220",
    "nombre": "Impuestos sobre renta y retenciones",
    "parentCode": "2200",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2221",
    "nombre": "IR por pagar",
    "parentCode": "2220",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": "Validar con contador"
  },
  {
    "code": "2222",
    "nombre": "Retenciones por pagar",
    "parentCode": "2220",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": "Validar con contador"
  },
  {
    "code": "2223",
    "nombre": "Anticipos de IR por pagar",
    "parentCode": "2220",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": "Validar con contador"
  },
  {
    "code": "2300",
    "nombre": "Préstamos y financiamientos",
    "parentCode": "2000",
    "level": 2,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2310",
    "nombre": "Préstamos de terceros",
    "parentCode": "2300",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2311",
    "nombre": "Préstamos recibidos C$",
    "parentCode": "2310",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2312",
    "nombre": "Préstamos recibidos US$",
    "parentCode": "2310",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2320",
    "nombre": "Tarjetas / financiamiento operativo",
    "parentCode": "2300",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2321",
    "nombre": "Tarjeta de crédito empresarial",
    "parentCode": "2320",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2322",
    "nombre": "Financiamiento de compras",
    "parentCode": "2320",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2400",
    "nombre": "Anticipos recibidos",
    "parentCode": "2000",
    "level": 2,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2410",
    "nombre": "Clientes",
    "parentCode": "2400",
    "level": 3,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Pasivo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "2411",
    "nombre": "Anticipos de clientes por pedidos",
    "parentCode": "2410",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "2412",
    "nombre": "Anticipos de eventos",
    "parentCode": "2410",
    "level": 4,
    "tipo": "pasivo",
    "rootType": "PASIVO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Pasivo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3100",
    "nombre": "Capital del propietario",
    "parentCode": "3000",
    "level": 2,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Capital",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "3110",
    "nombre": "Aportes",
    "parentCode": "3100",
    "level": 3,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Capital",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "3111",
    "nombre": "Aportes de capital C$",
    "parentCode": "3110",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3112",
    "nombre": "Aportes de capital US$",
    "parentCode": "3110",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3120",
    "nombre": "Retiros del propietario",
    "parentCode": "3100",
    "level": 3,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Capital",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "3121",
    "nombre": "Retiros personales C$",
    "parentCode": "3120",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3122",
    "nombre": "Retiros personales US$",
    "parentCode": "3120",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3200",
    "nombre": "Resultados acumulados",
    "parentCode": "3000",
    "level": 2,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Capital",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "3210",
    "nombre": "Resultados",
    "parentCode": "3200",
    "level": 3,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Capital",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "3211",
    "nombre": "Utilidades acumuladas",
    "parentCode": "3210",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3212",
    "nombre": "Pérdidas acumuladas",
    "parentCode": "3210",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "3213",
    "nombre": "Resultado del ejercicio",
    "parentCode": "3210",
    "level": 4,
    "tipo": "patrimonio",
    "rootType": "PATRIMONIO",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Capital",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4100",
    "nombre": "Ventas de productos",
    "parentCode": "4000",
    "level": 2,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4110",
    "nombre": "Sangría Artesanal Premium por presentación",
    "parentCode": "4100",
    "level": 3,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4111",
    "nombre": "Ventas Galón",
    "parentCode": "4110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4112",
    "nombre": "Ventas Litro",
    "parentCode": "4110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4113",
    "nombre": "Ventas Djeba 750 ml",
    "parentCode": "4110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4114",
    "nombre": "Ventas Media 375 ml",
    "parentCode": "4110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4115",
    "nombre": "Ventas Pulso 250 ml",
    "parentCode": "4110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "4200",
    "nombre": "Ventas por canal",
    "parentCode": "4000",
    "level": 2,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4210",
    "nombre": "Canales de venta",
    "parentCode": "4200",
    "level": 3,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4211",
    "nombre": "Ventas POS / directas",
    "parentCode": "4210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Usar solo si se decide contabilizar por canal"
  },
  {
    "code": "4212",
    "nombre": "Ventas por pedidos",
    "parentCode": "4210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Usar solo si se decide contabilizar por canal"
  },
  {
    "code": "4213",
    "nombre": "Ventas por eventos",
    "parentCode": "4210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Usar solo si se decide contabilizar por canal"
  },
  {
    "code": "4214",
    "nombre": "Ventas corporativas / especiales",
    "parentCode": "4210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Usar solo si se decide contabilizar por canal"
  },
  {
    "code": "4300",
    "nombre": "Descuentos y cortesías",
    "parentCode": "4000",
    "level": 2,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4310",
    "nombre": "Rebajas sobre ventas",
    "parentCode": "4300",
    "level": 3,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "4311",
    "nombre": "Descuentos concedidos",
    "parentCode": "4310",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Contra-ingreso si se usa contablemente"
  },
  {
    "code": "4312",
    "nombre": "Cortesías comerciales",
    "parentCode": "4310",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "INGRESOS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Ingreso",
    "excelType": "Posteable",
    "notes": "Contra-ingreso si se usa contablemente"
  },
  {
    "code": "5100",
    "nombre": "Costo de producción",
    "parentCode": "5000",
    "level": 2,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5110",
    "nombre": "Materia prima consumida",
    "parentCode": "5100",
    "level": 3,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5111",
    "nombre": "Costo de vino tinto",
    "parentCode": "5110",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5112",
    "nombre": "Costo de frutas y cítricos",
    "parentCode": "5110",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5113",
    "nombre": "Costo de endulzantes / jarabes",
    "parentCode": "5110",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5114",
    "nombre": "Costo de licores complementarios",
    "parentCode": "5110",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5120",
    "nombre": "Empaque consumido",
    "parentCode": "5100",
    "level": 3,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5121",
    "nombre": "Costo de botellas",
    "parentCode": "5120",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5122",
    "nombre": "Costo de tapas / sellos",
    "parentCode": "5120",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5123",
    "nombre": "Costo de etiquetas",
    "parentCode": "5120",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5124",
    "nombre": "Costo de bolsas / cajas",
    "parentCode": "5120",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5130",
    "nombre": "Insumos de servicio consumidos",
    "parentCode": "5100",
    "level": 3,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5131",
    "nombre": "Costo de vasos",
    "parentCode": "5130",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5132",
    "nombre": "Costo de hielo",
    "parentCode": "5130",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5133",
    "nombre": "Costo de insumos para eventos",
    "parentCode": "5130",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5200",
    "nombre": "Costo de ventas",
    "parentCode": "5000",
    "level": 2,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5210",
    "nombre": "Costo por presentación",
    "parentCode": "5200",
    "level": 3,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Costo",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "5211",
    "nombre": "Costo vendido Galón",
    "parentCode": "5210",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5212",
    "nombre": "Costo vendido Litro",
    "parentCode": "5210",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5213",
    "nombre": "Costo vendido Djeba 750 ml",
    "parentCode": "5210",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5214",
    "nombre": "Costo vendido Media 375 ml",
    "parentCode": "5210",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "5215",
    "nombre": "Costo vendido Pulso 250 ml",
    "parentCode": "5210",
    "level": 4,
    "tipo": "costo",
    "rootType": "COSTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Costo",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6100",
    "nombre": "Gastos de venta",
    "parentCode": "6000",
    "level": 2,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6110",
    "nombre": "Comercialización",
    "parentCode": "6100",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6111",
    "nombre": "Publicidad y redes sociales",
    "parentCode": "6110",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6112",
    "nombre": "Diseño / fotografía / contenido",
    "parentCode": "6110",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6113",
    "nombre": "Degustaciones y muestras",
    "parentCode": "6110",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6114",
    "nombre": "Comisiones por venta",
    "parentCode": "6110",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6120",
    "nombre": "Distribución y entrega",
    "parentCode": "6100",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6121",
    "nombre": "Delivery / transporte de pedidos",
    "parentCode": "6120",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6122",
    "nombre": "Combustible para entregas",
    "parentCode": "6120",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6123",
    "nombre": "Parqueo / peajes / logística",
    "parentCode": "6120",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6200",
    "nombre": "Gastos administrativos",
    "parentCode": "6000",
    "level": 2,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6210",
    "nombre": "Servicios y operación",
    "parentCode": "6200",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6211",
    "nombre": "Energía eléctrica",
    "parentCode": "6210",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6212",
    "nombre": "Agua",
    "parentCode": "6210",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6213",
    "nombre": "Internet / teléfono",
    "parentCode": "6210",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6214",
    "nombre": "Alquiler",
    "parentCode": "6210",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6220",
    "nombre": "Oficina y administración",
    "parentCode": "6200",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6221",
    "nombre": "Papelería y útiles",
    "parentCode": "6220",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6222",
    "nombre": "Software / plataformas",
    "parentCode": "6220",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6223",
    "nombre": "Honorarios profesionales",
    "parentCode": "6220",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6224",
    "nombre": "Trámites y permisos",
    "parentCode": "6220",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6300",
    "nombre": "Gastos financieros",
    "parentCode": "6000",
    "level": 2,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6310",
    "nombre": "Bancarios",
    "parentCode": "6300",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6311",
    "nombre": "Comisiones bancarias",
    "parentCode": "6310",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6312",
    "nombre": "Comisiones por tarjeta",
    "parentCode": "6310",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6313",
    "nombre": "Intereses pagados",
    "parentCode": "6310",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6400",
    "nombre": "Pérdidas y mermas",
    "parentCode": "6000",
    "level": 2,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6410",
    "nombre": "Mermas operativas",
    "parentCode": "6400",
    "level": 3,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Gasto",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "6411",
    "nombre": "Merma de producto",
    "parentCode": "6410",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6412",
    "nombre": "Producto dañado / vencido",
    "parentCode": "6410",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "6413",
    "nombre": "Diferencias de inventario",
    "parentCode": "6410",
    "level": 4,
    "tipo": "gasto",
    "rootType": "GASTOS",
    "nature": "deudora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Gasto",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7100",
    "nombre": "Ingresos no operativos",
    "parentCode": "7000",
    "level": 2,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Otro ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "7110",
    "nombre": "Ingresos varios",
    "parentCode": "7100",
    "level": 3,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Otro ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "7111",
    "nombre": "Recuperación de gastos",
    "parentCode": "7110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7112",
    "nombre": "Ajustes favorables de caja",
    "parentCode": "7110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7113",
    "nombre": "Diferencia cambiaria favorable",
    "parentCode": "7110",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7200",
    "nombre": "Ingresos extraordinarios",
    "parentCode": "7000",
    "level": 2,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Otro ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "7210",
    "nombre": "Otros ingresos eventuales",
    "parentCode": "7200",
    "level": 3,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": false,
    "accountMode": "grouping",
    "excelGroup": "Otro ingreso",
    "excelType": "Agrupadora",
    "notes": ""
  },
  {
    "code": "7211",
    "nombre": "Venta de activos / equipos",
    "parentCode": "7210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7212",
    "nombre": "Bonificaciones recibidas de proveedores",
    "parentCode": "7210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  },
  {
    "code": "7213",
    "nombre": "Otros ingresos extraordinarios",
    "parentCode": "7210",
    "level": 4,
    "tipo": "ingreso",
    "rootType": "OTROS",
    "nature": "acreedora",
    "isPostable": true,
    "accountMode": "postable",
    "excelGroup": "Otro ingreso",
    "excelType": "Posteable",
    "notes": ""
  }
]);

function finExcelSeedHasUserEdits(existing) {
  return !!(
    existing &&
    finIsUserCatalogAccount(existing) &&
    Number(existing.a33ExcelCatalogSeedVersion || 0) === FIN_ACCOUNT_EXCEL_SEED_VERSION
  );
}

function finExcelSeedIsEffectivelyPostable(existing, fallback) {
  if (!existing || !finExcelSeedHasUserEdits(existing)) return !!fallback;
  if (String(existing.accountMode || '').toLowerCase() === 'grouping') return false;
  if (existing.isGrouping === true || existing.grouping === true) return false;
  if (existing.noPostable === true) return false;
  if (existing.isPostable === false || existing.postable === false) return false;
  return true;
}

function finExcelSeedCleanInheritedFlags(row) {
  if (!row || typeof row !== 'object') return row;
  const removeKeys = [
    'accountRole', 'role', 'kind', 'currency', 'currencyCode', 'moneda',
    'isCash', 'isBank', 'financialAccount', 'bankCatalogId', 'bankCatalogName',
    'bankNameSnapshot', 'bankTypeSnapshot', 'generatedFromModule',
    'legacyReason', 'legacyNote', 'legacyFinancialAccount', 'isLegacy', 'legacy'
  ];
  for (const key of removeKeys) {
    try { delete row[key]; } catch (_) { row[key] = undefined; }
  }
  row.isLegacy = false;
  row.legacy = false;
  row.legacyFinancialAccount = false;
  row.systemProtected = false;
  row.isLocked = false;
  return row;
}

function finBuildExcelCatalogAccountRow(def, existing = null, nowISO = new Date().toISOString()) {
  const code = finGetAccountCode(def && def.code);
  const parentCode = finGetAccountCode((def && def.parentCode) || finInferParentCodeFromCode(code) || '');
  const rootCode = finGetRootFromCode(code);
  const root = FIN_FIXED_ROOTS_BY_CODE[rootCode] || null;
  const preserveUserEdit = finExcelSeedHasUserEdits(existing);
  const previousName = existing ? String(existing.nombre || existing.name || '').trim() : '';
  const name = preserveUserEdit
    ? (previousName || String(def.nombre || def.name || '').trim() || `Cuenta ${code}`)
    : (String(def.nombre || def.name || '').trim() || previousName || `Cuenta ${code}`);
  const isPostable = finExcelSeedIsEffectivelyPostable(existing, !!def.isPostable);
  const isActive = preserveUserEdit
    ? (finIsActiveAccount(existing) && existing.isHidden !== true)
    : true;
  const created = existing && (existing.createdAt || existing.createdAtISO)
    ? (existing.createdAt || existing.createdAtISO)
    : nowISO;
  const activated = existing && existing.a33CatalogActivatedAt ? existing.a33CatalogActivatedAt : nowISO;
  const legacyNames = Array.isArray(existing && existing.legacyNames) ? [...existing.legacyNames] : [];
  if (previousName && normText(previousName) !== normText(name) && !legacyNames.map(normText).includes(normText(previousName))) {
    legacyNames.push(previousName);
  }

  const row = {
    ...(existing || {}),
    id: code,
    code,
    nombre: name,
    name,
    parentId: parentCode,
    parentCode,
    rootCode,
    level: Number(def.level || finGetAccountLevelFromCode(code) || 0),
    type: root ? root.type : (def.type || def.tipo || inferTipoFromCode(code)),
    tipo: root ? root.tipo : (def.tipo || inferTipoFromCode(code)),
    rootType: root ? root.rootType : String(def.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase(),
    nature: root ? root.nature : (def.nature || finInferNatureFromRoot(rootCode)),
    isRoot: false,
    isLocked: false,
    systemProtected: false,
    isPostable,
    postable: isPostable,
    noPostable: !isPostable,
    isGrouping: !isPostable,
    grouping: !isPostable,
    accountMode: isPostable ? 'postable' : 'grouping',
    isActive,
    active: isActive,
    inactive: !isActive,
    isHidden: !isActive,
    isLegacy: false,
    legacy: false,
    legacyFinancialAccount: false,
    a33CatalogVisible: true,
    a33CatalogUserCreated: true,
    a33CatalogActivatedAt: activated,
    a33ExcelCatalogLoaded: true,
    a33ExcelCatalogSeedVersion: FIN_ACCOUNT_EXCEL_SEED_VERSION,
    a33ExcelCatalogSeedSource: FIN_ACCOUNT_EXCEL_SEED_SOURCE,
    generatedFrom: FIN_ACCOUNT_CATALOG_SOURCE,
    sourceModule: FIN_ACCOUNT_CATALOG_SOURCE,
    sourceCatalog: 'Finanzas → Catálogo de Cuentas',
    legacyNames,
    createdAt: created,
    updatedAt: existing && preserveUserEdit && existing.updatedAt ? existing.updatedAt : nowISO,
    createdAtISO: existing && existing.createdAtISO ? existing.createdAtISO : created,
    updatedAtISO: existing && preserveUserEdit && existing.updatedAtISO ? existing.updatedAtISO : nowISO,
    a33AccountCatalogVisibleMode: FIN_ACCOUNT_CATALOG_VISIBLE_MODE,
    a33AccountHierarchyStage: FIN_ACCOUNTING_REDESIGN_STAGE,
    a33AccountHierarchyVersion: FIN_ACCOUNT_HIERARCHY_VERSION
  };

  return finExcelSeedCleanInheritedFlags(row);
}

function finValidateExcelCatalogSeedRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const errors = [];
  const seen = new Set();
  const rootCodes = new Set(FIN_FIXED_ROOT_CODES);
  const available = new Set(FIN_FIXED_ROOT_CODES);

  for (const raw of list) {
    const code = finGetAccountCode(raw && raw.code);
    const parentCode = finGetAccountCode(raw && raw.parentCode);
    const level = Number(raw && raw.level);
    if (!code) { errors.push('Cuenta sin código.'); continue; }
    if (seen.has(code) || rootCodes.has(code)) errors.push(`Código duplicado o raíz en semilla: ${code}.`);
    seen.add(code);
    if (!finGetRootFromCode(code)) errors.push(`Código fuera de raíces fijas: ${code}.`);
    if (!String(raw && raw.nombre || '').trim()) errors.push(`Cuenta sin nombre: ${code}.`);
    if (!Number.isFinite(level) || level < 2 || level > FIN_ACCOUNT_MAX_LEVEL) errors.push(`Nivel inválido en ${code}.`);
    if (!parentCode) errors.push(`Cuenta sin padre: ${code}.`);
    if (parentCode && !available.has(parentCode) && !seen.has(parentCode)) errors.push(`Padre ausente para ${code}: ${parentCode}.`);
    const inferredLevel = finGetAccountLevelFromCode(code);
    if (inferredLevel && level !== inferredLevel) errors.push(`Nivel no coincide con código en ${code}.`);
    available.add(code);
  }
  return errors;
}

function finAccountComparableSnapshot(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  delete out.updatedAt;
  delete out.updatedAtISO;
  return out;
}

async function finEnsureExcelCatalogAccounts(existingByCode) {
  const errors = finValidateExcelCatalogSeedRows(FIN_ACCOUNT_EXCEL_SEED_ROWS);
  if (errors.length) {
    console.error('Catálogo Excel A33 no cargado por validación:', errors);
    return 0;
  }

  const byCode = existingByCode && typeof existingByCode.get === 'function'
    ? existingByCode
    : new Map((await finGetAll('accounts')).map(a => [finGetAccountCode(a && a.code), a]).filter(pair => pair[0]));
  const nowISO = new Date().toISOString();
  let loaded = 0;

  for (const def of FIN_ACCOUNT_EXCEL_SEED_ROWS) {
    const code = finGetAccountCode(def && def.code);
    if (!code || FIN_FIXED_ROOT_CODES.includes(code)) continue;
    const parentCode = finGetAccountCode(def && def.parentCode);
    if (!parentCode || (!FIN_FIXED_ROOT_CODES.includes(parentCode) && !byCode.has(parentCode))) {
      console.warn('Cuenta Excel omitida por padre ausente:', code, parentCode);
      continue;
    }
    const current = byCode.get(code) || null;
    const row = finBuildExcelCatalogAccountRow(def, current, nowISO);
    const same = current && JSON.stringify(finAccountComparableSnapshot(current)) === JSON.stringify(finAccountComparableSnapshot(row));
    if (!same) {
      row.updatedAt = nowISO;
      row.updatedAtISO = nowISO;
      await finPut('accounts', row);
      loaded += 1;
    }
    byCode.set(code, row);
  }

  return loaded;
}

const FIN_ACCOUNT_CATALOG_LOCK_MESSAGE = 'Esta cuenta raíz es fija y no puede editarse.';
const FIN_ACCOUNT_CATALOG_STRUCTURAL_LOCK_MESSAGE = 'Esta cuenta tiene movimientos y no puede modificarse de forma estructural.';
const FIN_ACCOUNT_CATALOG_CHILDREN_LOCK_MESSAGE = 'Esta cuenta tiene subcuentas y funciona como agrupadora.';
const FIN_ACCOUNT_CATALOG_POSTABLE_CHILD_LOCK_MESSAGE = 'Una cuenta posteable no puede tener subcuentas. Cambiala a agrupadora antes de crear niveles debajo.';
const FIN_ACCOUNT_MAX_LEVEL = 4;
const FIN_ACCOUNT_CATALOG_SOURCE = 'finanzas_catalogo_cuentas';

// Mapa de fuentes actuales: lectura/documentación interna para blindar históricos legacy.
const FIN_ACCOUNTING_DATA_SOURCES = Object.freeze({
  accounts: Object.freeze({ store: 'accounts', key: 'code', use: 'Catálogo de cuentas actual y futuras raíces jerárquicas' }),
  journalEntries: Object.freeze({ store: 'journalEntries', key: 'id', use: 'Cabeceras de movimientos/asientos manuales, automáticos y POS' }),
  journalLines: Object.freeze({ store: 'journalLines', key: 'id', use: 'Líneas DEBE/HABER vinculadas a journalEntryId' }),
  financialAccounts: Object.freeze({ store: 'financialAccounts', key: 'id', use: 'Cuentas financieras multibanco/multimoneda; no reemplaza el catálogo contable' }),
  internalTransfers: Object.freeze({ store: 'internalTransfers', key: 'transferId', use: 'Transferencias internas entre cuentas financieras' }),
  receipts: Object.freeze({ store: 'receipts', key: 'receiptId', use: 'Recibos y estados de emisión/anulación' }),
  suppliers: Object.freeze({ store: 'suppliers', key: 'id', use: 'Proveedores legacy/local de Finanzas conservados por compatibilidad' }),
  settings: Object.freeze({ store: 'settings', key: 'id', use: 'Snapshots no contables como Caja Chica física' }),
  posDailyCloseImports: Object.freeze({ store: 'posDailyCloseImports', key: 'closureId', use: 'Idempotencia de cierres diarios POS importados' })
});

// Etapa 1/5 — Tablero Finanzas Operativo: mapa técnico de fuentes.
// Esta estructura NO cambia la UI, NO migra datos y NO recalcula históricos; solo documenta
// y centraliza lecturas seguras para las siguientes etapas del Tablero operativo.
const FIN_OPERATIONAL_DASHBOARD_STAGE = 'finanzas_tablero_operativo_etapa_5_5';
const FIN_OPERATIONAL_DASHBOARD_SOURCE_MAP = Object.freeze({
  ventaTotalBruta: Object.freeze({
    actual: 'POS sales y cierres diarios POS como fallback seguro cuando no hay ventas crudas',
    futura: 'Mantener POS como fuente primaria, con Diario solo como fallback legacy si fuese necesario',
    stores: ['finanzasDB.journalEntries', 'finanzasDB.journalLines', 'a33-pos.sales', 'a33-pos.dailyClosures'],
    camposClave: ['fecha/date', 'source/origen', 'posEventId/eventScope', 'totalDebe/totalHaber', 'accountCode', 'subtotal/total']
  }),
  descuentos: Object.freeze({
    actual: 'Descuentos directos desde ventas POS',
    futura: 'Mantener lectura de descuentos POS por fecha/evento, sin doble conteo',
    stores: ['finanzasDB.journalLines', 'a33-pos.sales'],
    camposClave: ['discount', 'discountPerUnit', 'accountCode', 'accountNameSnapshot']
  }),
  cortesias: Object.freeze({
    actual: 'Cortesías directas desde ventas POS; cierres diarios solo como fallback parcial',
    futura: 'POS sales.courtesy + costo snapshot por venta/cierre diario',
    stores: ['finanzasDB.journalEntries', 'finanzasDB.journalLines', 'a33-pos.sales', 'a33-pos.dailyClosures'],
    camposClave: ['courtesy', 'cortesiaCantidad', 'cortesiaCostoTotal', 'posCosts', 'cortesia']
  }),
  ventaNeta: Object.freeze({
    actual: 'Derivada de Venta Total POS menos descuentos y cortesías',
    futura: 'Derivada de venta bruta POS menos descuentos/cortesías, con protección anti doble conteo',
    stores: ['finanzasDB.journalEntries', 'finanzasDB.journalLines', 'a33-pos.sales']
  }),
  costosVentas: Object.freeze({
    actual: 'Cost snapshots de POS sales y cierres POS como fallback',
    futura: 'Cost snapshots POS, sin recalcular inventario histórico',
    stores: ['finanzasDB.journalLines', 'a33-pos.sales', 'a33-pos.dailyClosures'],
    camposClave: ['cost', 'unitCost', 'costo', 'posCosts', 'accountCode']
  }),
  ingresosAdicionales: Object.freeze({
    actual: 'Caja Chica/Efectivo clasificado como Ingreso Adicional y recibos emitidos cuando aplique',
    futura: 'Caja Chica/Efectivo clasificado como Ingreso Adicional y recibos emitidos cuando aplique',
    stores: ['finanzasDB.journalEntries', 'finanzasDB.journalLines', 'finanzasDB.receipts', 'a33-pos.cashV2'],
    camposClave: ['source', 'tipoMovimiento', 'paymentMethod', 'receiptStatus/status', 'total', 'operationalClass']
  }),
  gastos: Object.freeze({
    actual: 'Caja Chica/Efectivo clasificado como Gasto y recibos de egreso cuando aplique',
    futura: 'Caja Chica/Efectivo clasificado como Gasto + Recibos egreso cuando aplique',
    stores: ['finanzasDB.journalEntries', 'finanzasDB.journalLines', 'finanzasDB.receipts', 'a33-pos.cashV2'],
    camposClave: ['tipoMovimiento', 'source', 'accountCode', 'receiptType/tipo', 'operationalClass']
  }),
  cajaPeriodo: Object.freeze({
    actual: 'Movimiento de caja del período desde POS + Caja/Efectivo + Recibos, respetando filtros compatibles',
    futura: 'Movimientos del período en caja, separando fondos/retiros de ingresos/gastos',
    stores: ['finanzasDB.journalLines', 'finanzasDB.financialAccounts', 'finanzasDB.settings', 'a33-pos.cashV2'],
    camposClave: ['financialAccountId', 'paymentMethod', 'medio', 'originalCurrency', 'baseAmountNio', 'operationalClass']
  }),
  bancosPeriodo: Object.freeze({
    actual: 'Movimiento bancario del período desde POS + Recibos, respetando filtros compatibles',
    futura: 'Movimientos del período por banco/moneda, sin inflar bancos ni duplicar transferencias internas',
    stores: ['finanzasDB.journalLines', 'finanzasDB.financialAccounts', 'a33-pos.banks'],
    camposClave: ['bankId', 'financialAccountId', 'paymentMethod', 'originalCurrency', 'exchangeRateUsed', 'operationalClass']
  }),
  eventos: Object.freeze({
    actual: 'Filtros GLOBAL / Por evento usando IDs POS, snapshots y etiquetas compatibles',
    futura: 'Vista GLOBAL / Por evento con IDs POS preservados y nombre snapshot',
    stores: ['finanzasDB.journalEntries', 'a33-pos.events'],
    camposClave: ['eventScope', 'posEventId', 'posEventNameSnapshot', 'evento']
  }),
  tipoCambio: Object.freeze({
    actual: 'Configuración → Moneda, key suite_a33_currency_settings_v1; snapshots ya guardados se respetan',
    futura: 'Banda superior informativa del Tablero, sin recalcular históricos',
    stores: ['localStorage.suite_a33_currency_settings_v1'],
    camposClave: ['exchangeRate', 'updatedAt']
  })
});
const FIN_POS_OPERATIONAL_STORES = Object.freeze(['sales', 'events', 'banks', 'dailyClosures', 'cashV2']);

function finOperationalArray(value) {
  return Array.isArray(value) ? value : [];
}

function finBuildOperationalDashboardSourceSnapshot(data) {
  const safe = data || {};
  const entries = finOperationalArray(safe.entries);
  const lines = finOperationalArray(safe.lines);
  const receipts = finOperationalArray(safe.receipts);
  const financialAccounts = finOperationalArray(safe.financialAccounts);
  const internalTransfers = finOperationalArray(safe.internalTransfers);
  let currency = null;
  try { currency = finGetCurrencyStateSafe(); } catch (_) { currency = null; }

  return Object.freeze({
    stage: FIN_OPERATIONAL_DASHBOARD_STAGE,
    builtAtISO: new Date().toISOString(),
    visibleUiChanged: false,
    migratedData: false,
    recalculatedHistory: false,
    sources: FIN_OPERATIONAL_DASHBOARD_SOURCE_MAP,
    counts: Object.freeze({
      entries: entries.length,
      lines: lines.length,
      receipts: receipts.length,
      financialAccounts: financialAccounts.length,
      internalTransfers: internalTransfers.length,
      posCashV2: finOperationalArray(safe.posCashV2).length
    }),
    currentCurrency: currency ? Object.freeze({
      source: currency.source || FIN_CURRENCY_SOURCE_LABEL,
      exchangeRate: currency.exchangeRate || null,
      exchangeRateText: currency.exchangeRateText || 'T/C no configurado',
      updatedAtText: currency.updatedAtText || 'Sin registros',
      hasExchangeRate: !!currency.hasExchangeRate
    }) : Object.freeze({
      source: FIN_CURRENCY_SOURCE_LABEL,
      exchangeRate: null,
      exchangeRateText: 'T/C no configurado',
      updatedAtText: 'Sin registros',
      hasExchangeRate: false
    })
  });
}

async function finReadPosOperationalSourcesSafe() {
  const out = {
    ok: true,
    dbName: POS_DB_NAME,
    stores: FIN_POS_OPERATIONAL_STORES.slice(),
    sales: [],
    events: [],
    banks: [],
    dailyClosures: [],
    cashV2: [],
    warnings: [],
    readAtISO: new Date().toISOString()
  };
  try { out.sales = await getAllPosSales(); }
  catch (err) { out.warnings.push('No se pudo leer POS.sales'); out.ok = false; }
  try { out.events = await getAllPosEventsSafe(); }
  catch (err) { out.warnings.push('No se pudo leer POS.events'); out.ok = false; }
  try { out.banks = await getAllPosBanksSafe(); }
  catch (err) { out.warnings.push('No se pudo leer POS.banks'); out.ok = false; }
  try { out.dailyClosures = await getAllPosDailyClosuresSafe(); }
  catch (err) { out.warnings.push('No se pudo leer POS.dailyClosures'); out.ok = false; }
  try { out.cashV2 = await getAllPosCashV2Safe(); }
  catch (err) { out.warnings.push('No se pudo leer POS.cashV2'); out.ok = false; }
  return out;
}

const FIN_OPERATIONAL_CLASS_STAGE = 'finanzas_tablero_operativo_etapa_5_5';
const FIN_OPERATIONAL_CLASSES = Object.freeze({
  ADDITIONAL_INCOME: 'ADDITIONAL_INCOME',
  EXPENSE: 'EXPENSE',
  CASH_IN: 'CASH_IN',
  CASH_OUT: 'CASH_OUT',
  UNCLASSIFIED: 'UNCLASSIFIED'
});
const FIN_OPERATIONAL_CLASS_LABELS = Object.freeze({
  ADDITIONAL_INCOME: 'Ingreso Adicional',
  EXPENSE: 'Gasto',
  CASH_IN: 'Entrada de efectivo / fondo',
  CASH_OUT: 'Salida de efectivo / retiro',
  UNCLASSIFIED: 'No clasificado'
});

function finNormalizeOperationalClass(value, fallback = FIN_OPERATIONAL_CLASSES.UNCLASSIFIED) {
  const raw = String(value || '').trim().toUpperCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-]+/g, '_');
  if (!raw) return fallback;
  if (raw === 'ADDITIONAL_INCOME' || raw === 'INGRESO_ADICIONAL' || raw === 'INGRESOS_ADICIONALES' || raw === 'OTHER_INCOME') return FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (raw === 'EXPENSE' || raw === 'GASTO' || raw === 'EGRESO_OPERATIVO') return FIN_OPERATIONAL_CLASSES.EXPENSE;
  if (raw === 'CASH_IN' || raw === 'ENTRADA_FONDO' || raw === 'ENTRADA_DE_EFECTIVO_FONDO' || raw === 'ENTRADA_EFECTIVO_FONDO' || raw === 'FONDO' || raw === 'ENTRADA') return FIN_OPERATIONAL_CLASSES.CASH_IN;
  if (raw === 'CASH_OUT' || raw === 'SALIDA_RETIRO' || raw === 'SALIDA_DE_EFECTIVO_RETIRO' || raw === 'SALIDA_EFECTIVO_RETIRO' || raw === 'RETIRO' || raw === 'SALIDA') return FIN_OPERATIONAL_CLASSES.CASH_OUT;
  if (raw === 'UNCLASSIFIED' || raw === 'NO_CLASIFICADO' || raw === 'SIN_CLASIFICAR') return FIN_OPERATIONAL_CLASSES.UNCLASSIFIED;
  return fallback;
}

function finOperationalClassLabel(value) {
  const cls = finNormalizeOperationalClass(value);
  return FIN_OPERATIONAL_CLASS_LABELS[cls] || FIN_OPERATIONAL_CLASS_LABELS.UNCLASSIFIED;
}

function finOperationalClassAffectsUtility(value) {
  const cls = finNormalizeOperationalClass(value);
  return cls === FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME || cls === FIN_OPERATIONAL_CLASSES.EXPENSE;
}

function finOperationalClassIsIncome(value) {
  return finNormalizeOperationalClass(value) === FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
}

function finOperationalClassIsExpense(value) {
  return finNormalizeOperationalClass(value) === FIN_OPERATIONAL_CLASSES.EXPENSE;
}

function finOperationalClassIsCashIn(value) {
  const cls = finNormalizeOperationalClass(value);
  return cls === FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME || cls === FIN_OPERATIONAL_CLASSES.CASH_IN;
}

function finOperationalClassIsCashOut(value) {
  const cls = finNormalizeOperationalClass(value);
  return cls === FIN_OPERATIONAL_CLASSES.EXPENSE || cls === FIN_OPERATIONAL_CLASSES.CASH_OUT;
}

function finInferOperationalClassFromMovementType(tipo, fallback = FIN_OPERATIONAL_CLASSES.UNCLASSIFIED) {
  const t = String(tipo || '').trim().toLowerCase();
  if (t === 'ingreso') return FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (t === 'egreso' || t === 'gasto') return FIN_OPERATIONAL_CLASSES.EXPENSE;
  if (t === 'entrada' || t === 'fondo') return FIN_OPERATIONAL_CLASSES.CASH_IN;
  if (t === 'salida' || t === 'retiro') return FIN_OPERATIONAL_CLASSES.CASH_OUT;
  return fallback;
}

function finInferReceiptOperationalClass(receipt) {
  const explicit = receipt && (receipt.operationalClass || receipt.clasificacionOperativa || receipt.tipoOperativo || receipt.receiptOperationalClass);
  if (explicit) return finNormalizeOperationalClass(explicit, FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);
  const st = String(receipt && (receipt.status || receipt.estado || '') || '').trim().toUpperCase();
  if (st === 'VOID' || st === 'ANULADO') return FIN_OPERATIONAL_CLASSES.UNCLASSIFIED;
  // Recibos existentes representan cobros/ingresos. Lectura defensiva, sin migración masiva.
  return FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
}

function finInferManualMovementOperationalClass(entry) {
  const explicit = entry && (entry.operationalClass || entry.clasificacionOperativa || entry.tipoOperativo || entry.cashOperationalClass);
  if (explicit) return finNormalizeOperationalClass(explicit, FIN_OPERATIONAL_CLASSES.UNCLASSIFIED);
  return finInferOperationalClassFromMovementType(entry && entry.tipoMovimiento, FIN_OPERATIONAL_CLASSES.UNCLASSIFIED);
}

function finOperationalPaymentChannel(value, fallback = '') {
  const raw = String(value || fallback || '').trim().toLowerCase();
  if (raw.includes('bank') || raw.includes('banco') || raw.includes('transfer')) return 'bank';
  if (raw.includes('cash') || raw.includes('caja') || raw.includes('efectivo')) return 'cash';
  return raw || fallback || '';
}

function finOperationalBaseAmountFromRecord(record) {
  const candidates = [
    record && record.baseAmountNio,
    record && record.equivalenteNIO,
    record && record.equivalenteCordobas,
    record && record.totalNio,
    record && record.totalDebe,
    record && record.totalHaber,
    record && record.total,
    record && record.amount,
    record && record.monto
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return finRoundCurrency2(Math.abs(n));
  }
  return 0;
}

function finGetOperationalReceiptsSource(data) {
  return finOperationalArray(data && data.receipts).filter(r => r && typeof r === 'object').map(r => {
    const operationalClass = finInferReceiptOperationalClass(r);
    const currency = finNormalizeCurrencyCode(r.originalCurrency || r.monedaOriginal || r.currency || r.moneda || 'NIO');
    const originalAmount = finRoundCurrency2(r.totalOriginal || r.originalAmount || r.montoOriginal || (r.totals && r.totals.total) || r.total || r.monto || r.amount || 0);
    const amountNio = finRoundCurrency2(r.baseAmountNio || r.equivalenteNIO || r.equivalenteCordobas || (currency === 'NIO' ? originalAmount : 0));
    const paymentMethod = finOperationalPaymentChannel(r.paymentType || r.paymentMethod || r.medio || r.metodoPago, 'cash');
    return {
      source: 'receipts',
      stage: FIN_OPERATIONAL_CLASS_STAGE,
      receiptId: String(r.receiptId || r.id || ''),
      status: String(r.status || r.estado || ''),
      dateISO: String(r.dateISO || r.fecha || r.date || '').slice(0, 10),
      currency,
      originalAmount,
      amountNio,
      amount: amountNio || originalAmount,
      eventScope: String(r.eventScope || r.evento || ''),
      posEventId: r.posEventId || null,
      paymentMethod,
      channel: paymentMethod,
      operationalClass,
      operationalClassLabel: finOperationalClassLabel(operationalClass),
      affectsUtility: finOperationalClassAffectsUtility(operationalClass),
      affectsCash: paymentMethod === 'cash',
      affectsBank: paymentMethod === 'bank',
      countsAsAdditionalIncome: finOperationalClassIsIncome(operationalClass),
      countsAsExpense: finOperationalClassIsExpense(operationalClass),
      countsAsCashIn: finOperationalClassIsCashIn(operationalClass),
      countsAsCashOut: finOperationalClassIsCashOut(operationalClass),
      reference: String(r.paymentRef || r.referenciaPago || r.reference || '').trim(),
      note: String(r.clientName || r.descripcion || '').trim()
    };
  });
}

function finGetOperationalManualMovementsSource(data) {
  return finOperationalArray(data && data.entries).filter(e => {
    const source = String(e && (e.source || e.origen || '') || '').trim();
    const hasLegacyType = !!String(e && e.tipoMovimiento || '').trim();
    // Defensivo: solo movimientos manuales/legacy sin fuente explícita.
    // Evita duplicar POS, compras, recibos o transferencias ya tratadas por su fuente propia.
    return source === 'manual_financial_account' || source === 'Interno' || (!source && hasLegacyType);
  }).map(e => {
    const operationalClass = finInferManualMovementOperationalClass(e);
    const paymentMethod = finOperationalPaymentChannel(e.paymentMethod || e.medio || e.financialAccountType || '', '');
    const amountNio = finOperationalBaseAmountFromRecord(e);
    return {
      source: String(e.source || e.origen || 'manual'),
      stage: FIN_OPERATIONAL_CLASS_STAGE,
      id: e.id || null,
      fecha: String(e.fecha || e.date || '').slice(0, 10),
      dateISO: String(e.fecha || e.date || '').slice(0, 10),
      tipoMovimiento: String(e.tipoMovimiento || ''),
      paymentMethod,
      channel: paymentMethod,
      eventScope: String(e.eventScope || ''),
      posEventId: e.posEventId || null,
      totalDebe: finRoundCurrency2(e.totalDebe || 0),
      totalHaber: finRoundCurrency2(e.totalHaber || 0),
      originalCurrency: finNormalizeCurrencyCode(e.originalCurrency || e.moneda || 'NIO'),
      originalAmount: finRoundCurrency2(e.originalAmount || e.montoOriginal || amountNio || 0),
      amountNio,
      amount: amountNio,
      exchangeRateUsed: e.exchangeRateUsed || null,
      operationalClass,
      operationalClassLabel: finOperationalClassLabel(operationalClass),
      affectsUtility: finOperationalClassAffectsUtility(operationalClass),
      affectsCash: paymentMethod === 'cash',
      affectsBank: paymentMethod === 'bank',
      countsAsAdditionalIncome: finOperationalClassIsIncome(operationalClass),
      countsAsExpense: finOperationalClassIsExpense(operationalClass),
      countsAsCashIn: finOperationalClassIsCashIn(operationalClass),
      countsAsCashOut: finOperationalClassIsCashOut(operationalClass),
      reference: String(e.reference || e.referencia || '').trim(),
      note: String(e.descripcion || '').trim()
    };
  });
}

function finInferPosCashV2OperationalClass(movement) {
  const explicit = movement && (movement.operationalClass || movement.clasificacionOperativa || movement.tipoOperativo);
  if (explicit) return finNormalizeOperationalClass(explicit, FIN_OPERATIONAL_CLASSES.UNCLASSIFIED);
  const kind = String(movement && movement.kind || '').trim().toUpperCase();
  if (kind === 'IN') return FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
  if (kind === 'OUT') return FIN_OPERATIONAL_CLASSES.EXPENSE;
  return FIN_OPERATIONAL_CLASSES.UNCLASSIFIED;
}

function finGetOperationalPosCashMovementsSource(posCashRows) {
  const rows = finOperationalArray(posCashRows);
  const out = [];
  for (const rec of rows) {
    const eventId = rec && (rec.eventId || rec.posEventId);
    const dayKey = String(rec && (rec.dayKey || rec.dateKey || rec.fecha || '') || '').slice(0, 10);
    const movements = finOperationalArray(rec && rec.movements);
    for (const m of movements) {
      if (!m || typeof m !== 'object') continue;
      const currency = finNormalizeCurrencyCode(m.currency || 'NIO');
      const amount = finRoundCurrency2(Math.abs(Number(m.amount || 0)));
      const fx = Number(m.exchangeRateUsed || m.fxUsed || rec.fx || rec.exchangeRateUsed || 0);
      const amountNio = currency === 'USD'
        ? (Number.isFinite(fx) && fx > 0 ? finRoundCurrency2(amount * fx) : 0)
        : amount;
      const operationalClass = finInferPosCashV2OperationalClass(m);
      out.push({
        source: 'pos_cashV2',
        stage: FIN_OPERATIONAL_CLASS_STAGE,
        id: String(m.id || ''),
        eventScope: 'POS',
        posEventId: eventId || null,
        dateISO: dayKey,
        fecha: dayKey,
        currency,
        originalCurrency: currency,
        originalAmount: amount,
        amount,
        amountNio,
        exchangeRateUsed: Number.isFinite(fx) && fx > 0 ? finRoundCurrency2(fx) : null,
        paymentMethod: 'cash',
        channel: 'cash',
        operationalClass,
        operationalClassLabel: finOperationalClassLabel(operationalClass),
        affectsUtility: finOperationalClassAffectsUtility(operationalClass),
        affectsCash: true,
        affectsBank: false,
        countsAsAdditionalIncome: finOperationalClassIsIncome(operationalClass),
        countsAsExpense: finOperationalClassIsExpense(operationalClass),
        countsAsCashIn: finOperationalClassIsCashIn(operationalClass),
        countsAsCashOut: finOperationalClassIsCashOut(operationalClass),
        reference: String(rec && (rec.key || '') || '').trim(),
        note: String(m.desc || m.note || '').trim()
      });
    }
  }
  return out;
}

function finApplyOperationalFilters(row, filters = {}) {
  if (!row) return false;
  const date = String(row.dateISO || row.fecha || '').slice(0, 10);
  const year = Number(filters.year || filters.anio || 0);
  const month = Number(filters.month || filters.mes || 0);
  if (year && (!date || Number(date.slice(0, 4)) !== year)) return false;
  if (month && (!date || Number(date.slice(5, 7)) !== month)) return false;
  const eventFilter = String(filters.evento || filters.event || filters.posEventId || '').trim();
  const eventUpper = eventFilter.toUpperCase();
  if (eventFilter && eventUpper !== 'GLOBAL' && eventUpper !== 'ALL') {
    if (eventUpper === 'NONE') {
      if (String(row.posEventId || '').trim() || String(row.eventScope || '').trim()) return false;
    } else if (eventFilter.startsWith('POS:')) {
      const id = eventFilter.slice(4);
      if (String(row.posEventId || '') !== id) return false;
    } else if (String(row.eventScope || '').toUpperCase() !== eventUpper) {
      return false;
    }
  }
  return true;
}


function finOperationalRowDedupeKey(row) {
  if (!row || typeof row !== 'object') return '';
  const src = String(row.source || '').trim().toLowerCase();
  const directId = row.receiptId || row.transferId || row.id || row.journalEntryId || '';
  if (directId) return `${src || 'src'}:${String(directId).trim()}`;
  return [
    src || 'manual',
    String(row.dateISO || row.fecha || '').slice(0, 10),
    String(row.posEventId || row.eventScope || '').trim(),
    finNormalizeOperationalClass(row.operationalClass),
    String(row.paymentMethod || row.channel || '').trim().toLowerCase(),
    String(row.reference || '').trim().toLowerCase(),
    String(row.note || '').trim().toLowerCase(),
    String(finRoundCurrency2(row.amountNio || row.amount || row.originalAmount || 0) || 0)
  ].join('|');
}

function finOperationalDedupeRows(rows) {
  const seen = new Set();
  const out = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const key = finOperationalRowDedupeKey(row);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(row);
  }
  return out;
}

function finBuildOperationalManualTotals(data, filters = {}) {
  const manual = finGetOperationalManualMovementsSource(data);
  const receipts = finGetOperationalReceiptsSource(data).filter(r => {
    const st = String(r.status || '').toUpperCase();
    return !st || st === 'ISSUED' || st === 'EMITIDO' || st === 'EMITIDA';
  });
  const posCash = finGetOperationalPosCashMovementsSource(data && data.posCashV2);
  const rawRows = manual.concat(receipts, posCash).filter(row => finApplyOperationalFilters(row, filters));
  const rows = finOperationalDedupeRows(rawRows);
  const totals = {
    stage: FIN_OPERATIONAL_CLASS_STAGE,
    ingresosAdicionales: 0,
    gastos: 0,
    entradasRealesDinero: 0,
    salidasRealesDinero: 0,
    movimientoCajaPeriodo: 0,
    movimientoBancosPeriodo: 0,
    sinClasificar: 0,
    count: rows.length,
    dedupedCount: Math.max(0, rawRows.length - rows.length),
    sourceCounts: {
      manual: manual.length,
      receipts: receipts.length,
      posCash: posCash.length,
      filtered: rawRows.length,
      used: rows.length
    },
    rows
  };
  for (const row of rows) {
    const rawAmount = finRoundCurrency2(row.amountNio || row.amount || row.originalAmount || 0);
    const amount = Math.abs(rawAmount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const cls = finNormalizeOperationalClass(row.operationalClass);
    const isIncome = cls === FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME;
    const isExpense = cls === FIN_OPERATIONAL_CLASSES.EXPENSE;
    const isCashIn = cls === FIN_OPERATIONAL_CLASSES.CASH_IN;
    const isCashOut = cls === FIN_OPERATIONAL_CLASSES.CASH_OUT;

    if (isIncome) totals.ingresosAdicionales = finRoundCurrency2(totals.ingresosAdicionales + amount);
    else if (isExpense) totals.gastos = finRoundCurrency2(totals.gastos + amount);
    else if (cls === FIN_OPERATIONAL_CLASSES.UNCLASSIFIED) totals.sinClasificar = finRoundCurrency2(totals.sinClasificar + amount);

    if (isIncome || isCashIn) totals.entradasRealesDinero = finRoundCurrency2(totals.entradasRealesDinero + amount);
    if (isExpense || isCashOut) totals.salidasRealesDinero = finRoundCurrency2(totals.salidasRealesDinero + amount);

    const delta = (isIncome || isCashIn) ? amount : ((isExpense || isCashOut) ? -amount : 0);
    if (row.affectsCash) totals.movimientoCajaPeriodo = finRoundCurrency2(totals.movimientoCajaPeriodo + delta);
    if (row.affectsBank) totals.movimientoBancosPeriodo = finRoundCurrency2(totals.movimientoBancosPeriodo + delta);
  }
  return totals;
}

async function finReadCajaChicaSnapshotSafe() {
  let fromDB = null;
  let fromLocal = null;
  try {
    const rec = await finGet('settings', CC_STORAGE_KEY);
    fromDB = rec && rec.data ? rec.data : null;
  } catch (_) { fromDB = null; }
  try {
    const raw = localStorage.getItem(CC_STORAGE_KEY);
    fromLocal = raw ? JSON.parse(raw) : null;
  } catch (_) { fromLocal = null; }
  const selected = fromDB || fromLocal || null;
  return {
    ok: true,
    source: fromDB ? 'finanzasDB.settings' : (fromLocal ? 'localStorage' : 'empty'),
    storageKey: CC_STORAGE_KEY,
    snapshot: selected,
    readAtISO: new Date().toISOString()
  };
}

function finNormalizeAccountCode(code) {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  const n = safeParseCodeNum(raw);
  if (Number.isFinite(n) && String(n) === raw.replace(/^0+/, '') && raw.length <= 4) {
    return String(n).padStart(4, '0');
  }
  return raw;
}


function finGetFixedAccountRoots() {
  return FIN_FIXED_ROOT_ACCOUNTS.map(root => ({ ...root }));
}

function finGetAccountCode(accountOrCode) {
  if (accountOrCode && typeof accountOrCode === 'object') {
    return finNormalizeAccountCode(accountOrCode.code ?? accountOrCode.accountCode ?? accountOrCode.codigo ?? accountOrCode.id ?? '');
  }
  return finNormalizeAccountCode(accountOrCode);
}

function finGetAccountName(account) {
  if (!account || typeof account !== 'object') return '';
  return String(account.nombre || account.name || account.label || account.title || finGetAccountCode(account) || '').trim();
}

function getAccountCode(accountOrCode) { return finGetAccountCode(accountOrCode); }
function getAccountName(account) { return finGetAccountName(account); }

function finGetRootFromCode(code) {
  const n = safeParseCodeNum(code);
  if (!Number.isFinite(n) || n < 1000) return '';
  const root = Math.floor(n / 1000) * 1000;
  const rootCode = String(root).padStart(4, '0');
  return FIN_FIXED_ROOT_CODES.includes(rootCode) ? rootCode : '';
}

function getRootFromCode(code) { return finGetRootFromCode(code); }

function finGetAccountLevelFromCode(code) {
  const c = finGetAccountCode(code);
  const n = safeParseCodeNum(c);
  if (!Number.isFinite(n) || c.length !== 4) return 0;
  if (FIN_FIXED_ROOT_CODES.includes(c)) return 1;
  if (!finGetRootFromCode(c)) return 0;
  if (n % 100 === 0) return 2;
  if (n % 10 === 0) return 3;
  return 4;
}

function getAccountLevelFromCode(code) { return finGetAccountLevelFromCode(code); }

function finInferParentCodeFromCode(code) {
  const c = finGetAccountCode(code);
  const n = safeParseCodeNum(c);
  if (!Number.isFinite(n) || c.length !== 4) return null;
  const rootCode = finGetRootFromCode(c);
  if (!rootCode || FIN_FIXED_ROOT_CODES.includes(c)) return null;
  const level = finGetAccountLevelFromCode(c);
  if (level === 2) return rootCode;
  if (level === 3) return String(Math.floor(n / 100) * 100).padStart(4, '0');
  if (level === 4) return String(Math.floor(n / 10) * 10).padStart(4, '0');
  return null;
}

function finInferNatureFromRoot(rootCode) {
  const root = FIN_FIXED_ROOTS_BY_CODE[finGetAccountCode(rootCode)];
  return root ? root.nature : '';
}

function inferNatureFromRoot(rootCode) { return finInferNatureFromRoot(rootCode); }

function finGetAccountNature(accountOrRootCode) {
  if (accountOrRootCode && typeof accountOrRootCode === 'object') {
    const explicit = accountOrRootCode.nature || accountOrRootCode.naturaleza || accountOrRootCode.accountNature;
    if (explicit) return String(explicit).trim().toLowerCase();
    return finInferNatureFromRoot(accountOrRootCode.rootCode || finGetRootFromCode(finGetAccountCode(accountOrRootCode)));
  }
  return finInferNatureFromRoot(finGetRootFromCode(accountOrRootCode) || accountOrRootCode);
}

function getAccountNature(accountOrRootCode) { return finGetAccountNature(accountOrRootCode); }

function finGetAccountType(account) {
  if (!account || typeof account !== 'object') return inferTipoFromCode(account);
  const explicit = account.type || account.tipo || account.rootType || account.accountType;
  if (explicit) return String(explicit).trim();
  const root = FIN_FIXED_ROOTS_BY_CODE[finGetRootFromCode(finGetAccountCode(account))];
  return root ? root.type : inferTipoFromCode(finGetAccountCode(account));
}

function getAccountType(account) { return finGetAccountType(account); }

function finIsRootAccount(accountOrCode) {
  const code = finGetAccountCode(accountOrCode);
  if (accountOrCode && typeof accountOrCode === 'object' && accountOrCode.isRoot === true) return true;
  return FIN_FIXED_ROOT_CODES.includes(code);
}

function isRootAccount(accountOrCode) { return finIsRootAccount(accountOrCode); }

function finIsLegacyAccount(accountOrCode) {
  if (accountOrCode && typeof accountOrCode === 'object') {
    // Una cuenta creada/gestionada desde el nuevo Catálogo puede usar códigos históricos
    // (por ejemplo 1100/1200) sin heredar el candado legacy. Los históricos se conservan
    // por código y snapshots; la administración del árbol debe responder a la marca de catálogo.
    if (finIsUserCatalogAccount(accountOrCode)) return false;
    if (accountOrCode.isLegacy === true || accountOrCode.legacyFinancialAccount === true || accountOrCode.legacy === true) return true;
    const origin = String(accountOrCode.generatedFrom || accountOrCode.source || accountOrCode.sourceModule || '').toLowerCase();
    if (origin.includes('legacy')) return true;
  }
  return finIsLegacyAccountCode(finGetAccountCode(accountOrCode));
}

function isLegacyAccount(accountOrCode) { return finIsLegacyAccount(accountOrCode); }

function finIsActiveAccount(account) {
  if (!account || typeof account !== 'object') return true;
  if (account.isActive === false || account.active === false || account.activa === false || account.inactive === true || account.isHidden === true) return false;
  return true;
}

function finIsGroupingAccount(account) {
  if (!account || typeof account !== 'object') return false;
  if (finIsRootAccount(account)) return true;
  if (account.hasChildren === true || account.childrenCount > 0) return true;
  if (account.isGrouping === true || account.grouping === true || account.esAgrupadora === true || account.agrupadora === true) return true;
  if (String(account.accountMode || account.mode || '').toLowerCase() === 'grouping') return true;
  return false;
}

function finIsPostableAccount(account) {
  // El Diario Contable futuro usará solo cuentas posteables; aquí se respeta la bandera sin romper históricos.
  if (!account || typeof account !== 'object') return false;
  if (!finIsActiveAccount(account)) return false;
  if (finIsRootAccount(account)) return false;
  if (finIsGroupingAccount(account)) return false;
  if (account.isPostable === false || account.postable === false || account.noPostable === true) return false;
  return true;
}

function isPostableAccount(account) { return finIsPostableAccount(account); }


function finGetAccountChildrenIndex(accounts) {
  const rows = Array.isArray(accounts) ? accounts : [];
  const byParent = new Map();
  for (const raw of rows) {
    const acc = finNormalizeAccountForView(raw);
    if (!acc || !acc.code) continue;
    const parent = finGetAccountCode(acc.parentId || acc.parentCode || finInferParentCodeFromCode(acc.code) || '');
    if (!parent) continue;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(acc);
  }
  return byParent;
}

function finAccountHasChildrenInList(accounts, code) {
  const c = finGetAccountCode(code);
  if (!c) return false;
  const byParent = finGetAccountChildrenIndex(accounts);
  const children = byParent.get(c) || [];
  return children.length > 0;
}

function finAccountHasActiveChildrenInList(accounts, code) {
  const c = finGetAccountCode(code);
  if (!c) return false;
  const byParent = finGetAccountChildrenIndex(accounts);
  const children = byParent.get(c) || [];
  return children.some(child => finIsActiveAccount(child) && child.isHidden !== true);
}

function finNormalizeAccountSearchText(value) {
  return normText(String(value || '').replace(/\s+/g, ' ').trim());
}

function finBuildSelectorDataFromAccounts(accountsOrData) {
  if (accountsOrData && Array.isArray(accountsOrData.accounts)) return accountsOrData;
  const rows = Array.isArray(accountsOrData) ? accountsOrData : [];
  return {
    accounts: rows,
    accountsMap: new Map(rows.map(acc => [finGetAccountCode(acc), acc]).filter(pair => pair[0]))
  };
}

function finGetAccountPathLabel(account, accountsOrData) {
  const data = finBuildSelectorDataFromAccounts(accountsOrData || finCachedData || {});
  const rows = Array.isArray(data.accounts) ? data.accounts : [];
  const map = data.accountsMap && typeof data.accountsMap.get === 'function'
    ? data.accountsMap
    : new Map(rows.map(acc => [finGetAccountCode(acc), acc]).filter(pair => pair[0]));
  const parts = [];
  let cursor = finNormalizeAccountForView(account);
  let guard = 0;
  while (cursor && guard < 8) {
    const label = `${cursor.code} ${cursor.nombre || cursor.name || ''}`.trim();
    if (label) parts.unshift(label);
    const parentCode = finGetAccountCode(cursor.parentId || cursor.parentCode || finInferParentCodeFromCode(cursor.code) || '');
    if (!parentCode) break;
    const parent = map.get(parentCode) || FIN_FIXED_ROOTS_BY_CODE[parentCode] || null;
    cursor = parent ? finNormalizeAccountForView(parent) : null;
    guard += 1;
  }
  return parts.join(' › ');
}

function finAccountSelectorMetaText(account, data) {
  const row = finNormalizeAccountForView(account);
  if (!row) return '';
  const type = String(row.type || row.tipo || '').trim();
  const nature = String(row.nature || row.naturaleza || '').trim();
  const currency = finGetFinancialAccountCurrencyCode(row);
  const currencyTxt = currency && currency !== FIN_BASE_CURRENCY_CODE ? ` · ${currency}` : (row.currency || row.currencyCode || row.moneda ? ` · ${currency}` : '');
  const path = finGetAccountPathLabel(row, data);
  const parentText = path && path !== `${row.code} ${row.nombre || row.name || ''}`.trim() ? ` · ${path}` : '';
  return `${type || 'Cuenta'}${nature ? ` · ${nature}` : ''} · Posteable · Activa${currencyTxt}${parentText}`;
}

function getPostableAccountsForSelector(accountsOrData) {
  const data = finBuildSelectorDataFromAccounts(accountsOrData || finCachedData || {});
  const rawRows = Array.isArray(data.accounts) ? data.accounts : [];
  const visibleRows = finGetVisibleCatalogAccounts(data);
  const sourceRows = visibleRows.length ? visibleRows : rawRows;
  const rowsForChildren = rawRows.length ? rawRows : sourceRows;

  return sourceRows
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean)
    .map(acc => {
      let state = null;
      try { state = catBuildAccountRuleState(data, acc); } catch (_) { state = null; }
      const hasChildren = state ? !!state.hasChildren : finAccountHasChildrenInList(rowsForChildren, acc.code);
      const hasActiveChildren = state ? Number(state.activeChildrenCount || 0) > 0 : finAccountHasActiveChildrenInList(rowsForChildren, acc.code);
      const active = state ? !!state.isActive : (finIsActiveAccount(acc) && acc.isHidden !== true);
      const lockedForPosting = !!(acc.lockedForPosting || acc.noPosting || acc.blockPosting || acc.postingLocked);
      const legacy = state ? !!state.isLegacy : finIsLegacyAccount(acc);
      const grouping = state ? !!state.isGrouping : finIsGroupingAccount({ ...acc, hasChildren });
      const postable = state ? !!state.effectivePostable : finIsPostableAccount({ ...acc, hasChildren });
      return { ...acc, hasChildren, hasActiveChildren, isActive: active, lockedForPosting, isLegacy: legacy, isGrouping: grouping, effectivePostable: postable };
    })
    .filter(acc => {
      if (!acc || !acc.code) return false;
      if (!acc.isActive || acc.isHidden === true) return false;
      if (finIsRootAccount(acc) || FIN_FIXED_ROOT_CODES.includes(finGetAccountCode(acc))) return false;
      if (acc.isLegacy || finIsLegacyAccount(acc)) return false;
      if (acc.lockedForPosting === true || acc.noPosting === true || acc.blockPosting === true || acc.postingLocked === true) return false;
      if (acc.hasChildren || acc.hasActiveChildren) return false;
      if (acc.isGrouping || acc.grouping === true || String(acc.accountMode || '').toLowerCase() === 'grouping') return false;
      if (acc.isPostable === false || acc.postable === false || acc.noPostable === true) return false;
      return acc.effectivePostable === true || finIsPostableAccount({ ...acc, hasChildren: false, isGrouping: false });
    })
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || ''), 'es', { numeric: true }));
}

function getSelectablePostingAccounts(accountsOrData) { return getPostableAccountsForSelector(accountsOrData); }
function filterChartAccountsForPicker(accountsOrData, query = '') {
  const q = finNormalizeAccountSearchText(query);
  const rows = getPostableAccountsForSelector(accountsOrData);
  if (!q) return rows;
  const data = finBuildSelectorDataFromAccounts(accountsOrData || finCachedData || {});
  return rows.filter(acc => {
    const haystack = finNormalizeAccountSearchText([
      acc.code,
      acc.nombre,
      acc.name,
      finGetAccountType(acc),
      finGetAccountNature(acc),
      finGetAccountPathLabel(acc, data),
      acc.currency,
      acc.currencyCode,
      acc.moneda
    ].filter(Boolean).join(' '));
    return haystack.includes(q);
  });
}

function finNormalizeAccountForView(account) {
  if (!account || typeof account !== 'object') return null;
  const code = finGetAccountCode(account);
  const rootCode = finGetRootFromCode(code) || finGetAccountCode(account.rootCode || '');
  const level = finGetAccountLevelFromCode(code);
  const root = FIN_FIXED_ROOTS_BY_CODE[rootCode] || null;
  const parentId = account.parentId !== undefined ? account.parentId : (account.parentCode || finInferParentCodeFromCode(code));
  const isRoot = finIsRootAccount(account);
  const isUserCatalog = finIsUserCatalogAccount({ ...account, code, isRoot });
  const isLegacy = isUserCatalog ? false : finIsLegacyAccount(account);
  const isActive = finIsActiveAccount(account);
  const isPostable = finIsPostableAccount({ ...account, code, isRoot, isActive });
  const nowISO = new Date().toISOString();

  return {
    ...account,
    id: account.id || code,
    code,
    name: finGetAccountName(account) || (root && root.name) || `Cuenta ${code}`,
    nombre: finGetAccountName(account) || (root && root.nombre) || `Cuenta ${code}`,
    parentId: parentId || null,
    rootCode: rootCode || null,
    level: level || account.level || 0,
    type: finGetAccountType(account),
    tipo: account.tipo || (root && root.tipo) || inferTipoFromCode(code),
    nature: finGetAccountNature(account) || (root && root.nature) || '',
    isRoot,
    isLocked: isRoot || (!isUserCatalog && (account.isLocked === true || account.systemProtected === true)),
    systemProtected: isUserCatalog ? false : account.systemProtected,
    isPostable,
    isActive,
    isLegacy,
    createdAt: account.createdAt || account.createdAtISO || nowISO,
    updatedAt: account.updatedAt || account.updatedAtISO || nowISO,
    a33AccountHierarchyStage: FIN_ACCOUNTING_REDESIGN_STAGE,
    a33AccountHierarchyVersion: FIN_ACCOUNT_HIERARCHY_VERSION
  };
}

function normalizeAccountForView(account) { return finNormalizeAccountForView(account); }

function finBuildFixedRootAccountRow(root, existing = null, nowISO = new Date().toISOString()) {
  const base = root || FIN_FIXED_ROOTS_BY_CODE[finGetAccountCode(existing)] || null;
  if (!base) return null;
  const created = existing && (existing.createdAt || existing.createdAtISO) ? (existing.createdAt || existing.createdAtISO) : nowISO;
  return {
    ...(existing || {}),
    ...base,
    id: base.code,
    code: base.code,
    name: base.name,
    nombre: base.nombre,
    parentId: null,
    parentCode: null,
    rootCode: base.code,
    level: 1,
    type: base.type,
    tipo: base.tipo,
    rootType: base.rootType,
    nature: base.nature,
    isRoot: true,
    isLocked: true,
    systemProtected: true,
    isPostable: false,
    postable: false,
    noPostable: true,
    isGrouping: true,
    grouping: true,
    isActive: true,
    active: true,
    isHidden: false,
    isLegacy: false,
    createdAt: created,
    updatedAt: nowISO,
    createdAtISO: existing && existing.createdAtISO ? existing.createdAtISO : created,
    updatedAtISO: nowISO,
    a33AccountCatalogVisibleMode: FIN_ACCOUNT_CATALOG_VISIBLE_MODE,
    a33AccountHierarchyStage: FIN_ACCOUNTING_REDESIGN_STAGE,
    a33AccountHierarchyVersion: FIN_ACCOUNT_HIERARCHY_VERSION
  };
}

function finBuildFixedRootAccountRows(nowISO = new Date().toISOString()) {
  return FIN_FIXED_ROOT_ACCOUNTS
    .map(root => finBuildFixedRootAccountRow(root, null, nowISO))
    .filter(Boolean);
}

function finIsCatalogManagedAccount(account) {
  if (!account || typeof account !== 'object') return false;
  if (finIsRootAccount(account)) return true;
  if (account.a33CatalogVisible === true) return true;
  if (account.a33CatalogUserCreated === true) return true;
  if (String(account.generatedFrom || '') === FIN_ACCOUNT_CATALOG_SOURCE) return true;
  if (String(account.sourceModule || '') === FIN_ACCOUNT_CATALOG_SOURCE) return true;
  return false;
}

function finIsUserCatalogAccount(account) {
  if (!account || typeof account !== 'object') return false;
  if (finIsRootAccount(account)) return false;
  if (account.a33CatalogUserCreated === true) return true;
  const generated = String(account.generatedFrom || '').trim();
  const sourceModule = String(account.sourceModule || '').trim();
  return account.a33CatalogVisible === true && (generated === FIN_ACCOUNT_CATALOG_SOURCE || sourceModule === FIN_ACCOUNT_CATALOG_SOURCE);
}

function finGetCatalogManagedAccounts(data) {
  const rows = Array.isArray(data && data.accounts) ? data.accounts : [];
  return rows
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean)
    .filter(acc => finIsCatalogManagedAccount(acc) && finGetRootFromCode(acc.code));
}

function finGetVisibleCatalogAccounts(data) {
  const rows = Array.isArray(data && data.accounts) ? data.accounts : [];
  const map = new Map(rows.map(acc => [finGetAccountCode(acc), acc]).filter(pair => pair[0]));
  const nowISO = new Date().toISOString();
  const out = [];
  const seen = new Set();

  for (const root of FIN_FIXED_ROOT_ACCOUNTS) {
    const rootRow = finBuildFixedRootAccountRow(root, map.get(root.code) || null, nowISO);
    if (!rootRow) continue;
    out.push(rootRow);
    seen.add(rootRow.code);
  }

  for (const acc of finGetCatalogManagedAccounts(data)) {
    const code = finGetAccountCode(acc);
    if (!code || seen.has(code) || FIN_FIXED_ROOT_CODES.includes(code)) continue;
    if (!acc.rootCode || !FIN_FIXED_ROOT_CODES.includes(finGetAccountCode(acc.rootCode))) continue;
    out.push(acc);
    seen.add(code);
  }

  return out;
}

function finGetCatalogCodeReservationAccounts(data) {
  // Para sugerir códigos se toma en cuenta el árbol visible/administrado, no las cuentas legacy internas.
  // Si un código legacy existe pero aún no fue incorporado al árbol, puede ser reclamado sin duplicar clave.
  return finGetVisibleCatalogAccounts(data);
}

function finIsCatalogRootLocked(accountOrCode) {
  const code = finGetAccountCode(accountOrCode);
  return FIN_FIXED_ROOT_CODES.includes(code) || finIsRootAccount(accountOrCode) || (accountOrCode && typeof accountOrCode === 'object' && accountOrCode.isLocked === true);
}

function finGetExistingChildCodes(parentAccountOrCode, allAccounts) {
  const parentCode = finGetAccountCode(parentAccountOrCode);
  const rows = Array.isArray(allAccounts) ? allAccounts : [];
  return rows
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean)
    .filter(acc => String(acc.parentId || finInferParentCodeFromCode(acc.code) || '') === parentCode)
    .map(acc => acc.code)
    .filter(Boolean);
}

function finSuggestNextAccountCode(parentAccount, allAccounts = []) {
  const parentCode = finGetAccountCode(parentAccount);
  const parentLevel = finIsRootAccount(parentAccount) ? 1 : finGetAccountLevelFromCode(parentCode);
  const parentRoot = finGetRootFromCode(parentCode) || (finIsRootAccount(parentCode) ? parentCode : '');
  const existing = new Set((Array.isArray(allAccounts) ? allAccounts : [])
    .map(acc => finGetAccountCode(acc))
    .filter(Boolean));
  const childCodes = new Set(finGetExistingChildCodes(parentAccount, allAccounts));

  if (!parentCode || !parentRoot) {
    return { ok: false, code: '', reason: 'invalid_parent', message: 'La cuenta padre no pertenece a una raíz válida.' };
  }
  if (parentLevel < 1 || parentLevel > 3) {
    return { ok: false, code: '', reason: 'level_full', message: 'Este nivel no permite más subcuentas.' };
  }

  let candidates = [];
  const base = safeParseCodeNum(parentCode);
  if (!Number.isFinite(base)) {
    return { ok: false, code: '', reason: 'invalid_parent_code', message: 'El código de la cuenta padre no es válido.' };
  }

  if (parentLevel === 1) {
    const root = safeParseCodeNum(parentRoot);
    for (let n = root + 100; n <= root + 900; n += 100) candidates.push(String(n).padStart(4, '0'));
  } else if (parentLevel === 2) {
    for (let n = base + 10; n <= base + 90; n += 10) candidates.push(String(n).padStart(4, '0'));
  } else if (parentLevel === 3) {
    for (let n = base + 1; n <= base + 9; n += 1) candidates.push(String(n).padStart(4, '0'));
  }

  const available = candidates.find(code => !existing.has(code) && !childCodes.has(code));
  if (!available) {
    return { ok: false, code: '', reason: 'no_space', message: 'No hay códigos disponibles en este nivel.' };
  }
  return { ok: true, code: available, reason: '', message: '', parentCode, parentLevel, rootCode: parentRoot };
}

function suggestNextAccountCode(parentAccount, allAccounts = []) { return finSuggestNextAccountCode(parentAccount, allAccounts); }

function finClassifyJournalEntryDraft(entry = {}, lines = []) {
  const text = normText([
    entry.tipo, entry.type, entry.category, entry.source, entry.sourceModule, entry.generatedFrom,
    entry.description, entry.descripcion, entry.concepto, entry.reference, entry.referencia, entry.autoLabel
  ].filter(Boolean).join(' '));
  const rows = Array.isArray(lines) ? lines : [];
  const lineCode = (ln) => finGetAccountCode(ln.accountCode || ln.account || ln.code || ln.cuenta || ln.cuentaCodigo || '');
  const lineName = (ln) => normText(ln.accountName || ln.accountNameSnapshot || ln.accountNombre || ln.cuentaNombre || ln.name || '');
  const debitVal = (ln) => Number(ln.debit ?? ln.debe ?? ln.debitOriginal ?? 0) || 0;
  const creditVal = (ln) => Number(ln.credit ?? ln.haber ?? ln.creditOriginal ?? 0) || 0;
  const hasDebitRoot = (rootCode) => rows.some(ln => debitVal(ln) > 0 && finGetRootFromCode(lineCode(ln)) === rootCode);
  const hasCreditRoot = (rootCode) => rows.some(ln => creditVal(ln) > 0 && finGetRootFromCode(lineCode(ln)) === rootCode);
  const hasDebitCode = (code) => rows.some(ln => debitVal(ln) > 0 && lineCode(ln) === finGetAccountCode(code));
  const hasDebitName = (rx) => rows.some(ln => debitVal(ln) > 0 && rx.test(lineName(ln)));
  const hasCreditName = (rx) => rows.some(ln => creditVal(ln) > 0 && rx.test(lineName(ln)));

  const debitActivo = hasDebitRoot('1000');
  const creditActivo = hasCreditRoot('1000');
  const debitCapital = hasDebitRoot('3000');
  const creditCapital = hasCreditRoot('3000');
  const debitPasivo = hasDebitRoot('2000');
  const creditPasivo = hasCreditRoot('2000');
  const debitIngreso = hasDebitRoot('4000') || hasDebitRoot('7000');
  const creditIngreso = hasCreditRoot('4000') || hasCreditRoot('7000');
  const debitCostoGasto = hasDebitRoot('5000') || hasDebitRoot('6000');
  const creditCostoGasto = hasCreditRoot('5000') || hasCreditRoot('6000');
  const inventoryDebit = hasDebitName(/inventario|existencia|producto/) || hasDebitCode('1400') || hasDebitCode('1500');
  const openingCredit = hasCreditName(/resultado|acumulad|apertura|inicial|capital inicial/);

  if (text.includes('saldo inicial') || text.includes('apertura')) return 'Saldo inicial';
  if (text.includes('prestamo') || text.includes('préstamo')) return 'Préstamo recibido';
  if (text.includes('pos') || text.includes('venta') || text.includes('ingreso por venta')) return 'Venta / Ingreso';
  if (text.includes('aporte')) return 'Aporte';
  if (text.includes('transferencia')) return 'Transferencia interna';
  if (text.includes('compra') || text.includes('inventario')) return 'Compra / Inventario';

  if (debitActivo && creditCapital && openingCredit) return 'Saldo inicial';
  if (debitActivo && creditPasivo) return 'Préstamo recibido';
  if (debitActivo && creditIngreso) return 'Venta / Ingreso';
  if (debitActivo && creditCapital) return 'Aporte';
  if (debitActivo && creditActivo && !debitPasivo && !creditPasivo && !debitCapital && !creditCapital && !debitIngreso && !creditIngreso && !debitCostoGasto && !creditCostoGasto) return 'Transferencia interna';
  if (inventoryDebit && (creditActivo || creditPasivo)) return 'Compra / Inventario';
  if (debitCostoGasto && creditActivo) return 'Egreso';
  if ((hasDebitRoot('5000') || hasDebitRoot('6000')) && (creditActivo || creditPasivo)) return 'Egreso';
  return 'Asiento contable';
}

function finGetAutomaticEntryLabel(entry = {}, lines = []) {
  return finClassifyJournalEntryDraft(entry, lines);
}

function finGetLegacyCashGeneralAccountCode() {
  return FIN_LEGACY_ACCOUNT_CODES.cashGeneral;
}

function finGetLegacyCashEventsAccountCode() {
  return FIN_LEGACY_ACCOUNT_CODES.cashEvents;
}

function finGetLegacyBankAccountCode() {
  // Cuenta 1200 se conserva como legacy para históricos.
  return FIN_LEGACY_ACCOUNT_CODES.bank;
}

function finGetCashGeneralAccountCode(currency = 'NIO') {
  return finNormalizeCurrencyCode(currency) === 'USD'
    ? FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralUSD
    : FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralNIO;
}

function finGetCashEventsAccountCode(currency = 'NIO') {
  return finNormalizeCurrencyCode(currency) === 'USD'
    ? FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsUSD
    : FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsNIO;
}

function finGetCurrentCashAccountCodes(currency) {
  if (currency) {
    const cur = finNormalizeCurrencyCode(currency);
    return FIN_CASH_ACCOUNT_CODES.filter(code => finGetFinancialAccountCurrencyCode({ code }) === cur);
  }
  return [...FIN_CASH_ACCOUNT_CODES];
}

function finGetCurrentBankAccountCodes(data) {
  const codes = new Set([finGetLegacyBankAccountCode()]);
  const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
  for (const acc of accounts) {
    if (finIsBankAccount(acc)) {
      const code = finNormalizeAccountCode(acc.code ?? acc.accountCode ?? acc.codigo ?? '');
      if (code) codes.add(code);
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

function finIsLegacyCashAccountCode(code) {
  return FIN_LEGACY_CASH_ACCOUNT_CODES.includes(finNormalizeAccountCode(code));
}

function finIsLegacyBankAccountCode(code) {
  return FIN_LEGACY_BANK_ACCOUNT_CODES.includes(finNormalizeAccountCode(code));
}

function finIsLegacyFinancialAccountCode(code) {
  const c = finNormalizeAccountCode(code);
  return finIsLegacyCashAccountCode(c) || finIsLegacyBankAccountCode(c);
}

function finIsLegacyAccountCode(code) {
  return finIsLegacyFinancialAccountCode(code);
}

function finIsCoreFinancialAccountCode(code) {
  return FIN_CORE_FINANCIAL_ACCOUNT_CODES.includes(finNormalizeAccountCode(code));
}

function finIsDynamicBankAccountCode(code) {
  const n = safeParseCodeNum(code);
  if (!Number.isFinite(n)) return false;
  if (n < FIN_DYNAMIC_BANK_CODE_MIN || n > FIN_DYNAMIC_BANK_CODE_MAX) return false;
  if (n === Number(finGetLegacyBankAccountCode())) return false;
  const rem = (n - FIN_DYNAMIC_BANK_CODE_MIN) % 10;
  return rem === 0 || rem === 1; // pares generados: 1201/1202, 1211/1212, etc.
}

function finGetFinancialAccountCurrencyCode(accOrCode) {
  if (accOrCode && typeof accOrCode === 'object') {
    const explicit = accOrCode.currencyCode ?? accOrCode.currency ?? accOrCode.moneda ?? accOrCode.currencyId ?? '';
    if (explicit) return finNormalizeCurrencyCode(explicit);
    const name = normText(accOrCode.nombre || accOrCode.name || '');
    if (name.includes('us$') || name.includes('usd') || name.includes('dolar') || name.includes('dólar')) return 'USD';
    const code = finNormalizeAccountCode(accOrCode.code ?? accOrCode.accountCode ?? accOrCode.codigo ?? '');
    return finGetFinancialAccountCurrencyCode(code);
  }

  const code = finNormalizeAccountCode(accOrCode);
  if (code === FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralUSD || code === FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsUSD) return 'USD';
  if (code === FIN_MULTICURRENCY_ACCOUNT_CODES.cashGeneralNIO || code === FIN_MULTICURRENCY_ACCOUNT_CODES.cashEventsNIO || code === FIN_MULTICURRENCY_ACCOUNT_CODES.bankLegacy) return 'NIO';

  const n = safeParseCodeNum(code);
  if (Number.isFinite(n) && n >= FIN_DYNAMIC_BANK_CODE_MIN && n <= FIN_DYNAMIC_BANK_CODE_MAX) {
    return (n % 10 === 2) ? 'USD' : 'NIO';
  }
  return FIN_BASE_CURRENCY_CODE;
}

function finGetCurrentCashAccounts(data) {
  const map = data && data.accountsMap;
  const list = Array.isArray(data && data.accounts) ? data.accounts : [];
  return finGetCurrentCashAccountCodes()
    .map(code => (map && typeof map.get === 'function') ? map.get(code) : list.find(a => String(a && a.code) === code))
    .filter(Boolean);
}

function finGetCurrentBankAccounts(data) {
  const list = Array.isArray(data && data.accounts) ? data.accounts : [];
  const map = data && data.accountsMap;
  const all = list.length ? list : (map && typeof map.values === 'function' ? [...map.values()] : []);
  return all
    .filter(acc => acc && finIsBankAccount(acc))
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

function finIsCashAccount(accOrCode) {
  if (accOrCode && typeof accOrCode === 'object') {
    const code = accOrCode.code ?? accOrCode.accountCode ?? accOrCode.codigo ?? '';
    if (finGetCurrentCashAccountCodes().includes(finNormalizeAccountCode(code))) return true;
    if (accOrCode.isCash === true || accOrCode.cash === true) return true;
    const role = String(accOrCode.role || accOrCode.kind || accOrCode.accountRole || '').toLowerCase();
    if (role.includes('cash') || role.includes('caja')) return true;
    const name = String(accOrCode.nombre || accOrCode.name || '').toLowerCase();
    return name.includes('caja') || name.includes('efectivo') || name.includes('cash');
  }
  return finGetCurrentCashAccountCodes().includes(finNormalizeAccountCode(accOrCode));
}

function finIsBankAccount(accOrCode) {
  if (accOrCode && typeof accOrCode === 'object') {
    const code = accOrCode.code ?? accOrCode.accountCode ?? accOrCode.codigo ?? '';
    if (finIsLegacyBankAccountCode(code)) return true;
    if (accOrCode.isBank === true || accOrCode.bank === true) return true;
    const role = String(accOrCode.role || accOrCode.kind || accOrCode.accountRole || '').toLowerCase();
    if (role.includes('bank') || role.includes('banco')) return true;
    const name = String(accOrCode.nombre || accOrCode.name || '').toLowerCase();
    if (name.includes('banco') || name.includes('bank')) return true;
    return finIsDynamicBankAccountCode(code);
  }
  const code = finNormalizeAccountCode(accOrCode);
  return finIsLegacyBankAccountCode(code) || finIsDynamicBankAccountCode(code);
}

function finIsFinancialCashOrBankAccount(accOrCode) {
  return finIsCashAccount(accOrCode) || finIsBankAccount(accOrCode);
}

function finGetFinanceBaseCurrencyCode() {
  return FIN_BASE_CURRENCY_CODE;
}

function finNormalizeCurrencyCode(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (!raw || raw === 'PRIMARY' || raw === 'BASE' || raw === 'C$' || raw === 'CORDOBA' || raw === 'CÓRDOBA' || raw === 'CORDOBAS' || raw === 'CÓRDOBAS') return 'NIO';
  if (raw === 'SECONDARY' || raw === 'US$' || raw === '$' || raw === 'DOLAR' || raw === 'DÓLAR' || raw === 'DOLARES' || raw === 'DÓLARES') return 'USD';
  return FIN_SUPPORTED_CURRENCY_CODES.includes(raw) ? raw : 'NIO';
}

function finFormatFinancialMoney(value, currency = FIN_BASE_CURRENCY_CODE) {
  return finFormatMoney(value, finNormalizeCurrencyCode(currency));
}

function finResolveLegacyCashOrBankCodeByMedium(medium) {
  const m = String(medium || '').trim().toLowerCase();
  if (m === 'bank' || m === 'banco' || m === 'transferencia' || m === 'transfer' || m === 'tarjeta') {
    return finGetLegacyBankAccountCode();
  }
  return finGetLegacyCashGeneralAccountCode();
}

function finGetFinancialCompatInfo(data) {
  return Object.freeze({
    baseCurrency: finGetFinanceBaseCurrencyCode(),
    supportedCurrencies: [...FIN_SUPPORTED_CURRENCY_CODES],
    cashAccounts: finGetCurrentCashAccountCodes(),
    bankAccounts: finGetCurrentBankAccountCodes(data),
    legacyBankAccount: finGetLegacyBankAccountCode(),
    legacyCashGeneralAccount: finGetLegacyCashGeneralAccountCode(),
    legacyCashEventsAccount: finGetLegacyCashEventsAccountCode(),
    stage: FIN_MULTICURRENCY_STAGE
  });
}

function finAccountDefinitionToRow(def, nowISO) {
  const row = {
    code: finNormalizeAccountCode(def.code),
    nombre: def.nombre || def.name || `Cuenta ${def.code}`,
    name: def.name || def.nombre || `Cuenta ${def.code}`,
    tipo: def.tipo || inferTipoFromCode(def.code),
    rootType: String(def.rootType || inferRootTypeFromCode(def.code) || 'OTROS').toUpperCase(),
    systemProtected: !!def.systemProtected,
    isHidden: false,
    active: true,
    a33FinanceStage: FIN_MULTICURRENCY_STAGE,
    a33FinanceMultibankStage: FIN_MULTICURRENCY_STAGE,
    updatedAtISO: nowISO
  };

  const passthrough = [
    'accountRole', 'role', 'kind', 'currency', 'currencyCode', 'moneda',
    'isCash', 'isBank', 'financialAccount', 'isLegacy', 'legacyFinancialAccount',
    'bankCatalogId', 'bankCatalogName', 'bankNameSnapshot', 'bankTypeSnapshot',
    'generatedFrom', 'generatedFromModule', 'sourceCatalog', 'legacyReason', 'legacyNote'
  ];
  for (const key of passthrough) {
    if (def[key] !== undefined) row[key] = def[key];
  }

  if (row.financialAccount === undefined && (row.isCash || row.isBank || row.isLegacy)) row.financialAccount = true;
  if (row.currencyCode === undefined && row.currency !== undefined) row.currencyCode = finNormalizeCurrencyCode(row.currency);
  if (row.currency === undefined && row.currencyCode !== undefined) row.currency = finNormalizeCurrencyCode(row.currencyCode);
  return row;
}

function finShouldUpgradeAccountName(current, def) {
  if (!current) return true;
  if (current.a33CatalogVisible === true || current.a33CatalogUserCreated === true) return false;
  const currentName = normText(current.nombre || current.name || '');
  if (!currentName) return true;
  const target = normText(def.nombre || def.name || '');
  if (currentName === target) return false;

  const legacyNames = Array.isArray(def.legacyNames) ? def.legacyNames : [];
  if (legacyNames.map(normText).includes(currentName)) return true;

  // Las cuentas generadas desde Catálogos pueden seguir el nombre vivo del banco.
  if (def.generatedFrom === 'catalogos_bancos' && current.generatedFrom === 'catalogos_bancos') return true;

  return false;
}

function finApplyAccountDefinition(current, def, nowISO) {
  const base = finAccountDefinitionToRow(def, nowISO);
  const out = current ? { ...current } : { code: base.code, createdAtISO: nowISO };
  let changed = !current;

  if (current && finIsUserCatalogAccount(current)) {
    const codeStr = String(base.code);
    if (String(out.code || '') !== codeStr) { out.code = codeStr; changed = true; }
    const safeKeys = {
      isRoot: false,
      isLocked: false,
      systemProtected: false,
      isLegacy: false,
      legacy: false,
      legacyFinancialAccount: false,
      a33CatalogVisible: true,
      a33CatalogUserCreated: true,
      generatedFrom: FIN_ACCOUNT_CATALOG_SOURCE,
      sourceModule: FIN_ACCOUNT_CATALOG_SOURCE,
      sourceCatalog: 'Finanzas → Catálogo de Cuentas',
      a33AccountCatalogVisibleMode: FIN_ACCOUNT_CATALOG_VISIBLE_MODE,
      a33AccountHierarchyStage: FIN_ACCOUNTING_REDESIGN_STAGE,
      a33AccountHierarchyVersion: FIN_ACCOUNT_HIERARCHY_VERSION
    };
    for (const [key, value] of Object.entries(safeKeys)) {
      if (out[key] !== value) { out[key] = value; changed = true; }
    }
    if (!out.nombre && out.name) { out.nombre = out.name; changed = true; }
    if (!out.name && out.nombre) { out.name = out.nombre; changed = true; }
    if (!out.parentId && out.parentCode) { out.parentId = out.parentCode; changed = true; }
    if (!out.parentCode && out.parentId) { out.parentCode = out.parentId; changed = true; }
    if (!out.rootCode) { out.rootCode = finGetRootFromCode(out.code); changed = true; }
    if (!out.level) { out.level = finGetAccountLevelFromCode(out.code); changed = true; }
    if (out.isPostable === false || out.postable === false || out.noPostable === true || out.isGrouping === true || out.grouping === true || String(out.accountMode || '').toLowerCase() === 'grouping') {
      if (out.isPostable !== false) { out.isPostable = false; changed = true; }
      if (out.postable !== false) { out.postable = false; changed = true; }
      if (out.noPostable !== true) { out.noPostable = true; changed = true; }
      if (out.isGrouping !== true) { out.isGrouping = true; changed = true; }
      if (out.grouping !== true) { out.grouping = true; changed = true; }
      if (out.accountMode !== 'grouping') { out.accountMode = 'grouping'; changed = true; }
    }
    if (changed) { out.updatedAtISO = nowISO; out.updatedAt = nowISO; }
    return { row: out, changed };
  }

  const codeStr = String(base.code);
  if (String(out.code || '') !== codeStr) {
    out.code = codeStr;
    changed = true;
  }

  if (finShouldUpgradeAccountName(out, def)) {
    out.nombre = base.nombre;
    out.name = base.name || base.nombre;
    changed = true;
  } else {
    if (!out.nombre && out.name) { out.nombre = out.name; changed = true; }
    if (!out.name && out.nombre) { out.name = out.nombre; changed = true; }
  }

  const forceKeys = [
    'tipo', 'rootType', 'systemProtected', 'accountRole', 'role', 'kind',
    'currency', 'currencyCode', 'moneda', 'isCash', 'isBank', 'financialAccount',
    'isLegacy', 'legacyFinancialAccount', 'bankCatalogId', 'bankCatalogName',
    'bankNameSnapshot', 'bankTypeSnapshot', 'generatedFrom', 'generatedFromModule',
    'sourceCatalog', 'legacyReason', 'legacyNote', 'a33FinanceStage', 'a33FinanceMultibankStage'
  ];

  const isUserCatalogVisible = out.a33CatalogVisible === true || out.a33CatalogUserCreated === true;
  const userCatalogPreserveKeys = new Set(['generatedFrom', 'generatedFromModule', 'sourceCatalog']);

  for (const key of forceKeys) {
    if (base[key] === undefined) continue;
    if (isUserCatalogVisible && userCatalogPreserveKeys.has(key)) continue;
    if (out[key] !== base[key]) {
      out[key] = base[key];
      changed = true;
    }
  }

  if (typeof out.isHidden !== 'boolean') {
    out.isHidden = false;
    changed = true;
  }
  if (out.active === undefined) {
    out.active = true;
    changed = true;
  }
  if (!out.createdAtISO) {
    out.createdAtISO = nowISO;
    changed = true;
  }
  if (changed) out.updatedAtISO = nowISO;

  return { row: out, changed };
}

function finCatalogBankIsActive(bank) {
  if (!bank || typeof bank !== 'object') return false;
  return bank.isActive === false || bank.active === false ? false : true;
}

function finNormalizeCatalogBankName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function finCatalogBankSortKey(bank) {
  return normText(finNormalizeCatalogBankName(bank && (bank.name || bank.nombre || bank.bankName || bank.label || '')));
}

function finGetUniqueActiveCatalogBanks(rawBanks) {
  const map = new Map();
  for (const bank of (Array.isArray(rawBanks) ? rawBanks : [])) {
    if (!finCatalogBankIsActive(bank)) continue;
    const name = finNormalizeCatalogBankName(bank.name || bank.nombre || bank.bankName || bank.label || '');
    if (!name) continue;
    const key = normText(name);
    if (!map.has(key)) map.set(key, { ...bank, name });
  }
  return [...map.values()].sort((a, b) => finCatalogBankSortKey(a).localeCompare(finCatalogBankSortKey(b)));
}

function finBankPreferredSlot(bank, index) {
  const n = Number(bank && bank.id);
  if (Number.isFinite(n) && n >= 1 && n <= 89) return Math.floor(n) - 1;
  return index;
}

function finBankCodePairFromSlot(slot) {
  const base = 1201 + (Number(slot) * 10);
  return {
    NIO: String(base).padStart(4, '0'),
    USD: String(base + 1).padStart(4, '0')
  };
}

function finExistingAccountMatchesBankCurrency(acc, bank, currency) {
  if (!acc) return true;
  const wantedCur = finNormalizeCurrencyCode(currency);
  const accCur = finGetFinancialAccountCurrencyCode(acc);
  if (accCur !== wantedCur) return false;

  const bankId = String(bank && bank.id != null ? bank.id : '');
  if (bankId && String(acc.bankCatalogId || '') === bankId) return true;

  const wantedName = normText(bank && (bank.name || bank.nombre || bank.bankName || ''));
  const accName = normText(acc.nombre || acc.name || acc.bankNameSnapshot || '');
  return !!wantedName && accName.includes(wantedName);
}

function finBuildBankAccountDefinitionsFromCatalog(rawBanks, existingByCode) {
  const banks = finGetUniqueActiveCatalogBanks(rawBanks);
  const defs = [];
  const occupied = new Set();

  // Respetar cuentas existentes de usuario; si una cuenta generada coincide con el banco, se puede reforzar.
  for (const code of (existingByCode && typeof existingByCode.keys === 'function' ? existingByCode.keys() : [])) {
    occupied.add(finNormalizeAccountCode(code));
  }
  for (const code of BASE_ACCOUNTS.map(a => a.code)) occupied.add(finNormalizeAccountCode(code));

  banks.forEach((bank, index) => {
    let slot = finBankPreferredSlot(bank, index);
    let pair = finBankCodePairFromSlot(slot);
    let guard = 0;

    while (guard < 90) {
      const accNIO = existingByCode && existingByCode.get(pair.NIO);
      const accUSD = existingByCode && existingByCode.get(pair.USD);
      const pairIsFreeOrSameBank =
        (!occupied.has(pair.NIO) || finExistingAccountMatchesBankCurrency(accNIO, bank, 'NIO')) &&
        (!occupied.has(pair.USD) || finExistingAccountMatchesBankCurrency(accUSD, bank, 'USD'));
      if (pairIsFreeOrSameBank) break;
      slot += 1;
      pair = finBankCodePairFromSlot(slot);
      guard += 1;
    }

    const bankId = String(bank && bank.id != null ? bank.id : `bank-${index + 1}`);
    const bankName = finNormalizeCatalogBankName(bank.name || bank.nombre || bank.bankName || `Banco ${index + 1}`);
    const bankType = String(bank.type || bank.bankType || 'transferencia');

    const common = {
      tipo: 'activo',
      rootType: 'ACTIVO',
      systemProtected: true,
      accountRole: 'bank',
      role: 'bank',
      kind: 'bank',
      isBank: true,
      financialAccount: true,
      bankCatalogId: bankId,
      bankCatalogName: bankName,
      bankNameSnapshot: bankName,
      bankTypeSnapshot: bankType,
      generatedFrom: 'catalogos_bancos',
      generatedFromModule: 'catalogos',
      sourceCatalog: 'Gestión Operativa → Catálogos → Bancos'
    };

    defs.push({ ...common, code: pair.NIO, nombre: `Banco / ${bankName} C$`, name: `Banco / ${bankName} C$`, currency: 'NIO', currencyCode: 'NIO' });
    defs.push({ ...common, code: pair.USD, nombre: `Banco / ${bankName} US$`, name: `Banco / ${bankName} US$`, currency: 'USD', currencyCode: 'USD' });
    occupied.add(pair.NIO);
    occupied.add(pair.USD);
  });

  return defs;
}

async function ensureDynamicBankAccountsFromCatalog(existingByCode) {
  const banks = await getAllPosBanksSafe();
  const defs = finBuildBankAccountDefinitionsFromCatalog(banks, existingByCode);
  const nowISO = new Date().toISOString();

  for (const def of defs) {
    const codeStr = finNormalizeAccountCode(def.code);
    const current = existingByCode.get(codeStr);
    const { row, changed } = finApplyAccountDefinition(current, def, nowISO);
    if (!current || changed) {
      await finPut('accounts', row);
      existingByCode.set(codeStr, row);
    }
  }

  return defs.length;
}

// Revisa si una cuenta ya se ha usado en journalLines (para migraciones seguras)
async function finAccountCodeHasLines(code) {
  try {
    await openFinDB();
    return await new Promise((resolve) => {
      const tx = finDB.transaction(['journalLines'], 'readonly');
      const st = tx.objectStore('journalLines');
      const req = st.openCursor();
      req.onerror = () => resolve(false);
      req.onsuccess = (ev) => {
        const cursor = ev.target.result;
        if (!cursor) return resolve(false);
        const v = cursor.value;
        if (String(v?.accountCode || '') === String(code)) return resolve(true);
        cursor.continue();
      };
    });
  } catch (err) {
    return false;
  }
}
async function ensureBaseAccounts() {
  await openFinDB();
  const existing = await finGetAll('accounts');
  const byCode = new Map(existing.map(a => [finNormalizeAccountCode(a.code), a]));
  const nowISO = new Date().toISOString();

  // Nuevo Catálogo de Cuentas: asegurar exactamente las 7 raíces visibles, fijas y no posteables.
  for (const root of FIN_FIXED_ROOT_ACCOUNTS) {
    const codeStr = finNormalizeAccountCode(root.code);
    const current = byCode.get(codeStr) || null;
    const rootRow = finBuildFixedRootAccountRow(root, current, nowISO);
    if (!current || JSON.stringify({ ...current, updatedAt: undefined, updatedAtISO: undefined }) !== JSON.stringify({ ...rootRow, updatedAt: undefined, updatedAtISO: undefined })) {
      await finPut('accounts', rootRow);
      byCode.set(codeStr, rootRow);
    }
  }

  // Precarga única/idempotente del Catálogo depurado desde Excel.
  // Se ejecuta antes de legacy para que códigos reclamados por el Excel no hereden candados viejos.
  await finEnsureExcelCatalogAccounts(byCode);

  // Capa legacy: se conserva/asegura solo para históricos y para que el formulario actual siga operativo.
  // No forma parte del Catálogo de Cuentas visible salvo que el usuario reclame ese código en el árbol.
  for (const base of BASE_ACCOUNTS) {
    const codeStr = finNormalizeAccountCode(base.code);
    const current = byCode.get(codeStr);
    const def = {
      ...base,
      legacyReason: base.isLegacy ? 'Cuenta bancaria histórica conservada para compatibilidad total con movimientos anteriores.' : base.legacyReason,
      legacyNote: base.isLegacy ? 'No migrar ni reclasificar movimientos históricos de 1200.' : base.legacyNote
    };
    const { row, changed } = finApplyAccountDefinition(current, def, nowISO);
    if (!current || changed) {
      await finPut('accounts', row);
      byCode.set(codeStr, row);
    }
  }

  // Bancos reales: lectura segura desde Catálogos → Bancos. No crea catálogo paralelo.
  await ensureDynamicBankAccountsFromCatalog(byCode);

  // A33 estándar: 6105 = Cortesías. Si existe con nombre antiguo y no se ha usado, lo renombramos.
  try {
    const acc6105 = await finGet('accounts', '6105');
    if (acc6105 && acc6105.nombre && !/cortes/i.test(String(acc6105.nombre))) {
      const used = await finAccountCodeHasLines('6105');
      if (!used) {
        acc6105.nombre = 'Cortesías (Promoción)';
        acc6105.name = 'Cortesías (Promoción)';
        await finPut('accounts', acc6105);
      }
    }
  } catch (err) {}

}

/* ---------- Catálogo: normalización segura (Etapa 0) ---------- */

const ROOT_TYPES = ['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESOS', 'COSTOS', 'GASTOS', 'OTROS'];

function isValidRootType(v) {
  return ROOT_TYPES.includes(String(v || '').toUpperCase());
}

function normText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function safeParseCodeNum(code) {
  const s = String(code ?? '').trim();
  const digits = s.match(/\d+/g);
  if (!digits) return NaN;
  const n = parseInt(digits.join(''), 10);
  return Number.isFinite(n) ? n : NaN;
}

function inferRootTypeFromCode(code) {
  const n = safeParseCodeNum(code);
  if (!Number.isFinite(n)) return null;

  if (n >= 1000 && n <= 1999) return 'ACTIVO';
  if (n >= 2000 && n <= 2999) return 'PASIVO';
  if (n >= 3000 && n <= 3999) return 'PATRIMONIO';

  if (n >= 4000 && n <= 4899) return 'INGRESOS';
  if (n >= 4900 && n <= 4999) return 'OTROS';   // otros ingresos

  if (n >= 5000 && n <= 5899) return 'COSTOS';
  if (n >= 5900 && n <= 5999) return 'OTROS';   // otros costos (si aplica)

  if (n >= 6000 && n <= 6899) return 'GASTOS';
  if (n >= 6900 && n <= 6999) return 'OTROS';   // otros gastos (si aplica)

  if (n >= 7000 && n <= 7999) return 'OTROS';   // 7xxx legacy: otros ingresos/gastos

  return null;
}

function inferRootTypeFromTipo(tipo) {
  const t = normText(tipo);
  if (!t) return null;

  if (t.includes('activo')) return 'ACTIVO';
  if (t.includes('pasivo')) return 'PASIVO';
  if (t.includes('patrimonio') || t.includes('capital')) return 'PATRIMONIO';
  if (t.includes('ingreso')) return 'INGRESOS';
  if (t.includes('costo')) return 'COSTOS';
  if (t.includes('gasto')) return 'GASTOS';
  if (t.includes('otro')) return 'OTROS';

  return null;
}

function inferRootTypeFromName(nombre) {
  const n = normText(nombre);
  if (!n) return null;

  // Regla crítica: "Retiros del dueño" debe quedar en PATRIMONIO.
  if (n.includes('retiro') && (n.includes('duen') || n.includes('due') || n.includes('propiet'))) {
    return 'PATRIMONIO';
  }

  return null;
}

function inferSystemProtectedIfMissing(acc) {
  const codeStr = String(acc.code ?? '');
  const codeNum = safeParseCodeNum(acc.code);
  const nombre = acc.nombre || acc.name || '';
  const nm = normText(nombre);

  const criticalCodes = new Set([...FIN_CORE_FINANCIAL_ACCOUNT_CODES, ...finGetCurrentCashAccountCodes(), ...finGetCurrentBankAccountCodes(), '4100', '5100', '3300']);
  if (criticalCodes.has(codeStr)) return true;
  if (Number.isFinite(codeNum)) {
    const padded = String(codeNum).padStart(4, '0');
    if (criticalCodes.has(padded)) return true;
  }

  const keywords = ['caja', 'banco', 'ventas', 'costo', 'inventario', 'retiro', 'capital'];
  for (const k of keywords) {
    if (nm.includes(k)) return true;
  }

  return false;
}

async function normalizeAccountsCatalog() {
  await openFinDB();

  const accounts = await finGetAll('accounts');
  if (!accounts || !accounts.length) return;

  const nowISO = new Date().toISOString();
  const childParentCodes = new Set((Array.isArray(accounts) ? accounts : [])
    .map(row => finNormalizeAccountForView(row))
    .filter(Boolean)
    .map(row => row.parentId || finInferParentCodeFromCode(row.code) || '')
    .filter(Boolean));

  for (const acc of accounts) {
    if (!acc || acc.code === undefined || acc.code === null) continue;

    let changed = false;

    // Las 7 raíces fijas se fuerzan a su forma protegida; no se pueden editar, inactivar ni postear.
    if (FIN_FIXED_ROOT_CODES.includes(finGetAccountCode(acc))) {
      const rootRow = finBuildFixedRootAccountRow(FIN_FIXED_ROOTS_BY_CODE[finGetAccountCode(acc)], acc, nowISO);
      await finPut('accounts', rootRow);
      continue;
    }

    // Compatibilidad name/nombre (sin borrar ninguno)
    const hasNombre = !!(acc.nombre && String(acc.nombre).trim());
    const hasName = !!(acc.name && String(acc.name).trim());

    if (!hasNombre && hasName) {
      acc.nombre = acc.name;
      changed = true;
    }
    if (!hasName && hasNombre) {
      acc.name = acc.nombre;
      changed = true;
    }

    // isHidden/isActive default seguros (solo si falta / inválido)
    if (typeof acc.isHidden !== 'boolean') {
      acc.isHidden = false;
      changed = true;
    }
    if (acc.isActive === undefined) {
      acc.isActive = acc.active === false || acc.isHidden === true ? false : true;
      changed = true;
    }
    if (acc.active === undefined) {
      acc.active = acc.isActive !== false;
      changed = true;
    }
    if (acc.inactive === undefined && acc.isActive === false) {
      acc.inactive = true;
      changed = true;
    }

    // systemProtected (respetar si ya existe; inferir si falta)
    if (typeof acc.systemProtected !== 'boolean') {
      acc.systemProtected = inferSystemProtectedIfMissing(acc);
      changed = true;
    }

    // rootType (si falta o inválido). Normalizamos a MAYÚSCULAS para consistencia futura.
    const rtExisting = String(acc.rootType || '').toUpperCase();
    if (rtExisting && ROOT_TYPES.includes(rtExisting) && acc.rootType !== rtExisting) {
      acc.rootType = rtExisting;
      changed = true;
    } else if (!ROOT_TYPES.includes(rtExisting)) {
      let rt = inferRootTypeFromName(acc.nombre || acc.name || '');
      if (!rt) rt = inferRootTypeFromCode(acc.code);
      if (!rt) rt = inferRootTypeFromTipo(acc.tipo);
      if (!rt) rt = 'OTROS';

      acc.rootType = rt;
      changed = true;
    }

    // Preparación no destructiva para el Catálogo jerárquico futuro.
    // No recalcular históricos legacy; solo completar metadatos faltantes.
    const futureShape = finNormalizeAccountForView(acc);
    if (futureShape) {
      const safeHierarchyKeys = [
        'id', 'parentId', 'rootCode', 'level', 'type', 'nature',
        'isRoot', 'isLocked', 'isPostable', 'isActive', 'isLegacy',
        'a33AccountHierarchyStage', 'a33AccountHierarchyVersion'
      ];
      for (const key of safeHierarchyKeys) {
        if (acc[key] === undefined && futureShape[key] !== undefined) {
          acc[key] = futureShape[key];
          changed = true;
        }
      }
      if (!acc.createdAt && futureShape.createdAt) {
        acc.createdAt = futureShape.createdAt;
        changed = true;
      }
      if (!acc.updatedAt && futureShape.updatedAt) {
        acc.updatedAt = futureShape.updatedAt;
        changed = true;
      }
    }

    // Si una cuenta tiene hijos, queda como agrupadora/no posteable.
    if (childParentCodes.has(finGetAccountCode(acc)) && !finIsRootAccount(acc)) {
      if (acc.isPostable !== false || acc.postable !== false || acc.noPostable !== true || acc.isGrouping !== true || acc.grouping !== true || acc.accountMode !== 'grouping') {
        acc.isPostable = false;
        acc.postable = false;
        acc.noPostable = true;
        acc.isGrouping = true;
        acc.grouping = true;
        acc.accountMode = 'grouping';
        changed = true;
      }
    }

    // createdAtISO / updatedAtISO (opcionales pero consistentes)
    if (!acc.createdAtISO) {
      acc.createdAtISO = nowISO;
      changed = true;
    }

    if (changed) {
      acc.updatedAtISO = nowISO;
      await finPut('accounts', acc);
    }
  }
}

/* ---------- Utilidades de fechas, texto y formato ---------- */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function monthRange(year, month) {
  // month: 1–12
  const y = Number(year);
  const m = Number(month);
  const start = `${y}-${pad2(m)}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
  return { start, end };
}


function isoShiftDays(isoYYYYMMDD, deltaDays) {
  // isoYYYYMMDD: 'YYYY-MM-DD'
  const d = new Date(`${isoYYYYMMDD}T00:00:00`);
  d.setDate(d.getDate() + Number(deltaDays || 0));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getDiaryRangeFromUI() {
  let desde = (document.getElementById('diario-desde')?.value) || '';
  let hasta = (document.getElementById('diario-hasta')?.value) || '';
  if (desde && hasta && desde > hasta) {
    const tmp = desde;
    desde = hasta;
    hasta = tmp;
  }
  return { desde, hasta };
}

function setDiaryRangeUI(desde, hasta) {
  const elDesde = document.getElementById('diario-desde');
  const elHasta = document.getElementById('diario-hasta');
  if (elDesde) elDesde.value = desde || '';
  if (elHasta) elHasta.value = hasta || '';
}

function applyDiaryPreset(preset) {
  const t = todayStr();
  const now = new Date();
  let desde = '';
  let hasta = '';

  switch (String(preset || '').toLowerCase()) {
    case 'hoy':
      desde = t; hasta = t;
      break;
    case 'ayer': {
      const a = isoShiftDays(t, -1);
      desde = a; hasta = a;
      break;
    }
    case '7d':
    case 'ultimos7':
    case 'ultimos 7':
      hasta = t;
      desde = isoShiftDays(t, -6);
      break;
    case 'mes':
    case 'este mes':
      hasta = t;
      desde = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-01`;
      break;
    case 'todo':
    default:
      desde = ''; hasta = '';
      break;
  }

  setDiaryRangeUI(desde, hasta);
  if (finCachedData) renderDiario(finCachedData);
}


function fmtCurrency(v) {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return safe.toLocaleString('es-NI', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

/* ---------- Moneda central: Finanzas / Banco (solo lectura, sin recalcular históricos) ---------- */

const FIN_CURRENCY_SOURCE_LABEL = 'Configuración → Moneda';
const FIN_CURRENCY_STORAGE_KEY = 'suite_a33_currency_settings_v1';
const FIN_CURRENCY_WARNING_MESSAGE = 'Configure el tipo de cambio vigente en Configuración → Moneda para registrar movimientos en USD.';

function finCurrencyPad2(value) {
  return String(value).padStart(2, '0');
}

function finFormatCurrencyTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Sin registros';
  if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(raw)) return raw;
  let d = null;
  const asNumber = Number(raw);
  if (Number.isFinite(asNumber) && asNumber > 0) d = new Date(asNumber);
  if (!d || Number.isNaN(d.getTime())) d = new Date(raw);
  if (!d || Number.isNaN(d.getTime())) return raw;
  return `${finCurrencyPad2(d.getDate())}/${finCurrencyPad2(d.getMonth() + 1)}/${d.getFullYear()} ${finCurrencyPad2(d.getHours())}:${finCurrencyPad2(d.getMinutes())}`;
}

function finReadCurrencySettingsSafe() {
  try {
    if (window.A33Currency && typeof window.A33Currency.readSettings === 'function') {
      const data = window.A33Currency.readSettings();
      if (data && typeof data === 'object') return data;
    }
  } catch (_) {}

  let raw = '';
  try {
    if (window.A33Storage && typeof window.A33Storage.getItem === 'function') {
      const v = window.A33Storage.getItem(FIN_CURRENCY_STORAGE_KEY, 'local');
      if (v !== undefined && v !== null) raw = String(v || '');
    }
  } catch (_) {}
  if (!raw) {
    try { raw = localStorage.getItem(FIN_CURRENCY_STORAGE_KEY) || ''; } catch (_) { raw = ''; }
  }

  let parsed = null;
  if (raw) {
    try { parsed = JSON.parse(raw); }
    catch (_) { parsed = { exchangeRate: raw }; }
  }

  const fallback = {
    version: 1,
    mode: 'manual',
    primary: { name: 'Córdoba nicaragüense', symbol: 'C$', code: 'NIO' },
    secondary: { name: 'Dólar estadounidense', symbol: 'US$', code: 'USD' },
    exchangeRate: '',
    updatedAt: ''
  };

  try {
    if (window.A33Currency && typeof window.A33Currency.normalizeSettings === 'function') {
      return window.A33Currency.normalizeSettings(parsed || fallback);
    }
  } catch (_) {}

  return {
    ...fallback,
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    primary: fallback.primary,
    secondary: fallback.secondary
  };
}

function finNormalizeExchangeRateValue(value) {
  try {
    if (window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function') {
      return window.A33Currency.normalizeExchangeRateValue(value);
    }
  } catch (_) {}
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!raw || !/^\d+(?:\.\d{0,2})?$/.test(raw)) return '';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : '';
}

function finParseCurrencyAmount(value) {
  try {
    if (window.A33Currency && typeof window.A33Currency.parseAmount === 'function') {
      const parsed = window.A33Currency.parseAmount(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch (_) {}
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let raw = String(value ?? '').trim();
  if (!raw) return null;
  raw = raw.replace(/[^0-9,.-]/g, '');
  const hasComma = raw.includes(',');
  const hasDot = raw.includes('.');
  if (hasComma && hasDot) raw = raw.replace(/,/g, '');
  else if (hasComma && !hasDot) raw = raw.replace(',', '.');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function finRoundCurrency2(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function finGetCurrencyStateSafe() {
  const settings = finReadCurrencySettingsSafe();
  const normalizedRate = finNormalizeExchangeRateValue(settings.exchangeRate);
  const rate = normalizedRate ? Number(normalizedRate) : null;
  const state = {
    ok: true,
    settings,
    primary: settings.primary || { symbol: 'C$', code: 'NIO' },
    secondary: settings.secondary || { symbol: 'US$', code: 'USD' },
    baseCurrency: 'NIO',
    secondaryCurrency: 'USD',
    exchangeRate: Number.isFinite(rate) && rate > 0 ? rate : null,
    exchangeRateValue: normalizedRate,
    exchangeRateText: normalizedRate ? `T/C ${normalizedRate}` : 'T/C no configurado',
    updatedAtRaw: String(settings.updatedAt || '').trim(),
    updatedAtText: finFormatCurrencyTimestamp(settings.updatedAt),
    hasExchangeRate: !!normalizedRate,
    source: FIN_CURRENCY_SOURCE_LABEL,
    storageKey: FIN_CURRENCY_STORAGE_KEY,
    warningMessage: normalizedRate ? '' : FIN_CURRENCY_WARNING_MESSAGE
  };
  return state;
}

function finGetFinanceBaseCurrency() {
  const state = finGetCurrencyStateSafe();
  return state.primary || { symbol: 'C$', code: 'NIO' };
}

function finGetFinanceSecondaryCurrency() {
  const state = finGetCurrencyStateSafe();
  return state.secondary || { symbol: 'US$', code: 'USD' };
}

function finCurrencySymbol(kind = 'NIO') {
  const k = String(kind || '').trim().toUpperCase();
  const state = finGetCurrencyStateSafe();
  const cur = (k === 'USD' || k === 'US$' || k === 'SECONDARY') ? state.secondary : state.primary;
  return String((cur && cur.symbol) || (k === 'USD' ? 'US$' : 'C$')).trim();
}

function finCurrencyCode(kind = 'NIO') {
  const state = finGetCurrencyStateSafe();
  const k = String(kind || '').trim().toUpperCase();
  const cur = (k === 'USD' || k === 'US$' || k === 'SECONDARY') ? state.secondary : state.primary;
  return String((cur && cur.code) || (k === 'USD' ? 'USD' : 'NIO')).trim().toUpperCase();
}

function finHasValidExchangeRate() {
  return !!finGetCurrencyStateSafe().hasExchangeRate;
}

function finGetCurrentExchangeRate() {
  const state = finGetCurrencyStateSafe();
  return state.hasExchangeRate ? state.exchangeRate : null;
}

function finMovementRequiresExchangeRate(currency) {
  return finNormalizeCurrencyCode(currency) === 'USD';
}

function finNormalizeMoneySpacing(text) {
  const raw = String(text ?? '').trim();
  return raw.replace(/^(C\$|US\$)(-?\d)/, '$1 $2');
}

function finFormatMoney(value, kind = 'NIO') {
  const k = finNormalizeCurrencyCode(kind || 'NIO');
  try {
    if (window.A33Currency && typeof window.A33Currency.formatMoney === 'function') {
      return finNormalizeMoneySpacing(window.A33Currency.formatMoney(value, k));
    }
  } catch (_) {}
  const symbol = finCurrencySymbol(k);
  return `${symbol} ${fmtCurrency(value)}`;
}

function finFormatCordobas(value) {
  return finFormatMoney(value, 'NIO');
}

function finFormatDollars(value) {
  return finFormatMoney(value, 'USD');
}

function finFormatOriginalAmount(value, currency = 'NIO') {
  return finFormatMoney(value, finNormalizeCurrencyCode(currency));
}

function finConvertUsdToCordobas(amount, explicitRate) {
  const monto = finParseCurrencyAmount(amount);
  if (monto === null) {
    return { ok: false, value: null, formatted: '', reason: 'amount_invalid', message: 'Monto inválido.' };
  }
  const rate = explicitRate != null ? Number(finNormalizeExchangeRateValue(explicitRate)) : finGetCurrentExchangeRate();
  if (!Number.isFinite(rate) || rate <= 0) {
    return { ok: false, value: null, formatted: '', reason: 'exchange_rate_missing', message: FIN_CURRENCY_WARNING_MESSAGE };
  }
  const value = finRoundCurrency2(monto * rate);
  return {
    ok: true,
    value,
    formatted: finFormatCordobas(value),
    reason: 'ok',
    exchangeRate: finRoundCurrency2(rate),
    exchangeRateText: `T/C ${Number(rate).toFixed(2)}`
  };
}

function finBuildExchangeRateSnapshot(input = {}) {
  const currency = finNormalizeCurrencyCode(input.monedaOriginal ?? input.currency ?? input.moneda ?? 'NIO');
  const amountRaw = input.montoOriginal ?? input.amount ?? input.monto ?? 0;
  const amount = finParseCurrencyAmount(amountRaw);
  const state = finGetCurrencyStateSafe();
  const base = {
    monedaOriginal: currency,
    montoOriginal: Number.isFinite(amount) ? finRoundCurrency2(amount) : null,
    monedaBase: 'NIO',
    tipoCambioUsado: null,
    equivalenteNIO: currency === 'NIO' && Number.isFinite(amount) ? finRoundCurrency2(amount) : null,
    fechaTipoCambio: '',
    fuenteTipoCambio: FIN_CURRENCY_SOURCE_LABEL,
    requiereTipoCambio: finMovementRequiresExchangeRate(currency),
    ok: true,
    warningMessage: ''
  };

  if (amount === null) {
    return { ...base, ok: false, warningMessage: 'Monto inválido.' };
  }

  if (currency === 'USD') {
    if (!state.hasExchangeRate || !Number.isFinite(state.exchangeRate) || state.exchangeRate <= 0) {
      return { ...base, ok: false, warningMessage: FIN_CURRENCY_WARNING_MESSAGE };
    }
    const converted = finConvertUsdToCordobas(amount, state.exchangeRate);
    return {
      ...base,
      tipoCambioUsado: finRoundCurrency2(state.exchangeRate),
      equivalenteNIO: converted.ok ? converted.value : null,
      fechaTipoCambio: state.updatedAtText || '',
      ok: converted.ok,
      warningMessage: converted.ok ? '' : FIN_CURRENCY_WARNING_MESSAGE
    };
  }

  return base;
}

function finFormatEquivalentCordobas(amountUsd, explicitRate) {
  const result = finConvertUsdToCordobas(amountUsd, explicitRate);
  return result.ok ? result.formatted : '—';
}

function finPrimaryAmountHeader() {
  return `Monto ${finCurrencySymbol('NIO')}`;
}

function finMoneyColumnHeader(label) {
  return `${label} (${finCurrencySymbol('NIO')})`;
}

function finSetCurrencyReferenceNode(prefix, state, primary, secondary, rateText, note) {
  const root = document.getElementById(`${prefix}-currency-reference`);
  const elPrimary = document.getElementById(`${prefix}-currency-primary`);
  const elSecondary = document.getElementById(`${prefix}-currency-secondary`);
  const elRate = document.getElementById(`${prefix}-currency-rate`);
  const elNote = document.getElementById(`${prefix}-currency-note`);
  if (root) root.classList.toggle('fin-currency-reference--warn', !state.hasExchangeRate);
  if (elPrimary) elPrimary.textContent = primary;
  if (elSecondary) elSecondary.textContent = secondary;
  if (elRate) elRate.textContent = rateText;
  if (elNote) elNote.textContent = note;
}

function finRenderCurrencyReference() {
  try {
    const state = finGetCurrencyStateSafe();
    const primary = `${finCurrencySymbol('NIO')} / ${finCurrencyCode('NIO')}`;
    const secondary = `${finCurrencySymbol('USD')} / ${finCurrencyCode('USD')}`;
    const rateText = state.hasExchangeRate
      ? `T/C vigente: ${finCurrencySymbol('NIO')}${Number(state.exchangeRate || 0).toFixed(2)} por ${finCurrencySymbol('USD')}1.00`
      : 'T/C no configurado';
    const updated = state.hasExchangeRate ? (state.updatedAtText || 'Sin registros') : 'Sin registros';
    const note = state.hasExchangeRate
      ? `Fuente: ${FIN_CURRENCY_SOURCE_LABEL} · Última actualización: ${updated} · Base contable: ${primary}.`
      : `${FIN_CURRENCY_WARNING_MESSAGE} Base contable: ${primary}.`;

    finSetCurrencyReferenceNode('fin', state, primary, secondary, rateText, note);
    finSetCurrencyReferenceNode('fa', state, primary, secondary, rateText, note);
    finSetCurrencyReferenceNode('ti', state, primary, secondary, rateText, note);
    finSetCurrencyReferenceNode('rec', state, primary, secondary, rateText, note);
  } catch (_) {}
}

try {
  window.A33FinanzasCurrency = Object.assign({}, window.A33FinanzasCurrency || {}, {
    source: FIN_CURRENCY_SOURCE_LABEL,
    warningMessage: FIN_CURRENCY_WARNING_MESSAGE,
    getState: finGetCurrencyStateSafe,
    getBaseCurrency: finGetFinanceBaseCurrency,
    getSecondaryCurrency: finGetFinanceSecondaryCurrency,
    getExchangeRate: finGetCurrentExchangeRate,
    hasExchangeRate: finHasValidExchangeRate,
    requiresExchangeRate: finMovementRequiresExchangeRate,
    convertUsdToCordobas: finConvertUsdToCordobas,
    buildExchangeRateSnapshot: finBuildExchangeRateSnapshot,
    formatEquivalentCordobas: finFormatEquivalentCordobas,
    formatOriginalAmount: finFormatOriginalAmount
  });
} catch (_) {}

/* ---------- Caja Chica (física / informativa, NO contable) ---------- */

const CC_STORAGE_KEY = 'a33_finanzas_caja_chica_v1';

const CC_DENOMS = {
  NIO: [
    { id: '1_coin', value: 1, chip: 'moneda' },
    { id: '5_coin', value: 5, chip: 'moneda' },
    { id: '10_coin', value: 10, chip: 'moneda' },
    { id: '10_bill', value: 10, chip: 'billete' },
    { id: '20', value: 20, chip: 'billete' },
    { id: '50', value: 50, chip: 'billete' },
    { id: '100', value: 100, chip: 'billete' },
    { id: '200', value: 200, chip: 'billete' },
    { id: '500', value: 500, chip: 'billete' },
    { id: '1000', value: 1000, chip: 'billete' }
  ],
  USD: [
    { id: '1', value: 1 },
    { id: '5', value: 5 },
    { id: '10', value: 10 },
    { id: '20', value: 20 },
    { id: '50', value: 50 },
    { id: '100', value: 100 }
  ]
};

let ccCurrency = 'NIO';
let ccSnapshot = null;

function fmtDDMMYYYYHHMM(date) {
  const d = (date instanceof Date) ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function ccSafeParseJSON(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function ccRound2(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function ccBuildEmptyConsolidated() {
  return {
    totalNio: 0,
    totalUsd: 0,
    equivalentNio: null,
    equivalentUsd: null,
    fxRateUsed: null,
    updatedAtISO: '',
    updatedAtDisplay: ''
  };
}

function ccBuildEmptySnapshot() {
  return {
    version: 3,
    currencies: {
      NIO: {
        denoms: CC_DENOMS.NIO.map(d => ({ id: d.id, value: d.value, chip: d.chip || '', count: null })),
        total: 0
      },
      USD: {
        denoms: CC_DENOMS.USD.map(d => ({ id: d.id, value: d.value, chip: d.chip || '', count: null })),
        total: 0
      }
    },
    consolidated: ccBuildEmptyConsolidated(),
    fxRateDraft: null,
    updatedAtISO: '',
    updatedAtDisplay: ''
  };
}

function ccComputeCurrencyTotal(currency, snap) {
  const s = snap || ccSnapshot;
  const cur = (s && s.currencies) ? (s.currencies[currency] || {}) : {};
  const denoms = Array.isArray(cur.denoms) ? cur.denoms : [];
  let total = 0;
  for (const d of denoms) {
    const val = Number(d.value || 0);
    const cnt = (d.count == null) ? 0 : Number(d.count || 0);
    if (Number.isFinite(val) && Number.isFinite(cnt)) total += val * cnt;
  }
  return Math.round(total * 100) / 100;
}

function ccNormalizeSnapshot(obj) {
  if (!obj || typeof obj !== 'object') return ccBuildEmptySnapshot();

  const out = ccBuildEmptySnapshot();
  const cur = obj.currencies || {
    NIO: obj.NIO || obj.nio || obj.cordobas || obj.cordoba || {},
    USD: obj.USD || obj.usd || obj.dolares || obj.dolar || {}
  };

  (['NIO', 'USD']).forEach(code => {
    const src = cur[code] || {};
    const srcDenoms = Array.isArray(src.denoms) ? src.denoms : [];
    const byId = new Map(srcDenoms.map(d => [String(d && d.id ? d.id : ''), d]));

    out.currencies[code].denoms = (CC_DENOMS[code] || []).map(base => {
      let raw = null;

      // 1) Formato actual: array `denoms` con {id,count}
      const hit = byId.get(String(base.id));
      if (hit) raw = hit.count;

      // 2) Compat: C$10 MONEDA histórico. Se consolida en el denom '10_coin' (solo histórico, read-only).
      if (code === 'NIO' && String(base.id) === '10_coin') {
        const aliases = [
          'moneda10', 'coin10', 'c10', 'm10', '10moneda', '10_coin'
        ];

        let sum = 0;
        let hasAny = false;

        // Desde denoms[] por ID (formato actual)
        {
          const h = byId.get('10_coin');
          if (h) {
            const v = h.count;
            if (!(v === '' || v == null)) {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
            }
          }
        }

        // Desde campos legacy (nivel raíz o src.denoms como objeto)
        for (const f of aliases) {
          if (!Object.prototype.hasOwnProperty.call(src, f)) continue;
          const v = src[f];
          if (v === '' || v == null) continue;
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
        }
        if (src.denoms && typeof src.denoms === 'object' && !Array.isArray(src.denoms)) {
          for (const f of aliases) {
            if (!Object.prototype.hasOwnProperty.call(src.denoms, f)) continue;
            const v = src.denoms[f];
            if (v === '' || v == null) continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
          }
        }

        if (hasAny) raw = sum;
      }

      // 3) Compat: C$10 BILLETE histórico. Se consolida en el denom '10_bill' (capturable).
      if (code === 'NIO' && String(base.id) === '10_bill') {
        const aliases = [
          '10_bill', 'billete10', 'bill10', 'b10', '10billete'
        ];

        let sum = 0;
        let hasAny = false;

        // Desde denoms[] por ID (formato actual)
        {
          const h = byId.get('10_bill');
          if (h) {
            const v = h.count;
            if (!(v === '' || v == null)) {
              const n = Number(v);
              if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
            }
          }
        }

        // Desde campos legacy (nivel raíz o src.denoms como objeto)
        for (const f of aliases) {
          if (!Object.prototype.hasOwnProperty.call(src, f)) continue;
          const v = src[f];
          if (v === '' || v == null) continue;
          const n = Number(v);
          if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
        }
        if (src.denoms && typeof src.denoms === 'object' && !Array.isArray(src.denoms)) {
          for (const f of aliases) {
            if (!Object.prototype.hasOwnProperty.call(src.denoms, f)) continue;
            const v = src.denoms[f];
            if (v === '' || v == null) continue;
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) { sum += n; hasAny = true; }
          }
        }

        if (hasAny) raw = sum;
      }

      const n = (raw === '' || raw == null) ? null : Number(raw);
      const count = (Number.isFinite(n) && n >= 0) ? Math.trunc(n) : null;
      return { id: base.id, value: base.value, chip: base.chip || '', count };
    });
    out.currencies[code].total = ccComputeCurrencyTotal(code, out);
  });

  out.updatedAtISO = typeof obj.updatedAtISO === 'string' ? obj.updatedAtISO : '';
  out.updatedAtDisplay = typeof obj.updatedAtDisplay === 'string' ? obj.updatedAtDisplay : '';

  const srcCon = (obj.consolidated && typeof obj.consolidated === 'object') ? obj.consolidated : null;
  const legacyFx = Number(obj.fxRateDraft ?? obj.fxRate ?? obj.fxRateUsed ?? (srcCon ? srcCon.fxRateUsed : null));
  out.fxRateDraft = (Number.isFinite(legacyFx) && legacyFx > 0) ? ccRound2(legacyFx) : null;

  const fallbackFx = ccCoerceFxRate(out.fxRateDraft);
  const fallbackConsolidated = {
    totalNio: out.currencies.NIO.total,
    totalUsd: out.currencies.USD.total,
    equivalentNio: fallbackFx ? ccRound2(out.currencies.NIO.total + (out.currencies.USD.total * fallbackFx)) : null,
    equivalentUsd: fallbackFx ? ccRound2(out.currencies.USD.total + (out.currencies.NIO.total / fallbackFx)) : null,
    fxRateUsed: fallbackFx,
    updatedAtISO: out.updatedAtISO,
    updatedAtDisplay: out.updatedAtDisplay
  };

  const con = srcCon || fallbackConsolidated;
  const fxUsed = Number(con.fxRateUsed);
  const eqNio = Number(con.equivalentNio);
  const eqUsd = Number(con.equivalentUsd);

  out.consolidated = {
    totalNio: ccRound2(con.totalNio ?? fallbackConsolidated.totalNio),
    totalUsd: ccRound2(con.totalUsd ?? fallbackConsolidated.totalUsd),
    equivalentNio: Number.isFinite(eqNio) ? ccRound2(eqNio) : null,
    equivalentUsd: Number.isFinite(eqUsd) ? ccRound2(eqUsd) : null,
    fxRateUsed: (Number.isFinite(fxUsed) && fxUsed > 0) ? ccRound2(fxUsed) : null,
    updatedAtISO: typeof con.updatedAtISO === 'string' ? con.updatedAtISO : fallbackConsolidated.updatedAtISO,
    updatedAtDisplay: typeof con.updatedAtDisplay === 'string' ? con.updatedAtDisplay : fallbackConsolidated.updatedAtDisplay
  };

  if (!out.fxRateDraft && out.consolidated.fxRateUsed) out.fxRateDraft = out.consolidated.fxRateUsed;
  return out;
}

function ccSetMsg(text) {
  const el = document.getElementById('cc-msg');
  if (el) el.textContent = text || '';
}

function ccSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function ccFormatNIO(value) {
  return finFormatCordobas(value || 0);
}

function ccFormatUSD(value) {
  return finFormatDollars(value || 0);
}

function ccCoerceFxRate(value) {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0) ? ccRound2(n) : null;
}


function ccNormalizeCentralFxRate(value) {
  if (window.A33Currency && typeof window.A33Currency.normalizeExchangeRateValue === 'function') {
    const normalized = window.A33Currency.normalizeExchangeRateValue(value);
    return normalized ? ccCoerceFxRate(normalized) : null;
  }
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(raw)) return null;
  return ccCoerceFxRate(raw);
}

function ccFormatCurrencyTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Sin registros';
  if (/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}$/.test(raw)) return raw;
  let d = null;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) d = new Date(n);
  if (!d || Number.isNaN(d.getTime())) d = new Date(raw);
  if (!d || Number.isNaN(d.getTime())) return raw;
  return fmtDDMMYYYYHHMM(d);
}

function ccReadCentralCurrencyState() {
  try {
    if (window.A33Currency && typeof window.A33Currency.getState === 'function') {
      const state = window.A33Currency.getState();
      const settings = (state && state.settings && typeof state.settings === 'object') ? state.settings : {};
      const rate = ccNormalizeCentralFxRate(settings.exchangeRate ?? state.exchangeRate);
      return {
        hasExchangeRate: !!rate,
        rate,
        rateText: state && state.exchangeRateText ? String(state.exchangeRateText) : (rate ? `T/C ${rate.toFixed(2)}` : 'T/C no configurado'),
        updatedAtRaw: String(settings.updatedAt || '').trim(),
        updatedAtDisplay: ccFormatCurrencyTimestamp(settings.updatedAt),
        source: 'Configuración → Moneda'
      };
    }
  } catch (_) {}

  let raw = '';
  const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
  try {
    if (window.A33Storage && typeof window.A33Storage.getItem === 'function') {
      const stored = window.A33Storage.getItem(key, 'local');
      if (stored !== undefined && stored !== null) raw = String(stored);
    }
  } catch (_) {}
  if (!raw) {
    try { raw = localStorage.getItem(key) || ''; } catch (_) { raw = ''; }
  }

  let settings = {};
  if (raw) {
    try { settings = JSON.parse(raw); }
    catch (_) { settings = { exchangeRate: raw }; }
  }

  const rate = ccNormalizeCentralFxRate(settings.exchangeRate);
  return {
    hasExchangeRate: !!rate,
    rate,
    rateText: rate ? `T/C ${rate.toFixed(2)}` : 'T/C no configurado',
    updatedAtRaw: String(settings.updatedAt || '').trim(),
    updatedAtDisplay: ccFormatCurrencyTimestamp(settings.updatedAt),
    source: 'Configuración → Moneda'
  };
}

function ccGetCentralFxRate() {
  const central = ccReadCentralCurrencyState();
  return central.hasExchangeRate ? central.rate : null;
}

function ccUpdateCentralCurrencyReference() {
  const central = ccReadCentralCurrencyState();
  const input = document.getElementById('cc-fx-rate');
  if (input) {
    input.readOnly = true;
    input.disabled = true;
    input.value = central.hasExchangeRate ? central.rate.toFixed(2) : '';
    input.placeholder = 'Configurar en Moneda';
    input.title = central.hasExchangeRate
      ? `Fuente: Configuración → Moneda · ${central.rateText}`
      : 'Configure el T/C en Configuración → Moneda';
  }

  const note = document.getElementById('cc-central-fx-note');
  if (note) {
    note.textContent = central.hasExchangeRate
      ? `Fuente: Configuración → Moneda · ${central.rateText}`
      : 'Configure el T/C en Configuración → Moneda';
    note.classList.toggle('is-ok', central.hasExchangeRate);
    note.classList.toggle('is-warn', !central.hasExchangeRate);
  }

  const updated = document.getElementById('cc-currency-updated-at');
  if (updated) updated.textContent = central.updatedAtDisplay || 'Sin registros';

  return central;
}

function ccReadFxRate() {
  return ccGetCentralFxRate();
}

function ccGetLastSavedFxRate(snap = ccSnapshot) {
  if (!snap || typeof snap !== 'object') return null;
  return ccCoerceFxRate(
    snap.fxRateDraft ?? (snap.consolidated ? snap.consolidated.fxRateUsed : null)
  );
}

function ccGetFxRateForSave() {
  // Etapa 7/9 Moneda: Caja Chica ya no decide su propio T/C.
  // La única fuente válida para nuevas consolidaciones es Configuración → Moneda.
  return ccGetCentralFxRate();
}

function ccSetFxInputFromSnapshot(overwrite = false) {
  // Nombre conservado por compatibilidad interna; ahora sincroniza la UI con Moneda central.
  ccUpdateCentralCurrencyReference();
}

function ccUpdateConsolidatedSummary() {
  const snap = ccSnapshot || ccBuildEmptySnapshot();
  const con = (snap.consolidated && typeof snap.consolidated === 'object')
    ? snap.consolidated
    : ccBuildEmptyConsolidated();
  const central = ccUpdateCentralCurrencyReference();

  ccSetText('cc-summary-nio', ccFormatNIO(con.totalNio || 0));
  ccSetText('cc-summary-usd', ccFormatUSD(con.totalUsd || 0));

  const fxUsed = Number(con.fxRateUsed);
  const eqNio = Number(con.equivalentNio);
  const eqUsd = Number(con.equivalentUsd);
  const fxSource = document.getElementById('cc-summary-fx-source');

  if (Number.isFinite(fxUsed) && fxUsed > 0 && Number.isFinite(eqNio) && Number.isFinite(eqUsd)) {
    ccSetText('cc-summary-eq-nio', ccFormatNIO(eqNio));
    ccSetText('cc-summary-eq-usd', ccFormatUSD(eqUsd));
    ccSetText('cc-summary-fx-used', fxUsed.toFixed(2));
    if (fxSource) {
      const sameAsCentral = central && central.hasExchangeRate && Math.abs(Number(central.rate) - fxUsed) < 0.005;
      fxSource.textContent = sameAsCentral
        ? 'Fuente: Configuración → Moneda'
        : (central && central.hasExchangeRate
          ? `Último consolidado; T/C central actual ${central.rate.toFixed(2)}`
          : 'Último consolidado; falta T/C central');
      fxSource.classList.toggle('is-ok', sameAsCentral);
      fxSource.classList.toggle('is-warn', !sameAsCentral);
    }
  } else {
    ccSetText('cc-summary-eq-nio', '—');
    ccSetText('cc-summary-eq-usd', '—');
    ccSetText('cc-summary-fx-used', '—');
    if (fxSource) {
      fxSource.textContent = central && central.hasExchangeRate
        ? 'Listo para consolidar desde Moneda al guardar.'
        : 'Configure el T/C en Configuración → Moneda';
      fxSource.classList.toggle('is-ok', !!(central && central.hasExchangeRate));
      fxSource.classList.toggle('is-warn', !(central && central.hasExchangeRate));
    }
  }

  ccSetText('cc-summary-last-update', con.updatedAtDisplay || 'Sin actualizar');
}

function ccBuildConsolidatedFromCurrent(now, fxRate) {
  const snap = ccSnapshot || ccBuildEmptySnapshot();
  const nioTotal = ccRound2(ccComputeCurrencyTotal('NIO', snap));
  const usdTotal = ccRound2(ccComputeCurrencyTotal('USD', snap));
  const stamp = now instanceof Date ? now : new Date();
  const used = Number(fxRate);

  const out = {
    totalNio: nioTotal,
    totalUsd: usdTotal,
    equivalentNio: null,
    equivalentUsd: null,
    fxRateUsed: null,
    updatedAtISO: stamp.toISOString(),
    updatedAtDisplay: fmtDDMMYYYYHHMM(stamp)
  };

  if (Number.isFinite(used) && used > 0) {
    out.fxRateUsed = ccRound2(used);
    out.equivalentNio = ccRound2(nioTotal + (usdTotal * used));
    out.equivalentUsd = ccRound2(usdTotal + (nioTotal / used));
  }

  return out;
}

function ccNormalizeFxInputDisplay() {
  ccUpdateCentralCurrencyReference();
}

function ccSnapshotStamp(snap) {
  if (!snap || typeof snap !== 'object') return 0;
  const con = (snap.consolidated && typeof snap.consolidated === 'object') ? snap.consolidated : null;
  const raw = (con && con.updatedAtISO) || snap.updatedAtISO || '';
  const t = raw ? Date.parse(raw) : 0;
  return Number.isFinite(t) ? t : 0;
}

function ccSnapshotHasData(snap) {
  if (!snap || typeof snap !== 'object') return false;
  const nio = Number(snap.currencies && snap.currencies.NIO ? snap.currencies.NIO.total : 0);
  const usd = Number(snap.currencies && snap.currencies.USD ? snap.currencies.USD.total : 0);
  const con = (snap.consolidated && typeof snap.consolidated === 'object') ? snap.consolidated : null;
  const conNio = Number(con ? con.totalNio : 0);
  const conUsd = Number(con ? con.totalUsd : 0);
  return !!(
    (Number.isFinite(nio) && nio > 0) ||
    (Number.isFinite(usd) && usd > 0) ||
    (Number.isFinite(conNio) && conNio > 0) ||
    (Number.isFinite(conUsd) && conUsd > 0) ||
    ccGetLastSavedFxRate(snap) ||
    (snap.updatedAtISO || snap.updatedAtDisplay)
  );
}

function ccPickNewestSnapshot(a, b) {
  if (!a) return b || ccBuildEmptySnapshot();
  if (!b) return a;

  const at = ccSnapshotStamp(a);
  const bt = ccSnapshotStamp(b);
  if (bt !== at) return bt > at ? b : a;

  const ah = ccSnapshotHasData(a);
  const bh = ccSnapshotHasData(b);
  if (bh && !ah) return b;
  return a;
}

async function ccLoadSnapshot() {
  let fromLS = null;
  try {
    const raw = localStorage.getItem(CC_STORAGE_KEY);
    const parsed = raw ? ccSafeParseJSON(raw) : null;
    fromLS = parsed ? ccNormalizeSnapshot(parsed) : null;
  } catch (_) {
    fromLS = null;
  }

  let fromDB = null;
  try {
    const rec = await finGet('settings', CC_STORAGE_KEY);
    const data = rec && rec.data ? rec.data : null;
    fromDB = data ? ccNormalizeSnapshot(data) : null;
  } catch (_) {
    fromDB = null;
  }

  ccSnapshot = ccPickNewestSnapshot(fromLS, fromDB);
  try { localStorage.setItem(CC_STORAGE_KEY, JSON.stringify(ccSnapshot)); } catch (_) {}
  return ccSnapshot;
}

function ccUpdateTotal() {
  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();
  const cur = ccSnapshot.currencies[ccCurrency];
  cur.total = ccComputeCurrencyTotal(ccCurrency, ccSnapshot);

  const tbody = document.getElementById('cc-tbody');
  if (tbody) {
    const byId = new Map((cur.denoms || []).map(d => [String(d.id), d]));
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((tr) => {
      const denomId = String(tr.dataset.denomId || '');
      const denom = byId.get(denomId);
      const tdSub = tr.querySelector('td.num');
      if (!denom || !tdSub) return;
      const sub = ((denom.count == null) ? 0 : denom.count) * Number(denom.value || 0);
      tdSub.textContent = fmtCurrency(sub);
    });
  }

  const totalEl = document.getElementById('cc-total-value');
  if (totalEl) totalEl.textContent = fmtCurrency(cur.total || 0);
}

function ccRenderCurrency() {
  const tbody = document.getElementById('cc-tbody');
  if (!tbody) return;

  const snap = ccSnapshot || ccBuildEmptySnapshot();
  const cur = snap.currencies[ccCurrency] || { denoms: [], total: 0 };
  const prefix = ccCurrency === 'USD' ? 'US$' : 'C$';

  document.querySelectorAll('.cc-tab').forEach(b => {
    const isActive = b.dataset.currency === ccCurrency;
    b.classList.toggle('active', isActive);
    b.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  const totalPrefix = document.getElementById('cc-total-prefix');
  if (totalPrefix) totalPrefix.textContent = prefix;

  const totalLabel = document.getElementById('cc-total-label');
  if (totalLabel) totalLabel.textContent = (ccCurrency === 'USD') ? 'Total USD' : 'Total C$';

  const upd = document.getElementById('cc-updated');
  if (upd) upd.textContent = snap.updatedAtDisplay ? `Actualizado: ${snap.updatedAtDisplay}` : 'Actualizado: —';

  tbody.innerHTML = '';

  for (const d of cur.denoms) {
    const isLegacy10Coin = (ccCurrency === 'NIO' && String(d.id) === '10_coin');
    const legacyCount = (d.count == null) ? 0 : Number(d.count || 0);
    const showLegacy = isLegacy10Coin && legacyCount > 0;

    // UI: eliminar captura de Moneda C$10. Solo mostrar si existe histórico > 0 (read-only).
    if (isLegacy10Coin && !showLegacy) continue;

    const tr = document.createElement('tr');
    tr.dataset.denomId = String(d.id || '');

    const tdDen = document.createElement('td');
    tdDen.className = 'cc-denom';
    const main = document.createElement('span');
    main.textContent = isLegacy10Coin ? `${prefix} ${d.value} (Histórico)` : `${prefix} ${d.value}`;
    tdDen.appendChild(main);

    if (!isLegacy10Coin && d.chip) {
      const chip = document.createElement('span');
      chip.className = 'cc-chip';
      chip.textContent = d.chip;
      tdDen.appendChild(chip);
    }

    const tdQty = document.createElement('td');

    if (isLegacy10Coin) {
      const ro = document.createElement('input');
      ro.type = 'number';
      ro.inputMode = 'numeric';
      ro.min = '0';
      ro.step = '1';
      ro.disabled = true;
      ro.className = 'a33-num cc-ro';
      ro.value = String(Math.trunc(legacyCount));
      ro.setAttribute('aria-label', 'Cantidad (Histórico)');
      tdQty.appendChild(ro);
    } else {
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.inputMode = 'numeric';
      inp.min = '0';
      inp.step = '1';
      inp.className = 'a33-num';
      inp.dataset.a33Default = '';
      inp.id = `cc-q-${ccCurrency}-${d.id}`;
      inp.value = (d.count == null) ? '' : String(d.count);

      // UX: vacío se mantiene vacío; si hay valor, seleccionar todo al click/focus.
      inp.addEventListener('focus', ()=>{
        if (String(inp.value ?? '') === '') return;
        try{ setTimeout(()=>inp.select(), 0); }catch(e){}
      });
      inp.addEventListener('click', ()=>{
        if (String(inp.value ?? '') === '') return;
        try{ inp.select(); }catch(e){}
      });

      inp.addEventListener('input', () => {
        const raw = String(inp.value ?? '').trim();
        const n = raw === '' ? null : Number(raw);
        d.count = (Number.isFinite(n) && n >= 0) ? Math.trunc(n) : null;
        ccUpdateTotal();
        ccSetMsg('');
      });

      tdQty.appendChild(inp);
    }

    const tdSub = document.createElement('td');
    tdSub.className = 'num';
    const sub = ((d.count == null) ? 0 : d.count) * Number(d.value || 0);
    tdSub.textContent = fmtCurrency(sub);

    tr.appendChild(tdDen);
    tr.appendChild(tdQty);
    tr.appendChild(tdSub);
    tbody.appendChild(tr);
  }

  ccUpdateTotal();
  ccUpdateConsolidatedSummary();
}

async function ccSaveSnapshot() {
  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();
  ccSnapshot.currencies.NIO.total = ccComputeCurrencyTotal('NIO', ccSnapshot);
  ccSnapshot.currencies.USD.total = ccComputeCurrencyTotal('USD', ccSnapshot);

  const now = new Date();
  const fxRate = ccGetFxRateForSave();
  const previousConsolidated = (ccSnapshot.consolidated && typeof ccSnapshot.consolidated === 'object')
    ? ccSnapshot.consolidated
    : ccBuildEmptyConsolidated();
  ccUpdateCentralCurrencyReference();
  ccSnapshot.fxRateDraft = fxRate ? ccRound2(fxRate) : null;

  ccSnapshot.updatedAtISO = now.toISOString();
  ccSnapshot.updatedAtDisplay = fmtDDMMYYYYHHMM(now);
  ccSnapshot.consolidated = fxRate
    ? ccBuildConsolidatedFromCurrent(now, fxRate)
    : previousConsolidated;

  try {
    await finPut('settings', { id: CC_STORAGE_KEY, data: ccSnapshot });
  } catch (err) {
  }

  try {
    localStorage.setItem(CC_STORAGE_KEY, JSON.stringify(ccSnapshot));
  } catch (_) {}

  const upd = document.getElementById('cc-updated');
  if (upd) upd.textContent = `Actualizado: ${ccSnapshot.updatedAtDisplay}`;
  ccUpdateConsolidatedSummary();

  showToast('Caja Chica guardada');
  if (fxRate) {
    ccSetMsg(`Guardado: ${ccSnapshot.updatedAtDisplay} · T/C desde Moneda ${fxRate.toFixed(2)}`);
  } else {
    ccSetMsg(`Guardado: ${ccSnapshot.updatedAtDisplay} · consolidado no recalculado; configure el T/C en Configuración → Moneda`);
  }
}

function ccResetCountsOnly() {
  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();

  (['NIO', 'USD']).forEach(code => {
    const cur = ccSnapshot.currencies && ccSnapshot.currencies[code];
    if (!cur || !Array.isArray(cur.denoms)) return;
    cur.denoms.forEach(d => { d.count = null; });
    cur.total = 0;
  });
}

function ccReset() {
  const ok = confirm('Reset a cero: esto borrara los conteos actuales (solo informativo).');
  if (!ok) return;

  const centralFx = ccGetFxRateForSave();
  const currentConsolidated = (ccSnapshot && ccSnapshot.consolidated)
    ? ccSnapshot.consolidated
    : ccBuildEmptyConsolidated();
  const currentUpdatedAtISO = ccSnapshot ? (ccSnapshot.updatedAtISO || '') : '';
  const currentUpdatedAtDisplay = ccSnapshot ? (ccSnapshot.updatedAtDisplay || '') : '';

  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();
  ccResetCountsOnly();
  ccSnapshot.consolidated = currentConsolidated;
  ccSnapshot.updatedAtISO = currentUpdatedAtISO;
  ccSnapshot.updatedAtDisplay = currentUpdatedAtDisplay;
  ccSnapshot.fxRateDraft = centralFx ? ccRound2(centralFx) : null;

  ccUpdateCentralCurrencyReference();
  ccRenderCurrency();
  ccSetMsg('Reset a cero listo · presiona Guardar');
}

function setupCajaChicaUI() {
  document.querySelectorAll('.cc-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.currency;
      if (!c) return;
      ccCurrency = c;
      ccRenderCurrency();
    });
  });

  const btnSave = document.getElementById('cc-save');
  if (btnSave) btnSave.addEventListener('click', (e) => { e.preventDefault(); ccSaveSnapshot(); });

  const btnReset = document.getElementById('cc-reset');
  if (btnReset) btnReset.addEventListener('click', (e) => { e.preventDefault(); ccReset(); });

  const btnRecalc = document.getElementById('cc-recalc');
  if (btnRecalc) btnRecalc.addEventListener('click', async (e) => {
    e.preventDefault();
    await ccLoadSnapshot();
    ccSetFxInputFromSnapshot(true);
    ccRenderCurrency();
    ccSetMsg('Refrescado');
  });

  const fxInput = document.getElementById('cc-fx-rate');
  if (fxInput) {
    fxInput.readOnly = true;
    fxInput.disabled = true;
    fxInput.addEventListener('blur', ccNormalizeFxInputDisplay);
  }

  try {
    window.addEventListener('storage', (ev) => {
      const key = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
      if (!ev || ev.key !== key) return;
      ccUpdateCentralCurrencyReference();
      ccUpdateConsolidatedSummary();
      ccSetMsg('T/C central actualizado desde Moneda.');
    });
  } catch (_) {}
}

function normStr(s, maxLen = 200) {
  const out = (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
  const ml = Number(maxLen);
  if (Number.isFinite(ml) && ml > 0 && out.length > ml) return out.slice(0, ml);
  return out;
}


function isCentralEventName(ev) {
  const v = (ev || '').toString().trim().toUpperCase();
  return v === 'CENTRAL' || v === 'GENERAL';
}

function displayEventLabel(ev) {
  if (!ev) return '';
  return isCentralEventName(ev) ? 'Central' : ev;
}

// --- Compatibilidad: Evento vs Referencia (sin migración destructiva) ---
// Históricos: el campo "evento" se usó como factura/referencia.
// Nuevos: guardan reference + eventScope.

function getDisplayReference(mov) {
  if (!mov || typeof mov !== 'object') return '';

  // POS cierres diarios: no mostrar closureId como referencia. Mostrar la fecha del cierre.
  const src = (mov.source || '').toString().trim();
  if (src === 'POS_DAILY_CLOSE' || src === 'POS_DAILY_CLOSE_REVERSAL') {
    const dk = (mov.dateKey ?? mov.date_key ?? '').toString().trim();
    if (dk) return dk.slice(0, 10);
    const f = (mov.fecha || mov.date || '').toString().slice(0, 10);
    if (f) return f;
    return '';
  }

  const ref = (mov.reference ?? mov.referencia ?? '').toString().trim();
  if (ref) return ref;

  // Fallback histórico: SOLO si no proviene del POS.
  const origen = (mov.origen ?? mov.origin ?? '').toString().trim().toUpperCase();
  if (origen === 'POS') return '';

  // Entradas de compra usan "evento" para Central; no interpretarlo como referencia.
  const entryType = (mov.entryType || '').toString().trim().toLowerCase();
  if (entryType === 'purchase') return '';

  const legacy = (mov.event ?? mov.evento ?? '').toString().trim();
  if (!legacy) return '';
  if (isCentralEventName(legacy)) return '';
  return legacy;
}


function getDisplayEventLabel(mov) {
  if (!mov || typeof mov !== 'object') return 'Central';

  const scope = (mov.eventScope ?? mov.event_scope ?? '').toString().trim().toUpperCase();
  const origen = (mov.origen ?? mov.origin ?? '').toString().trim().toUpperCase();

  // POS: intentar resolver el nombre live (lookup por posEventId). Fallback a snapshot.
  if (scope === 'POS' || (!scope && origen === 'POS')) {
    const posId = mov.posEventId ?? mov.pos_event_id ?? mov.eventId ?? mov.posEventID ?? null;

    const snap = (mov.posEventNameSnapshot ?? mov.posEventName ?? mov.posEventSnapshot ?? mov.eventName ?? '').toString().trim();
    // Compatibilidad: POS antiguos pudieron guardar el nombre del evento en "evento".
    const legacyEv = (mov.posEventNameLegacy ?? mov.evento ?? mov.event ?? '').toString().trim();

    // Si hay ID, usamos live->snapshot->legacy.
    if (posId != null && String(posId).trim() !== '') {
      return getPosEventNameSnapshotById(posId, snap || legacyEv);
    }

    // Si no hay ID, no hay lookup live: usa snapshot/legacy.
    return snap || legacyEv || 'Evento POS';
  }

  return 'Central';
}

function makePill(text, variant) {
  const v = variant ? ` fin-pill--${variant}` : '';
  return `<span class="fin-pill${v}">${escapeHtml(text)}</span>`;
}

function updateDiaryIntegrityBanner(data) {
  const banner = document.getElementById('diario-integrity-banner');
  if (!banner) return;

  const integ = data && data.journalIntegrity ? data.journalIntegrity : null;
  const missing = integ ? Number(integ.entriesWithoutLinesCount || 0) : 0;
  const orphan = integ ? Number(integ.orphanLinesCount || 0) : 0;

  if (!(missing > 0 || orphan > 0)) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }

  const parts = [];
  if (missing > 0) parts.push(`Asientos sin líneas: ${missing}`);
  if (orphan > 0) parts.push(`Líneas huérfanas: ${orphan}`);

  const ids = (integ && Array.isArray(integ.entriesWithoutLinesIds)) ? integ.entriesWithoutLinesIds : [];
  const idsSample = ids.slice(0, 6).join(', ');
  const idsTail = ids.length > 6 ? '…' : '';
  const idsText = idsSample ? ` · IDs: ${idsSample}${idsTail}` : '';

  banner.classList.remove('hidden');
  banner.innerHTML = `${makePill('Inconsistente', 'red')} <strong>Integridad del Diario:</strong> ${escapeHtml(parts.join(' · '))}${escapeHtml(idsText)}. <span class="fin-muted">No se borró nada.</span>`;
}

function normalizeEventForPurchases() {
  return CENTRAL_EVENT;
}

/* ---------- Proveedores: normalización (modelo productos por proveedor) ---------- */

function normNumNonNeg(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return (Number.isFinite(n) && n >= 0) ? n : 0;
}

function normStrKeep(v, maxLen = 120) {
  const s = (v == null) ? '' : String(v);
  const out = s.trim();
  const ml = Number(maxLen);
  if (Number.isFinite(ml) && ml > 0 && out.length > ml) return out.slice(0, ml);
  return out;
}

function normBool01(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return (s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes');
}

function normalizeProductType(v) {
  const t = normStrKeep(v, 24).toUpperCase();
  if (!t) return '—';
  return (t === 'CAJAS' || t === 'UNIDADES') ? t : '—';
}

function normalizeSupplierProduct(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};

  // Importante: distinguir "precio vacío" (no set) vs "precio=0" real.
  // - Nuevos registros guardan precioSet.
  // - Históricos sin precioSet: si precio es 0 asumimos "no set" (evita 0 fantasma en UI).
  const precioRaw = obj.precio;
  const precioStr = (precioRaw == null) ? '' : String(precioRaw).trim();
  const hasFlag = Object.prototype.hasOwnProperty.call(obj, 'precioSet');
  const precioSet = hasFlag ? normBool01(obj.precioSet) : ((precioStr !== '') && (normNumNonNeg(precioRaw) !== 0));
  const unidadesRaw = (obj.unidadesPorCaja != null)
    ? obj.unidadesPorCaja
    : ((obj.supplierProductUnitsPerBox != null)
      ? obj.supplierProductUnitsPerBox
      : ((obj.supplierProductUnitsPerCaja != null)
        ? obj.supplierProductUnitsPerCaja
        : ((obj.unitsPerBox != null) ? obj.unitsPerBox : obj.unidadesCaja)));

  return {
    id: normStrKeep(obj.id, 80),
    nombre: normStrKeep(obj.nombre, 120),
    tipo: normalizeProductType(obj.tipo),
    precio: normNumNonNeg(obj.precio),
    precioSet,
    unidadesPorCaja: normNumNonNeg(unidadesRaw)
  };
}

function normalizeSupplier(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const productosRaw = Array.isArray(obj.productos) ? obj.productos : [];
  const productos = productosRaw.map(normalizeSupplierProduct);
  return {
    ...obj,
    id: obj.id,
    nombre: normStrKeep(obj.nombre, 120),
    telefono: normStrKeep(obj.telefono, 80),
    nota: normStrKeep(obj.nota, 220),
    productos
  };
}

function getSupplierLabelFromEntry(entry, data) {
  if (!entry) return '—';
  const name = (entry.supplierName || '').toString().trim();
  if (name) return name;
  const id = entry.supplierId;
  if (id != null && data && data.suppliersMap) {
    const s = data.suppliersMap.get(Number(id));
    if (s && s.nombre) return s.nombre;
  }
  return '—';
}

function finIsSupplierAvailableForNewPurchases(s) {
  if (!s || typeof s !== 'object') return false;
  if (s.deleted === true || s.isDeleted === true || s.removed === true) return false;
  if (s.active === false || s.isActive === false || s.enabled === false) return false;
  const estado = String(s.estado || s.status || '').trim().toLowerCase();
  if (['inactivo', 'inactive', 'eliminado', 'deleted', 'borrado', 'archivado', 'archived'].includes(estado)) return false;
  if (String(s.deletedAt || s.removedAt || '').trim()) return false;
  return true;
}

function finSupplierVisualDedupeKey(s) {
  const name = normStrKeep(s && s.nombre, 120).toLowerCase();
  if (!name) return '';
  const tel = normStrKeep(s && s.telefono, 80).toLowerCase();
  return `${name}|${tel}`;
}

function finSupplierRichnessScore(s) {
  if (!s || typeof s !== 'object') return 0;
  let score = 0;
  if (String(s.telefono || '').trim()) score += 1;
  if (String(s.nota || '').trim()) score += 1;
  if (Array.isArray(s.productos)) score += Math.min(50, s.productos.length * 3);
  if (finIsSupplierAvailableForNewPurchases(s)) score += 100;
  return score;
}

function finGetSuppliersForNewPurchases(data) {
  const raw = (data && Array.isArray(data.suppliers)) ? data.suppliers : [];
  const chosen = new Map();
  const loose = [];
  for (const s of raw) {
    if (!finIsSupplierAvailableForNewPurchases(s)) continue;
    const key = finSupplierVisualDedupeKey(s);
    if (!key) {
      loose.push(s);
      continue;
    }
    const prev = chosen.get(key);
    if (!prev || finSupplierRichnessScore(s) > finSupplierRichnessScore(prev)) chosen.set(key, s);
  }
  return [...chosen.values(), ...loose].sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
}

/* ---------- Cuentas: display name por lookup (compatibilidad con históricos) ---------- */

function getLineAccountSnapshotName(line) {
  if (!line || typeof line !== 'object') return '';

  // Campos comunes en históricos / importaciones antiguas (si existieran)
  const candidates = [
    line.accountName,
    line.accountNombre,
    line.nombreCuenta,
    line.cuentaNombre,
    line.account_name,
    line.account_nombre,
    line.nombre,
    line.name
  ];

  for (const c of candidates) {
    const v = (c != null) ? String(c).trim() : '';
    if (v) return v;
  }

  // Algunos formatos guardan un objeto cuenta embebido
  const embedded = line.account || line.cuenta || null;
  if (embedded && typeof embedded === 'object') {
    const v = String(embedded.nombre || embedded.name || '').trim();
    if (v) return v;
  }

  return '';
}

function getAccountDisplayNameByCode(code, accountsMap, lineForFallback) {
  const c = String(code ?? '').trim();
  const acc = (accountsMap && typeof accountsMap.get === 'function') ? accountsMap.get(c) : null;
  if (acc) {
    const nm = String(acc.nombre || acc.name || '').trim();
    if (nm) return nm;
    return `Cuenta ${String(acc.code ?? c)}`;
  }

  const snap = getLineAccountSnapshotName(lineForFallback);
  if (snap) return snap;

  return c ? `Cuenta desconocida (${c})` : 'Cuenta desconocida';
}


/* ---------- Carga y estructura de datos ---------- */

async function getAllFinData() {
  await openFinDB();
  const [accounts, entries, lines, financialAccounts, internalTransfers, receipts, posSources] = await Promise.all([
    finGetAll('accounts'),
    finGetAll('journalEntries'),
    finGetAll('journalLines'),
    finGetAll('financialAccounts').catch(() => []),
    finGetAll('internalTransfers').catch(() => []),
    finGetAll('receipts').catch(() => []),
    finReadPosOperationalSourcesSafe().catch(() => ({ sales: [], events: [], banks: [], dailyClosures: [], cashV2: [], warnings: ['No se pudieron leer fuentes POS'] }))
  ]);

  let suppliers = [];
  try {
    // Catálogos → Proveedores administra este store; Finanzas solo lo lee/consume.
    suppliers = await finGetAll('suppliers');
  } catch (err) {
    suppliers = [];
  }

  // Normalización suave: soporta proveedores sin `productos` y evita crashes.
  suppliers = (Array.isArray(suppliers) ? suppliers : []).map(normalizeSupplier);

  const accountsMap = new Map();
  for (const acc of accounts) {
    accountsMap.set(String(acc.code), acc);
  }

  

  const suppliersMap = new Map();
  for (const s of suppliers) {
    suppliersMap.set(Number(s.id), s);
  }
  const normalizeId = (v) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) ? n : null;
  };

  const entryIdSet = new Set();
  for (const e of (Array.isArray(entries) ? entries : [])) {
    const id = normalizeId(e && e.id);
    if (id) entryIdSet.add(id);
  }

  const linesByEntry = new Map();
  let orphanLinesCount = 0;
  const orphanLinesSample = [];

  for (const ln of (Array.isArray(lines) ? lines : [])) {
    const idEntry = normalizeId(ln && ln.idEntry);
    if (!idEntry || !entryIdSet.has(idEntry)) {
      orphanLinesCount++;
      if (orphanLinesSample.length < 5) {
        orphanLinesSample.push({
          id: (ln && ln.id) ?? null,
          idEntry: (ln && ln.idEntry) ?? null,
          accountCode: (ln && ln.accountCode) ?? '',
          debe: (ln && ln.debe) ?? 0,
          haber: (ln && ln.haber) ?? 0
        });
      }
      continue;
    }

    if (!linesByEntry.has(idEntry)) linesByEntry.set(idEntry, []);
    linesByEntry.get(idEntry).push(ln);
  }

  const entriesWithoutLinesIds = [];
  const entriesWithoutLinesSample = [];

  for (const e of (Array.isArray(entries) ? entries : [])) {
    const id = normalizeId(e && e.id);
    if (!id) continue;
    const arr = linesByEntry.get(id);
    if (!arr || arr.length === 0) {
      entriesWithoutLinesIds.push(id);
      if (entriesWithoutLinesSample.length < 5) {
        entriesWithoutLinesSample.push({
          id,
          fecha: (e && (e.fecha || e.date)) ? String(e.fecha || e.date) : '',
          descripcion: (typeof getDisplayDescription === 'function') ? (getDisplayDescription(e) || '') : (String(e.descripcion || '')),
          origen: String(e && (e.origen || e.source || ''))
        });
      }
    }
  }

  const journalIntegrity = {
    checkedAt: Date.now(),
    entriesWithoutLinesCount: entriesWithoutLinesIds.length,
    entriesWithoutLinesIds,
    entriesWithoutLinesSample,
    orphanLinesCount,
    orphanLinesSample
  };

  const inconsistentEntryIds = new Set(entriesWithoutLinesIds);

  return {
    accounts,
    accountsMap,
    entries,
    lines,
    linesByEntry,
    suppliers,
    suppliersMap,
    financialAccounts: Array.isArray(financialAccounts) ? financialAccounts : [],
    internalTransfers: Array.isArray(internalTransfers) ? internalTransfers : [],
    receipts: Array.isArray(receipts) ? receipts : [],
    posSources: posSources || { sales: [], events: [], banks: [], dailyClosures: [], cashV2: [], warnings: [] },
    posSales: Array.isArray(posSources && posSources.sales) ? posSources.sales : [],
    posEvents: Array.isArray(posSources && posSources.events) ? posSources.events : [],
    posBanks: Array.isArray(posSources && posSources.banks) ? posSources.banks : [],
    posDailyClosures: Array.isArray(posSources && posSources.dailyClosures) ? posSources.dailyClosures : [],
    posCashV2: Array.isArray(posSources && posSources.cashV2) ? posSources.cashV2 : [],
    journalIntegrity,
    inconsistentEntryIds,
    operationalDashboardSources: finBuildOperationalDashboardSourceSnapshot({
      entries,
      lines,
      receipts,
      financialAccounts,
      internalTransfers,
      posCashV2: Array.isArray(posSources && posSources.cashV2) ? posSources.cashV2 : []
    })
  };
}

function finDashboardAddEventOption(map, value, label, sortLabel) {
  const val = String(value || '').trim();
  const lab = String(label || '').trim();
  if (!val || !lab) return;
  if (isCentralEventName(lab)) return;
  if (!map.has(val)) map.set(val, { value: val, label: lab, sortLabel: String(sortLabel || lab).trim() });
}

function buildEventList(dataOrEntries) {
  const map = new Map();
  const isData = dataOrEntries && !Array.isArray(dataOrEntries) && typeof dataOrEntries === 'object';
  const entries = isData ? (Array.isArray(dataOrEntries.entries) ? dataOrEntries.entries : []) : (Array.isArray(dataOrEntries) ? dataOrEntries : []);
  const posEvents = isData ? (Array.isArray(dataOrEntries.posEvents) ? dataOrEntries.posEvents : []) : [];
  const posSales = isData ? (Array.isArray(dataOrEntries.posSales) ? dataOrEntries.posSales : []) : [];
  const posClosures = isData ? (Array.isArray(dataOrEntries.posDailyClosures) ? dataOrEntries.posDailyClosures : []) : [];
  const posCashRows = isData ? (Array.isArray(dataOrEntries.posCashV2) ? dataOrEntries.posCashV2 : []) : [];
  const receipts = isData ? (Array.isArray(dataOrEntries.receipts) ? dataOrEntries.receipts : []) : [];

  for (const ev of posEvents) {
    if (!ev) continue;
    const idRaw = ev.id;
    const id = (typeof idRaw === 'number') ? idRaw : parseInt(String(idRaw || '').trim(), 10);
    const name = String(ev.name || ev.nombre || '').trim();
    if (id && name) finDashboardAddEventOption(map, `POS:${id}`, name, name);
  }

  for (const s of posSales) {
    if (!s) continue;
    const id = (typeof s.eventId === 'number') ? s.eventId : parseInt(String(s.eventId || '').trim(), 10);
    const name = String(s.eventName || s.eventNameSnapshot || s.posEventNameSnapshot || '').trim() || getPosEventNameLiveById(id);
    if (id && name) finDashboardAddEventOption(map, `POS:${id}`, name, name);
  }

  for (const c of posClosures) {
    if (!c) continue;
    const id = (typeof c.eventId === 'number') ? c.eventId : parseInt(String(c.eventId || '').trim(), 10);
    const name = String(c.eventNameSnapshot || c.eventName || c.posEventNameSnapshot || '').trim() || getPosEventNameLiveById(id);
    if (id && name) finDashboardAddEventOption(map, `POS:${id}`, name, name);
  }

  for (const rec of posCashRows) {
    if (!rec) continue;
    const id = (typeof rec.eventId === 'number') ? rec.eventId : parseInt(String(rec.eventId || rec.posEventId || '').trim(), 10);
    const name = getPosEventNameLiveById(id) || String(rec.eventName || rec.eventNameSnapshot || '').trim();
    if (id && name) finDashboardAddEventOption(map, `POS:${id}`, name, name);
  }

  for (const r of receipts) {
    if (!r) continue;
    const id = (typeof r.posEventId === 'number') ? r.posEventId : parseInt(String(r.posEventId || '').trim(), 10);
    const name = String(r.eventScope || r.evento || r.eventNameSnapshot || '').trim() || getPosEventNameLiveById(id);
    if (id) finDashboardAddEventOption(map, `POS:${id}`, name || `Evento POS (${id})`, name || `Evento POS (${id})`);
    else if (name) finDashboardAddEventOption(map, name, displayEventLabel(name), name);
  }

  for (const e of entries) {
    if (!e) continue;
    const id = (typeof e.posEventId === 'number') ? e.posEventId : parseInt(String(e.posEventId || '').trim(), 10);
    const posName = String(e.posEventNameSnapshot || e.eventNameSnapshot || '').trim() || getPosEventNameLiveById(id);
    if (id) finDashboardAddEventOption(map, `POS:${id}`, posName || `Evento POS (${id})`, posName || `Evento POS (${id})`);
    const name = getDisplayEventLabel(e);
    if (name) finDashboardAddEventOption(map, name, name, name);
  }

  return Array.from(map.values()).sort((a, b) => String(a.sortLabel || a.label).localeCompare(String(b.sortLabel || b.label), 'es'));
}

function matchEvent(entry, eventFilter) {
  const rawFilter = String(eventFilter || '').trim();
  if (!rawFilter || rawFilter === 'ALL' || rawFilter === 'GLOBAL') return true;
  if (rawFilter === 'NONE') return !getDisplayEventLabel(entry) && !(entry && entry.posEventId);
  if (rawFilter.startsWith('POS:')) {
    const id = rawFilter.slice(4);
    if (String(entry && entry.posEventId || '') === id) return true;
    const live = getPosEventNameLiveById(id);
    const evLabel = getDisplayEventLabel(entry);
    return !!(live && evLabel && normStr(evLabel) === normStr(live));
  }
  const evLabel = getDisplayEventLabel(entry);
  const f = displayEventLabel(rawFilter);
  return evLabel === f;
}

function filterEntriesByDateAndEvent(entries, { desde, hasta, evento }) {
  return entries.filter(e => {
    const f = e.fecha || e.date || '';
    if (desde && f < desde) return false;
    if (hasta && f > hasta) return false;
    if (!matchEvent(e, evento)) return false;
    return true;
  });
}

/* ---------- Cálculos: resultados y balances ---------- */

function calcResultadosForFilter(data, filtros) {
  const { accountsMap, entries, linesByEntry } = data;
  const subset = filterEntriesByDateAndEvent(entries, filtros);

  let ingresos = 0;
  let costos = 0;
  let gastos = 0;

  for (const e of subset) {
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'ingreso') {
        ingresos += (haber - debe);
      } else if (tipo === 'costo') {
        costos += (debe - haber);
      } else if (tipo === 'gasto') {
        gastos += (debe - haber);
      }
    }
  }

  return { ingresos, costos, gastos };
}


// Total de cortesías provenientes del POS.
// Compatibilidad: antes se leía 6105; ahora también respeta el snapshot de cuenta posteable usado por cada cierre.
function calcCortesiasPos6105ForFilter(data, filtros) {
  const entriesInRange = filterEntriesByDateAndEvent(data?.entries || [], filtros);
  const allowedByEntry = new Map();

  for (const e of entriesInRange) {
    const src = String(e?.source || '');
    if (src === POS_DAILY_CLOSE_SOURCE || src === POS_DAILY_CLOSE_REVERSAL_SOURCE) {
      const id = Number(e?.id || 0);
      if (!id) continue;
      const code = finNormalizeAccountCode(e?.cortesia?.expenseAccountCode || e?.posCosts?.courtesyAccountCode || '6105');
      allowedByEntry.set(id, code || '6105');
    }
  }

  if (!allowedByEntry.size) return 0;

  let sum = 0;
  for (const ln of (data?.lines || [])) {
    if (!ln) continue;
    const eid = Number(ln.idEntry || 0);
    if (!allowedByEntry.has(eid)) continue;
    const expected = allowedByEntry.get(eid);
    const lineCode = finNormalizeAccountCode(ln.accountCode);
    if (lineCode !== expected && lineCode !== '6105') continue;
    sum += (n0(ln.debe) - n0(ln.haber));
  }
  return n2(sum);
}


// Agrupa por evento en un rango de fechas
function calcResultadosByEventInRange(data, desde, hasta) {
  const { accountsMap, entries, linesByEntry } = data;
  const map = new Map(); // key: nombreEvento, value: {ingresos, costos, gastos}

  for (const e of entries) {
    const f = e.fecha || e.date || '';
    if (desde && f < desde) continue;
    if (hasta && f > hasta) continue;

    const eventName = getDisplayEventLabel(e) || 'Sin evento';
    if (!map.has(eventName)) {
      map.set(eventName, { ingresos: 0, costos: 0, gastos: 0 });
    }
    const bucket = map.get(eventName);

    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'ingreso') {
        bucket.ingresos += (haber - debe);
      } else if (tipo === 'costo') {
        bucket.costos += (debe - haber);
      } else if (tipo === 'gasto') {
        bucket.gastos += (debe - haber);
      }
    }
  }

  return map;
}

function calcBalanceGroupsUntilDate(data, corte) {
  const { accountsMap, entries, linesByEntry } = data;
  const cutoff = corte || todayStr();

  let activos = 0;
  let pasivos = 0;
  let patrimonio = 0;

  for (const e of entries) {
    const f = e.fecha || e.date || '';
    if (f && f > cutoff) continue;
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const acc = accountsMap.get(String(ln.accountCode));
      if (!acc) continue;
      const tipo = getTipoCuenta(acc);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (tipo === 'activo') {
        activos += (debe - haber);
      } else if (tipo === 'pasivo') {
        pasivos += (haber - debe);
      } else if (tipo === 'patrimonio') {
        patrimonio += (haber - debe);
      }
    }
  }

  return { activos, pasivos, patrimonio };
}

function finDashboardBuildFinancialAccountLookups(data) {
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts : [];
  const byId = new Map();
  const byCode = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = String(row.id || row.uniqueKey || row.financialAccountId || '').trim();
    const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || row.accountCode || '');
    if (id && !byId.has(id)) byId.set(id, row);
    if (code && !byCode.has(code)) byCode.set(code, row);
  }
  return { byId, byCode };
}

function finDashboardGetFinancialAccountForLine(line, entry, data, lookups) {
  const maps = lookups || finDashboardBuildFinancialAccountLookups(data);
  const id = String(
    (line && (line.financialAccountId || line.cuentaFinancieraId)) ||
    (entry && (entry.financialAccountId || entry.cuentaFinancieraId)) ||
    ''
  ).trim();
  if (id && maps.byId && maps.byId.has(id)) return maps.byId.get(id);
  const code = finNormalizeAccountCode(line && line.accountCode);
  if (code && maps.byCode && maps.byCode.has(code)) return maps.byCode.get(code);
  return null;
}

function finDashboardCurrencyRaw(account, line, entry, financialAccount) {
  const candidates = [
    line && (line.originalCurrency || line.monedaOriginal || line.currency || line.moneda),
    entry && (entry.originalCurrency || entry.monedaOriginal || entry.financialAccountCurrency || entry.cuentaFinancieraMoneda || entry.currency || entry.moneda),
    financialAccount && (financialAccount.moneda || financialAccount.financialAccountCurrency || financialAccount.currency || financialAccount.currencyCode),
    account && (account.currencyCode || account.currency || account.moneda || account.currencyId)
  ];
  for (const raw of candidates) {
    const s = String(raw ?? '').trim();
    if (s) return s;
  }
  return '';
}

function finDashboardInferCurrency(account, line, entry, financialAccount) {
  const raw = finDashboardCurrencyRaw(account, line, entry, financialAccount);
  if (raw) {
    return {
      currency: finNormalizeCurrencyCode(raw),
      confidence: 'explicit'
    };
  }

  const text = normText([
    financialAccount && (financialAccount.nombreVisible || financialAccount.financialAccountNameSnapshot || financialAccount.name || financialAccount.nombre),
    account && (account.nombre || account.name),
    line && (line.accountNameSnapshot || line.accountName || line.nombreCuenta),
    entry && (entry.descripcion || entry.description || entry.reference || entry.referencia)
  ].filter(Boolean).join(' '));

  if (/(^|\s)(us\$|usd)(\s|$)/.test(text) || text.includes('dolar')) {
    return { currency: 'USD', confidence: 'inferredText' };
  }
  if (/(^|\s)(c\$|nio)(\s|$)/.test(text) || text.includes('cordoba')) {
    return { currency: 'NIO', confidence: 'inferredText' };
  }

  const code = finNormalizeAccountCode(
    (account && (account.code || account.accountCode || account.codigo)) ||
    (line && line.accountCode) ||
    ''
  );
  const inferredByCode = finGetFinancialAccountCurrencyCode(code);
  if (code && inferredByCode === 'USD') return { currency: 'USD', confidence: 'inferredCode' };
  return { currency: 'NIO', confidence: 'legacyDefault' };
}

function finDashboardNormalizeBankName(text) {
  let out = String(text || '').trim();
  out = out.replace(/^banco\s*\/\s*/i, '');
  out = out.replace(/^banco\s+/i, '');
  out = out.replace(/\s+[·|-]\s*(c\$|us\$|nio|usd)$/i, '');
  out = out.replace(/\s+(c\$|us\$|nio|usd)$/i, '');
  out = out.replace(/\s+/g, ' ').trim();
  return out || 'Banco sin clasificar';
}

function finDashboardResolveBankName(account, line, entry, financialAccount) {
  const candidates = [
    financialAccount && (financialAccount.bancoNombreSnapshot || financialAccount.bankNameSnapshot || financialAccount.bankCatalogName || financialAccount.nombreBanco),
    account && (account.bankNameSnapshot || account.bankCatalogName || account.bancoNombreSnapshot || account.nombreBanco),
    financialAccount && (financialAccount.nombreVisible || financialAccount.financialAccountNameSnapshot || financialAccount.name || financialAccount.nombre),
    line && (line.financialAccountNameSnapshot || line.cuentaFinancieraNombreSnapshot || line.bankNameSnapshot || line.accountNameSnapshot || line.accountName),
    account && (account.nombre || account.name)
  ];
  for (const raw of candidates) {
    const value = finDashboardNormalizeBankName(raw);
    if (value && value !== 'Banco sin clasificar') return value;
  }
  return 'Banco sin clasificar';
}

function finDashboardResolveCashName(account, line, entry, financialAccount) {
  const raw =
    (financialAccount && (financialAccount.nombreVisible || financialAccount.financialAccountNameSnapshot || financialAccount.name || financialAccount.nombre)) ||
    (account && (account.nombre || account.name)) ||
    (line && (line.accountNameSnapshot || line.accountName)) ||
    '';
  const txt = String(raw || '').trim();
  if (!txt) return 'Caja';
  if (/caja/i.test(txt)) return txt.replace(/\s+/g, ' ').trim();
  return 'Caja';
}

function finDashboardParseMoneyLike(value) {
  const n = finParseCurrencyAmount(value);
  return Number.isFinite(n) ? finRoundCurrency2(n) : null;
}

function finDashboardGetSnapshotRate(line, entry) {
  const raw =
    (line && (line.exchangeRateUsed ?? line.tipoCambioUsado ?? line.exchangeRate ?? line.tipoCambio)) ??
    (entry && (entry.exchangeRateUsed ?? entry.tipoCambioUsado ?? entry.exchangeRate ?? entry.tipoCambio));
  const n = finDashboardParseMoneyLike(raw);
  return Number.isFinite(n) && n > 0 ? finRoundCurrency2(n) : null;
}

function finDashboardOriginalDelta(line, entry, currency, baseDelta, rate) {
  const dOrig = finDashboardParseMoneyLike(line && (line.debitOriginal ?? line.debeOriginal));
  const hOrig = finDashboardParseMoneyLike(line && (line.creditOriginal ?? line.haberOriginal));
  if ((Number.isFinite(dOrig) && dOrig > 0) || (Number.isFinite(hOrig) && hOrig > 0)) {
    return finRoundCurrency2((dOrig || 0) - (hOrig || 0));
  }

  const rawOriginalLine = line && (line.originalAmount ?? line.montoOriginal ?? line.totalOriginal);
  const lineOriginal = finDashboardParseMoneyLike(rawOriginalLine);
  if (Number.isFinite(lineOriginal) && lineOriginal > 0) {
    return finRoundCurrency2((baseDelta < 0 ? -1 : 1) * lineOriginal);
  }

  if (currency === 'NIO') return finRoundCurrency2(baseDelta);

  const rawOriginalEntry = entry && (entry.originalAmount ?? entry.montoOriginal ?? entry.totalOriginal);
  const entryOriginal = finDashboardParseMoneyLike(rawOriginalEntry);
  if (Number.isFinite(entryOriginal) && entryOriginal > 0) {
    return finRoundCurrency2((baseDelta < 0 ? -1 : 1) * entryOriginal);
  }

  if (currency === 'USD' && Number.isFinite(rate) && rate > 0 && Number.isFinite(baseDelta)) {
    return finRoundCurrency2(baseDelta / rate);
  }
  return null;
}

function finDashboardMakeLiquidityRow(kind, key, label, currency) {
  return {
    kind,
    key,
    label,
    currency: finNormalizeCurrencyCode(currency),
    balanceOriginal: 0,
    equivalentNio: 0,
    accountCodes: new Set(),
    lineCount: 0,
    legacyCurrencyCount: 0,
    inferredCurrencyCount: 0,
    missingUsdRateCount: 0,
    missingOriginalUsdCount: 0,
    usedStoredEquivalentWithoutRateCount: 0,
    unclassifiedBankCount: 0
  };
}

function finDashboardAddLiquidityRow(map, row, originalDelta, equivalentDelta, accountCode, meta) {
  if (!map.has(row.key)) map.set(row.key, row);
  const target = map.get(row.key);
  if (Number.isFinite(originalDelta)) target.balanceOriginal = finRoundCurrency2(target.balanceOriginal + originalDelta);
  if (Number.isFinite(equivalentDelta)) target.equivalentNio = finRoundCurrency2(target.equivalentNio + equivalentDelta);
  if (accountCode) target.accountCodes.add(accountCode);
  target.lineCount += 1;
  if (meta && meta.currencyConfidence === 'legacyDefault') target.legacyCurrencyCount += 1;
  if (meta && (meta.currencyConfidence === 'inferredText' || meta.currencyConfidence === 'inferredCode')) target.inferredCurrencyCount += 1;
  if (meta && meta.missingUsdRate) target.missingUsdRateCount += 1;
  if (meta && meta.missingOriginalUsd) target.missingOriginalUsdCount += 1;
  if (meta && meta.usedStoredEquivalentWithoutRate) target.usedStoredEquivalentWithoutRateCount += 1;
  if (meta && meta.unclassifiedBank) target.unclassifiedBankCount += 1;
}

function calcCajaBancoMultimonedaUntilDate(data, corte) {
  const safeData = data || {};
  const entries = Array.isArray(safeData.entries) ? safeData.entries : [];
  const linesByEntry = safeData.linesByEntry instanceof Map ? safeData.linesByEntry : new Map();
  const accountsMap = safeData.accountsMap instanceof Map ? safeData.accountsMap : new Map();
  const cutoff = corte || todayStr();
  const lookups = finDashboardBuildFinancialAccountLookups(safeData);
  const cashRows = new Map();
  const bankRows = new Map();
  const stats = {
    scannedEntries: 0,
    scannedLines: 0,
    liquidityLines: 0,
    usdWithoutRate: 0,
    usdWithoutOriginal: 0,
    legacyCurrency: 0,
    inferredCurrency: 0,
    unclassifiedBank: 0,
    groupingLiquidityLines: 0
  };

  for (const entry of entries) {
    const f = String((entry && (entry.fecha || entry.date)) || '').slice(0, 10);
    if (f && f > cutoff) continue;
    stats.scannedEntries += 1;
    const entryId = Number(entry && entry.id);
    const lines = linesByEntry.get(entry && entry.id) || linesByEntry.get(entryId) || [];
    for (const line of lines) {
      if (!line || typeof line !== 'object') continue;
      stats.scannedLines += 1;
      const accountCode = finNormalizeAccountCode(line.accountCode);
      const account = getAccountByCodeLoose(accountCode, accountsMap);
      const isCash = finIsCashAccount(account || accountCode);
      const isBank = !isCash && finIsBankAccount(account || accountCode);
      if (!isCash && !isBank) continue;

      stats.liquidityLines += 1;
      if (account && (finIsRootAccount(account) || finIsGroupingAccount(account))) stats.groupingLiquidityLines += 1;

      const financialAccount = finDashboardGetFinancialAccountForLine(line, entry, safeData, lookups);
      const curInfo = finDashboardInferCurrency(account, line, entry, financialAccount);
      const currency = finNormalizeCurrencyCode(curInfo.currency);
      const rate = finDashboardGetSnapshotRate(line, entry);
      const debe = n0(line.debe);
      const haber = n0(line.haber);
      const baseDelta = finRoundCurrency2(debe - haber);
      const originalDelta = finDashboardOriginalDelta(line, entry, currency, baseDelta, rate);

      const missingUsdRate = currency === 'USD' && !rate;
      const missingOriginalUsd = currency === 'USD' && !Number.isFinite(originalDelta);
      const usedStoredEquivalentWithoutRate = currency === 'USD' && missingUsdRate && Number.isFinite(baseDelta) && Math.abs(baseDelta) > 0.005;
      if (missingUsdRate) stats.usdWithoutRate += 1;
      if (missingOriginalUsd) stats.usdWithoutOriginal += 1;
      if (curInfo.confidence === 'legacyDefault') stats.legacyCurrency += 1;
      if (curInfo.confidence === 'inferredText' || curInfo.confidence === 'inferredCode') stats.inferredCurrency += 1;

      if (isCash) {
        const label = currency === 'USD' ? 'Caja US$' : 'Caja C$';
        const row = finDashboardMakeLiquidityRow('cash', `cash-${currency}`, label, currency);
        row.cashName = finDashboardResolveCashName(account, line, entry, financialAccount);
        finDashboardAddLiquidityRow(cashRows, row, originalDelta, baseDelta, accountCode, {
          currencyConfidence: curInfo.confidence,
          missingUsdRate,
          missingOriginalUsd,
          usedStoredEquivalentWithoutRate
        });
      } else if (isBank) {
        const bankName = finDashboardResolveBankName(account, line, entry, financialAccount);
        const unclassifiedBank = bankName === 'Banco sin clasificar';
        if (unclassifiedBank) stats.unclassifiedBank += 1;
        const row = finDashboardMakeLiquidityRow('bank', `bank-${normText(bankName)}-${currency}`, `${bankName} ${currency === 'USD' ? 'US$' : 'C$'}`, currency);
        row.bankName = bankName;
        finDashboardAddLiquidityRow(bankRows, row, originalDelta, baseDelta, accountCode, {
          currencyConfidence: curInfo.confidence,
          missingUsdRate,
          missingOriginalUsd,
          usedStoredEquivalentWithoutRate,
          unclassifiedBank
        });
      }
    }
  }

  const toRows = (map) => [...map.values()]
    .map(row => ({
      ...row,
      accountCodes: [...row.accountCodes].sort((a, b) => String(a).localeCompare(String(b), 'es')),
      balanceOriginal: finRoundCurrency2(row.balanceOriginal),
      equivalentNio: finRoundCurrency2(row.equivalentNio)
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
      if (a.currency !== b.currency) return a.currency === 'NIO' ? -1 : 1;
      return String(a.label).localeCompare(String(b.label), 'es');
    });

  const cash = toRows(cashRows);
  const bank = toRows(bankRows);
  const sumRows = (rows, currency) => finRoundCurrency2(rows.filter(r => r.currency === currency).reduce((sum, r) => sum + n0(r.balanceOriginal), 0));
  const sumEq = (rows) => finRoundCurrency2(rows.reduce((sum, r) => sum + n0(r.equivalentNio), 0));

  const totals = {
    cashNio: sumRows(cash, 'NIO'),
    cashUsd: sumRows(cash, 'USD'),
    cashEquivalentNio: sumEq(cash),
    bankNio: sumRows(bank, 'NIO'),
    bankUsd: sumRows(bank, 'USD'),
    bankEquivalentNio: sumEq(bank)
  };
  totals.liquidityEquivalentNio = finRoundCurrency2(totals.cashEquivalentNio + totals.bankEquivalentNio);

  const alerts = [
    { text: 'Caja y Bancos se calculan como saldo acumulado global al cierre del período; el filtro de evento no se aplica para evitar saldos artificiales.' }
  ];
  if (stats.usdWithoutRate) alerts.push({ kind: 'warn', text: `${stats.usdWithoutRate} línea(s) USD de Caja/Bancos no tienen T/C snapshot. Se respeta el equivalente guardado cuando existe y no se recalcula con el T/C actual.` });
  if (stats.usdWithoutOriginal) alerts.push({ kind: 'warn', text: `${stats.usdWithoutOriginal} línea(s) USD no tienen monto original suficiente para mostrar saldo en US$. El equivalente C$ guardado se mantiene.` });
  if (stats.legacyCurrency) alerts.push({ text: `${stats.legacyCurrency} línea(s) legacy de Caja/Bancos no tenían moneda explícita; se tratan como C$ legacy sin modificar históricos.` });
  if (stats.inferredCurrency) alerts.push({ text: `${stats.inferredCurrency} línea(s) de Caja/Bancos usaron moneda inferida por cuenta/nombre/código.` });
  if (stats.unclassifiedBank) alerts.push({ kind: 'warn', text: `${stats.unclassifiedBank} línea(s) bancarias no tienen banco identificable; se agrupan como Banco sin clasificar.` });
  if (stats.groupingLiquidityLines) alerts.push({ kind: 'warn', text: `${stats.groupingLiquidityLines} línea(s) de Caja/Bancos parecen usar cuentas raíz/agrupadoras. Se muestran sin bloquear, pero conviene corregir con asientos de ajuste.` });
  if (!stats.liquidityLines) alerts.push({ text: 'No hay movimientos reales de Caja/Bancos acumulados al corte seleccionado.' });

  return { cash, bank, totals, alerts, stats, cutoff };
}

function calcCajaBancoUntilDate(data, corte) {
  const detail = calcCajaBancoMultimonedaUntilDate(data, corte);
  return {
    caja: detail.totals.cashEquivalentNio,
    banco: detail.totals.bankEquivalentNio,
    detail
  };
}

/* ---------- Rentabilidad por presentación (lectura POS) ---------- */

const RENTAB_PRESENTACIONES = [
  { id: 'pulso', label: 'Pulso 250 ml' },
  { id: 'media', label: 'Media 375 ml' },
  { id: 'djeba', label: 'Djeba 750 ml' },
  { id: 'litro', label: 'Litro 1000 ml' },
  { id: 'galon', label: 'Galón 3720 ml' }
];

function mapProductNameToPresIdFromPOS(name) {
  const n = normStr(name);
  if (!n) return null;
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon') || n.includes('galón')) return 'galon';
  return null;
}

function matchEventPOS(sale, eventFilter) {
  const ev = (sale.eventName || '').toString().trim();
  if (!eventFilter || eventFilter === 'ALL') return true;
  if (eventFilter === 'NONE') return !ev;
  return ev === eventFilter;
}

function ensureRentabUI() {
  const subER = document.getElementById('sub-er');
  if (!subER) return null;
  let section = document.getElementById('rentab-presentacion');
  if (section) return section;

  const wrapper = document.createElement('section');
  wrapper.id = 'rentab-presentacion';
  wrapper.className = 'fin-subsection';

  wrapper.innerHTML = `
    <header class="fin-section-header fin-section-header--sub">
      <h3>Rentabilidad por presentación</h3>
      <p>
        Usa los mismos filtros de arriba (Periodo y Evento) para ver botellas, ingresos, costo y margen
        por Pulso, Media, Djeba, Litro y Galón.
      </p>
    </header>
    <div class="fin-table-wrapper">
      <table class="fin-table">
        <thead>
          <tr>
            <th>Presentación</th>
            <th>Botellas vendidas</th>
            <th>Ingresos</th>
            <th>Costo de venta</th>
            <th>Margen</th>
            <th>% Margen</th>
          </tr>
        </thead>
        <tbody id="rentab-tbody">
          <tr>
            <td colspan="6">Sin datos de ventas del POS para el periodo/evento seleccionado.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  subER.appendChild(wrapper);
  return wrapper;
}

function renderRentabilidadPresentacion(/* dataFinanzas */) {
  (async () => {
    const section = ensureRentabUI();
    if (!section) return;
    const tbody = document.getElementById('rentab-tbody');
    if (!tbody) return;

    // Determinar rango de fechas y evento usando los mismos filtros del ER
    const modoSel = document.getElementById('er-modo');
    const mesSel = document.getElementById('er-mes');
    const anioSel = document.getElementById('er-anio');
    const desdeInput = document.getElementById('er-desde');
    const hastaInput = document.getElementById('er-hasta');
    const eventoSel = document.getElementById('er-evento');

    const modo = modoSel ? modoSel.value : 'mes';
    let desde;
    let hasta;

    if (modo === 'mes') {
      const mes = (mesSel && mesSel.value) ? mesSel.value : pad2(new Date().getMonth() + 1);
      const anio = (anioSel && anioSel.value) ? anioSel.value : String(new Date().getFullYear());
      const range = monthRange(Number(anio), Number(mes));
      desde = range.start;
      hasta = range.end;
    } else {
      desde = (desdeInput && desdeInput.value) ? desdeInput.value : todayStr();
      hasta = (hastaInput && hastaInput.value) ? hastaInput.value : desde;
      if (hasta < desde) {
        const tmp = desde;
        desde = hasta;
        hasta = tmp;
      }
    }

    const evento = (eventoSel && eventoSel.value) ? eventoSel.value : 'ALL';

    const ventas = await getAllPosSales();

    if (!ventas || !ventas.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">No hay ventas registradas en el POS para calcular rentabilidad.</td>
        </tr>
      `;
      return;
    }

    const agg = {};
    for (const s of ventas) {
      const fecha = s.date || '';
      if (fecha && desde && fecha < desde) continue;
      if (fecha && hasta && fecha > hasta) continue;
      if (!matchEventPOS(s, evento)) continue;

      const courtesy = !!s.courtesy;
      if (courtesy) continue; // Por ahora, cortesías fuera de la rentabilidad

      const presId = mapProductNameToPresIdFromPOS(s.productName || '');
      if (!presId) continue;

      if (!agg[presId]) {
        agg[presId] = {
          botellas: 0,
          ingresos: 0,
          costo: 0
        };
      }
      const group = agg[presId];

      const qty = Number(s.qty || 0); // devoluciones vienen con signo negativo
      const total = Number(s.total || 0); // devoluciones ajustan ingresos
      const lineCost = (typeof s.lineCost === 'number')
        ? Number(s.lineCost || 0)
        : Number(s.costPerUnit || 0) * qty;

      group.botellas += qty;
      group.ingresos += total;
      group.costo += lineCost;
    }

    tbody.innerHTML = '';

    let tieneDatos = false;
    for (const def of RENTAB_PRESENTACIONES) {
      const data = agg[def.id] || { botellas: 0, ingresos: 0, costo: 0 };
      const botellas = data.botellas;
      const ingresos = data.ingresos;
      const costo = data.costo;
      const margen = ingresos - costo;
      const margenPct = ingresos !== 0 ? (margen / ingresos) * 100 : 0;

      if (botellas !== 0 || ingresos !== 0 || costo !== 0) {
        tieneDatos = true;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${def.label}</td>
        <td class="num">${botellas.toFixed(0)}</td>
        <td class="num">${finFormatCordobas(ingresos)}</td>
        <td class="num">${finFormatCordobas(costo)}</td>
        <td class="num">${finFormatCordobas(margen)}</td>
        <td class="num">${margenPct.toFixed(1)}%</td>
      `;
      tbody.appendChild(tr);
    }

    if (!tieneDatos) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6">Sin movimientos de ventas (no cortesías) para el periodo/evento seleccionado.</td>
        </tr>
      `;
    }
  })().catch(err => {
    console.error('Error calculando rentabilidad por presentación', err);
  });
}

/* ---------- Comparativo de eventos (solo Finanzas) ---------- */

function ensureComparativoEventosUI() {
  const subER = document.getElementById('sub-er');
  if (!subER) return null;
  let section = document.getElementById('comp-eventos');
  if (section) return section;

  const wrapper = document.createElement('section');
  wrapper.id = 'comp-eventos';
  wrapper.className = 'fin-subsection';

  wrapper.innerHTML = `
    <header class="fin-section-header fin-section-header--sub">
      <h3>Comparativo de eventos</h3>
      <p>
        Usa el mismo periodo de arriba (mes o rango de fechas).
        Muestra por evento: ingresos, costos de venta, gastos, resultado y % de margen.
      </p>
    </header>
    <div class="fin-table-wrapper">
      <table class="fin-table">
        <thead>
          <tr>
            <th>Evento</th>
            <th>Ingresos</th>
            <th>Costo de venta</th>
            <th>Gastos</th>
            <th>Resultado</th>
            <th>% Margen</th>
          </tr>
        </thead>
        <tbody id="comp-eventos-tbody">
          <tr>
            <td colspan="6">Sin asientos registrados para el periodo seleccionado.</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
  subER.appendChild(wrapper);
  return wrapper;
}

function renderComparativoEventos(data) {
  const section = ensureComparativoEventosUI();
  if (!section || !data) return;
  const tbody = document.getElementById('comp-eventos-tbody');
  if (!tbody) return;

  // Reutilizamos el mismo periodo del Estado de Resultados,
  // pero aquí SIEMPRE comparamos TODOS los eventos.
  const modoSel = document.getElementById('er-modo');
  const mesSel = document.getElementById('er-mes');
  const anioSel = document.getElementById('er-anio');
  const desdeInput = document.getElementById('er-desde');
  const hastaInput = document.getElementById('er-hasta');

  const modo = modoSel ? modoSel.value : 'mes';
  let desde;
  let hasta;

  if (modo === 'mes') {
    const mes = (mesSel && mesSel.value) ? mesSel.value : pad2(new Date().getMonth() + 1);
    const anio = (anioSel && anioSel.value) ? anioSel.value : String(new Date().getFullYear());
    const range = monthRange(Number(anio), Number(mes));
    desde = range.start;
    hasta = range.end;
  } else {
    desde = (desdeInput && desdeInput.value) ? desdeInput.value : todayStr();
    hasta = (hastaInput && hastaInput.value) ? hastaInput.value : desde;
    if (hasta < desde) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
  }

  const map = calcResultadosByEventInRange(data, desde, hasta);

  tbody.innerHTML = '';

  if (!map || map.size === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">Sin asientos registrados para el periodo seleccionado.</td>
      </tr>
    `;
    return;
  }

  // Orden: primero eventos con nombre, luego "Sin evento"
  const keys = Array.from(map.keys()).sort((a, b) => {
    if (a === 'Sin evento') return 1;
    if (b === 'Sin evento') return -1;
    return a.localeCompare(b, 'es');
  });

  let totalIngresos = 0;
  let totalCostos = 0;
  let totalGastos = 0;
  let totalResultado = 0;

  for (const evName of keys) {
    const vals = map.get(evName);
    const ingresos = vals.ingresos;
    const costos = vals.costos;
    const gastos = vals.gastos;
    const resultado = ingresos - costos - gastos;
    const margenPct = ingresos !== 0 ? (resultado / ingresos) * 100 : 0;

    totalIngresos += ingresos;
    totalCostos += costos;
    totalGastos += gastos;
    totalResultado += resultado;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${evName}</td>
      <td class="num">${finFormatCordobas(ingresos)}</td>
      <td class="num">${finFormatCordobas(costos)}</td>
      <td class="num">${finFormatCordobas(gastos)}</td>
      <td class="num">${finFormatCordobas(resultado)}</td>
      <td class="num">${margenPct.toFixed(1)}%</td>
    `;
    tbody.appendChild(tr);
  }

  // Fila de totales
  const margenTotalPct = totalIngresos !== 0
    ? (totalResultado / totalIngresos) * 100
    : 0;

  const trTotal = document.createElement('tr');
  trTotal.classList.add('fin-row-strong');
  trTotal.innerHTML = `
    <td>Total</td>
    <td class="num">${finFormatCordobas(totalIngresos)}</td>
    <td class="num">${finFormatCordobas(totalCostos)}</td>
    <td class="num">${finFormatCordobas(totalGastos)}</td>
    <td class="num">${finFormatCordobas(totalResultado)}</td>
    <td class="num">${margenTotalPct.toFixed(1)}%</td>
  `;
  tbody.appendChild(trTotal);
}

/* ---------- Flujo de Caja (Caja + Banco) ---------- */

function calcFlujoCaja(data) {
  if (!data) return null;

  const { entries, linesByEntry, accountsMap } = data;

  // Usamos mismo periodo del ER (mes / rango)
  const modoSel = $('#er-modo');
  const mesSel = $('#er-mes');
  const anioSel = $('#er-anio');
  const desdeInput = $('#er-desde');
  const hastaInput = $('#er-hasta');

  const modo = modoSel ? modoSel.value : 'mes';
  let desde;
  let hasta;

  if (modo === 'mes') {
    const mes = mesSel && mesSel.value ? mesSel.value : pad2(new Date().getMonth() + 1);
    const anio = anioSel && anioSel.value ? anioSel.value : String(new Date().getFullYear());
    const range = monthRange(Number(anio), Number(mes));
    desde = range.start;
    hasta = range.end;
  } else {
    desde = (desdeInput && desdeInput.value) ? desdeInput.value : todayStr();
    hasta = (hastaInput && hastaInput.value) ? hastaInput.value : desde;
    if (hasta < desde) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
  }

  if (!desde || !hasta) return null;

  // Saldo inicial = Caja+Banco hasta el día anterior a "desde"
  let fechaAntes = desde;
  try {
    const [y, m, d] = desde.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    const y2 = dt.getFullYear();
    const m2 = pad2(dt.getMonth() + 1);
    const d2 = pad2(dt.getDate());
    fechaAntes = `${y2}-${m2}-${d2}`;
  } catch {
    // si algo falla, usamos mismo "desde" como corte inicial
    fechaAntes = desde;
  }

  const saldoInicialData = calcCajaBancoUntilDate(data, fechaAntes);
  const saldoFinalData = calcCajaBancoUntilDate(data, hasta);

  const saldoInicial = (saldoInicialData.caja || 0) + (saldoInicialData.banco || 0);
  const saldoFinal = (saldoFinalData.caja || 0) + (saldoFinalData.banco || 0);

  let opIn = 0;
  let opOut = 0;
  let ownerIn = 0;
  let ownerOut = 0;

  const isCajaBanco = (code) => {
    const acc = getAccountByCodeLoose(code, accountsMap);
    return finIsFinancialCashOrBankAccount(acc || code);
  };
  const isOwnerEquity = (code) => (code === '3100' || code === '3200' || code === '3300');

  for (const e of entries) {
    const f = e.fecha || e.date || '';
    if (!f) continue;
    if (f < desde || f > hasta) continue;

    const lines = linesByEntry.get(e.id) || [];
    if (!lines.length) continue;

    let deltaCash = 0;
    let hasOwner = false;
    let hasOp = false;

    for (const ln of lines) {
      const code = String(ln.accountCode);
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);

      if (isCajaBanco(code)) {
        deltaCash += (debe - haber);
      } else {
        if (isOwnerEquity(code)) {
          hasOwner = true;
        } else {
          // cualquier otra cuenta distinta de patrimonio dueño la consideramos "operación"
          hasOp = true;
        }
      }
    }

    if (!deltaCash) continue;

    const isOwnerMov = hasOwner && !hasOp;
    if (isOwnerMov) {
      if (deltaCash > 0) ownerIn += deltaCash;
      else ownerOut += -deltaCash;
    } else {
      if (deltaCash > 0) opIn += deltaCash;
      else opOut += -deltaCash;
    }
  }

  const netOp = opIn - opOut;
  const netOwner = ownerIn - ownerOut;
  const netPeriodo = saldoFinal - saldoInicial;
  const otros = netPeriodo - netOp - netOwner;

  return {
    desde,
    hasta,
    saldoInicial,
    opIn,
    opOut,
    netOp,
    ownerIn,
    ownerOut,
    netOwner,
    otros,
    saldoFinal
  };
}

function renderFlujoCaja(data) {
  const tbody = $('#fc-tbody');
  if (!tbody) return;

  if (!data) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2">Sin datos contables para calcular flujo de caja.</td>
      </tr>
    `;
    return;
  }

  const r = calcFlujoCaja(data);
  if (!r) {
    tbody.innerHTML = `
      <tr>
        <td colspan="2">Selecciona un periodo válido para ver el flujo de caja.</td>
      </tr>
    `;
    return;
  }

  const rows = [
    ['Saldo inicial Caja + Banco', r.saldoInicial],
    ['Flujo neto de operación (cobros - pagos)', r.netOp],
    ['Flujo neto aportes / retiros del dueño', r.netOwner],
    ['Otros movimientos de caja', r.otros],
    ['Saldo final Caja + Banco', r.saldoFinal]
  ];

  tbody.innerHTML = '';
  for (const [label, val] of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${label}</td>
      <td class="num">${finFormatCordobas(val)}</td>
    `;
    tbody.appendChild(tr);
  }
}


/* ---------- Exportar a Excel: Diario, ER, BG, Flujo de Caja ---------- */

async function exportDiarioExcel() {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  if (!finCachedData) {
    await refreshAllFin();
  }
  const data = finCachedData;
  if (!data || !Array.isArray(data.entries) || !data.entries.length) {
    alert('No hay movimientos en el Diario para exportar.');
    return;
  }

  const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
  const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
  const origenFilter = ($('#filtro-origen')?.value) || 'todos';
  const proveedorFilter = (document.getElementById('filtro-proveedor')?.value) || 'todos';

  const { desde: diarioDesde, hasta: diarioHasta } = getDiaryRangeFromUI();

  const { entries, linesByEntry, accountsMap } = data;

  // Performance guard (iPad/Safari): estimar volumen antes de construir el workbook.
  const EXCEL_WARN_ROWS = 3000;
  let approxCount = 0;
  for (const e of entries) {
    const tipo = e.tipoMovimiento || 'otro';
    if (tipoFilter !== 'todos' && tipo !== tipoFilter) continue;

    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    // Origen (compat con filtros POS_CIERRES / POS_LEGACY)
    const originInfo0 = finGetEntryOriginPresentation(e);
    const origenRaw0 = originInfo0.label;
    const origenBase0 = originInfo0.base;
    const isPos0 = (origenBase0 === 'POS');
    const isPosClose0 = isPos0 && isPosDailyCloseEntry(e);
    const origenKey0 = isPos0 ? (isPosClose0 ? 'POS_CIERRES' : 'POS_LEGACY') : origenBase0;

    if (!finEntryOriginMatchesFilter(e, origenFilter)) continue;

    if (!matchEvent(e, eventoFilter)) continue;

    const sid0 = (e.supplierId != null) ? String(e.supplierId) : '';
    const hasSupplier0 = !!sid0 || !!(e.supplierName || '').toString().trim();
    if (proveedorFilter !== 'todos') {
      if (proveedorFilter === 'NONE') {
        if (hasSupplier0) continue;
      } else {
        if (!sid0 || sid0 !== proveedorFilter) continue;
      }
    }

    approxCount++;
  }

  if (approxCount > EXCEL_WARN_ROWS) {
    const warn = `Exportación grande (~${approxCount} filas) puede tardar o colgar Safari en iPad.\n\n`;
    if (!diarioDesde && !diarioHasta) {
      alert(warn + 'Selecciona un rango de fechas (Desde/Hasta) antes de exportar.');
      return;
    }
    const ok = confirm(warn + '¿Deseas continuar de todas formas?');
    if (!ok) {
      showToast('Exportación cancelada. Ajusta el rango de fechas y vuelve a intentar.');
      return;
    }
  }

  const sorted = [...entries].sort((a, b) => {
    const fa = a.fecha || a.date || '';
    const fb = b.fecha || b.date || '';
    if (fa === fb) return (a.id || 0) - (b.id || 0);
    return fa < fb ? -1 : 1;
  });

  const rows = [];
  const detailRows = [];
  rows.push(['Fecha', 'Descripción', 'Tipo', 'Evento', 'Proveedor', 'Pago', 'Referencia', 'Origen', 'Etiqueta', finMoneyColumnHeader('Debe total'), finMoneyColumnHeader('Haber total'), 'Cuenta financiera', 'Moneda original', 'Monto original', 'T/C usado', finMoneyColumnHeader('Equivalente C$')]);
  detailRows.push(['Fecha', 'Asiento', 'Origen', 'Descripción', 'Referencia', 'Etiqueta', 'Cuenta', 'Nombre cuenta', finMoneyColumnHeader('Debe'), finMoneyColumnHeader('Haber'), 'Moneda original', 'Monto original', 'T/C usado', finMoneyColumnHeader('Equivalente C$')]);

  for (const e of sorted) {
    const tipo = e.tipoMovimiento || 'otro';
    if (tipoFilter !== 'todos' && tipo !== tipoFilter) continue;

    const originInfo = finGetEntryOriginPresentation(e);
    const origenBase = originInfo.base;
    const isPos = (origenBase === 'POS');
    const origenOut = finEntryOriginLabelForHistory(e);
    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (!finEntryOriginMatchesFilter(e, origenFilter)) continue;

    if (!matchEvent(e, eventoFilter)) continue;

    const sid = (e.supplierId != null) ? String(e.supplierId) : '';
    const hasSupplier = !!sid || !!(e.supplierName || '').toString().trim();
    if (proveedorFilter !== 'todos') {
      if (proveedorFilter === 'NONE') {
        if (hasSupplier) continue;
      } else {
        if (!sid || sid !== proveedorFilter) continue;
      }
    }

    const lines = linesByEntry.get(e.id) || [];
    const normLines = normalizeEntryLines(e, lines);

    let totalDebe = 0;
    let totalHaber = 0;
    for (const ln of normLines) {
      totalDebe += nSafeMoney(ln.debit);
      totalHaber += nSafeMoney(ln.credit);
    }

    // Display-only: para cierres POS, en el listado mostramos el monto principal (Caja/Banco vs Ventas)
    let displayDebe = totalDebe;
    let displayHaber = totalHaber;
    if (isPosDailyCloseEntry(e)) {
      const p = getPosPrincipalAmounts(e, lines, accountsMap);
      if (p && p.found) {
        displayDebe = p.principalDebe;
        displayHaber = p.principalHaber;
      }
    }

    const supplierLabel = getSupplierLabelFromEntry(e, data);
    const ref = getDisplayReference(e);
    const evLabel = getDisplayEventLabel(e);
    const pm = (e.paymentMethod || '').toString().trim();
    const pmLabel = pm === 'bank' ? 'Banco' : (pm === 'cash' ? 'Caja' : (pm ? pm : '—'));

    const autoLabel = finGetEntryAutoLabel(e) || '';
    const currencyMeta = finGetEntryManualCurrencyMeta(e);
    rows.push([
      e.fecha || e.date || '',
      e.descripcion || '',
      tipo,
      evLabel || '—',
      supplierLabel,
      pmLabel,
      ref,
      origenOut,
      autoLabel,
      Number(totalDebe.toFixed(2)),
      Number(totalHaber.toFixed(2)),
      currencyMeta ? (currencyMeta.financialAccountName || '') : '',
      currencyMeta ? currencyMeta.originalCurrency : '',
      currencyMeta && currencyMeta.originalAmount != null ? Number(Number(currencyMeta.originalAmount).toFixed(2)) : '',
      currencyMeta && currencyMeta.exchangeRateUsed ? Number(Number(currencyMeta.exchangeRateUsed).toFixed(2)) : '',
      currencyMeta && currencyMeta.baseAmountNio != null ? Number(Number(currencyMeta.baseAmountNio).toFixed(2)) : ''
    ]);

    if (normLines.length) {
      for (const ln of normLines) {
        const lineCurrency = finReportLineCurrencyMeta(ln, e, data);
        detailRows.push([
          e.fecha || e.date || '',
          e.id || '',
          origenOut,
          e.descripcion || '',
          ref,
          autoLabel,
          ln.accountCode || '',
          getAccountDisplayNameByCode(ln.accountCode, accountsMap, ln),
          Number(finReportLineAmount(ln.debit).toFixed(2)),
          Number(finReportLineAmount(ln.credit).toFixed(2)),
          lineCurrency.originalCurrency || '',
          lineCurrency.originalAmount != null ? Number(Number(lineCurrency.originalAmount).toFixed(2)) : '',
          lineCurrency.exchangeRateUsed ? Number(Number(lineCurrency.exchangeRateUsed).toFixed(2)) : '',
          lineCurrency.baseAmountNio != null ? Number(Number(lineCurrency.baseAmountNio).toFixed(2)) : ''
        ]);
      }
    } else {
      detailRows.push([
        e.fecha || e.date || '',
        e.id || '',
        origenOut,
        e.descripcion || '',
        ref,
        autoLabel,
        '—',
        'Movimiento histórico / legacy',
        '',
        '',
        currencyMeta ? currencyMeta.originalCurrency : '',
        currencyMeta && currencyMeta.originalAmount != null ? Number(Number(currencyMeta.originalAmount).toFixed(2)) : '',
        currencyMeta && currencyMeta.exchangeRateUsed ? Number(Number(currencyMeta.exchangeRateUsed).toFixed(2)) : '',
        currencyMeta && currencyMeta.baseAmountNio != null ? Number(Number(currencyMeta.baseAmountNio).toFixed(2)) : ''
      ]);
    }
  }

  if (rows.length <= 1) {
    showToast('No hay movimientos para exportar con los filtros actuales.');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wsDetail = XLSX.utils.aoa_to_sheet(detailRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Diario');
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Lineas_Debe_Haber');
  const filename = `finanzas_diario_${todayStr()}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Diario exportado a Excel');
}

async function exportEstadoResultadosExcel() {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  if (!finCachedData) {
    await refreshAllFin();
  }
  const data = finCachedData;
  if (!data || !Array.isArray(data.entries) || !data.entries.length) {
    alert('No hay datos contables para exportar el Estado de Resultados.');
    return;
  }

  const modoSel = $('#er-modo');
  const mesSel = $('#er-mes');
  const anioSel = $('#er-anio');
  const desdeInput = $('#er-desde');
  const hastaInput = $('#er-hasta');
  const eventoSel = $('#er-evento');

  const modo = modoSel ? modoSel.value : 'mes';
  let desde;
  let hasta;

  if (modo === 'mes') {
    const mes = (mesSel && mesSel.value) ? mesSel.value : pad2(new Date().getMonth() + 1);
    const anio = (anioSel && anioSel.value) ? anioSel.value : String(new Date().getFullYear());
    const range = monthRange(Number(anio), Number(mes));
    desde = range.start;
    hasta = range.end;
  } else {
    desde = (desdeInput && desdeInput.value) ? desdeInput.value : todayStr();
    hasta = (hastaInput && hastaInput.value) ? hastaInput.value : desde;
    if (hasta < desde) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
  }

  const evento = (eventoSel && eventoSel.value) ? eventoSel.value : 'ALL';
  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde,
    hasta,
    evento
  });

  const bruta = ingresos - costos;
  const postCortesias = bruta - cortesias;
  const neta = bruta - gastos;

  let eventoLabel = 'Todos los eventos';
  if (evento === 'NONE') {
    eventoLabel = 'Sin evento';
  } else if (evento !== 'ALL') {
    const opt = eventoSel && eventoSel.options && eventoSel.selectedIndex >= 0
      ? eventoSel.options[eventoSel.selectedIndex]
      : null;
    eventoLabel = opt ? opt.textContent : evento;
  }

  const num = (v) => Number((v || 0).toFixed(2));

  const rows = [];
  rows.push(['Estado de Resultados', '']);
  rows.push(['Periodo', `${desde} a ${hasta}`]);
  rows.push(['Evento', eventoLabel]);
  rows.push([]);
  rows.push(['Concepto', finPrimaryAmountHeader()]);
  rows.push(['Ingresos (4xxx)', num(ingresos)]);
  rows.push(['Costos de venta (5xxx)', num(costos)]);
  rows.push(['Gastos de operación (6xxx)', num(gastos)]);
  rows.push(['Utilidad bruta', num(bruta)]);
  rows.push(['Utilidad neta', num(neta)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EstadoResultados');
  const filename = `finanzas_ER_${todayStr()}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Estado de Resultados exportado a Excel');
}

async function exportBalanceGeneralExcel() {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  if (!finCachedData) {
    await refreshAllFin();
  }
  const data = finCachedData;
  if (!data || !Array.isArray(data.entries) || !data.entries.length) {
    alert('No hay datos contables para exportar el Balance General.');
    return;
  }

  const corteInput = $('#bg-fecha');
  const corte = (corteInput && corteInput.value) ? corteInput.value : todayStr();
  const { activos, pasivos, patrimonio } = calcBalanceGroupsUntilDate(data, corte);
  const cuadre = activos - (pasivos + patrimonio);

  const num = (v) => Number((v || 0).toFixed(2));

  const rows = [];
  rows.push(['Balance General', '']);
  rows.push(['Corte al', corte]);
  rows.push([]);
  rows.push(['Grupo', finPrimaryAmountHeader()]);
  rows.push(['Activos (1xxx)', num(activos)]);
  rows.push(['Pasivos (2xxx)', num(pasivos)]);
  rows.push(['Patrimonio (3xxx)', num(patrimonio)]);
  rows.push(['Activos – Pasivos – Patrimonio', num(cuadre)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BalanceGeneral');
  const filename = `finanzas_BG_${todayStr()}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Balance General exportado a Excel');
}

async function exportFlujoCajaExcel() {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  if (!finCachedData) {
    await refreshAllFin();
  }
  const data = finCachedData;
  if (!data || !Array.isArray(data.entries) || !data.entries.length) {
    alert('No hay datos contables para exportar el Flujo de Caja.');
    return;
  }

  const r = calcFlujoCaja(data);
  if (!r) {
    alert('Selecciona un periodo válido para exportar el Flujo de Caja.');
    return;
  }

  const num = (v) => Number((v || 0).toFixed(2));

  const rows = [];
  rows.push(['Flujo de Caja', '']);
  rows.push(['Periodo', `${r.desde} a ${r.hasta}`]);
  rows.push([]);
  rows.push(['Concepto', finPrimaryAmountHeader()]);
  rows.push(['Saldo inicial Caja + Banco', num(r.saldoInicial)]);
  rows.push(['Flujo neto de operación (cobros - pagos)', num(r.netOp)]);
  rows.push(['Flujo neto aportes / retiros del dueño', num(r.netOwner)]);
  rows.push(['Otros movimientos de caja', num(r.otros)]);
  rows.push(['Saldo final Caja + Banco', num(r.saldoFinal)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FlujoCaja');
  const filename = `finanzas_FC_${todayStr()}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Flujo de Caja exportado a Excel');
}

/* ---------- UI: helpers ---------- */

/* ---------- UI: helpers ---------- */

function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2000);
}

function fillMonthYearSelects() {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const months = [
    '01', '02', '03', '04', '05', '06',
    '07', '08', '09', '10', '11', '12'
  ];
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const tabMes = $('#tab-mes');
  const erMes = $('#er-mes');
  const comprasMes = $('#compras-mes');
  const tabAnio = $('#tab-anio');
  const erAnio = $('#er-anio');
  const comprasAnio = $('#compras-anio');

  if (tabMes) tabMes.innerHTML = '';
  if (erMes) erMes.innerHTML = '';
  if (comprasMes) comprasMes.innerHTML = '';

  months.forEach((m, idx) => {
    if (tabMes) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthNames[idx];
      tabMes.appendChild(opt);
    }
    if (erMes) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthNames[idx];
      erMes.appendChild(opt);
    }
    if (comprasMes) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = monthNames[idx];
      comprasMes.appendChild(opt);
    }
  });

  // Años: desde currentYear - 2 hasta currentYear + 1
  const years = [];
  for (let y = currentYear - 2; y <= currentYear + 1; y++) years.push(String(y));

  if (tabAnio) tabAnio.innerHTML = '';
  if (erAnio) erAnio.innerHTML = '';
  if (comprasAnio) comprasAnio.innerHTML = '';

  years.forEach(y => {
    if (tabAnio) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      tabAnio.appendChild(opt);
    }
    if (erAnio) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      erAnio.appendChild(opt);
    }
    if (comprasAnio) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      comprasAnio.appendChild(opt);
    }
  });

  if (tabMes) tabMes.value = pad2(currentMonth);
  if (erMes) erMes.value = pad2(currentMonth);
  if (comprasMes) comprasMes.value = pad2(currentMonth);
  if (tabAnio) tabAnio.value = String(currentYear);
  if (erAnio) erAnio.value = String(currentYear);
  if (comprasAnio) comprasAnio.value = String(currentYear);

  const bgFecha = $('#bg-fecha');
  if (bgFecha && !bgFecha.value) {
    bgFecha.value = todayStr();
  }

  const erDesde = $('#er-desde');
  const erHasta = $('#er-hasta');
  if (erDesde && erHasta) {
    const { start, end } = monthRange(currentYear, currentMonth);
    erDesde.value = start;
    erHasta.value = end;
  }

  const comprasDesde = $('#compras-desde');
  const comprasHasta = $('#compras-hasta');
  if (comprasDesde && comprasHasta) {
    const { start, end } = monthRange(currentYear, currentMonth);
    comprasDesde.value = start;
    comprasHasta.value = end;
  }

  const movFecha = $('#mov-fecha');
  if (movFecha && !movFecha.value) {
    movFecha.value = todayStr();
  }

  const compraFecha = $('#compra-fecha');
  if (compraFecha && !compraFecha.value) {
    compraFecha.value = todayStr();
  }
}

function updateEventFilters(dataOrEntries) {
  const eventos = buildEventList(dataOrEntries);
  const selects = [
    $('#tab-evento'),
    $('#filtro-evento-diario'),
    $('#er-evento')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'ALL';
    optAll.textContent = 'Todos los eventos';
    sel.appendChild(optAll);

    const optNone = document.createElement('option');
    optNone.value = 'NONE';
    optNone.textContent = 'Sin evento';
    sel.appendChild(optNone);

    eventos.forEach(ev => {
      const opt = document.createElement('option');
      opt.value = String(ev && ev.value || '');
      opt.textContent = String(ev && ev.label || ev && ev.value || 'Evento');
      sel.appendChild(opt);
    });

    if (prev && Array.from(sel.options).some(o => o.value === prev)) {
      sel.value = prev;
    } else {
      sel.value = 'ALL';
    }
  });
}

function updateSupplierSelects(data) {
  const suppliers = (data && Array.isArray(data.suppliers)) ? [...data.suppliers] : [];
  suppliers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  const suppliersForNewPurchases = finGetSuppliersForNewPurchases(data);

  // Diario: filtro proveedor
  const diarioSel = document.getElementById('filtro-proveedor');
  if (diarioSel) {
    const prev = diarioSel.value;
    diarioSel.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'todos';
    optAll.textContent = 'Todos';
    diarioSel.appendChild(optAll);

    const optNone = document.createElement('option');
    optNone.value = 'NONE';
    optNone.textContent = 'Sin proveedor';
    diarioSel.appendChild(optNone);

    for (const s of suppliers) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.nombre || `Proveedor ${s.id}`;
      diarioSel.appendChild(opt);
    }

    if (prev && Array.from(diarioSel.options).some(o => o.value === prev)) {
      diarioSel.value = prev;
    } else {
      diarioSel.value = 'todos';
    }
  }

  // Compras: selector proveedor (form) + selector reporte
  const compraSel = document.getElementById('compra-proveedor');
  if (compraSel) {
    const prev = compraSel.value;
    compraSel.innerHTML = '<option value="">Seleccione proveedor…</option>';
    for (const s of suppliersForNewPurchases) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.nombre || `Proveedor ${s.id}`;
      compraSel.appendChild(opt);
    }
    if (prev && Array.from(compraSel.options).some(o => o.value === prev)) {
      compraSel.value = prev;
    }

    // Producto asistido: mantener coherencia al refrescar proveedores
    try { compraUpdateProductoSelect(data); } catch (_) { /* noop */ }
  }

  const repSel = document.getElementById('compras-proveedor');
  if (repSel) {
    const prev = repSel.value;
    repSel.innerHTML = '';

    const optAll = document.createElement('option');
    optAll.value = 'ALL';
    optAll.textContent = 'Todos';
    repSel.appendChild(optAll);

    for (const s of suppliers) {
      const opt = document.createElement('option');
      opt.value = String(s.id);
      opt.textContent = s.nombre || `Proveedor ${s.id}`;
      repSel.appendChild(opt);
    }

    if (prev && Array.from(repSel.options).some(o => o.value === prev)) {
      repSel.value = prev;
    } else {
      repSel.value = 'ALL';
    }
  }
}

function fillCuentaSelect(data) {
  const sel = $('#mov-cuenta');
  if (!sel || !data) return;
  const tipoMov = ($('#mov-tipo')?.value) || 'ingreso';

  const cuentas = [...data.accounts].sort((a, b) =>
    String(a.code).localeCompare(String(b.code))
  );

  sel.innerHTML = '<option value="">Seleccione cuenta…</option>';

  for (const acc of cuentas) {
    // Cuentas inactivas, raíces y agrupadoras no deben aparecer en selects para movimientos nuevos.
    if (!finIsActiveAccount(acc) || (acc && acc.isHidden === true)) continue;
    if (finIsRootAccount(acc) || !finIsPostableAccount(acc)) continue;

    const tipo = getTipoCuenta(acc);
    let permitido = false;

    if (tipoMov === 'ingreso') {
      permitido = (tipo === 'ingreso');
    } else if (tipoMov === 'egreso') {
      permitido = (tipo === 'gasto' || tipo === 'costo');
    } else {
      // ajuste: permitimos todas
      permitido = true;
    }

    if (!permitido) continue;

    const nombre = acc.nombre || acc.name || `Cuenta ${acc.code}`;

    const opt = document.createElement('option');
    opt.value = String(acc.code);
    opt.textContent = `${acc.code} – ${nombre}`;
    sel.appendChild(opt);
  }
}


function finGetActiveFinancialAccountsForMovements(data) {
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts : [];
  const accountsMap = data && data.accountsMap ? data.accountsMap : new Map();
  return rows
    .filter(row => {
      if (!row || row.activa === false) return false;
      const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
      if (!code) return false;
      const mappedAcc = accountsMap && typeof accountsMap.get === 'function' ? accountsMap.get(code) : null;
      if (!mappedAcc) return false;
      if (!finIsActiveAccount(mappedAcc) || !finIsPostableAccount(mappedAcc)) return false;
      return true;
    })
    .sort((a, b) => {
      const ta = String(a.type || a.tipo || '').localeCompare(String(b.type || b.tipo || ''));
      if (ta) return ta;
      return String(a.nombreVisible || '').localeCompare(String(b.nombreVisible || ''), 'es');
    });
}

function finFinancialAccountMovementLabel(row) {
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || 'Cuenta financiera').trim();
  const type = finFinancialAccountTypeLabel(row && (row.type || row.tipo || 'caja'));
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || finCurrencySymbol(currency));
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  return `${name} · ${type} · ${symbol} · ${code}${accName ? ' ' + accName : ''}`;
}

function fillFinancialAccountSelect(data) {
  const sel = document.getElementById('mov-financial-account');
  if (!sel) return;
  const prev = sel.value;
  const rows = finGetActiveFinancialAccountsForMovements(data);
  sel.innerHTML = '';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = rows.length ? 'Seleccione cuenta financiera…' : 'Sin cuentas financieras activas';
  sel.appendChild(first);

  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = String(row.id || row.uniqueKey || '');
    opt.textContent = finFinancialAccountMovementLabel(row);
    opt.dataset.currency = finNormalizeCurrencyCode(row.moneda || 'NIO');
    opt.dataset.accountCode = finNormalizeAccountCode(row.cuentaContableCodigo || '');
    sel.appendChild(opt);
  }

  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  else if (!sel.value && rows.length === 1) sel.value = String(rows[0].id || rows[0].uniqueKey || '');

  updateManualMovementCurrencyPreview();
}

function finGetSelectedFinancialAccount(data) {
  const sel = document.getElementById('mov-financial-account');
  const id = String(sel && sel.value || '').trim();
  if (!id) return null;
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts : [];
  return rows.find(row => String(row && (row.id || row.uniqueKey || '')) === id) || null;
}

function finBuildManualMovementSnapshot(row, originalAmount, baseAmountNio, exchangeSnapshot) {
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const type = String(row && (row.type || row.tipo || 'caja') || 'caja').toLowerCase();
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || '').trim();
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || finCurrencySymbol(currency));
  const rate = currency === 'USD' ? finRoundCurrency2(exchangeSnapshot && exchangeSnapshot.tipoCambioUsado) : null;
  const rateDate = currency === 'USD' ? String((exchangeSnapshot && exchangeSnapshot.fechaTipoCambio) || '') : '';
  return {
    financialAccountId: String(row && (row.id || row.uniqueKey || '') || ''),
    financialAccountNameSnapshot: name,
    financialAccountType: type,
    financialAccountCurrency: currency,
    financialAccountSymbol: symbol,
    financialAccountAccountingCode: code,
    financialAccountAccountingNameSnapshot: accName,
    originalCurrency: currency,
    originalAmount: finRoundCurrency2(originalAmount),
    exchangeRateUsed: rate,
    exchangeRateDateSnapshot: rateDate,
    exchangeRateSource: currency === 'USD' ? FIN_CURRENCY_SOURCE_LABEL : '',
    baseCurrency: 'NIO',
    baseAmountNio: finRoundCurrency2(baseAmountNio),
    isMulticurrency: currency === 'USD',
    // Aliases en español para compatibilidad con helpers ya existentes.
    cuentaFinancieraId: String(row && (row.id || row.uniqueKey || '') || ''),
    cuentaFinancieraNombreSnapshot: name,
    cuentaFinancieraTipo: type,
    cuentaFinancieraMoneda: currency,
    cuentaFinancieraSimbolo: symbol,
    cuentaFinancieraCodigoContable: code,
    cuentaFinancieraNombreContableSnapshot: accName,
    monedaOriginal: currency,
    montoOriginal: finRoundCurrency2(originalAmount),
    tipoCambioUsado: rate,
    fechaTipoCambio: rateDate,
    fuenteTipoCambio: currency === 'USD' ? FIN_CURRENCY_SOURCE_LABEL : '',
    monedaBase: 'NIO',
    equivalenteNIO: finRoundCurrency2(baseAmountNio)
  };
}

function finGetEntryManualCurrencyMeta(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const has = entry.financialAccountId || entry.cuentaFinancieraId || entry.originalAmount != null || entry.montoOriginal != null;
  if (!has) return null;
  const currency = finNormalizeCurrencyCode(entry.originalCurrency || entry.monedaOriginal || entry.financialAccountCurrency || entry.cuentaFinancieraMoneda || 'NIO');
  const originalAmount = finParseCurrencyAmount(entry.originalAmount ?? entry.montoOriginal ?? entry.baseAmountNio ?? entry.equivalenteNIO ?? 0);
  const baseAmount = finParseCurrencyAmount(entry.baseAmountNio ?? entry.equivalenteNIO ?? entry.totalDebe ?? 0);
  const rate = finParseCurrencyAmount(entry.exchangeRateUsed ?? entry.tipoCambioUsado ?? '');
  return {
    financialAccountName: String(entry.financialAccountNameSnapshot || entry.cuentaFinancieraNombreSnapshot || '').trim(),
    financialAccountType: String(entry.financialAccountType || entry.cuentaFinancieraTipo || '').trim(),
    financialAccountAccountingCode: finNormalizeAccountCode(entry.financialAccountAccountingCode || entry.cuentaFinancieraCodigoContable || ''),
    originalCurrency: currency,
    originalAmount: Number.isFinite(originalAmount) ? originalAmount : null,
    baseAmountNio: Number.isFinite(baseAmount) ? baseAmount : null,
    exchangeRateUsed: Number.isFinite(rate) ? rate : null,
    exchangeRateDateSnapshot: String(entry.exchangeRateDateSnapshot || entry.fechaTipoCambio || '').trim(),
    exchangeRateSource: String(entry.exchangeRateSource || entry.fuenteTipoCambio || '').trim()
  };
}

function finRenderEntryFinancialBadges(entry) {
  const transferBadges = finRenderInternalTransferBadges(entry);
  if (transferBadges) return transferBadges;
  const meta = finGetEntryManualCurrencyMeta(entry);
  if (!meta) return '';
  const parts = [];
  if (meta.financialAccountName) parts.push(makePill(meta.financialAccountName, 'muted'));
  if (meta.originalAmount != null) parts.push(makePill(finFormatOriginalAmount(meta.originalAmount, meta.originalCurrency), meta.originalCurrency === 'USD' ? 'gold' : 'cash'));
  if (meta.originalCurrency === 'USD' && meta.exchangeRateUsed) parts.push(makePill(`T/C ${Number(meta.exchangeRateUsed).toFixed(2)}`, 'muted'));
  if (meta.baseAmountNio != null) parts.push(makePill(`Eq. ${finFormatCordobas(meta.baseAmountNio)}`, 'green'));
  return parts.length ? `<div class="fin-badge-strip">${parts.join(' ')}</div>` : '';
}

function updateManualMovementCurrencyPreview() {
  const box = document.getElementById('mov-financial-meta');
  if (!box) return;
  const data = finCachedData;
  const row = finGetSelectedFinancialAccount(data);
  const rows = finGetActiveFinancialAccountsForMovements(data);
  if (!rows.length) {
    box.className = 'fin-movement-meta is-warn';
    box.textContent = 'Configure al menos una cuenta financiera activa antes de registrar movimientos.';
    return;
  }
  if (!row) {
    box.className = 'fin-movement-meta';
    box.textContent = 'Seleccione una cuenta financiera activa para detectar moneda y cuenta contable.';
    return;
  }

  const currency = finNormalizeCurrencyCode(row.moneda || 'NIO');
  const code = finNormalizeAccountCode(row.cuentaContableCodigo || '');
  const amount = finParseCurrencyAmount(document.getElementById('mov-monto')?.value || '');
  const state = finGetCurrencyStateSafe();
  const name = row.nombreVisible || 'Cuenta financiera';
  const accName = row.cuentaContableNombreSnapshot || '';

  if (currency === 'USD' && !state.hasExchangeRate) {
    box.className = 'fin-movement-meta is-warn';
    box.innerHTML = `${escapeHtml(name)} · USD · ${escapeHtml(code)} ${escapeHtml(accName)}<br>${escapeHtml(FIN_CURRENCY_WARNING_MESSAGE)}`;
    return;
  }

  let calc = '';
  if (currency === 'USD' && Number.isFinite(amount) && amount > 0) {
    const converted = finConvertUsdToCordobas(amount, state.exchangeRate);
    if (converted.ok) calc = ` · ${finFormatDollars(amount)} × ${Number(state.exchangeRate).toFixed(2)} = ${converted.formatted}`;
  } else if (currency === 'NIO' && Number.isFinite(amount) && amount > 0) {
    calc = ` · Equivalente: ${finFormatCordobas(amount)}`;
  }

  box.className = 'fin-movement-meta';
  box.innerHTML = `${escapeHtml(name)} · ${escapeHtml(finFinancialAccountTypeLabel(row.type || row.tipo))} · ${escapeHtml(currency)} · ${escapeHtml(code)} ${escapeHtml(accName)}${escapeHtml(calc)}`;
}


/* ---------- Transferencias Internas (Etapa 6/10) ---------- */

const FIN_INTERNAL_TRANSFER_SOURCE = 'internal_transfer';
const FIN_INTERNAL_TRANSFER_TYPE = 'transferenciaInterna';
const FIN_TRANSFER_WARNING_MESSAGE = 'Configure el tipo de cambio vigente en Configuración → Moneda para registrar transferencias en US$.';

function finGetFinancialAccountId(row) {
  return String(row && (row.id || row.uniqueKey || '') || '').trim();
}

function finFindFinancialAccountById(data, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts : [];
  return rows.find(row => finGetFinancialAccountId(row) === key) || null;
}

function finFinancialAccountTransferOptionLabel(row) {
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || 'Cuenta financiera').trim();
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  return `${name} — ${finCurrencySymbol(currency)} · ${code}${accName ? ' ' + accName : ''}`;
}

function finGetActiveFinancialAccountsForTransfers(data) {
  return finGetActiveFinancialAccountsForMovements(data);
}

function finPopulateTransferAccountSelects(data) {
  const originSel = document.getElementById('ti-origen');
  const destSel = document.getElementById('ti-destino');
  if (!originSel || !destSel) return;

  const rows = finGetActiveFinancialAccountsForTransfers(data);
  const prevOrigin = originSel.value;
  const prevDest = destSel.value;

  const build = (sel, placeholder) => {
    sel.innerHTML = '';
    const first = document.createElement('option');
    first.value = '';
    first.textContent = rows.length ? placeholder : 'Sin cuentas financieras activas';
    sel.appendChild(first);
    for (const row of rows) {
      const opt = document.createElement('option');
      opt.value = finGetFinancialAccountId(row);
      opt.textContent = finFinancialAccountTransferOptionLabel(row);
      opt.dataset.currency = finNormalizeCurrencyCode(row.moneda || 'NIO');
      opt.dataset.accountCode = finNormalizeAccountCode(row.cuentaContableCodigo || '');
      sel.appendChild(opt);
    }
  };

  build(originSel, 'Seleccione origen…');
  build(destSel, 'Seleccione destino…');

  if (prevOrigin && Array.from(originSel.options).some(o => o.value === prevOrigin)) originSel.value = prevOrigin;
  else if (rows.length >= 1) originSel.value = finGetFinancialAccountId(rows[0]);

  if (prevDest && Array.from(destSel.options).some(o => o.value === prevDest)) destSel.value = prevDest;
  else if (rows.length >= 2) destSel.value = finGetFinancialAccountId(rows.find(r => finGetFinancialAccountId(r) !== originSel.value) || rows[1]);

  if (originSel.value && destSel.value && originSel.value === destSel.value && rows.length >= 2) {
    const alt = rows.find(r => finGetFinancialAccountId(r) !== originSel.value);
    if (alt) destSel.value = finGetFinancialAccountId(alt);
  }
}

function finTransferRequiresExchangeRate(originCurrency, destCurrency) {
  return finNormalizeCurrencyCode(originCurrency) === 'USD' || finNormalizeCurrencyCode(destCurrency) === 'USD';
}


function finTransferRoundingTolerance(rate, currencyWithTwoDecimalLimit = 'NIO') {
  const r = Number(rate);
  if (finNormalizeCurrencyCode(currencyWithTwoDecimalLimit) === 'USD' && Number.isFinite(r) && r > 0) {
    // Medio centavo de dólar convertido a C$ + colchón mínimo por redondeo doble.
    return Math.max(0.05, finRoundCurrency2((r * 0.005) + 0.02));
  }
  return 0.05;
}

function finGetTransferAccountsFromUI() {
  const data = finCachedData;
  const originId = String(document.getElementById('ti-origen')?.value || '').trim();
  const destId = String(document.getElementById('ti-destino')?.value || '').trim();
  return {
    originId,
    destId,
    origin: finFindFinancialAccountById(data, originId),
    dest: finFindFinancialAccountById(data, destId)
  };
}

function finTransferAccountSnapshot(row, rolePrefix) {
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const type = String(row && (row.type || row.tipo || 'caja') || 'caja').toLowerCase();
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || '').trim();
  return {
    [`cuenta${rolePrefix}Id`]: finGetFinancialAccountId(row),
    [`cuenta${rolePrefix}NombreSnapshot`]: name,
    [`cuenta${rolePrefix}Tipo`]: type,
    [`cuenta${rolePrefix}Moneda`]: currency,
    [`cuenta${rolePrefix}CuentaContableCodigo`]: code,
    [`cuenta${rolePrefix}CuentaContableNombreSnapshot`]: accName
  };
}

function finSetTransferMeta(message, isWarn = false) {
  const box = document.getElementById('ti-meta');
  if (!box) return;
  box.className = `fin-movement-meta${isWarn ? ' is-warn' : ''}`;
  box.innerHTML = message;
}

function finBuildTransferCalculation({ origin, dest, amountOriginRaw, amountDestRaw, explicitRate } = {}) {
  const originCurrency = finNormalizeCurrencyCode(origin && (origin.moneda || origin.financialAccountCurrency || 'NIO'));
  const destCurrency = finNormalizeCurrencyCode(dest && (dest.moneda || dest.financialAccountCurrency || 'NIO'));
  const amountOrigin = finParseCurrencyAmount(amountOriginRaw);
  let amountDest = finParseCurrencyAmount(amountDestRaw);
  const state = finGetCurrencyStateSafe();
  const requiresRate = finTransferRequiresExchangeRate(originCurrency, destCurrency);
  const rate = explicitRate != null && explicitRate !== '' ? Number(finNormalizeExchangeRateValue(explicitRate)) : state.exchangeRate;

  const base = {
    ok: false,
    originCurrency,
    destCurrency,
    amountOrigin: Number.isFinite(amountOrigin) ? finRoundCurrency2(amountOrigin) : null,
    amountDest: Number.isFinite(amountDest) ? finRoundCurrency2(amountDest) : null,
    requiresRate,
    exchangeRateUsed: requiresRate && Number.isFinite(rate) && rate > 0 ? finRoundCurrency2(rate) : null,
    exchangeRateDateSnapshot: requiresRate ? (state.updatedAtText || '') : '',
    exchangeRateSource: requiresRate ? FIN_CURRENCY_SOURCE_LABEL : '',
    equivalenteNIO: null,
    destEquivalentNIO: null,
    warningMessage: ''
  };

  if (!origin || !dest) return { ...base, warningMessage: 'Seleccione cuenta origen y cuenta destino.' };
  if (finGetFinancialAccountId(origin) && finGetFinancialAccountId(origin) === finGetFinancialAccountId(dest)) {
    return { ...base, warningMessage: 'La cuenta origen y destino no pueden ser la misma.' };
  }
  if (!(Number.isFinite(amountOrigin) && amountOrigin > 0)) {
    return { ...base, warningMessage: 'El monto origen debe ser mayor que cero.' };
  }
  if (requiresRate && !(Number.isFinite(rate) && rate > 0)) {
    return { ...base, warningMessage: FIN_TRANSFER_WARNING_MESSAGE };
  }

  let suggestedDest = null;
  let equivalent = null;
  let destEquivalent = null;

  if (originCurrency === destCurrency) {
    suggestedDest = finRoundCurrency2(amountOrigin);
    if (!(Number.isFinite(amountDest) && amountDest > 0)) amountDest = suggestedDest;
    if (Math.abs(finRoundCurrency2(amountDest) - suggestedDest) > 0.005) {
      return { ...base, amountDest: finRoundCurrency2(amountDest), warningMessage: 'En transferencias de la misma moneda, monto origen y destino deben ser iguales.' };
    }
    equivalent = originCurrency === 'USD' ? finRoundCurrency2(amountOrigin * rate) : finRoundCurrency2(amountOrigin);
    destEquivalent = equivalent;
  } else if (originCurrency === 'NIO' && destCurrency === 'USD') {
    suggestedDest = finRoundCurrency2(amountOrigin / rate);
    if (!(Number.isFinite(amountDest) && amountDest > 0)) amountDest = suggestedDest;
    destEquivalent = finRoundCurrency2(amountDest * rate);
    equivalent = finRoundCurrency2(amountOrigin);
    const diff = Math.abs(finRoundCurrency2(destEquivalent - equivalent));
    const tolerance = finTransferRoundingTolerance(rate, 'USD');
    if (diff > tolerance) {
      return {
        ...base,
        amountDest: finRoundCurrency2(amountDest),
        equivalenteNIO: equivalent,
        destEquivalentNIO: destEquivalent,
        warningMessage: 'El monto destino no cuadra con el T/C vigente. Solo se permiten diferencias de redondeo.'
      };
    }
    destEquivalent = equivalent; // ajuste controlado por redondeo para asiento balanceado
  } else if (originCurrency === 'USD' && destCurrency === 'NIO') {
    suggestedDest = finRoundCurrency2(amountOrigin * rate);
    if (!(Number.isFinite(amountDest) && amountDest > 0)) amountDest = suggestedDest;
    equivalent = finRoundCurrency2(amountDest);
    destEquivalent = finRoundCurrency2(amountOrigin * rate);
    const diff = Math.abs(finRoundCurrency2(destEquivalent - equivalent));
    const tolerance = finTransferRoundingTolerance(rate, 'NIO');
    if (diff > tolerance) {
      return {
        ...base,
        amountDest: finRoundCurrency2(amountDest),
        equivalenteNIO: equivalent,
        destEquivalentNIO: destEquivalent,
        warningMessage: 'El monto destino no cuadra con el T/C vigente. Solo se permiten diferencias de redondeo.'
      };
    }
    destEquivalent = equivalent; // ajuste controlado por redondeo para asiento balanceado
  }

  if (!(Number.isFinite(equivalent) && equivalent > 0)) {
    return { ...base, amountDest: finRoundCurrency2(amountDest), warningMessage: 'El equivalente contable en C$ es inválido.' };
  }

  return {
    ...base,
    ok: true,
    amountOrigin: finRoundCurrency2(amountOrigin),
    amountDest: finRoundCurrency2(amountDest),
    suggestedDest: finRoundCurrency2(suggestedDest),
    equivalenteNIO: finRoundCurrency2(equivalent),
    destEquivalentNIO: finRoundCurrency2(destEquivalent),
    warningMessage: ''
  };
}

function updateInternalTransferPreview() {
  const data = finCachedData;
  const rows = finGetActiveFinancialAccountsForTransfers(data);
  const status = document.getElementById('ti-status');
  const originCurrencyEl = document.getElementById('ti-moneda-origen');
  const destCurrencyEl = document.getElementById('ti-moneda-destino');
  const rateInput = document.getElementById('ti-tc');
  const equivalentInput = document.getElementById('ti-equivalente');
  const amountDestInput = document.getElementById('ti-monto-destino');

  if (status) {
    status.textContent = rows.length >= 2
      ? 'Transferencias Internas usa Cuentas Financieras activas. No toca ingresos, egresos, compras, recibos ni Caja Chica.'
      : 'Configure al menos dos cuentas financieras activas para registrar transferencias internas.';
    status.className = rows.length >= 2 ? 'fin-help fa-status-ok' : 'fin-help fa-status-warn';
  }

  const { origin, dest } = finGetTransferAccountsFromUI();
  const originCurrency = finNormalizeCurrencyCode(origin && (origin.moneda || origin.financialAccountCurrency || 'NIO'));
  const destCurrency = finNormalizeCurrencyCode(dest && (dest.moneda || dest.financialAccountCurrency || 'NIO'));

  if (originCurrencyEl) originCurrencyEl.value = origin ? originCurrency : '';
  if (destCurrencyEl) destCurrencyEl.value = dest ? destCurrency : '';

  const state = finGetCurrencyStateSafe();
  const requiresRate = finTransferRequiresExchangeRate(originCurrency, destCurrency) && origin && dest;
  if (rateInput) {
    rateInput.value = requiresRate && state.hasExchangeRate ? Number(state.exchangeRate).toFixed(2) : '';
    rateInput.disabled = !requiresRate;
    rateInput.readOnly = true;
  }

  const amountOriginRaw = document.getElementById('ti-monto-origen')?.value || '';
  const calc = finBuildTransferCalculation({
    origin,
    dest,
    amountOriginRaw,
    amountDestRaw: amountDestInput?.value || '',
    explicitRate: rateInput?.value || ''
  });

  if (amountDestInput) {
    amountDestInput.disabled = !(origin && dest);
    amountDestInput.placeholder = origin && dest
      ? (originCurrency === destCurrency ? 'Igual al origen' : (destCurrency === 'USD' ? 'Se sugiere en US$' : 'Se sugiere en C$'))
      : 'Seleccione cuentas';
  }
  if (equivalentInput) equivalentInput.value = calc.equivalenteNIO ? finFormatCordobas(calc.equivalenteNIO) : '';

  if (!origin || !dest) {
    finSetTransferMeta('Seleccione origen y destino para detectar monedas, T/C y asiento contable.', false);
    return;
  }
  if (rows.length < 2) {
    finSetTransferMeta('Configure al menos dos cuentas financieras activas para registrar transferencias internas.', true);
    return;
  }
  if (requiresRate && !state.hasExchangeRate) {
    finSetTransferMeta(escapeHtml(FIN_TRANSFER_WARNING_MESSAGE), true);
    return;
  }

  if (calc.ok) {
    const rateText = calc.requiresRate ? ` · T/C snapshot ${Number(calc.exchangeRateUsed).toFixed(2)}` : '';
    const convText = originCurrency === destCurrency
      ? `${finFormatOriginalAmount(calc.amountOrigin, originCurrency)} → ${finFormatOriginalAmount(calc.amountDest, destCurrency)}`
      : `${finFormatOriginalAmount(calc.amountOrigin, originCurrency)} → ${finFormatOriginalAmount(calc.amountDest, destCurrency)}${rateText}`;
    finSetTransferMeta(`${escapeHtml(origin.nombreVisible || 'Origen')} → ${escapeHtml(dest.nombreVisible || 'Destino')}<br>${escapeHtml(convText)} · Asiento: DEBE destino / HABER origen · ${escapeHtml(finFormatCordobas(calc.equivalenteNIO))}`, false);
    return;
  }

  finSetTransferMeta(escapeHtml(calc.warningMessage || 'Complete los datos de la transferencia.'), !!calc.warningMessage);
}

function finSuggestTransferDestinationAmount(force = false) {
  const amountDestInput = document.getElementById('ti-monto-destino');
  if (!amountDestInput) return;
  if (!force && String(amountDestInput.value || '').trim()) return;
  const { origin, dest } = finGetTransferAccountsFromUI();
  const rateValue = document.getElementById('ti-tc')?.value || '';
  const calc = finBuildTransferCalculation({
    origin,
    dest,
    amountOriginRaw: document.getElementById('ti-monto-origen')?.value || '',
    amountDestRaw: '',
    explicitRate: rateValue
  });
  if (calc.amountDest && Number.isFinite(calc.amountDest)) {
    amountDestInput.value = Number(calc.amountDest).toFixed(2);
  }
}

function finBuildInternalTransferSnapshot(origin, dest, calc, reference, descripcion, fecha) {
  const nowISO = new Date().toISOString();
  const transferId = `trf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const originSnap = finTransferAccountSnapshot(origin, 'Origen');
  const destSnap = finTransferAccountSnapshot(dest, 'Destino');
  const originName = originSnap.cuentaOrigenNombreSnapshot || 'Origen';
  const destName = destSnap.cuentaDestinoNombreSnapshot || 'Destino';
  return {
    transferId,
    fecha,
    tipoOperacion: FIN_INTERNAL_TRANSFER_TYPE,
    operationType: FIN_INTERNAL_TRANSFER_TYPE,
    source: FIN_INTERNAL_TRANSFER_SOURCE,
    ...originSnap,
    ...destSnap,
    montoOrigen: finRoundCurrency2(calc.amountOrigin),
    monedaOrigen: calc.originCurrency,
    montoDestino: finRoundCurrency2(calc.amountDest),
    monedaDestino: calc.destCurrency,
    tipoCambioUsado: calc.requiresRate ? finRoundCurrency2(calc.exchangeRateUsed) : null,
    fechaTipoCambioSnapshot: calc.requiresRate ? (calc.exchangeRateDateSnapshot || '') : '',
    fuenteTipoCambio: calc.requiresRate ? FIN_CURRENCY_SOURCE_LABEL : '',
    equivalenteNIO: finRoundCurrency2(calc.equivalenteNIO),
    baseCurrency: 'NIO',
    referencia: reference,
    reference,
    descripcion: descripcion || `Transferencia interna: ${originName} → ${destName}`,
    createdAtISO: nowISO,
    updatedAtISO: nowISO
  };
}

function finGetEntryInternalTransferMeta(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const raw = entry.internalTransferSnapshot || entry.transferSnapshot || entry;
  const type = String(raw.tipoOperacion || entry.tipoOperacion || entry.operationType || '').trim();
  const src = String(entry.source || raw.source || '').trim();
  const tipoMov = String(entry.tipoMovimiento || '').trim();
  if (type !== FIN_INTERNAL_TRANSFER_TYPE && src !== FIN_INTERNAL_TRANSFER_SOURCE && tipoMov !== 'transferencia') return null;

  const amountOrigin = finParseCurrencyAmount(raw.montoOrigen ?? entry.montoOrigen ?? entry.originalAmount ?? entry.montoOriginal ?? 0);
  const amountDest = finParseCurrencyAmount(raw.montoDestino ?? entry.montoDestino ?? 0);
  const equivalent = finParseCurrencyAmount(raw.equivalenteNIO ?? entry.equivalenteNIO ?? entry.baseAmountNio ?? entry.totalDebe ?? 0);
  const rate = finParseCurrencyAmount(raw.tipoCambioUsado ?? entry.tipoCambioUsado ?? entry.exchangeRateUsed ?? '');
  return {
    transferId: String(raw.transferId || entry.transferId || '').trim(),
    originName: String(raw.cuentaOrigenNombreSnapshot || entry.cuentaOrigenNombreSnapshot || '').trim(),
    originCurrency: finNormalizeCurrencyCode(raw.monedaOrigen || raw.cuentaOrigenMoneda || entry.monedaOrigen || 'NIO'),
    amountOrigin: Number.isFinite(amountOrigin) ? amountOrigin : null,
    destName: String(raw.cuentaDestinoNombreSnapshot || entry.cuentaDestinoNombreSnapshot || '').trim(),
    destCurrency: finNormalizeCurrencyCode(raw.monedaDestino || raw.cuentaDestinoMoneda || entry.monedaDestino || 'NIO'),
    amountDest: Number.isFinite(amountDest) ? amountDest : null,
    exchangeRateUsed: Number.isFinite(rate) ? rate : null,
    equivalentNio: Number.isFinite(equivalent) ? equivalent : null,
    reference: String(raw.reference || raw.referencia || entry.reference || '').trim(),
    source: String(raw.fuenteTipoCambio || entry.fuenteTipoCambio || '').trim()
  };
}

function finRenderInternalTransferBadges(entry) {
  const meta = finGetEntryInternalTransferMeta(entry);
  if (!meta) return '';
  const parts = [];
  const origin = `${meta.originName || 'Origen'}: ${finFormatOriginalAmount(meta.amountOrigin || 0, meta.originCurrency)}`;
  const dest = `${meta.destName || 'Destino'}: ${finFormatOriginalAmount(meta.amountDest || 0, meta.destCurrency)}`;
  parts.push(makePill(origin, 'muted'));
  parts.push(makePill(dest, meta.destCurrency === 'USD' ? 'gold' : 'cash'));
  if (meta.exchangeRateUsed) parts.push(makePill(`T/C ${Number(meta.exchangeRateUsed).toFixed(2)}`, 'muted'));
  if (meta.equivalentNio != null) parts.push(makePill(`Eq. ${finFormatCordobas(meta.equivalentNio)}`, 'green'));
  return parts.length ? `<div class="fin-badge-strip">${parts.join(' ')}</div>` : '';
}

async function createInternalTransferWithJournalAtomic(transfer, entry, lines) {
  await openFinDB();
  return new Promise((resolve, reject) => {
    let tx;
    let entryId = null;
    try {
      tx = finDB.transaction(['internalTransfers', 'journalEntries', 'journalLines'], 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }

    const stT = tx.objectStore('internalTransfers');
    const stE = tx.objectStore('journalEntries');
    const stL = tx.objectStore('journalLines');

    const req = stE.add(entry);
    req.onsuccess = (e) => {
      entryId = e.target.result;
      const savedTransfer = { ...transfer, journalEntryId: entryId };
      stT.put(savedTransfer);
      for (const ln of (Array.isArray(lines) ? lines : [])) {
        stL.add({ ...ln, idEntry: entryId, journalEntryId: entryId, entryId });
      }
    };

    tx.oncomplete = () => resolve({ entryId, transferId: transfer && transfer.transferId });
    tx.onabort = () => reject(tx.error || new Error('Transacción de transferencia abortada'));
    tx.onerror = () => { /* onabort maneja */ };
  });
}

async function guardarTransferenciaInterna() {
  if (!finCachedData) await refreshAllFin();
  const rows = finGetActiveFinancialAccountsForTransfers(finCachedData);
  if (rows.length < 2) {
    alert('Configure al menos dos cuentas financieras activas para registrar transferencias internas.');
    return;
  }

  const fecha = document.getElementById('ti-fecha')?.value || todayStr();
  const { origin, dest } = finGetTransferAccountsFromUI();
  const reference = String(document.getElementById('ti-referencia')?.value || '').trim();
  const descripcion = String(document.getElementById('ti-descripcion')?.value || '').trim();
  const amountOriginRaw = document.getElementById('ti-monto-origen')?.value || '';
  const amountDestRaw = document.getElementById('ti-monto-destino')?.value || '';
  const rateRaw = document.getElementById('ti-tc')?.value || '';

  if (!fecha) { alert('Ingresa la fecha de la transferencia.'); return; }
  if (!origin) { alert('Selecciona la cuenta financiera origen.'); return; }
  if (!dest) { alert('Selecciona la cuenta financiera destino.'); return; }
  if (finGetFinancialAccountId(origin) === finGetFinancialAccountId(dest)) { alert('La cuenta origen y destino no pueden ser la misma.'); return; }

  const originCode = finNormalizeAccountCode(origin.cuentaContableCodigo || '');
  const destCode = finNormalizeAccountCode(dest.cuentaContableCodigo || '');
  const accountsMap = finCachedData && finCachedData.accountsMap ? finCachedData.accountsMap : new Map();
  if (!originCode || !accountsMap.get(originCode)) { alert('La cuenta origen no tiene una cuenta contable válida asociada.'); return; }
  if (!destCode || !accountsMap.get(destCode)) { alert('La cuenta destino no tiene una cuenta contable válida asociada.'); return; }

  const calc = finBuildTransferCalculation({ origin, dest, amountOriginRaw, amountDestRaw, explicitRate: rateRaw });
  if (!calc.ok) {
    alert(calc.warningMessage || 'Revise los datos de la transferencia.');
    return;
  }

  const totalDebe = finRoundCurrency2(calc.equivalenteNIO);
  const totalHaber = finRoundCurrency2(calc.equivalenteNIO);
  if (!(Number.isFinite(totalDebe) && totalDebe > 0) || Math.abs(totalDebe - totalHaber) > 0.005) {
    alert('El asiento no cuadra. No se guardó la transferencia.');
    return;
  }

  const transfer = finBuildInternalTransferSnapshot(origin, dest, calc, reference, descripcion, fecha);
  const description = transfer.descripcion;
  const entry = {
    fecha,
    descripcion: description,
    tipoMovimiento: 'transferencia',
    tipoOperacion: FIN_INTERNAL_TRANSFER_TYPE,
    operationType: FIN_INTERNAL_TRANSFER_TYPE,
    reference,
    eventScope: 'CENTRAL',
    origen: 'Interno',
    origenId: null,
    source: FIN_INTERNAL_TRANSFER_SOURCE,
    entryType: 'internal_transfer',
    paymentMethod: 'internal_transfer',
    medio: 'transferencia_interna',
    totalDebe,
    totalHaber,
    transferId: transfer.transferId,
    internalTransferSnapshot: transfer,
    // Compatibilidad con badges/exportación multimoneda: mostrar origen como moneda original principal.
    originalCurrency: calc.originCurrency,
    originalAmount: finRoundCurrency2(calc.amountOrigin),
    exchangeRateUsed: calc.requiresRate ? finRoundCurrency2(calc.exchangeRateUsed) : null,
    exchangeRateDateSnapshot: calc.requiresRate ? (calc.exchangeRateDateSnapshot || '') : '',
    exchangeRateSource: calc.requiresRate ? FIN_CURRENCY_SOURCE_LABEL : '',
    baseCurrency: 'NIO',
    baseAmountNio: totalDebe,
    equivalenteNIO: totalDebe,
    montoOriginal: finRoundCurrency2(calc.amountOrigin),
    monedaOriginal: calc.originCurrency,
    tipoCambioUsado: calc.requiresRate ? finRoundCurrency2(calc.exchangeRateUsed) : null,
    fechaTipoCambio: calc.requiresRate ? (calc.exchangeRateDateSnapshot || '') : '',
    fuenteTipoCambio: calc.requiresRate ? FIN_CURRENCY_SOURCE_LABEL : ''
  };

  const common = {
    internalTransferId: transfer.transferId,
    transferId: transfer.transferId,
    baseCurrency: 'NIO',
    baseAmountNio: totalDebe,
    exchangeRateUsed: calc.requiresRate ? finRoundCurrency2(calc.exchangeRateUsed) : null,
    exchangeRateSource: calc.requiresRate ? FIN_CURRENCY_SOURCE_LABEL : ''
  };

  const lines = [
    {
      accountCode: destCode,
      debe: totalDebe,
      haber: 0,
      accountNameSnapshot: getAccountDisplayNameByCode(destCode, accountsMap),
      financialAccountId: finGetFinancialAccountId(dest),
      originalCurrency: calc.destCurrency,
      originalAmount: finRoundCurrency2(calc.amountDest),
      ...common
    },
    {
      accountCode: originCode,
      debe: 0,
      haber: totalHaber,
      accountNameSnapshot: getAccountDisplayNameByCode(originCode, accountsMap),
      financialAccountId: finGetFinancialAccountId(origin),
      originalCurrency: calc.originCurrency,
      originalAmount: finRoundCurrency2(calc.amountOrigin),
      ...common
    }
  ];

  try {
    await createInternalTransferWithJournalAtomic(transfer, entry, lines);
  } catch (err) {
    console.error('Error guardando transferencia interna', err);
    alert('No se pudo guardar la transferencia interna.');
    return;
  }

  const amountOriginInput = document.getElementById('ti-monto-origen');
  const amountDestInput = document.getElementById('ti-monto-destino');
  const refInput = document.getElementById('ti-referencia');
  const descInput = document.getElementById('ti-descripcion');
  if (amountOriginInput) amountOriginInput.value = '';
  if (amountDestInput) amountDestInput.value = '';
  if (refInput) refInput.value = '';
  if (descInput) descInput.value = '';

  showToast('Transferencia interna guardada');
  await refreshAllFin();
}

function renderInternalTransfersView(data) {
  finPopulateTransferAccountSelects(data);
  const dateInput = document.getElementById('ti-fecha');
  if (dateInput && !dateInput.value) dateInput.value = todayStr();
  updateInternalTransferPreview();

  const host = document.getElementById('ti-list');
  if (!host) return;
  const transfers = Array.isArray(data && data.internalTransfers) ? data.internalTransfers : [];
  const sorted = transfers.slice().sort((a, b) => {
    const fa = String(a.fecha || '');
    const fb = String(b.fecha || '');
    if (fa === fb) return String(b.createdAtISO || '').localeCompare(String(a.createdAtISO || ''));
    return fb.localeCompare(fa);
  });

  if (!sorted.length) {
    host.innerHTML = '<div class="fa-empty">Todavía no hay transferencias internas registradas.</div>';
    return;
  }

  host.innerHTML = sorted.map(t => {
    const origin = `${t.cuentaOrigenNombreSnapshot || 'Origen'} · ${finFormatOriginalAmount(t.montoOrigen || 0, t.monedaOrigen || 'NIO')}`;
    const dest = `${t.cuentaDestinoNombreSnapshot || 'Destino'} · ${finFormatOriginalAmount(t.montoDestino || 0, t.monedaDestino || 'NIO')}`;
    const rate = t.tipoCambioUsado ? `<span>${escapeHTML(`T/C ${Number(t.tipoCambioUsado).toFixed(2)}`)}</span>` : '';
    const ref = t.reference || t.referencia ? `<span>${escapeHTML(`Ref: ${t.reference || t.referencia}`)}</span>` : '';
    return `
      <article class="ti-card">
        <div class="ti-card-head">
          <strong>${escapeHTML(t.fecha || '')}</strong>
          <span class="fin-pill fin-pill--green">Transferencia interna</span>
        </div>
        <div class="ti-route">
          <div><small>Origen</small><b>${escapeHTML(origin)}</b></div>
          <div><small>Destino</small><b>${escapeHTML(dest)}</b></div>
        </div>
        <div class="ti-card-meta">
          ${rate}
          <span>${escapeHTML(`Eq. ${finFormatCordobas(t.equivalenteNIO || 0)}`)}</span>
          ${ref}
          ${t.journalEntryId ? `<span>${escapeHTML(`Diario #${t.journalEntryId}`)}</span>` : ''}
        </div>
        ${t.descripcion ? `<p>${escapeHTML(t.descripcion)}</p>` : ''}
      </article>
    `;
  }).join('');
}

function setupInternalTransfersUI() {
  const ids = ['ti-origen', 'ti-destino', 'ti-monto-origen', 'ti-monto-destino'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const evName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evName, () => {
      if (id === 'ti-origen' || id === 'ti-destino' || id === 'ti-monto-origen') {
        finSuggestTransferDestinationAmount(true);
      }
      updateInternalTransferPreview();
    });
  });

  const btn = document.getElementById('ti-guardar');
  if (btn) {
    btn.addEventListener('click', () => {
      guardarTransferenciaInterna().catch(err => {
        console.error('Error guardando transferencia interna', err);
        alert('No se pudo guardar la transferencia interna.');
      });
    });
  }
}

/* ---------- Render: Tablero ---------- */

function finDashboardAccountText(account, line) {
  const parts = [];
  if (account && typeof account === 'object') {
    parts.push(
      finGetAccountCode(account),
      finGetAccountName(account),
      account.tipo,
      account.type,
      account.category,
      account.categoria,
      account.rubro,
      account.group,
      account.grupo,
      account.clase,
      account.accountClass,
      account.dashboardClass,
      account.reportClass,
      account.classification,
      account.clasificacion
    );
  }
  if (line && typeof line === 'object') {
    parts.push(
      line.accountCode,
      line.accountName,
      line.accountNameSnapshot,
      line.accountNombre,
      line.nombreCuenta,
      line.category,
      line.categoria,
      line.rubro,
      line.classification,
      line.clasificacion
    );
  }
  return normStr(parts.filter(v => v != null && String(v).trim()).join(' '), 400);
}

function finDashboardAccountType(account, line) {
  let raw = '';
  if (account && typeof account === 'object') raw = String(finGetAccountType(account) || getTipoCuenta(account) || '').toLowerCase();
  else {
    const code = finGetAccountCode(line && line.accountCode);
    raw = String(inferTipoFromCode(code) || '').toLowerCase();
  }
  if (raw === 'otros_ingresos' || raw === 'otro_ingreso') return 'ingreso';
  if (raw === 'capital') return 'patrimonio';
  return raw;
}

function finDashboardRootCode(account, line) {
  return finGetRootFromCode(finGetAccountCode(account || (line && line.accountCode)));
}

function finDashboardIsOtherIncome(account, line) {
  const tipo = finDashboardAccountType(account, line);
  if (tipo !== 'ingreso') return false;
  const root = finDashboardRootCode(account, line);
  const text = finDashboardAccountText(account, line);
  if (root === '7000') return true;
  return /(^|\s)(otro|otros)\s+ingres/.test(text) || /ingreso\s+no\s+operativ/.test(text) || /no\s+operativ/.test(text);
}

function finDashboardIsCommercialAdjustment(account, line) {
  const code = finGetAccountCode(account || (line && line.accountCode));
  const text = finDashboardAccountText(account, line);
  if (code === '6105') return true;
  return /(cortesia|cortesias|descuento|descuentos|ajuste\s+comercial|ajustes\s+comerciales|promocion|promociones|bonificacion|bonificaciones)/.test(text);
}

function finDashboardLineNaturalAmount(account, line) {
  const tipo = finDashboardAccountType(account, line);
  const debe = n0(line && line.debe);
  const haber = n0(line && line.haber);
  if (tipo === 'ingreso') return haber - debe;
  if (tipo === 'costo' || tipo === 'gasto' || tipo === 'activo') return debe - haber;
  if (tipo === 'pasivo' || tipo === 'patrimonio') return haber - debe;
  return debe - haber;
}

function finDashboardSafePct(num, den) {
  const d = n0(den);
  if (!Number.isFinite(d) || Math.abs(d) < 0.005) return 0;
  const pct = (n0(num) / d) * 100;
  return Number.isFinite(pct) ? n2(pct) : 0;
}

function finDashboardFormatPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(2)}%`;
}

function finDashboardDate(record) {
  if (!record || typeof record !== 'object') return '';
  const candidates = [record.dateISO, record.fecha, record.date, record.dayKey, record.dateKey, record.createdAtISO, record.createdAt];
  for (const v of candidates) {
    if (v == null || v === '') continue;
    if (typeof v === 'number') {
      try {
        const d = new Date(v);
        if (Number.isFinite(d.getTime())) return d.toISOString().slice(0, 10);
      } catch (_) {}
    }
    const s = String(v || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) {
      try { return new Date(parsed).toISOString().slice(0, 10); } catch (_) {}
    }
  }
  return '';
}

function finDashboardInRange(record, filtros = {}) {
  const date = finDashboardDate(record);
  if (filtros.desde && (!date || date < filtros.desde)) return false;
  if (filtros.hasta && (!date || date > filtros.hasta)) return false;
  return true;
}

function finDashboardEventId(value) {
  const n = (typeof value === 'number') ? value : parseInt(String(value || '').trim(), 10);
  return (Number.isFinite(n) && n > 0) ? n : null;
}

function finDashboardEventLabelFromRecord(record) {
  if (!record || typeof record !== 'object') return '';
  const id = finDashboardEventId(record.posEventId || record.eventId);
  const live = id ? getPosEventNameLiveById(id) : '';
  return String(record.eventName || record.eventNameSnapshot || record.posEventNameSnapshot || record.eventScope || record.evento || live || '').trim();
}

function finDashboardRecordMatchesEvent(record, eventFilter) {
  const raw = String(eventFilter || '').trim();
  const upper = raw.toUpperCase();
  if (!raw || upper === 'ALL' || upper === 'GLOBAL') return true;
  const id = finDashboardEventId(record && (record.posEventId || record.eventId));
  const label = finDashboardEventLabelFromRecord(record);
  if (upper === 'NONE') return !id && !label;
  if (raw.startsWith('POS:')) return String(id || '') === raw.slice(4);
  return !!(label && normStr(label) === normStr(displayEventLabel(raw)));
}

function finDashboardEventKey(record) {
  const id = finDashboardEventId(record && (record.posEventId || record.eventId));
  if (id) return `POS:${id}`;
  const label = finDashboardEventLabelFromRecord(record);
  return label ? `LEGACY:${normStr(label)}` : 'NONE';
}

function finDashboardPaymentBucket(value) {
  const raw = normStr(value || '');
  if (!raw) return 'cash';
  if (raw.includes('credito') || raw.includes('credit')) return 'credit';
  if (raw.includes('transfer') || raw.includes('banco') || raw.includes('bank') || raw.includes('tarjeta') || raw.includes('card')) return 'bank';
  if (raw.includes('efectivo') || raw.includes('cash')) return 'cash';
  return raw;
}

function finDashboardSaleDiscount(sale) {
  if (!sale || typeof sale !== 'object') return 0;
  const d = Number(sale.discount);
  if (Number.isFinite(d)) return Math.abs(d);
  const du = Number(sale.discountPerUnit);
  if (Number.isFinite(du) && du > 0) return Math.abs(du) * Math.abs(Number(sale.qty || 0));
  return 0;
}

function finDashboardSaleLineCost(sale) {
  if (!sale || typeof sale !== 'object') return 0;
  const lc = Number(sale.lineCost);
  if (Number.isFinite(lc)) return Math.abs(lc);
  const cpu = Number(sale.costPerUnit ?? sale.unitCost ?? sale.cost ?? 0);
  const qty = Math.abs(Number(sale.qty || 0));
  if (Number.isFinite(cpu) && Number.isFinite(qty)) return Math.abs(cpu) * qty;
  return 0;
}

function finDashboardSaleGrossReference(sale) {
  if (!sale || typeof sale !== 'object') return 0;
  const qty = Math.abs(Number(sale.qty || 0));
  const unit = Math.abs(Number(sale.unitPrice || sale.price || 0));
  const total = Math.abs(Number(sale.total || 0));
  const discount = finDashboardSaleDiscount(sale);
  const ref = unit > 0 && qty > 0 ? unit * qty : 0;
  return n2(ref || (total + discount));
}

function finDashboardSaleSign(sale) {
  const qty = Number(sale && sale.qty || 0);
  const total = Number(sale && sale.total || 0);
  return (sale && sale.isReturn) || qty < 0 || total < 0 ? -1 : 1;
}

function finDashboardSaleCashEquivalentNio(sale) {
  if (!sale || typeof sale !== 'object') return 0;
  const direct = sale.cashExpectedDelta;
  let nio = 0;
  let usd = 0;
  if (direct && typeof direct === 'object') {
    nio = n0(direct.NIO ?? direct.nio ?? 0);
    usd = n0(direct.USD ?? direct.usd ?? 0);
  } else {
    const bx = sale.cashBreakdown && sale.cashBreakdown.expectedBoxByCurrency;
    if (bx && typeof bx === 'object') {
      nio = n0(bx.NIO ?? bx.nio ?? 0);
      usd = n0(bx.USD ?? bx.usd ?? 0);
    }
  }
  const fx = n0(sale.fxUsed ?? sale.exchangeRateUsed ?? (sale.cashBreakdown && (sale.cashBreakdown.fxUsed ?? sale.cashBreakdown.exchangeRateUsed)) ?? 0);
  let eq = n2(nio + (usd && fx > 0 ? usd * fx : 0));
  if (Math.abs(eq) < 0.005) eq = n2(sale.total || 0);
  return eq;
}

function finDashboardApplyMoneyMovement(totals, channel, amount) {
  const amt = n2(amount);
  if (!Number.isFinite(amt) || Math.abs(amt) < 0.005) return;
  if (amt > 0) totals.entradasRealesDinero = n2(totals.entradasRealesDinero + amt);
  if (amt < 0) totals.salidasRealesDinero = n2(totals.salidasRealesDinero + Math.abs(amt));
  if (channel === 'bank') totals.bancosPeriodo = n2(totals.bancosPeriodo + amt);
  else if (channel === 'cash') totals.cajaPeriodo = n2(totals.cajaPeriodo + amt);
}

function finDashboardApplyPosSale(totals, sale) {
  const sign = finDashboardSaleSign(sale);
  const gross = finDashboardSaleGrossReference(sale) * sign;
  const discount = finDashboardSaleDiscount(sale) * sign;
  const courtesy = !!(sale && (sale.courtesy || sale.isCourtesy));
  const courtesyValue = courtesy ? gross : 0;
  totals.ventaTotal = n2(totals.ventaTotal + gross);
  if (courtesy) totals.cortesias = n2(totals.cortesias + courtesyValue);
  else {
    totals.descuentos = n2(totals.descuentos + discount);
    totals.costosVentas = n2(totals.costosVentas + (finDashboardSaleLineCost(sale) * sign));

    const payment = finDashboardPaymentBucket(sale && sale.payment);
    if (payment === 'cash') {
      finDashboardApplyMoneyMovement(totals, 'cash', finDashboardSaleCashEquivalentNio(sale));
    } else if (payment === 'bank') {
      finDashboardApplyMoneyMovement(totals, 'bank', n2(sale && sale.total || 0));
    }
  }
  totals.eventKeys.add(finDashboardEventKey(sale));
}

function finDashboardClosureLatestByEventDay(closures) {
  const map = new Map();
  for (const c of (Array.isArray(closures) ? closures : [])) {
    if (!c || typeof c !== 'object') continue;
    const id = finDashboardEventId(c.eventId);
    const dk = finDashboardDate(c);
    if (!id || !dk) continue;
    const key = `${id}|${dk}`;
    const current = map.get(key);
    const ver = Number(c.version || 0);
    const created = Number(c.createdAt || 0);
    const curVer = current ? Number(current.version || 0) : -1;
    const curCreated = current ? Number(current.createdAt || 0) : -1;
    if (!current || ver > curVer || (ver === curVer && created > curCreated)) map.set(key, c);
  }
  return Array.from(map.values());
}

function finDashboardApplyPosClosureFallback(totals, closure) {
  const t = (closure && closure.totals && typeof closure.totals === 'object') ? closure.totals : {};
  const net = n2(t.totalGeneral || 0);
  totals.ventaTotal = n2(totals.ventaTotal + net);
  totals.costosVentas = n2(totals.costosVentas + n2(t.costoVentasTotal || 0));
  totals.eventKeys.add(finDashboardEventKey(closure));
  totals.stats.closureFallback += 1;

  const pm = (t.ventasPorMetodo && typeof t.ventasPorMetodo === 'object') ? t.ventasPorMetodo : {};
  Object.keys(pm).forEach(key => {
    const bucket = finDashboardPaymentBucket(key);
    const amount = n2(pm[key] || 0);
    if (bucket === 'cash') finDashboardApplyMoneyMovement(totals, 'cash', amount);
    else if (bucket === 'bank') finDashboardApplyMoneyMovement(totals, 'bank', amount);
  });
}


function finDashboardSafeMoney(value) {
  const n = n2(value);
  return Number.isFinite(n) ? n : 0;
}

function finDashboardFinalizeTotals(totals) {
  if (!totals || typeof totals !== 'object') return totals;
  [
    'ventaTotal', 'descuentos', 'cortesias', 'ventaNeta', 'costosVentas',
    'utilidadBruta', 'ingresosAdicionales', 'gastos', 'utilidadNeta',
    'flujoCaja', 'cajaPeriodo', 'bancosPeriodo', 'entradasRealesDinero',
    'salidasRealesDinero'
  ].forEach((key) => { totals[key] = finDashboardSafeMoney(totals[key]); });
  totals.margenBruto = finDashboardSafePct(totals.utilidadBruta, totals.ventaNeta);
  totals.margenNeto = finDashboardSafePct(totals.utilidadNeta, totals.ventaNeta);
  if (!Number.isFinite(Number(totals.numeroEventos)) || Number(totals.numeroEventos) < 0) totals.numeroEventos = 0;
  return totals;
}

function calcTableroClasificadoForFilter(data, filtros) {
  const safeData = data || {};
  const eventFilter = String(filtros && filtros.evento || 'ALL').trim() || 'ALL';
  const sales = Array.isArray(safeData.posSales) ? safeData.posSales : [];
  const closures = Array.isArray(safeData.posDailyClosures) ? safeData.posDailyClosures : [];

  const totals = {
    stage: FIN_OPERATIONAL_DASHBOARD_STAGE,
    ventaTotal: 0,
    descuentos: 0,
    cortesias: 0,
    ventaNeta: 0,
    costosVentas: 0,
    utilidadBruta: 0,
    ingresosAdicionales: 0,
    gastos: 0,
    utilidadNeta: 0,
    margenBruto: 0,
    margenNeto: 0,
    numeroEventos: 0,
    flujoCaja: 0,
    cajaPeriodo: 0,
    bancosPeriodo: 0,
    entradasRealesDinero: 0,
    salidasRealesDinero: 0,
    eventKeys: new Set(),
    alerts: [],
    stats: {
      posSales: 0,
      posCourtesySales: 0,
      closureFallback: 0,
      manualRows: 0,
      receiptRows: 0,
      posCashRows: 0
    }
  };

  const saleDayKeys = new Set();
  for (const sale of sales) {
    if (!sale || typeof sale !== 'object') continue;
    if (!finDashboardInRange(sale, filtros || {})) continue;
    if (!finDashboardRecordMatchesEvent(sale, eventFilter)) continue;
    const id = finDashboardEventId(sale.eventId);
    const dk = finDashboardDate(sale);
    if (id && dk) saleDayKeys.add(`${id}|${dk}`);
    totals.stats.posSales += 1;
    if (sale.courtesy || sale.isCourtesy) totals.stats.posCourtesySales += 1;
    finDashboardApplyPosSale(totals, sale);
  }

  // Fallback defensivo: usar cierre diario solo cuando no hay ventas crudas para ese evento/día.
  for (const closure of finDashboardClosureLatestByEventDay(closures)) {
    if (!closure || typeof closure !== 'object') continue;
    if (!finDashboardInRange(closure, filtros || {})) continue;
    if (!finDashboardRecordMatchesEvent(closure, eventFilter)) continue;
    const id = finDashboardEventId(closure.eventId);
    const dk = finDashboardDate(closure);
    if (id && dk && saleDayKeys.has(`${id}|${dk}`)) continue;
    finDashboardApplyPosClosureFallback(totals, closure);
  }

  const month = Number(String(filtros && filtros.desde || '').slice(5, 7));
  const year = Number(String(filtros && filtros.desde || '').slice(0, 4));
  const manualTotals = finBuildOperationalManualTotals(safeData, { year, month, evento: eventFilter });
  totals.ingresosAdicionales = n2(manualTotals.ingresosAdicionales || 0);
  totals.gastos = n2(manualTotals.gastos || 0);
  totals.entradasRealesDinero = n2(totals.entradasRealesDinero + n0(manualTotals.entradasRealesDinero));
  totals.salidasRealesDinero = n2(totals.salidasRealesDinero + n0(manualTotals.salidasRealesDinero));
  totals.cajaPeriodo = n2(totals.cajaPeriodo + n0(manualTotals.movimientoCajaPeriodo));
  totals.bancosPeriodo = n2(totals.bancosPeriodo + n0(manualTotals.movimientoBancosPeriodo));
  totals.stats.manualRows = manualTotals && manualTotals.sourceCounts ? Number(manualTotals.sourceCounts.manual || 0) : 0;
  totals.stats.receiptRows = manualTotals && manualTotals.sourceCounts ? Number(manualTotals.sourceCounts.receipts || 0) : 0;
  totals.stats.posCashRows = manualTotals && manualTotals.sourceCounts ? Number(manualTotals.sourceCounts.posCash || 0) : 0;
  for (const row of (Array.isArray(manualTotals.rows) ? manualTotals.rows : [])) {
    const key = finDashboardEventKey(row);
    if (key && key !== 'NONE') totals.eventKeys.add(key);
  }

  totals.ventaTotal = finDashboardSafeMoney(totals.ventaTotal);
  totals.descuentos = finDashboardSafeMoney(totals.descuentos);
  totals.cortesias = finDashboardSafeMoney(totals.cortesias);
  totals.costosVentas = finDashboardSafeMoney(totals.costosVentas);
  totals.ventaNeta = finDashboardSafeMoney(totals.ventaTotal - totals.descuentos - totals.cortesias);
  totals.utilidadBruta = finDashboardSafeMoney(totals.ventaNeta - totals.costosVentas);
  totals.utilidadNeta = finDashboardSafeMoney(totals.utilidadBruta + totals.ingresosAdicionales - totals.gastos);
  totals.flujoCaja = finDashboardSafeMoney(totals.entradasRealesDinero - totals.salidasRealesDinero);
  totals.numeroEventos = eventFilter && eventFilter !== 'ALL' && eventFilter !== 'GLOBAL'
    ? (totals.eventKeys.size ? 1 : 0)
    : Array.from(totals.eventKeys).filter(k => k && k !== 'NONE').length;
  finDashboardFinalizeTotals(totals);

  totals.liquidityPeriod = {
    cutoff: filtros && filtros.hasta,
    totals: {
      cashNio: totals.cajaPeriodo,
      cashUsd: 0,
      cashEquivalentNio: totals.cajaPeriodo,
      bankNio: totals.bancosPeriodo,
      bankUsd: 0,
      bankEquivalentNio: totals.bancosPeriodo,
      liquidityEquivalentNio: n2(totals.cajaPeriodo + totals.bancosPeriodo)
    },
    cash: Math.abs(totals.cajaPeriodo) > 0.005 ? [{ label: 'Movimiento de caja del período', currency: 'NIO', balanceOriginal: totals.cajaPeriodo, equivalentNio: totals.cajaPeriodo }] : [],
    bank: Math.abs(totals.bancosPeriodo) > 0.005 ? [{ label: 'Movimiento bancario del período', currency: 'NIO', balanceOriginal: totals.bancosPeriodo, equivalentNio: totals.bancosPeriodo }] : [],
    alerts: []
  };

  if (!totals.stats.posSales && !totals.stats.closureFallback && !totals.stats.manualRows) {
    totals.alerts.push({ text: 'No hay datos operativos para el filtro seleccionado.' });
  }
  if (totals.stats.closureFallback) {
    totals.alerts.push({ text: `Se usaron ${totals.stats.closureFallback} cierre(s) POS como fallback porque no había ventas crudas para ese evento/día.` });
  }
  if (manualTotals.sinClasificar) {
    totals.alerts.push({ kind: 'warn', text: `Hay ${finFormatCordobas(manualTotals.sinClasificar)} en movimientos sin clasificación operativa; no se sumaron a utilidad.` });
  }
  if (manualTotals.dedupedCount) {
    totals.alerts.push({ kind: 'warn', text: `Se omitieron ${manualTotals.dedupedCount} registro(s) operativo(s) repetido(s) para evitar doble conteo.` });
  }
  if (!totals.alerts.length) {
    totals.alerts.push({ text: 'Tablero operativo calculado desde POS, Caja Chica/Efectivo y Recibos; sin depender del Diario Contable como fuente principal.' });
  }

  return totals;
}

function renderTableroAlerts(result) {
  const host = document.getElementById('tab-alerts');
  if (!host) return;
  host.innerHTML = finReportAlertHtml((result && result.alerts) || []);
}

function renderTableroChart(result) {
  const canvas = document.getElementById('tab-chart');
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width || 720;
  const cssHeight = canvas.clientHeight || canvas.height || 300;
  const width = Math.max(320, Math.floor(cssWidth));
  const height = Math.max(220, Math.floor(cssHeight));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const styles = getComputedStyle(document.documentElement);
  const gold = styles.getPropertyValue('--fin-gold').trim() || '#d4af37';
  const red = styles.getPropertyValue('--fin-red').trim() || '#c83232';
  const text = styles.getPropertyValue('--fin-text').trim() || '#f7f1df';
  const muted = styles.getPropertyValue('--fin-muted').trim() || '#b8ad93';
  const border = styles.getPropertyValue('--fin-border').trim() || 'rgba(255,255,255,0.12)';

  const rows = [
    ['Venta Total', n0(result && result.ventaTotal), gold],
    ['Venta Neta', n0(result && result.ventaNeta), '#9f8b4a'],
    ['Costos', n0(result && result.costosVentas), red],
    ['Gastos', n0(result && result.gastos), '#8b1f26'],
    ['Utilidad neta', n0(result && result.utilidadNeta), (n0(result && result.utilidadNeta) >= 0 ? gold : red)]
  ];
  const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r[1])));
  const hasData = rows.some(r => Math.abs(r[1]) > 0.005);

  ctx.font = '600 13px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.fillStyle = text;
  ctx.fillText('Resultado operativo del filtro seleccionado', 18, 24);

  if (!hasData) {
    ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText('No hay montos operativos para graficar en este período.', 18, 58);
    return;
  }

  const labelW = Math.min(190, Math.max(130, width * 0.28));
  const rightPad = 120;
  const barX = labelW + 22;
  const barW = Math.max(80, width - barX - rightPad);
  const top = 54;
  const gap = 15;
  const barH = Math.max(18, Math.min(30, (height - top - 28 - gap * (rows.length - 1)) / rows.length));

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(barX, top - 10);
  ctx.lineTo(barX + barW, top - 10);
  ctx.stroke();

  rows.forEach((row, idx) => {
    const [label, value, color] = row;
    const y = top + idx * (barH + gap);
    const w = Math.max(2, Math.round((Math.abs(value) / maxAbs) * barW));

    ctx.font = '12px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(label, 18, y + Math.round(barH * 0.68));

    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(barX, y, barW, barH);

    ctx.fillStyle = color;
    ctx.fillRect(barX, y, w, barH);

    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.fillText(finFormatCordobas(value), barX + barW + 12, y + Math.round(barH * 0.68));
  });
  ctx.textAlign = 'left';
}


function finTableroMoneyByCurrency(value, currency) {
  return finNormalizeCurrencyCode(currency) === 'USD' ? finFormatDollars(value) : finFormatCordobas(value);
}

function finTableroLiquidityRowHtml(row) {
  const codes = Array.isArray(row.accountCodes) && row.accountCodes.length
    ? `<span>Cuentas: ${escapeHtml(row.accountCodes.join(', '))}</span>`
    : '';
  const flags = [];
  if (row.missingUsdRateCount) flags.push(`${row.missingUsdRateCount} sin T/C snapshot`);
  if (row.missingOriginalUsdCount) flags.push(`${row.missingOriginalUsdCount} sin monto US$ original`);
  if (row.legacyCurrencyCount) flags.push(`${row.legacyCurrencyCount} legacy`);
  if (row.unclassifiedBankCount) flags.push(`${row.unclassifiedBankCount} sin banco identificado`);
  const flagsHtml = flags.length ? `<span>${escapeHtml(flags.join(' · '))}</span>` : '';
  return `
    <article class="fin-liquidity-row">
      <div>
        <strong>${escapeHtml(row.label || 'Sin clasificar')}</strong>
        <p>${codes}${flagsHtml}</p>
      </div>
      <div class="fin-liquidity-row-values">
        <b>${escapeHtml(finTableroMoneyByCurrency(row.balanceOriginal || 0, row.currency))}</b>
        <span>Eq. ${escapeHtml(finFormatCordobas(row.equivalentNio || 0))}</span>
      </div>
    </article>
  `;
}

function finTableroLiquidityEmptyHtml(text) {
  return `<div class="fin-liquidity-empty">${escapeHtml(text || 'Sin movimientos en el período filtrado.')}</div>`;
}

function renderTableroLiquidity(detail, context) {
  const safe = detail || calcCajaBancoMultimonedaUntilDate({}, todayStr());
  const totals = safe.totals || {};
  const cashRows = Array.isArray(safe.cash) ? safe.cash : [];
  const bankRows = Array.isArray(safe.bank) ? safe.bank : [];

  const cashNio = document.getElementById('tab-cash-nio');
  const cashUsd = document.getElementById('tab-cash-usd');
  const cashEq = document.getElementById('tab-cash-equivalent');
  const bankNio = document.getElementById('tab-bank-nio');
  const bankUsd = document.getElementById('tab-bank-usd');
  const bankEq = document.getElementById('tab-bank-equivalent');
  const liquidityEq = document.getElementById('tab-liquidity-equivalent');
  const cashDetail = document.getElementById('tab-cash-detail');
  const bankDetail = document.getElementById('tab-bank-detail');
  const note = document.getElementById('tab-liquidity-note');

  if (cashNio) cashNio.textContent = finFormatCordobas(totals.cashNio || 0);
  if (cashUsd) cashUsd.textContent = finFormatDollars(totals.cashUsd || 0);
  if (cashEq) cashEq.textContent = finFormatCordobas(totals.cashEquivalentNio || 0);
  if (bankNio) bankNio.textContent = finFormatCordobas(totals.bankNio || 0);
  if (bankUsd) bankUsd.textContent = finFormatDollars(totals.bankUsd || 0);
  if (bankEq) bankEq.textContent = finFormatCordobas(totals.bankEquivalentNio || 0);
  if (liquidityEq) liquidityEq.textContent = finFormatCordobas(totals.liquidityEquivalentNio || 0);

  if (cashDetail) {
    cashDetail.innerHTML = cashRows.length
      ? cashRows.map(finTableroLiquidityRowHtml).join('')
      : finTableroLiquidityEmptyHtml('No hay movimientos reales de caja en el período filtrado.');
  }
  if (bankDetail) {
    bankDetail.innerHTML = bankRows.length
      ? bankRows.map(finTableroLiquidityRowHtml).join('')
      : finTableroLiquidityEmptyHtml('No hay movimientos reales bancarios en el período filtrado.');
  }
  if (note) {
    const parts = [];
    const corte = context && context.corte ? context.corte : safe.cutoff;
    if (corte) parts.push(`Movimiento del período hasta: ${corte}.`);
    parts.push('Caja y Bancos respetan mes/año y el evento cuando la fuente trae evento asociado.');
    if (context && context.eventFilter && context.eventFilter !== 'ALL') parts.push('Filtro por evento aplicado a POS, Caja/Efectivo y Recibos compatibles.');
    note.textContent = parts.join(' ');
  }
}

function finRenderTableroCurrencyBand() {
  const rateEl = document.getElementById('tab-fx-rate');
  const updatedEl = document.getElementById('tab-fx-updated');
  let state = null;
  try { state = finGetCurrencyStateSafe(); } catch (_) { state = null; }
  const rateText = state && state.hasExchangeRate && state.exchangeRate
    ? `T/C vigente ${Number(state.exchangeRate).toFixed(2)}`
    : 'T/C vigente —';
  const updatedText = state && state.updatedAtText && state.updatedAtText !== 'Sin registros'
    ? `Última actualización: ${state.updatedAtText}`
    : 'Última actualización: —';
  if (rateEl) rateEl.textContent = rateText;
  if (updatedEl) updatedEl.textContent = updatedText;
}

function finSetText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function finResolveDashboardEventFilter(vista, eventoSel) {
  const mode = String(vista || 'GLOBAL').toUpperCase();
  if (mode !== 'EVENT') return 'ALL';
  if (!eventoSel) return 'NONE';
  let value = String(eventoSel.value || '').trim();
  if (!value || value === 'ALL') {
    const firstEvent = Array.from(eventoSel.options || []).find(opt => opt && opt.value && opt.value !== 'ALL' && opt.value !== 'NONE');
    if (firstEvent) {
      value = firstEvent.value;
      try { eventoSel.value = value; } catch (_) {}
    }
  }
  return value || 'NONE';
}

function renderTablero(data) {
  const mesSel = $('#tab-mes');
  const anioSel = $('#tab-anio');
  const eventoSel = $('#tab-evento');
  const vistaSel = $('#tab-vista');
  const eventoWrap = $('#tab-evento-wrap');
  if (!mesSel || !anioSel || !eventoSel) return;

  const mes = mesSel.value || pad2(new Date().getMonth() + 1);
  const anio = anioSel.value || String(new Date().getFullYear());
  const { start, end } = monthRange(Number(anio), Number(mes));
  const vista = String(vistaSel && vistaSel.value || 'GLOBAL').toUpperCase();
  const isEventView = vista === 'EVENT';
  if (eventoWrap) eventoWrap.classList.toggle('hidden', !isEventView);
  if (eventoSel) eventoSel.disabled = !isEventView;
  const eventFilter = finResolveDashboardEventFilter(vista, eventoSel);

  finRenderTableroCurrencyBand();

  const result = calcTableroClasificadoForFilter(data, {
    desde: start,
    hasta: end,
    evento: eventFilter
  });

  finSetText('tab-venta-total', finFormatCordobas(result.ventaTotal));
  finSetText('tab-descuentos', finFormatCordobas(result.descuentos));
  finSetText('tab-cortesias', finFormatCordobas(result.cortesias));
  finSetText('tab-venta-neta', finFormatCordobas(result.ventaNeta));
  finSetText('tab-costos', finFormatCordobas(result.costosVentas));
  finSetText('tab-utilidad-bruta', finFormatCordobas(result.utilidadBruta));
  finSetText('tab-ingresos-adicionales', finFormatCordobas(result.ingresosAdicionales));
  finSetText('tab-gastos', finFormatCordobas(result.gastos));
  finSetText('tab-utilidad-neta', finFormatCordobas(result.utilidadNeta));
  finSetText('tab-margen-bruto', finDashboardFormatPct(result.margenBruto));
  finSetText('tab-margen-neto', finDashboardFormatPct(result.margenNeto));
  finSetText('tab-num-eventos', String(result.numeroEventos || 0));
  finSetText('tab-flujo-caja', finFormatCordobas(result.flujoCaja));
  finSetText('tab-caja-periodo', finFormatCordobas(result.cajaPeriodo));
  finSetText('tab-bancos-periodo', finFormatCordobas(result.bancosPeriodo));

  // Compatibilidad con ids antiguos que pudieran existir en instalaciones cacheadas.
  finSetText('tab-ingresos', finFormatCordobas(result.ventaTotal));
  finSetText('tab-post-cortesias', finFormatCordobas(result.ingresosAdicionales));
  finSetText('tab-bruta', finFormatCordobas(result.utilidadBruta));
  finSetText('tab-resultado', finFormatCordobas(result.utilidadNeta));
  finSetText('tab-caja', finFormatCordobas(result.cajaPeriodo));
  finSetText('tab-banco', finFormatCordobas(result.bancosPeriodo));

  renderTableroLiquidity(result.liquidityPeriod, { corte: end, eventFilter, periodMode: true });
  renderTableroAlerts(result);
  renderTableroChart(result);
}

/* ---------- Render: Diario y Ajustes ---------- */

function getDisplayDescription(entry) {
  const raw = (entry && (entry.descripcion != null ? entry.descripcion : entry.description)) || '';
  const desc = String(raw || '');

  const src = String(entry?.source || '').trim();
  const origen = String(entry?.origen || '').trim();
  const looksLikePosClose = (
    src === POS_DAILY_CLOSE_SOURCE ||
    src === POS_DAILY_CLOSE_REVERSAL_SOURCE ||
    src.includes(POS_DAILY_CLOSE_SOURCE) ||
    (origen === 'POS' && desc.includes('Cierre diario POS'))
  );

  if (!looksLikePosClose) return desc;

  const idx = desc.search(/(\s*[—-]\s*)?closureId\s*:/i);
  if (idx >= 0) {
    let out = desc.slice(0, idx).trim();
    out = out.replace(/[\s—-]+$/g, '').trim();
    return out;
  }
  const idx2 = desc.search(/(\s*[—-]\s*)cierre\s*:/i);
  if (idx2 >= 0) {
    let out = desc.slice(0, idx2).trim();
    out = out.replace(/[\s—-]+$/g, '').trim();
    return out;
  }
  return desc;
}



function isPosDailyCloseEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;

  const src = String(entry.source || '').trim();
  if (src === POS_DAILY_CLOSE_SOURCE || src === POS_DAILY_CLOSE_REVERSAL_SOURCE) return true;
  if (src && src.includes(POS_DAILY_CLOSE_SOURCE)) return true;
  // Compatibilidad: posibles variantes de source en builds antiguos
  if (src && src.includes('POS_DAILY_CLOSE')) return true;

  // Campos técnicos del flujo POS (si existen)
  if (entry.closureId || entry.reversalOfClosureId || entry.reversingClosureId) return true;

  const origen = String(entry.origen || '').trim().toUpperCase();
  const desc = String((entry.descripcion != null ? entry.descripcion : entry.description) || '');
  if (origen === 'POS' && /cierre\s+diario\s+pos/i.test(desc)) return true;

  return false;
}

function getPosCloseMismatchAmount(entry) {
  if (!entry || typeof entry !== 'object') return 0;
  const src = String(entry.source || '').trim();
  if (src === POS_DAILY_CLOSE_REVERSAL_SOURCE) return 0;

  const raw = entry?.posSnapshot?.totals?.totalMismatch;
  if (raw == null) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (Math.abs(n) <= 0.01) return 0;
  return n2(n);
}


function nSafeMoney(v) {
  if (v == null) return 0;
  const s = (typeof v === 'string') ? v.replace(',', '.').trim() : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeEntryLines(entry, linesFromStore) {
  // Normaliza cualquier variante de estructura de líneas a un formato único.
  // Display-only. NO toca data persistida.
  let raw = Array.isArray(linesFromStore) ? linesFromStore : [];

  if (!raw.length && entry && typeof entry === 'object') {
    const embedded = entry.lines || entry.items || entry.movements || entry.detailLines || entry.journalLines || entry.lineas || null;
    if (Array.isArray(embedded)) raw = embedded;

    // Compatibilidad: algunas integraciones podrían guardar líneas dentro de meta
    if (!raw.length && entry.meta && Array.isArray(entry.meta.lines)) raw = entry.meta.lines;
    if (!raw.length && entry.meta && Array.isArray(entry.meta.items)) raw = entry.meta.items;
  }

  const out = [];
  for (const ln of (raw || [])) {
    if (!ln || typeof ln !== 'object') continue;

    let code = String(
      ln.accountCode ?? ln.account_code ?? ln.accountcode ??
      ln.code ?? ln.codigo ?? ln.account ?? ln.cuenta ??
      ln.accountId ?? ln.account_id ?? ln.cuentaCodigo ?? ln.codigoCuenta ?? ''
    ).trim();

    if (!code) {
      const emb = ln.account || ln.cuenta || null;
      if (emb && typeof emb === 'object') {
        code = String(emb.code ?? emb.codigo ?? emb.accountCode ?? emb.account_code ?? emb.id ?? '').trim();
      }
    }

    let debit = nSafeMoney(ln.debe ?? ln.debit ?? ln.DEBE ?? ln.DEBIT ?? ln.dr ?? ln.DR ?? 0);
    let credit = nSafeMoney(ln.haber ?? ln.credit ?? ln.HABER ?? ln.CREDIT ?? ln.cr ?? ln.CR ?? 0);

    // Si viene como {type:'DEBIT'|'CREDIT', amount}
    if (!(debit || credit)) {
      const amtRaw = (ln.amount ?? ln.monto ?? ln.valor ?? ln.value ?? ln.total ?? ln.importe ?? null);
      const amtNum = (amtRaw == null) ? 0 : Number((typeof amtRaw === 'string') ? amtRaw.replace(',', '.').trim() : amtRaw);
      const amt = Number.isFinite(amtNum) ? amtNum : 0;

      const side = String(ln.type ?? ln.side ?? ln.nature ?? ln.tipo ?? '').trim().toUpperCase();
      const isDebit = side.includes('DEBIT') || side.includes('DEBE') || side == 'D' || side == 'DR';
      const isCredit = side.includes('CREDIT') || side.includes('HABER') || side == 'C' || side == 'CR';

      if (amt) {
        if (isDebit && !isCredit) debit = Math.abs(amt);
        else if (isCredit && !isDebit) credit = Math.abs(amt);
        else {
          // Último recurso: signo
          if (amt < 0) credit = Math.abs(amt);
          else debit = Math.abs(amt);
        }
      }
    }

    debit = Math.abs(debit);
    credit = Math.abs(credit);

    const amount = Math.max(debit, credit);
    out.push({ accountCode: code, debit, credit, amount, raw: ln });
  }

  return out;
}

function getAccountByCodeLoose(code, accountsMap) {
  const c = String(code || '').trim();
  if (!c || !accountsMap || typeof accountsMap.get !== 'function') return null;

  // Exact match
  let acc = accountsMap.get(c);
  if (acc) return acc;

  // Match por padding numérico
  const n = safeParseCodeNum(c);
  if (Number.isFinite(n)) {
    const padded = String(n).padStart(4, '0');
    acc = accountsMap.get(padded);
    if (acc) return acc;
  }

  return null;
}

function getRootTypeLoose(code, acc, fallbackName) {
  const rt = String(acc?.rootType || '').toUpperCase();
  if (rt) return rt;

  const byTipo = inferRootTypeFromTipo(acc?.tipo);
  if (byTipo) return byTipo;

  const byCode = inferRootTypeFromCode(code);
  if (byCode) return byCode;

  const byName = inferRootTypeFromName(fallbackName);
  if (byName) return byName;

  return null;
}

function accountHasCashBankFlag(acc) {
  if (!acc || typeof acc !== 'object') return false;
  // Soportar flags potenciales de catálogos custom.
  if (acc.isCash === true || acc.isBank === true) return true;
  if (acc.cash === true || acc.bank === true) return true;
  const role = String(acc.role || acc.kind || acc.accountRole || '').toLowerCase();
  if (role.includes('cash') || role.includes('bank') || role.includes('caja') || role.includes('banco')) return true;
  const tags = acc.tags;
  if (Array.isArray(tags)) {
    const t = tags.map(x => String(x || '').toLowerCase());
    if (t.includes('cash') || t.includes('bank') || t.includes('caja') || t.includes('banco')) return true;
  }
  return false;
}

function looksLikeCashOrBankByName(code, name) {
  const n = normText(name);
  if (!n) return false;
  if (n.includes('caja') || n.includes('banco') || n.includes('efectivo')) return true;
  if (n.includes('cash') || n.includes('bank')) return true;

  // Posibles sinónimos (sin romper orden: esto solo es fallback por nombre)
  if (n.includes('transfer') || n.includes('tarjeta') || n.includes('credito') || n.includes('crédito')) return true;
  if (n.includes('cxc') || n.includes('cuentas por cobrar')) return true;

  return false;
}

function getPosSalesTotalFromMeta(entry) {
  const v =
    entry?.meta?.salesTotal ??
    entry?.salesTotal ??
    entry?.totalSales ??
    entry?.ventasTotal ??
    entry?.meta?.ventasTotal ??
    entry?.posTotals?.salesTotal ??
    entry?.posTotals?.ventasTotal ??
    entry?.posSnapshot?.totals?.salesTotal ??
    entry?.posSnapshot?.totals?.totalGeneral ??
    entry?.posSnapshot?.totals?.ventasTotal ??
    entry?.posSnapshot?.totals?.total ??
    entry?.posSnapshot?.totals?.totalVentas ??
    null;

  const n = Number((typeof v === 'string') ? v.replace(',', '.').trim() : v);
  return Number.isFinite(n) ? n : null;
}

function isLikelyInventoryAccount(code, name, rootType) {
  const c = String(code || '').trim();
  const n = normText(name);
  const rt = String(rootType || '').toUpperCase();

  // Inventario típico A33
  if (c === '1500') return true;

  // Por nombre
  if (n.includes('inventar') || n.includes('existenc') || n.includes('stock')) return true;

  // Algunas cuentas activas pueden parecer inventario
  if (rt === 'ACTIVO' && (n.includes('inventar') || n.includes('existenc') || n.includes('stock'))) return true;

  return false;
}

function resolveCashBankNet(entry, normalizedLines, accountsMap) {
  const stdCodes = new Set([...finGetCurrentCashAccountCodes(), ...finGetCurrentBankAccountCodes({ accounts: accountsMap && typeof accountsMap.values === 'function' ? [...accountsMap.values()] : [] }), '1300', '1900']);

  // Step 1: flags en catálogo
  const step1 = [];
  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    const acc = getAccountByCodeLoose(code, accountsMap);
    if (accountHasCashBankFlag(acc)) step1.push(ln);
  }
  if (step1.length) {
    const v = step1.reduce((s, ln) => s + (nSafeMoney(ln.debit) - nSafeMoney(ln.credit)), 0);
    return { value: v, by: 'flag', lines: step1.length };
  }

  // Step 2: nombre contiene Caja/Banco (y variantes razonables)
  const step2 = [];
  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    const acc = getAccountByCodeLoose(code, accountsMap);
    const name = String(acc?.nombre || acc?.name || '').trim() || getLineAccountSnapshotName(ln.raw);
    if (looksLikeCashOrBankByName(code, name)) step2.push(ln);
  }
  if (step2.length) {
    const v = step2.reduce((s, ln) => s + (nSafeMoney(ln.debit) - nSafeMoney(ln.credit)), 0);
    return { value: v, by: 'name', lines: step2.length };
  }

  // Step 3: códigos estándar Suite A33
  const step3 = [];
  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    if (!code) continue;

    // Match exact o padding
    if (stdCodes.has(code)) step3.push(ln);
    else {
      const n = safeParseCodeNum(code);
      if (Number.isFinite(n) && stdCodes.has(String(n).padStart(4, '0'))) step3.push(ln);
    }
  }
  if (step3.length) {
    const v = step3.reduce((s, ln) => s + (nSafeMoney(ln.debit) - nSafeMoney(ln.credit)), 0);
    return { value: v, by: 'stdCode', lines: step3.length };
  }

  // Step 4: proxy seguro (solo POS_DAILY_CLOSE): mayor movimiento ACTIVO
  let best = null;
  let bestAbs = 0;
  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    const acc = getAccountByCodeLoose(code, accountsMap);
    const name = String(acc?.nombre || acc?.name || '').trim() || getLineAccountSnapshotName(ln.raw);
    const rt = getRootTypeLoose(code, acc, name);
    if (rt !== 'ACTIVO') continue;

    const net = (nSafeMoney(ln.debit) - nSafeMoney(ln.credit));
    const absNet = Math.abs(net);
    if (absNet > bestAbs) {
      bestAbs = absNet;
      best = net;
    }
  }

  if (best != null && bestAbs > 0) return { value: best, by: 'proxyActivo', lines: 1 };

  return { value: null, by: 'none', lines: 0 };
}

function resolveIncomeNet(entry, normalizedLines, accountsMap) {
  // Step 1: RootType INGRESOS
  const incomeLines = [];
  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    const acc = getAccountByCodeLoose(code, accountsMap);
    const name = String(acc?.nombre || acc?.name || '').trim() || getLineAccountSnapshotName(ln.raw);
    const rt = getRootTypeLoose(code, acc, name);
    if (rt === 'INGRESOS') incomeLines.push(ln);
  }

  if (incomeLines.length) {
    const v = incomeLines.reduce((s, ln) => s + (nSafeMoney(ln.credit) - nSafeMoney(ln.debit)), 0);
    return { value: v, by: 'rootTypeIngresos', lines: incomeLines.length };
  }

  // Step 2: mayor HABER que no sea Inventario/Pasivo (si se puede detectar)
  let bestNet = null;
  let bestHaber = 0;
  let bestAmt = 0;

  for (const ln of normalizedLines) {
    const code = String(ln.accountCode || '').trim();
    const acc = getAccountByCodeLoose(code, accountsMap);
    const name = String(acc?.nombre || acc?.name || '').trim() || getLineAccountSnapshotName(ln.raw);
    const rt = getRootTypeLoose(code, acc, name);

    if (rt === 'PASIVO') continue;
    if (isLikelyInventoryAccount(code, name, rt)) continue;

    const haber = nSafeMoney(ln.credit);
    const debe = nSafeMoney(ln.debit);
    const net = haber - debe;

    // Preferir por mayor HABER
    if (haber > bestHaber) {
      bestHaber = haber;
      bestAmt = Math.max(haber, debe);
      bestNet = net;
    } else if (!bestHaber && Math.max(haber, debe) > bestAmt) {
      // Si no hay HABER en ninguna línea, soportar reversos eligiendo mayor movimiento.
      bestAmt = Math.max(haber, debe);
      bestNet = net;
    }
  }

  if (bestNet != null && bestAmt > 0) return { value: bestNet, by: 'maxHaberNonInvNonPasivo', lines: 1 };

  // Step 3: Fallback a meta salesTotal
  const s = getPosSalesTotalFromMeta(entry);
  if (s != null) return { value: s, by: 'meta', lines: 0 };

  return { value: null, by: 'none', lines: 0 };
}

function isLikelyReversalEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const src = String(entry.source || '').toUpperCase();
  if (src.includes('REVERSAL') || src.includes('REVERSO')) return true;
  if (entry.reversalOfClosureId || entry.reversingClosureId) return true;

  const desc = String((entry.descripcion != null ? entry.descripcion : entry.description) || '').toLowerCase();
  if (desc.includes('reverso') || desc.includes('reversal')) return true;

  const oid = String(entry.origenId || '').toUpperCase();
  if (oid.startsWith('REV:')) return true;

  return false;
}

function getPosPrincipalAmounts(entry, lines, accountsMap) {
  // Helper display-only. NO toca data persistida.
  // Retorna el monto principal (positivo o negativo) para el listado: Debe/Haber principales.

  const normalized = normalizeEntryLines(entry, lines);
  const metaSales = getPosSalesTotalFromMeta(entry);

  if (!normalized.length) {
    if (metaSales != null) return { principalDebe: metaSales, principalHaber: metaSales, found: true, by: 'metaOnly' };
    return { principalDebe: null, principalHaber: null, found: false, by: 'none' };
  }

  const cashRes = resolveCashBankNet(entry, normalized, accountsMap);
  const incomeRes = resolveIncomeNet(entry, normalized, accountsMap);

  const cashNet = (cashRes && cashRes.value != null) ? Number(cashRes.value) : null;
  const incNet = (incomeRes && incomeRes.value != null) ? Number(incomeRes.value) : null;

  // Signo: priorizar ACTIVO (cash/bank) porque refleja entrada/salida real.
  let sign = null;
  if (cashNet != null && Math.abs(cashNet) > 0.0001) sign = cashNet >= 0 ? 1 : -1;
  else if (incNet != null && Math.abs(incNet) > 0.0001) sign = incNet >= 0 ? 1 : -1;

  // Magnitud: priorizar ingresos si existe, luego cash/bank, luego meta.
  let magnitude = null;
  if (incNet != null && Math.abs(incNet) > 0.0001) magnitude = Math.abs(incNet);
  else if (cashNet != null && Math.abs(cashNet) > 0.0001) magnitude = Math.abs(cashNet);
  else if (metaSales != null && Math.abs(metaSales) > 0.0001) magnitude = Math.abs(metaSales);

  // Si ambos existen pero difieren mucho, preferir meta si existe.
  if (magnitude != null && metaSales != null) {
    const a = (cashNet != null) ? Math.abs(cashNet) : null;
    const b = (incNet != null) ? Math.abs(incNet) : null;
    if (a != null && b != null && Math.abs(a - b) > 0.05) {
      magnitude = Math.abs(metaSales);
    }
  }

  if (sign == null) {
    // Último recurso: si no se pudo inferir por líneas, usar marca textual.
    sign = isLikelyReversalEntry(entry) ? -1 : 1;
  }

  if (magnitude == null || !(magnitude > 0)) {
    return { principalDebe: null, principalHaber: null, found: false, by: 'fallbackTotals' };
  }

  const signed = sign * magnitude;

  // UI decisión: se muestra el monto principal en ambas columnas (Debe/Haber) para cierres POS.
  return {
    principalDebe: signed,
    principalHaber: signed,
    found: true,
    by: `cash:${cashRes.by}|income:${incomeRes.by}|meta:${metaSales != null ? 'y' : 'n'}`
  };
}


function finIsManualJournalEntry(entry) {
  if (!entry || typeof entry !== 'object') return false;
  const src = String(entry.source || '').trim();
  return src === 'manual_journal_entry' || entry.entryType === 'journal_entry' || entry.stage === FIN_JOURNAL_REAL_STAGE;
}

function finGetEntryAutoLabel(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return String(entry.autoLabel || entry.etiquetaAutomatica || '').trim();
}

function finGetEntryOriginPresentation(entry) {
  const rawText = normText([
    entry && entry.entryType,
    entry && entry.source,
    entry && entry.origin,
    entry && entry.origen,
    entry && entry.tipoMovimiento,
    entry && entry.purchaseKind,
    entry && entry.receiptId,
    entry && entry.internalTransferSnapshot && entry.internalTransferSnapshot.tipoOperacion
  ].filter(Boolean).join(' '));

  if (!entry || typeof entry !== 'object') return { base: 'Legacy', label: 'Legacy / histórico' };

  if (rawText.includes('pos') || String(entry.source || '') === POS_DAILY_CLOSE_SOURCE || String(entry.source || '') === POS_DAILY_CLOSE_REVERSAL_SOURCE) {
    return { base: 'POS', label: 'POS' };
  }
  if (rawText.includes('internal_transfer') || rawText.includes('transferencia interna') || String(entry.tipoMovimiento || '') === 'transferencia') {
    return { base: 'Transferencia', label: 'Transferencia' };
  }
  if (String(entry.entryType || '') === 'purchase' || rawText.includes('purchase') || rawText.includes('compra')) {
    return { base: 'Compra', label: 'Compra' };
  }
  if (String(entry.entryType || '') === 'receipt' || rawText.includes('receipt') || rawText.includes('recibo')) {
    return { base: 'Recibo', label: 'Recibo' };
  }
  if (finIsManualJournalEntry(entry) || String(entry.source || '') === 'manual_financial_account') {
    return { base: 'Manual', label: 'Manual' };
  }

  const origenRaw = String(entry.origen || entry.origin || '').trim();
  if (origenRaw) {
    const normalized = normText(origenRaw);
    if (normalized.includes('manual') || normalized.includes('interno')) return { base: 'Manual', label: 'Manual' };
    return { base: origenRaw, label: origenRaw };
  }

  return { base: 'Legacy', label: 'Legacy / histórico' };
}

function finEntryOriginMatchesFilter(entry, filterValue) {
  const filter = String(filterValue || 'todos');
  if (filter === 'todos') return true;

  const info = finGetEntryOriginPresentation(entry);
  const base = info.base;

  if (filter === 'POS' || filter === 'POS_CIERRES' || filter === 'POS_LEGACY') {
    if (base !== 'POS') return false;
    if (filter === 'POS') return true;
    const close = isPosDailyCloseEntry(entry);
    if (filter === 'POS_CIERRES') return close;
    if (filter === 'POS_LEGACY') return !close;
  }

  return base === filter;
}

function finEntryOriginLabelForHistory(entry) {
  const info = finGetEntryOriginPresentation(entry);
  if (info.base === 'POS') return isPosDailyCloseEntry(entry) ? 'POS — Cierre diario' : 'POS — Legacy';
  return info.label || info.base || 'Legacy / histórico';
}

function finEntryOriginPillVariant(entry) {
  const base = finGetEntryOriginPresentation(entry).base;
  if (base === 'Manual' || base === 'POS') return 'gold';
  if (base === 'Compra' || base === 'Recibo' || base === 'Transferencia') return 'cash';
  if (base === 'Legacy') return 'muted';
  return 'muted';
}

function finJournalDetailAmountCell(line, side) {
  const baseRaw = side === 'debit'
    ? (line.debe ?? line.debit ?? line.debitBase ?? 0)
    : (line.haber ?? line.credit ?? line.creditBase ?? 0);
  const originalRaw = side === 'debit'
    ? (line.debitOriginal ?? line.debeOriginal ?? null)
    : (line.creditOriginal ?? line.haberOriginal ?? null);
  const base = finParseCurrencyAmount(baseRaw);
  const original = finParseCurrencyAmount(originalRaw);
  const currency = finNormalizeCurrencyCode(line.originalCurrency || line.monedaOriginal || line.currency || 'NIO');
  const rate = finParseCurrencyAmount(line.exchangeRateUsed ?? line.tipoCambioUsado ?? '');
  const main = finFormatCordobas(Number.isFinite(base) ? base : 0);
  if (currency === 'USD' && Number.isFinite(original) && original > 0) {
    return `${main}<div class="fin-detail-line-meta">${escapeHtml(finFormatDollars(original))}${Number.isFinite(rate) && rate > 0 ? ` · T/C ${escapeHtml(Number(rate).toFixed(2))}` : ''}</div>`;
  }
  return main;
}

function renderDiario(data) {
  const tbody = $('#diario-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  updateDiaryIntegrityBanner(data);

  const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
  const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
  const origenFilter = ($('#filtro-origen')?.value) || 'todos';
  const proveedorFilter = (document.getElementById('filtro-proveedor')?.value) || 'todos';

  const { desde: diarioDesde, hasta: diarioHasta } = getDiaryRangeFromUI();

  const { entries, linesByEntry, accountsMap } = data;

  // Mostrar lo más reciente arriba (fecha DESC, id DESC). Si falta fecha, va al final.
  const sorted = [...entries].sort((a, b) => {
    const fa = (a.fecha || a.date || '').toString();
    const fb = (b.fecha || b.date || '').toString();

    const hasA = !!fa;
    const hasB = !!fb;
    if (hasA !== hasB) return hasB ? 1 : -1; // sin fecha al final

    if (fa === fb) return (Number(b.id || 0) - Number(a.id || 0));
    return fb.localeCompare(fa); // ISO strings: DESC
  });

  let renderedRows = 0;

  for (const e of sorted) {
    const tipoMov = e.tipoMovimiento || '';
    const originInfo = finGetEntryOriginPresentation(e);
    const origenRaw = originInfo.label;
    const origenBase = originInfo.base;

    // POS: distinguir cierres diarios vs históricos legacy (ventas individuales)
    const isPos = (origenBase === 'POS');
    const isPosClose = isPos && isPosDailyCloseEntry(e);
    const origenKey = isPos ? (isPosClose ? 'POS_CIERRES' : 'POS_LEGACY') : origenBase;
    const origenLabel = finEntryOriginLabelForHistory(e);
    const origenCell = makePill(origenLabel, finEntryOriginPillVariant(e));

    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (tipoFilter !== 'todos' && tipoMov !== tipoFilter) continue;
    if (!matchEvent(e, eventoFilter)) continue;
    if (!finEntryOriginMatchesFilter(e, origenFilter)) continue;


    const sid = (e.supplierId != null) ? String(e.supplierId) : '';
    const hasSupplier = !!sid || !!(e.supplierName || '').toString().trim();
    if (proveedorFilter !== 'todos') {
      if (proveedorFilter === 'NONE') {
        if (hasSupplier) continue;
      } else {
        if (!sid || sid !== proveedorFilter) continue;
      }
    }
    const lines = linesByEntry.get(e.id) || [];
    const normLines = normalizeEntryLines(e, lines);
    let totalDebe = 0;
    let totalHaber = 0;
    for (const ln of normLines) {
      totalDebe += nSafeMoney(ln.debit);
      totalHaber += nSafeMoney(ln.credit);
    }

    // Display-only: para cierres POS mostramos Caja/Banco vs Ventas, no el total contable del asiento
    let displayDebe = totalDebe;
    let displayHaber = totalHaber;
    if (isPosDailyCloseEntry(e)) {
      const p = getPosPrincipalAmounts(e, lines, accountsMap);
      if (p && p.found) {
        displayDebe = p.principalDebe;
        displayHaber = p.principalHaber;
      }
    }

    const evLabel = getDisplayEventLabel(e);
    const refLabel = getDisplayReference(e);
    const refText = refLabel ? (isPosClose ? refLabel : `Ref: ${refLabel}`) : '';
    const evCell = `${makePill(evLabel, 'gold')}${refText ? ' ' + makePill(refText, 'muted') : ''}`;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(e.fecha || e.date || '')}</td>
      <td>${(function(){
        const baseText = escapeHtml(uiTextFIN(getDisplayDescription(e)));
        const base = `<span class="fin-cell-text fin-clamp-2">${baseText}</span>`;
        const inc = !!(data && data.inconsistentEntryIds && data.inconsistentEntryIds.has(Number(e.id)));
        const incPill = inc ? (' ' + makePill('Inconsistente', 'red')) : '';
        const mm = getPosCloseMismatchAmount(e);
        const pill = mm ? (' ' + makePill(`Cierre con diferencia: ${finFormatCordobas(mm)}`, 'red')) : '';
        return base + incPill + pill + finRenderEntryFinancialBadges(e);
      })()}</td>
      <td>${(function(){ const auto = finGetEntryAutoLabel(e); return `${escapeHtml(tipoMov || 'asiento')}${auto ? '<div class="fin-badge-strip fin-badge-strip--compact">' + makePill(auto, 'gold') + '</div>' : ''}`; })()}</td>
      <td>${evCell || '—'}</td>
      <td>${escapeHtml(getSupplierLabelFromEntry(e, data))}</td>
      <td>${origenCell}</td>
      <td>${(function(){ const m = finGetEntryManualCurrencyMeta(e); return m ? makePill(m.originalCurrency, m.originalCurrency === 'USD' ? 'gold' : 'cash') : '—'; })()}</td>
      <td class="num">${finFormatCordobas(displayDebe)}</td>
      <td class="num">${finFormatCordobas(displayHaber)}</td>
      <td><button type="button" class="btn-link ver-detalle" data-id="${e.id}">Ver detalle</button></td>
    `;
    tbody.appendChild(tr);
    renderedRows++;
  }

  if (!renderedRows) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="10" class="fin-empty-cell">No hay movimientos para mostrar.</td>';
    tbody.appendChild(tr);
  }
}

function openDetalleModal(entryId) {
  if (!finCachedData) return;
  const { entries, linesByEntry, accountsMap } = finCachedData;
  const entry = entries.find(e => e.id === entryId);
  if (!entry) return;

  const modal = $('#detalle-modal');
  const meta = $('#detalle-meta');
  const tbody = $('#detalle-tbody');
  if (!modal || !meta || !tbody) return;

  const supplierLabel = getSupplierLabelFromEntry(entry, finCachedData);
  const ref = getDisplayReference(entry);
  const evLabel = getDisplayEventLabel(entry);
  const pm = (entry.paymentMethod || '').toString().trim();
  const pmLabel = pm === 'bank' ? 'Banco' : (pm === 'cash' ? 'Caja' : (pm ? pm : '—'));
  const closureId = (entry.closureId || '').toString().trim();
  const src = String(entry.source || '').trim();
  const isPosClose = (src === POS_DAILY_CLOSE_SOURCE || src === POS_DAILY_CLOSE_REVERSAL_SOURCE);
  const revOf = (entry.reversalOfClosureId || '').toString().trim();
  const revBy = (entry.reversingClosureId || '').toString().trim();

  let closureLine = '';
  let costsLine = '';
  let mismatchLine = '';
  if (isPosClose) {
    if (closureId) {
      closureLine = `<p><strong>ClosureId:</strong> <code>${escapeHtml(closureId)}</code> <a class="btn-link" href="../pos/index.html" target="_blank" rel="noopener">Abrir POS</a></p>`;
    } else if (revOf) {
      const extra = revBy ? ` (reversado por <code>${escapeHtml(revBy)}</code>)` : '';
      closureLine = `<p><strong>ClosureId:</strong> <code>${escapeHtml(revOf)}</code>${extra} <a class="btn-link" href="../pos/index.html" target="_blank" rel="noopener">Abrir POS</a></p>`;
    }

    const cv = n2(entry?.posCosts?.costoVentasTotal);
    const cc = n2(entry?.posCosts?.costoCortesiasTotal);
    if (cv > 0 || cc > 0) {
      const inv = n2(entry?.posCosts?.costoTotalSalidaInventario);
      costsLine = `
        <p><strong>COGS (5100):</strong> ${finFormatCordobas(cv)}</p>
        <p><strong>Cortesías (6105):</strong> ${finFormatCordobas(cc)}</p>
        <p><strong>Salida de inventario (1500):</strong> ${finFormatCordobas(inv || (cv + cc))}</p>
      `;
    }
  }

    const mm = getPosCloseMismatchAmount(entry);
    if (mm) mismatchLine = `<p>${makePill(`Cierre con diferencia: ${finFormatCordobas(mm)}`, 'red')}</p>`;
  const detailOriginInfo = finGetEntryOriginPresentation(entry);
  const isPosOrigin = detailOriginInfo.base === 'POS';
  const origenLabel = finEntryOriginLabelForHistory(entry);

  const lines = linesByEntry.get(entry.id) || [];
  const isInconsistent = lines.length === 0;
  const inconsLine = isInconsistent ? `<p>${makePill('Inconsistente: asiento sin líneas', 'red')} <span class="fin-muted">No se borró nada. Esto suele pasar por cortes/crash antiguos durante guardado.</span></p>` : '';

  const isPurchase = (entry && entry.entryType === 'purchase');
  // Compras a Proveedor queda dormido: no mostrar accesos visuales al editor legacy.
  const editCompraBtn = '';
  const posNoEditLine = isPosOrigin
    ? `<p>${makePill('Solo consulta', 'muted')} <span class="fin-muted">Este asiento proviene de POS y no se edita directamente. Use un asiento de ajuste si necesita corregirlo.</span></p>`
    : '';

  const transferMeta = finGetEntryInternalTransferMeta(entry);
  const transferLine = transferMeta ? `
    <div class="fin-detail-currency">
      <p><strong>Transferencia interna:</strong> ${escapeHtml(transferMeta.originName || 'Origen')} → ${escapeHtml(transferMeta.destName || 'Destino')}</p>
      <p><strong>Monto origen:</strong> ${escapeHtml(finFormatOriginalAmount(transferMeta.amountOrigin || 0, transferMeta.originCurrency))}</p>
      <p><strong>Monto destino:</strong> ${escapeHtml(finFormatOriginalAmount(transferMeta.amountDest || 0, transferMeta.destCurrency))}</p>
      ${transferMeta.exchangeRateUsed ? `<p><strong>T/C snapshot:</strong> ${escapeHtml(Number(transferMeta.exchangeRateUsed).toFixed(2))}</p>` : ''}
      <p><strong>Equivalente contable:</strong> ${escapeHtml(finFormatCordobas(transferMeta.equivalentNio || 0))}</p>
    </div>
  ` : '';

  const multiMeta = transferMeta ? null : finGetEntryManualCurrencyMeta(entry);
  const multiLine = multiMeta ? `
    <div class="fin-detail-currency">
      <p><strong>Cuenta financiera:</strong> ${escapeHtml(multiMeta.financialAccountName || '—')} ${multiMeta.financialAccountAccountingCode ? `(${escapeHtml(multiMeta.financialAccountAccountingCode)})` : ''}</p>
      <p><strong>Monto original:</strong> ${escapeHtml(finFormatOriginalAmount(multiMeta.originalAmount || 0, multiMeta.originalCurrency))}</p>
      ${multiMeta.originalCurrency === 'USD' ? `<p><strong>T/C snapshot:</strong> ${escapeHtml(multiMeta.exchangeRateUsed ? Number(multiMeta.exchangeRateUsed).toFixed(2) : '—')} · ${escapeHtml(multiMeta.exchangeRateDateSnapshot || 'Sin fecha')}</p>` : ''}
      <p><strong>Equivalente contable:</strong> ${escapeHtml(finFormatCordobas(multiMeta.baseAmountNio || 0))}</p>
    </div>
  ` : '';

  meta.innerHTML = `
    <p><strong>Fecha:</strong> ${escapeHtml(entry.fecha || entry.date || '')}</p>
    <p><strong>Descripción:</strong> ${escapeHtml(uiTextFIN(getDisplayDescription(entry) || ''))}</p>
    <p><strong>Tipo:</strong> ${escapeHtml(entry.tipoMovimiento || '')}</p>
    <p><strong>Evento:</strong> ${escapeHtml(evLabel) || '—'}</p>
    <p><strong>Proveedor:</strong> ${escapeHtml(supplierLabel)}</p>
    <p><strong>Pago:</strong> ${escapeHtml(pmLabel)}</p>
    <p><strong>Referencia:</strong> ${ref ? escapeHtml(ref) : '—'}</p>
    ${finGetEntryAutoLabel(entry) ? `<p><strong>Etiqueta:</strong> ${escapeHtml(finGetEntryAutoLabel(entry))}</p>` : ''}
    ${entry.currency || entry.originalCurrency || entry.monedaOriginal ? `<p><strong>Moneda:</strong> ${escapeHtml(finNormalizeCurrencyCode(entry.currency || entry.originalCurrency || entry.monedaOriginal))}</p>` : ''}
    ${entry.exchangeRateUsed || entry.tipoCambioUsado ? `<p><strong>T/C snapshot:</strong> ${escapeHtml(Number(entry.exchangeRateUsed || entry.tipoCambioUsado).toFixed(2))}</p>` : ''}
    ${entry.totalDebitBase != null || entry.totalDebe != null ? `<p><strong>Total Debe:</strong> ${escapeHtml(finFormatCordobas(entry.totalDebitBase ?? entry.totalDebe ?? 0))}</p>` : ''}
    ${entry.totalCreditBase != null || entry.totalHaber != null ? `<p><strong>Total Haber:</strong> ${escapeHtml(finFormatCordobas(entry.totalCreditBase ?? entry.totalHaber ?? 0))}</p>` : ''}
    ${entry.differenceBase != null || entry.diferenciaBase != null ? `<p><strong>Diferencia:</strong> ${escapeHtml(finFormatCordobas(entry.differenceBase ?? entry.diferenciaBase ?? 0))}</p>` : ''}
    ${editCompraBtn}
    ${posNoEditLine}
    ${closureLine}
    ${costsLine}
    ${mismatchLine}
    ${inconsLine}
    ${transferLine}
    ${multiLine}
    <p><strong>Origen:</strong> ${escapeHtml(origenLabel)}</p>
  `;

tbody.innerHTML = '';
  if (!lines.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="4" class="fin-empty-cell">Movimiento histórico / legacy. No se exigen líneas Debe/Haber nuevas.</td>';
    tbody.appendChild(tr);
  } else {
    for (const ln of lines) {
      const nombre = getAccountDisplayNameByCode(ln.accountCode, accountsMap, ln);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(ln.accountCode || '')}</td>
        <td>${escapeHtml(nombre)}</td>
        <td class="num">${finJournalDetailAmountCell(ln, 'debit')}</td>
        <td class="num">${finJournalDetailAmountCell(ln, 'credit')}</td>
      `;
      tbody.appendChild(tr);
    }
  }

  modal.classList.add('open');
}

function closeDetalleModal() {
  const modal = $('#detalle-modal');
  if (modal) modal.classList.remove('open');
}


/* ---------- Reportes Contables Multibanco / Multimoneda (Etapa 9/10) ---------- */

function finReportSafeEntries(data) {
  return Array.isArray(data && data.entries) ? data.entries : [];
}

function finReportSafeLines(data) {
  return Array.isArray(data && data.lines) ? data.lines : [];
}

function finReportEntryId(entry) {
  const n = Number(entry && entry.id);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function finReportEntryDate(entry) {
  return String(entry && (entry.fecha || entry.date || entry.dateISO || entry.createdAtISO || '') || '').slice(0, 10);
}

function finReportEntryReference(entry) {
  return String(entry && (entry.reference || entry.referencia || entry.paymentRef || entry.comprobante || entry.origenId || '') || '').trim();
}

function finReportEntryDescription(entry) {
  try {
    const v = getDisplayDescription(entry);
    if (v) return String(v).trim();
  } catch (_) {}
  return String(entry && (entry.descripcion || entry.description || entry.concepto || '') || '').trim();
}

function finReportLineAmount(v) {
  const n = finParseCurrencyAmount(v);
  return Number.isFinite(n) ? finRoundCurrency2(n) : 0;
}

function finReportEntryLines(data, entry) {
  const id = finReportEntryId(entry);
  if (!id) return [];
  const map = data && data.linesByEntry;
  if (map && typeof map.get === 'function') {
    const arr = map.get(id);
    return Array.isArray(arr) ? arr : [];
  }
  return finReportSafeLines(data).filter(l => Number(l && l.idEntry) === id);
}

function finReportAccountsSorted(data) {
  return (Array.isArray(data && data.accounts) ? data.accounts : [])
    .filter(acc => acc && finNormalizeAccountCode(acc.code || acc.accountCode || ''))
    .sort((a, b) => finNormalizeAccountCode(a.code || '').localeCompare(finNormalizeAccountCode(b.code || ''), 'es'));
}

function finReportFinancialAccountsSorted(data) {
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts.slice() : [];
  const hasLegacy = rows.some(row => finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || '')) === '1200');
  const legacyAcc = data && data.accountsMap ? data.accountsMap.get('1200') : null;
  if (!hasLegacy && legacyAcc) {
    rows.push({
      id: 'fa-legacy-banco-1200',
      uniqueKey: 'legacy:banco:1200',
      type: 'banco',
      tipo: 'banco',
      nombreVisible: 'Banco legacy / histórico — C$',
      moneda: 'NIO',
      simbolo: finCurrencySymbol('NIO'),
      cuentaContableCodigo: '1200',
      cuentaContableNombreSnapshot: String(legacyAcc.nombre || legacyAcc.name || 'Banco legacy / histórico'),
      activa: false,
      legacyFinancialAccount: true,
      sourceCatalog: 'Cuenta 1200 legacy / histórica'
    });
  }
  return rows
    .filter(row => row && (row.id || row.uniqueKey || row.legacyFinancialAccount || row.legacyFinancialAccount === true))
    .sort((a, b) => String(a.nombreVisible || a.financialAccountNameSnapshot || '').localeCompare(String(b.nombreVisible || b.financialAccountNameSnapshot || ''), 'es'));
}

function finReportBuildFinancialAccountMap(data) {
  const map = new Map();
  for (const row of finReportFinancialAccountsSorted(data)) {
    const id = String(row && (row.id || row.uniqueKey || '') || '').trim();
    if (id) map.set(id, row);
  }
  return map;
}

function finReportFinancialAccountName(row) {
  return String(row && (row.nombreVisible || row.financialAccountNameSnapshot || row.cuentaFinancieraNombreSnapshot || '') || '').trim() || 'Cuenta financiera';
}

function finReportFinancialAccountCode(row) {
  return finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || row.cuentaFinancieraCodigoContable || ''));
}

function finReportFinancialAccountCurrency(row) {
  return finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || row.cuentaFinancieraMoneda || 'NIO'));
}

function finReportLineCurrencyMeta(line, entry, data) {
  const faMap = finReportBuildFinancialAccountMap(data);
  const faId = String(
    (line && (line.financialAccountId || line.cuentaFinancieraId)) ||
    (entry && (entry.financialAccountId || entry.cuentaFinancieraId)) ||
    ''
  ).trim();
  const fa = faId ? faMap.get(faId) : null;
  const hasExplicitCurrency = !!String(
    (line && (line.originalCurrency || line.monedaOriginal)) ||
    (entry && (entry.originalCurrency || entry.monedaOriginal || entry.financialAccountCurrency || entry.cuentaFinancieraMoneda)) ||
    ''
  ).trim();
  const currency = finNormalizeCurrencyCode(
    (line && (line.originalCurrency || line.monedaOriginal)) ||
    (entry && (entry.originalCurrency || entry.monedaOriginal || entry.financialAccountCurrency || entry.cuentaFinancieraMoneda)) ||
    (fa && (fa.moneda || fa.financialAccountCurrency)) ||
    'NIO'
  );
  const rawOriginal = (line && (line.originalAmount ?? line.montoOriginal ?? line.totalOriginal ?? line.debitOriginal ?? line.creditOriginal)) ??
    (entry && (entry.originalAmount ?? entry.montoOriginal ?? entry.totalOriginal ?? entry.totalDebitOriginal ?? entry.totalDebeOriginal));
  let originalAmount = finParseCurrencyAmount(rawOriginal);
  const baseAmountRaw = (line && (line.baseAmountNio ?? line.equivalenteNIO ?? line.debitBase ?? line.creditBase)) ??
    (entry && (entry.baseAmountNio ?? entry.equivalenteNIO ?? entry.totalDebitBase ?? entry.totalDebe));
  let baseAmountNio = finParseCurrencyAmount(baseAmountRaw);
  const debe = finReportLineAmount(line && line.debe);
  const haber = finReportLineAmount(line && line.haber);
  const lineBase = finRoundCurrency2(Math.max(debe, haber));
  if (!Number.isFinite(baseAmountNio) || baseAmountNio === 0) baseAmountNio = lineBase;
  if (!Number.isFinite(originalAmount)) {
    originalAmount = currency === 'NIO' ? lineBase : null;
  }
  const rate = finParseCurrencyAmount((line && (line.exchangeRateUsed ?? line.tipoCambioUsado)) ?? (entry && (entry.exchangeRateUsed ?? entry.tipoCambioUsado)));
  return {
    financialAccountId: faId,
    financialAccountName: String(
      (line && (line.financialAccountNameSnapshot || line.cuentaFinancieraNombreSnapshot)) ||
      (entry && (entry.financialAccountNameSnapshot || entry.cuentaFinancieraNombreSnapshot)) ||
      (fa ? finReportFinancialAccountName(fa) : '') ||
      ''
    ).trim(),
    financialAccountCode: finReportFinancialAccountCode(fa) || finNormalizeAccountCode(entry && (entry.financialAccountAccountingCode || entry.cuentaFinancieraCodigoContable || '')),
    originalCurrency: currency,
    originalAmount: Number.isFinite(originalAmount) ? finRoundCurrency2(originalAmount) : null,
    baseAmountNio: Number.isFinite(baseAmountNio) ? finRoundCurrency2(baseAmountNio) : lineBase,
    exchangeRateUsed: Number.isFinite(rate) ? finRoundCurrency2(rate) : null,
    hasMetadata: !!(hasExplicitCurrency || rawOriginal != null || faId || (Number.isFinite(rate) && rate > 0)),
    isLegacy: !(hasExplicitCurrency || rawOriginal != null || faId || (Number.isFinite(rate) && rate > 0))
  };
}

function finReportLineOriginalDisplay(line, entry, data) {
  const meta = finReportLineCurrencyMeta(line, entry, data);
  const parts = [];
  if (meta.originalAmount != null) parts.push(finFormatOriginalAmount(meta.originalAmount, meta.originalCurrency));
  if (meta.originalCurrency === 'USD') parts.push(`T/C ${meta.exchangeRateUsed ? Number(meta.exchangeRateUsed).toFixed(2) : '—'}`);
  if (meta.financialAccountName) parts.push(meta.financialAccountName);
  if (meta.isLegacy) parts.push('Legacy C$');
  return parts.join(' · ');
}

function finReportDateInRange(date, desde, hasta) {
  const d = String(date || '').slice(0, 10);
  if (desde && d && d < desde) return false;
  if (hasta && d && d > hasta) return false;
  return true;
}

function finReportTextMatch(text, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return String(text || '').toLowerCase().includes(q);
}

function finReportGetFilterRange(prefix) {
  let desde = String(document.getElementById(`${prefix}-desde`)?.value || '').slice(0, 10);
  let hasta = String(document.getElementById(`${prefix}-hasta`)?.value || '').slice(0, 10);
  if (desde && hasta && hasta < desde) {
    const tmp = desde; desde = hasta; hasta = tmp;
  }
  return { desde, hasta };
}

function finReportAccountName(data, code, line) {
  return getAccountDisplayNameByCode(finNormalizeAccountCode(code), data && data.accountsMap, line);
}

function finReportCounterpart(data, entry, accountCode) {
  const code = finNormalizeAccountCode(accountCode);
  const others = finReportEntryLines(data, entry)
    .filter(l => finNormalizeAccountCode(l && l.accountCode) !== code)
    .map(l => `${finNormalizeAccountCode(l.accountCode)} ${finReportAccountName(data, l.accountCode, l)}`.trim());
  return Array.from(new Set(others)).slice(0, 3).join(' · ');
}

function finReportSourceKey(entry) {
  const base = finGetEntryOriginPresentation(entry).base;
  if (base === 'Transferencia') return 'transferencia';
  if (base === 'Compra') return 'compra';
  if (base === 'Recibo') return 'recibo';
  if (base === 'POS') return 'pos';
  if (base === 'Manual') return 'manual';
  return 'legacy';
}

function finReportSourceLabel(entry) {
  const k = finReportSourceKey(entry);
  const labels = {
    manual: 'Registro manual', transferencia: 'Transferencia interna', compra: 'Compra a proveedor',
    recibo: 'Recibo', pos: 'POS', legacy: 'Legacy / histórico'
  };
  return labels[k] || 'Legacy / histórico';
}

function finReportAlertHtml(items) {
  const arr = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!arr.length) return '';
  return arr.map(it => `<div class="fin-report-alert ${escapeHtml(it.kind || '')}">${escapeHtml(it.text || it)}</div>`).join('');
}

function finReportRenderEmpty(hostId, text) {
  const host = document.getElementById(hostId);
  if (host) host.innerHTML = `<div class="fin-empty">${escapeHtml(text || 'No hay movimientos para los filtros seleccionados.')}</div>`;
}

function finReportVisibleRows(rows, limit = FIN_REPORT_UI_LIMIT) {
  const arr = Array.isArray(rows) ? rows : [];
  const max = Number(limit);
  if (!Number.isFinite(max) || max <= 0 || arr.length <= max) {
    return { visible: arr, hidden: 0, limit: arr.length };
  }
  return { visible: arr.slice(0, max), hidden: arr.length - max, limit: max };
}

function finReportLimitNotice(hidden, limit, label = 'movimientos') {
  const h = Number(hidden || 0);
  if (!(h > 0)) return '';
  return `<div class="fin-empty fin-report-limit-note">Se muestran ${escapeHtml(String(limit))} ${escapeHtml(label)}. Hay ${escapeHtml(String(h))} más; usa Exportar Excel para el detalle completo.</div>`;
}

function finReportEnsureSelectors(data) {
  // Evita selectores vacíos antes del primer render; no inventa filtros ni modifica datos.
  try { finReportsFillSelectors(data); } catch (_) {}
}

function finReportsFillSelectors(data) {
  const accountSelectIds = ['rep-mayor-cuenta'];
  const accounts = finReportAccountsSorted(data);
  for (const id of accountSelectIds) {
    const sel = document.getElementById(id);
    if (!sel) continue;
    const prev = sel.value;
    sel.innerHTML = accounts.map(acc => {
      const code = finNormalizeAccountCode(acc.code || '');
      const name = String(acc.nombre || acc.name || `Cuenta ${code}`);
      return `<option value="${escapeAttr(code)}">${escapeHtml(code)} — ${escapeHtml(name)}</option>`;
    }).join('');
    if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
    else if (Array.from(sel.options).some(o => o.value === '1200')) sel.value = '1200';
  }

  const faSel = document.getElementById('rep-estado-fa');
  if (faSel) {
    const prev = faSel.value;
    const rows = finReportFinancialAccountsSorted(data);
    faSel.innerHTML = rows.map(row => {
      const id = String(row && (row.id || row.uniqueKey || '') || '').trim();
      const name = finReportFinancialAccountName(row);
      const code = finReportFinancialAccountCode(row);
      const cur = finReportFinancialAccountCurrency(row);
      const active = row && row.activa === false ? ' · histórica/oculta' : '';
      return `<option value="${escapeAttr(id)}">${escapeHtml(name)} · ${escapeHtml(cur)}${code ? ` · ${escapeHtml(code)}` : ''}${escapeHtml(active)}</option>`;
    }).join('');
    if (prev && Array.from(faSel.options).some(o => o.value === prev)) faSel.value = prev;
  }
}

function finBuildMayorReport(data) {
  const code = finNormalizeAccountCode(document.getElementById('rep-mayor-cuenta')?.value || '');
  const { desde, hasta } = finReportGetFilterRange('rep-mayor');
  const q = String(document.getElementById('rep-mayor-buscar')?.value || '').trim();
  const allEntries = finReportSafeEntries(data).slice().sort((a, b) => `${finReportEntryDate(a)}|${finReportEntryId(a) || 0}`.localeCompare(`${finReportEntryDate(b)}|${finReportEntryId(b) || 0}`));
  let saldoInicial = 0;
  const rows = [];
  let legacyCount = 0;
  let missingMetaUsd = 0;

  for (const entry of allEntries) {
    const date = finReportEntryDate(entry);
    for (const line of finReportEntryLines(data, entry)) {
      if (finNormalizeAccountCode(line && line.accountCode) !== code) continue;
      const debe = finReportLineAmount(line.debe);
      const haber = finReportLineAmount(line.haber);
      const delta = finRoundCurrency2(debe - haber);
      if (desde && date && date < desde) {
        saldoInicial = finRoundCurrency2(saldoInicial + delta);
        continue;
      }
      if (!finReportDateInRange(date, desde, hasta)) continue;
      const desc = finReportEntryDescription(entry);
      const ref = finReportEntryReference(entry);
      const contraparte = finReportCounterpart(data, entry, code);
      const meta = finReportLineCurrencyMeta(line, entry, data);
      if (meta.isLegacy) legacyCount++;
      if (meta.originalCurrency === 'USD' && !meta.exchangeRateUsed) missingMetaUsd++;
      const text = `${date} ${finReportEntryId(entry) || ''} ${desc} ${ref} ${contraparte} ${finReportSourceLabel(entry)} ${finReportLineOriginalDisplay(line, entry, data)}`;
      if (!finReportTextMatch(text, q)) continue;
      rows.push({ entry, line, date, id: finReportEntryId(entry), desc, ref, contraparte, debe, haber, delta, meta });
    }
  }
  let saldo = saldoInicial;
  for (const r of rows) {
    saldo = finRoundCurrency2(saldo + r.delta);
    r.saldo = saldo;
  }
  return { accountCode: code, accountName: finReportAccountName(data, code), desde, hasta, rows, saldoInicial, saldoFinal: saldo, legacyCount, missingMetaUsd };
}

function renderMayorReport(data) {
  const r = finBuildMayorReport(data);
  const alerts = [
    { text: 'Este reporte usa C$ como moneda contable base.' },
    { text: 'Los movimientos en US$ se muestran con el T/C guardado al momento del registro.' }
  ];
  if (r.accountCode === '1200') alerts.push({ text: 'La cuenta 1200 Banco se conserva como legacy para históricos.' });
  if (r.legacyCount) alerts.push({ text: 'Hay movimientos históricos sin metadata multimoneda; se muestran como C$ legacy.' });
  if (r.missingMetaUsd) alerts.push({ text: 'Existen movimientos USD sin T/C snapshot. Se muestran sin recalcular.' , kind: 'warn'});
  const alertHost = document.getElementById('rep-mayor-alerts');
  if (alertHost) alertHost.innerHTML = finReportAlertHtml(alerts);
  const summary = document.getElementById('rep-mayor-summary');
  if (summary) summary.innerHTML = `
    <article><span>Cuenta</span><strong>${escapeHtml(r.accountCode || '—')} · ${escapeHtml(r.accountName || '—')}</strong></article>
    <article><span>Saldo inicial</span><strong>${escapeHtml(finFormatCordobas(r.saldoInicial))}</strong></article>
    <article><span>Saldo final</span><strong>${escapeHtml(finFormatCordobas(r.saldoFinal))}</strong></article>
    <article><span>Movimientos</span><strong>${escapeHtml(String(r.rows.length))}</strong></article>`;
  const host = document.getElementById('rep-mayor-list');
  if (!host) return;
  if (!r.rows.length) return finReportRenderEmpty('rep-mayor-list');
  const limited = finReportVisibleRows(r.rows, FIN_REPORT_UI_LIMIT);
  host.innerHTML = limited.visible.map(row => `
    <article class="fin-report-card">
      <div class="fin-report-card-head">
        <div><strong>${escapeHtml(row.date || 'Sin fecha')}</strong> <span class="fin-muted">· Asiento #${escapeHtml(row.id || '—')}</span></div>
        <div class="fin-report-balance">Saldo ${escapeHtml(finFormatCordobas(row.saldo))}</div>
      </div>
      <div class="fin-report-title">${escapeHtml(row.desc || 'Sin descripción')}</div>
      <div class="fin-report-grid">
        <div><span>Debe</span><strong>${escapeHtml(finFormatCordobas(row.debe))}</strong></div>
        <div><span>Haber</span><strong>${escapeHtml(finFormatCordobas(row.haber))}</strong></div>
        <div><span>Contraparte</span><strong>${escapeHtml(row.contraparte || '—')}</strong></div>
        <div><span>Referencia</span><strong>${escapeHtml(row.ref || '—')}</strong></div>
      </div>
      <div class="fin-badge-strip">${finReportLineOriginalDisplay(row.line, row.entry, data).split(' · ').filter(Boolean).map(x => makePill(x, x.includes('T/C') ? 'muted' : (x.includes('US$') ? 'gold' : 'cash'))).join('')}</div>
    </article>`).join('') + finReportLimitNotice(limited.hidden, limited.limit);
}

function finBuildEstadoCuentaReport(data) {
  const faId = String(document.getElementById('rep-estado-fa')?.value || '').trim();
  const faMap = finReportBuildFinancialAccountMap(data);
  const fa = faMap.get(faId) || null;
  const accountCode = finReportFinancialAccountCode(fa);
  const currency = finReportFinancialAccountCurrency(fa);
  const { desde, hasta } = finReportGetFilterRange('rep-estado');
  const q = String(document.getElementById('rep-estado-buscar')?.value || '').trim();
  const allEntries = finReportSafeEntries(data).slice().sort((a, b) => `${finReportEntryDate(a)}|${finReportEntryId(a) || 0}`.localeCompare(`${finReportEntryDate(b)}|${finReportEntryId(b) || 0}`));
  let saldoInicialBase = 0;
  let saldoInicialPrincipal = 0;
  let principalUnknown = 0;
  const rows = [];
  let legacyCount = 0;

  for (const entry of allEntries) {
    const date = finReportEntryDate(entry);
    for (const line of finReportEntryLines(data, entry)) {
      if (!accountCode || finNormalizeAccountCode(line && line.accountCode) !== accountCode) continue;
      const debe = finReportLineAmount(line.debe);
      const haber = finReportLineAmount(line.haber);
      const entradaBase = debe;
      const salidaBase = haber;
      const deltaBase = finRoundCurrency2(entradaBase - salidaBase);
      const meta = finReportLineCurrencyMeta(line, entry, data);
      const principalAmount = currency === 'USD'
        ? (meta.originalCurrency === 'USD' && meta.originalAmount != null ? meta.originalAmount : null)
        : Math.max(entradaBase, salidaBase);
      const entradaPrincipal = principalAmount != null ? (debe > 0 ? principalAmount : 0) : null;
      const salidaPrincipal = principalAmount != null ? (haber > 0 ? principalAmount : 0) : null;
      const deltaPrincipal = principalAmount != null ? finRoundCurrency2((entradaPrincipal || 0) - (salidaPrincipal || 0)) : null;
      if (desde && date && date < desde) {
        saldoInicialBase = finRoundCurrency2(saldoInicialBase + deltaBase);
        if (deltaPrincipal != null) saldoInicialPrincipal = finRoundCurrency2(saldoInicialPrincipal + deltaPrincipal);
        else principalUnknown++;
        continue;
      }
      if (!finReportDateInRange(date, desde, hasta)) continue;
      const desc = finReportEntryDescription(entry);
      const ref = finReportEntryReference(entry);
      const source = finReportSourceLabel(entry);
      if (meta.isLegacy) legacyCount++;
      const text = `${date} ${desc} ${ref} ${source} ${finReportLineOriginalDisplay(line, entry, data)}`;
      if (!finReportTextMatch(text, q)) continue;
      rows.push({ entry, line, date, id: finReportEntryId(entry), desc, ref, source, entradaBase, salidaBase, deltaBase, entradaPrincipal, salidaPrincipal, deltaPrincipal, meta });
    }
  }
  let saldoBase = saldoInicialBase;
  let saldoPrincipal = saldoInicialPrincipal;
  for (const row of rows) {
    saldoBase = finRoundCurrency2(saldoBase + row.deltaBase);
    row.saldoBase = saldoBase;
    if (row.deltaPrincipal != null) saldoPrincipal = finRoundCurrency2(saldoPrincipal + row.deltaPrincipal);
    else principalUnknown++;
    row.saldoPrincipal = row.deltaPrincipal != null ? saldoPrincipal : null;
  }
  return { fa, faId, accountCode, currency, desde, hasta, rows, saldoInicialBase, saldoBase, saldoInicialPrincipal, saldoPrincipal, principalUnknown, legacyCount };
}

function renderEstadoCuentaReport(data) {
  const r = finBuildEstadoCuentaReport(data);
  const alerts = [
    { text: 'No se reclasifican históricos ni se vinculan bancos por nombre.' },
    { text: 'Los movimientos en US$ se muestran con snapshots; no usan el T/C actual.' }
  ];
  if (r.accountCode === '1200') alerts.push({ text: 'La cuenta 1200 Banco se conserva como legacy para históricos.' });
  if (r.legacyCount || r.principalUnknown) alerts.push({ text: 'Algunos movimientos históricos no tienen metadata de moneda; se muestran como C$ legacy o sin saldo original inventado.', kind: 'warn' });
  const alertHost = document.getElementById('rep-estado-alerts');
  if (alertHost) alertHost.innerHTML = finReportAlertHtml(alerts);
  const summary = document.getElementById('rep-estado-summary');
  if (summary) summary.innerHTML = `
    <article><span>Cuenta financiera</span><strong>${escapeHtml(r.fa ? finReportFinancialAccountName(r.fa) : '—')}</strong></article>
    <article><span>Cuenta contable</span><strong>${escapeHtml(r.accountCode || '—')}</strong></article>
    <article><span>Saldo ${escapeHtml(r.currency)}</span><strong>${r.currency === 'USD' ? escapeHtml(finFormatDollars(r.saldoPrincipal)) : escapeHtml(finFormatCordobas(r.saldoBase))}</strong></article>
    <article><span>Equivalente C$</span><strong>${escapeHtml(finFormatCordobas(r.saldoBase))}</strong></article>`;
  const host = document.getElementById('rep-estado-list');
  if (!host) return;
  if (!r.fa || !r.accountCode) return finReportRenderEmpty('rep-estado-list', 'Seleccione una cuenta financiera válida.');
  if (!r.rows.length) return finReportRenderEmpty('rep-estado-list');
  const limited = finReportVisibleRows(r.rows, FIN_REPORT_UI_LIMIT);
  host.innerHTML = limited.visible.map(row => {
    const entP = row.entradaPrincipal != null ? (r.currency === 'USD' ? finFormatDollars(row.entradaPrincipal) : finFormatCordobas(row.entradaPrincipal)) : '—';
    const salP = row.salidaPrincipal != null ? (r.currency === 'USD' ? finFormatDollars(row.salidaPrincipal) : finFormatCordobas(row.salidaPrincipal)) : '—';
    const saldoP = row.saldoPrincipal != null ? (r.currency === 'USD' ? finFormatDollars(row.saldoPrincipal) : finFormatCordobas(row.saldoPrincipal)) : '—';
    return `
    <article class="fin-report-card">
      <div class="fin-report-card-head">
        <div><strong>${escapeHtml(row.date || 'Sin fecha')}</strong> <span class="fin-muted">· ${escapeHtml(row.source)}</span></div>
        <div class="fin-report-balance">Saldo ${escapeHtml(saldoP)}</div>
      </div>
      <div class="fin-report-title">${escapeHtml(row.desc || 'Sin descripción')}</div>
      <div class="fin-report-grid">
        <div><span>Entrada</span><strong>${escapeHtml(entP)}</strong></div>
        <div><span>Salida</span><strong>${escapeHtml(salP)}</strong></div>
        <div><span>Eq. C$ entrada/salida</span><strong>${escapeHtml(finFormatCordobas(row.entradaBase))} / ${escapeHtml(finFormatCordobas(row.salidaBase))}</strong></div>
        <div><span>Referencia</span><strong>${escapeHtml(row.ref || '—')}</strong></div>
      </div>
      <div class="fin-badge-strip">${finReportLineOriginalDisplay(row.line, row.entry, data).split(' · ').filter(Boolean).map(x => makePill(x, x.includes('T/C') ? 'muted' : (x.includes('US$') ? 'gold' : 'cash'))).join('')}</div>
    </article>`;
  }).join('') + finReportLimitNotice(limited.hidden, limited.limit);
}

function finBuildBalanzaReport(data) {
  const { desde, hasta } = finReportGetFilterRange('rep-balanza');
  const q = String(document.getElementById('rep-balanza-buscar')?.value || '').trim();
  const groups = new Map();
  let missingAccountLines = 0;
  for (const entry of finReportSafeEntries(data)) {
    const date = finReportEntryDate(entry);
    if (!finReportDateInRange(date, desde, hasta)) continue;
    for (const line of finReportEntryLines(data, entry)) {
      const code = finNormalizeAccountCode(line && line.accountCode);
      if (!code) { missingAccountLines++; continue; }
      const name = finReportAccountName(data, code, line);
      const text = `${code} ${name}`;
      if (!finReportTextMatch(text, q)) continue;
      if (!groups.has(code)) groups.set(code, { code, name, debe: 0, haber: 0 });
      const g = groups.get(code);
      g.debe = finRoundCurrency2(g.debe + finReportLineAmount(line.debe));
      g.haber = finRoundCurrency2(g.haber + finReportLineAmount(line.haber));
    }
  }
  const rows = Array.from(groups.values()).sort((a, b) => a.code.localeCompare(b.code, 'es'));
  let totalDebe = 0;
  let totalHaber = 0;
  for (const r of rows) {
    totalDebe = finRoundCurrency2(totalDebe + r.debe);
    totalHaber = finRoundCurrency2(totalHaber + r.haber);
    const saldo = finRoundCurrency2(r.debe - r.haber);
    r.saldoDeudor = saldo > 0 ? saldo : 0;
    r.saldoAcreedor = saldo < 0 ? Math.abs(saldo) : 0;
  }
  return { desde, hasta, rows, totalDebe, totalHaber, diff: finRoundCurrency2(totalDebe - totalHaber), missingAccountLines };
}

function renderBalanzaReport(data) {
  const r = finBuildBalanzaReport(data);
  const alerts = [{ text: 'La balanza está expresada en C$ / NIO y usa journalLines como fuente principal.' }];
  if (Math.abs(r.diff) > 0.005) alerts.push({ text: `Advertencia: total DEBE y HABER no cuadran. Diferencia ${finFormatCordobas(r.diff)}. No se modificó ningún dato.`, kind: 'warn' });
  if (r.missingAccountLines) alerts.push({ text: `Hay ${r.missingAccountLines} líneas sin cuenta contable.`, kind: 'warn' });
  const alertHost = document.getElementById('rep-balanza-alerts');
  if (alertHost) alertHost.innerHTML = finReportAlertHtml(alerts);
  const summary = document.getElementById('rep-balanza-summary');
  if (summary) summary.innerHTML = `
    <article><span>Total DEBE</span><strong>${escapeHtml(finFormatCordobas(r.totalDebe))}</strong></article>
    <article><span>Total HABER</span><strong>${escapeHtml(finFormatCordobas(r.totalHaber))}</strong></article>
    <article><span>Diferencia</span><strong>${escapeHtml(finFormatCordobas(r.diff))}</strong></article>
    <article><span>Cuentas</span><strong>${escapeHtml(String(r.rows.length))}</strong></article>`;
  const host = document.getElementById('rep-balanza-list');
  if (!host) return;
  if (!r.rows.length) return finReportRenderEmpty('rep-balanza-list');
  const limited = finReportVisibleRows(r.rows, FIN_REPORT_BALANZA_UI_LIMIT);
  host.innerHTML = limited.visible.map(row => `
    <article class="fin-report-card fin-report-card--compact">
      <div class="fin-report-card-head"><div><strong>${escapeHtml(row.code)}</strong> · ${escapeHtml(row.name)}</div></div>
      <div class="fin-report-grid fin-report-grid--four">
        <div><span>Debe</span><strong>${escapeHtml(finFormatCordobas(row.debe))}</strong></div>
        <div><span>Haber</span><strong>${escapeHtml(finFormatCordobas(row.haber))}</strong></div>
        <div><span>Saldo deudor</span><strong>${escapeHtml(finFormatCordobas(row.saldoDeudor))}</strong></div>
        <div><span>Saldo acreedor</span><strong>${escapeHtml(finFormatCordobas(row.saldoAcreedor))}</strong></div>
      </div>
    </article>`).join('') + finReportLimitNotice(limited.hidden, limited.limit, 'cuentas');
}

function finBuildLibroReport(data) {
  const { desde, hasta } = finReportGetFilterRange('rep-libro');
  const q = String(document.getElementById('rep-libro-buscar')?.value || '').trim();
  const origen = String(document.getElementById('rep-libro-origen')?.value || 'todos');
  let unbalanced = 0;
  let missingLines = 0;
  const rows = [];
  for (const entry of finReportSafeEntries(data).slice().sort((a, b) => `${finReportEntryDate(a)}|${finReportEntryId(a) || 0}`.localeCompare(`${finReportEntryDate(b)}|${finReportEntryId(b) || 0}`))) {
    const date = finReportEntryDate(entry);
    if (!finReportDateInRange(date, desde, hasta)) continue;
    const key = finReportSourceKey(entry);
    if (origen !== 'todos' && key !== origen) continue;
    const lines = finReportEntryLines(data, entry);
    if (!lines.length) missingLines++;
    const desc = finReportEntryDescription(entry);
    const ref = finReportEntryReference(entry);
    const source = finReportSourceLabel(entry);
    const textLines = lines.map(l => `${l.accountCode} ${finReportAccountName(data, l.accountCode, l)} ${finReportLineOriginalDisplay(l, entry, data)}`).join(' ');
    const text = `${date} ${finReportEntryId(entry) || ''} ${desc} ${ref} ${source} ${textLines}`;
    if (!finReportTextMatch(text, q)) continue;
    const totalDebe = finRoundCurrency2(lines.reduce((s, l) => s + finReportLineAmount(l.debe), 0));
    const totalHaber = finRoundCurrency2(lines.reduce((s, l) => s + finReportLineAmount(l.haber), 0));
    const diff = finRoundCurrency2(totalDebe - totalHaber);
    if (Math.abs(diff) > 0.005) unbalanced++;
    rows.push({ entry, id: finReportEntryId(entry), date, desc, ref, source, lines, totalDebe, totalHaber, diff });
  }
  return { desde, hasta, rows, unbalanced, missingLines };
}

function renderLibroReport(data) {
  const r = finBuildLibroReport(data);
  const alerts = [{ text: 'Los asientos se muestran agrupados; los históricos sin metadata se conservan sin inventar datos.' }];
  if (r.unbalanced) alerts.push({ text: `Hay ${r.unbalanced} asientos descuadrados en el filtro. No se corrigieron automáticamente.`, kind: 'warn' });
  if (r.missingLines) alerts.push({ text: `Hay ${r.missingLines} asientos sin líneas contables visibles.`, kind: 'warn' });
  const alertHost = document.getElementById('rep-libro-alerts');
  if (alertHost) alertHost.innerHTML = finReportAlertHtml(alerts);
  const summary = document.getElementById('rep-libro-summary');
  if (summary) summary.innerHTML = `
    <article><span>Asientos</span><strong>${escapeHtml(String(r.rows.length))}</strong></article>
    <article><span>Descuadrados</span><strong>${escapeHtml(String(r.unbalanced))}</strong></article>
    <article><span>Sin líneas</span><strong>${escapeHtml(String(r.missingLines))}</strong></article>`;
  const host = document.getElementById('rep-libro-list');
  if (!host) return;
  if (!r.rows.length) return finReportRenderEmpty('rep-libro-list');
  const limited = finReportVisibleRows(r.rows, FIN_REPORT_JOURNAL_UI_LIMIT);
  host.innerHTML = limited.visible.map(row => `
    <article class="fin-report-card fin-report-journal-card">
      <div class="fin-report-card-head">
        <div><strong>${escapeHtml(row.date || 'Sin fecha')}</strong> <span class="fin-muted">· Asiento #${escapeHtml(row.id || '—')} · ${escapeHtml(row.source)}</span></div>
        <div class="${Math.abs(row.diff) > 0.005 ? 'fin-report-balance is-warn' : 'fin-report-balance'}">${Math.abs(row.diff) > 0.005 ? 'Descuadrado' : 'Cuadrado'}</div>
      </div>
      <div class="fin-report-title">${escapeHtml(row.desc || 'Sin descripción')}</div>
      <div class="fin-report-ref">Referencia: ${escapeHtml(row.ref || '—')}</div>
      <div class="fin-report-lines">
        ${row.lines.map(line => `
          <div class="fin-report-line">
            <div><strong>${escapeHtml(finNormalizeAccountCode(line.accountCode))}</strong> · ${escapeHtml(finReportAccountName(data, line.accountCode, line))}</div>
            <div class="num">DEBE ${escapeHtml(finFormatCordobas(finReportLineAmount(line.debe)))} · HABER ${escapeHtml(finFormatCordobas(finReportLineAmount(line.haber)))}</div>
            <div class="fin-report-line-meta">${escapeHtml(finReportLineOriginalDisplay(line, row.entry, data) || 'Sin metadata multimoneda')}</div>
          </div>`).join('')}
      </div>
    </article>`).join('') + finReportLimitNotice(limited.hidden, limited.limit, 'asientos');
}

function finReportFinancialAccountCodesSet(data) {
  const set = new Set();
  for (const row of finReportFinancialAccountsSorted(data)) {
    const code = finReportFinancialAccountCode(row);
    if (code) set.add(code);
  }
  for (const acc of finReportAccountsSorted(data)) {
    if (finIsFinancialCashOrBankAccount(acc)) set.add(finNormalizeAccountCode(acc.code));
  }
  return set;
}

function finBuildResumenMonedaReport(data) {
  const { desde, hasta } = finReportGetFilterRange('rep-moneda');
  const finCodes = finReportFinancialAccountCodesSet(data);
  const totals = {
    NIO: { entradas: 0, salidas: 0, movimientos: 0, equivalenteEntradas: 0, equivalenteSalidas: 0 },
    USD: { entradas: 0, salidas: 0, movimientos: 0, equivalenteEntradas: 0, equivalenteSalidas: 0 }
  };
  let legacyCount = 0;
  let missingUsdRate = 0;
  const rows = [];
  for (const entry of finReportSafeEntries(data)) {
    const date = finReportEntryDate(entry);
    if (!finReportDateInRange(date, desde, hasta)) continue;
    for (const line of finReportEntryLines(data, entry)) {
      const code = finNormalizeAccountCode(line && line.accountCode);
      if (!finCodes.has(code)) continue;
      const meta = finReportLineCurrencyMeta(line, entry, data);
      const cur = meta.originalCurrency === 'USD' ? 'USD' : 'NIO';
      const debe = finReportLineAmount(line.debe);
      const haber = finReportLineAmount(line.haber);
      const baseAmt = finRoundCurrency2(Math.max(debe, haber));
      const origAmt = meta.originalAmount != null ? meta.originalAmount : (cur === 'USD' ? 0 : baseAmt);
      if (debe > 0) {
        totals[cur].entradas = finRoundCurrency2(totals[cur].entradas + origAmt);
        totals[cur].equivalenteEntradas = finRoundCurrency2(totals[cur].equivalenteEntradas + baseAmt);
      }
      if (haber > 0) {
        totals[cur].salidas = finRoundCurrency2(totals[cur].salidas + origAmt);
        totals[cur].equivalenteSalidas = finRoundCurrency2(totals[cur].equivalenteSalidas + baseAmt);
      }
      totals[cur].movimientos += 1;
      if (meta.isLegacy) legacyCount++;
      if (cur === 'USD' && !meta.exchangeRateUsed) missingUsdRate++;
      rows.push({ date, code, accountName: finReportAccountName(data, code, line), desc: finReportEntryDescription(entry), cur, debe, haber, baseAmt, origAmt, meta });
    }
  }
  const totalGeneralEq = finRoundCurrency2(totals.NIO.equivalenteEntradas - totals.NIO.equivalenteSalidas + totals.USD.equivalenteEntradas - totals.USD.equivalenteSalidas);
  return { desde, hasta, totals, rows, legacyCount, missingUsdRate, totalGeneralEq };
}

function renderResumenMonedaReport(data) {
  const r = finBuildResumenMonedaReport(data);
  const alerts = [{ text: 'Los movimientos USD usan snapshots guardados; no se recalculan con el T/C actual.' }];
  if (r.legacyCount) alerts.push({ text: 'Algunos movimientos históricos no tienen metadata de moneda; se muestran como C$ legacy.', kind: 'warn' });
  if (r.missingUsdRate) alerts.push({ text: 'Existen movimientos USD sin T/C snapshot. Se muestran sin recalcular.', kind: 'warn' });
  const alertHost = document.getElementById('rep-moneda-alerts');
  if (alertHost) alertHost.innerHTML = finReportAlertHtml(alerts);
  const t = r.totals;
  const summary = document.getElementById('rep-moneda-summary');
  if (summary) summary.innerHTML = `
    <article><span>Total entradas C$</span><strong>${escapeHtml(finFormatCordobas(t.NIO.entradas))}</strong></article>
    <article><span>Total salidas C$</span><strong>${escapeHtml(finFormatCordobas(t.NIO.salidas))}</strong></article>
    <article><span>Total entradas US$</span><strong>${escapeHtml(finFormatDollars(t.USD.entradas))}</strong><small>Eq. ${escapeHtml(finFormatCordobas(t.USD.equivalenteEntradas))}</small></article>
    <article><span>Total salidas US$</span><strong>${escapeHtml(finFormatDollars(t.USD.salidas))}</strong><small>Eq. ${escapeHtml(finFormatCordobas(t.USD.equivalenteSalidas))}</small></article>
    <article><span>Movimientos C$</span><strong>${escapeHtml(String(t.NIO.movimientos))}</strong></article>
    <article><span>Movimientos US$</span><strong>${escapeHtml(String(t.USD.movimientos))}</strong></article>
    <article><span>Total general equivalente</span><strong>${escapeHtml(finFormatCordobas(r.totalGeneralEq))}</strong></article>`;
  const host = document.getElementById('rep-moneda-list');
  if (!host) return;
  if (!r.rows.length) return finReportRenderEmpty('rep-moneda-list');
  const byCur = ['NIO', 'USD'].map(cur => {
    const rows = r.rows.filter(x => x.cur === cur);
    if (!rows.length) return '';
    const limited = finReportVisibleRows(rows, FIN_REPORT_JOURNAL_UI_LIMIT);
    return `<article class="fin-report-card">
      <div class="fin-report-card-head"><div><strong>${cur === 'USD' ? 'US$ / USD' : 'C$ / NIO'}</strong></div><div>${rows.length} movimientos</div></div>
      <div class="fin-report-lines">
        ${limited.visible.map(row => `<div class="fin-report-line"><div><strong>${escapeHtml(row.date || 'Sin fecha')}</strong> · ${escapeHtml(row.code)} ${escapeHtml(row.accountName)}</div><div>${escapeHtml(row.desc || 'Sin descripción')}</div><div class="fin-report-line-meta">${escapeHtml(finFormatOriginalAmount(row.origAmt, row.cur))} · Eq. ${escapeHtml(finFormatCordobas(row.baseAmt))}${row.meta.exchangeRateUsed ? ` · T/C ${escapeHtml(Number(row.meta.exchangeRateUsed).toFixed(2))}` : ''}</div></div>`).join('')}
        ${finReportLimitNotice(limited.hidden, limited.limit)}
      </div>
    </article>`;
  }).join('');
  host.innerHTML = byCur;
}

function renderAccountingReports(data) {
  try {
    finReportsFillSelectors(data);
    renderMayorReport(data);
    renderEstadoCuentaReport(data);
    renderBalanzaReport(data);
    renderLibroReport(data);
    renderResumenMonedaReport(data);
  } catch (err) {
    console.error('Error renderizando Reportes Contables', err);
    ['rep-mayor-list', 'rep-estado-list', 'rep-balanza-list', 'rep-libro-list', 'rep-moneda-list'].forEach(id => finReportRenderEmpty(id, 'No se pudo renderizar el reporte. Revisa consola.'));
  }
}

function finExportReportWorkbook(sheetName, rows, filename, title) {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  finAttachExportCurrencyMetadata(wb, title);
  XLSX.writeFile(wb, filename);
}

async function exportMayorReportExcel() {
  if (!finCachedData) await refreshAllFin();
  const r = finBuildMayorReport(finCachedData);
  if (!r.rows.length) return alert('No hay datos para exportar el Mayor por cuenta.');
  const rows = [['Mayor por cuenta'], ['Cuenta', `${r.accountCode} ${r.accountName}`], ['Periodo', `${r.desde || 'Inicio'} a ${r.hasta || 'Hoy'}`], ['Exportado', finFormatCurrencyTimestamp(new Date().toISOString())], [], ['Fecha', 'Asiento', 'Descripción', 'Referencia', 'Contraparte', 'Debe C$', 'Haber C$', 'Saldo C$', 'Moneda original', 'Monto original', 'T/C usado', 'Equivalente C$']];
  for (const x of r.rows) rows.push([x.date, x.id || '', x.desc, x.ref, x.contraparte, x.debe, x.haber, x.saldo, x.meta.originalCurrency, x.meta.originalAmount ?? '', x.meta.exchangeRateUsed ?? '', x.meta.baseAmountNio ?? '']);
  finExportReportWorkbook('Mayor', rows, `finanzas_mayor_${r.accountCode || 'cuenta'}_${todayStr()}.xlsx`, 'Mayor por cuenta');
  showToast('Mayor exportado a Excel');
}

async function exportEstadoCuentaReportExcel() {
  if (!finCachedData) await refreshAllFin();
  const r = finBuildEstadoCuentaReport(finCachedData);
  if (!r.rows.length) return alert('No hay datos para exportar el Estado de cuenta.');
  const rows = [['Estado de cuenta financiera'], ['Cuenta financiera', r.fa ? finReportFinancialAccountName(r.fa) : ''], ['Cuenta contable', r.accountCode || ''], ['Periodo', `${r.desde || 'Inicio'} a ${r.hasta || 'Hoy'}`], ['Exportado', finFormatCurrencyTimestamp(new Date().toISOString())], [], ['Fecha', 'Asiento', 'Operación', 'Descripción', 'Referencia', 'Entrada original', 'Salida original', 'Saldo original', 'Entrada C$', 'Salida C$', 'Saldo C$', 'Moneda', 'Monto original', 'T/C usado']];
  for (const x of r.rows) rows.push([x.date, x.id || '', x.source, x.desc, x.ref, x.entradaPrincipal ?? '', x.salidaPrincipal ?? '', x.saldoPrincipal ?? '', x.entradaBase, x.salidaBase, x.saldoBase, x.meta.originalCurrency, x.meta.originalAmount ?? '', x.meta.exchangeRateUsed ?? '']);
  finExportReportWorkbook('EstadoCuenta', rows, `finanzas_estado_cuenta_${r.accountCode || 'cuenta'}_${todayStr()}.xlsx`, 'Estado de cuenta financiera');
  showToast('Estado de cuenta exportado a Excel');
}

async function exportBalanzaReportExcel() {
  if (!finCachedData) await refreshAllFin();
  const r = finBuildBalanzaReport(finCachedData);
  if (!r.rows.length) return alert('No hay datos para exportar la Balanza.');
  const rows = [['Balanza de comprobación'], ['Periodo', `${r.desde || 'Inicio'} a ${r.hasta || 'Hoy'}`], ['Exportado', finFormatCurrencyTimestamp(new Date().toISOString())], ['Total DEBE', r.totalDebe], ['Total HABER', r.totalHaber], ['Diferencia', r.diff], [], ['Código', 'Cuenta', 'Total DEBE C$', 'Total HABER C$', 'Saldo deudor C$', 'Saldo acreedor C$']];
  for (const x of r.rows) rows.push([x.code, x.name, x.debe, x.haber, x.saldoDeudor, x.saldoAcreedor]);
  finExportReportWorkbook('Balanza', rows, `finanzas_balanza_${todayStr()}.xlsx`, 'Balanza de comprobación');
  showToast('Balanza exportada a Excel');
}

async function exportLibroReportExcel() {
  if (!finCachedData) await refreshAllFin();
  const r = finBuildLibroReport(finCachedData);
  if (!r.rows.length) return alert('No hay datos para exportar el Libro Diario.');
  const rows = [['Libro Diario mejorado'], ['Periodo', `${r.desde || 'Inicio'} a ${r.hasta || 'Hoy'}`], ['Exportado', finFormatCurrencyTimestamp(new Date().toISOString())], [], ['Fecha', 'Asiento', 'Origen', 'Descripción', 'Referencia', 'Cuenta', 'Nombre cuenta', 'Debe C$', 'Haber C$', 'Moneda original', 'Monto original', 'T/C usado', 'Cuenta financiera']];
  for (const e of r.rows) {
    for (const l of e.lines) {
      const meta = finReportLineCurrencyMeta(l, e.entry, finCachedData);
      rows.push([e.date, e.id || '', e.source, e.desc, e.ref, finNormalizeAccountCode(l.accountCode), finReportAccountName(finCachedData, l.accountCode, l), finReportLineAmount(l.debe), finReportLineAmount(l.haber), meta.originalCurrency, meta.originalAmount ?? '', meta.exchangeRateUsed ?? '', meta.financialAccountName || '']);
    }
  }
  finExportReportWorkbook('LibroDiario', rows, `finanzas_libro_diario_${todayStr()}.xlsx`, 'Libro Diario mejorado');
  showToast('Libro Diario exportado a Excel');
}

async function exportResumenMonedaReportExcel() {
  if (!finCachedData) await refreshAllFin();
  const r = finBuildResumenMonedaReport(finCachedData);
  if (!r.rows.length) return alert('No hay datos para exportar el Resumen por moneda.');
  const rows = [['Resumen por moneda'], ['Periodo', `${r.desde || 'Inicio'} a ${r.hasta || 'Hoy'}`], ['Exportado', finFormatCurrencyTimestamp(new Date().toISOString())], [], ['Moneda', 'Entradas originales', 'Salidas originales', 'Eq. entradas C$', 'Eq. salidas C$', 'Movimientos'], ['NIO', r.totals.NIO.entradas, r.totals.NIO.salidas, r.totals.NIO.equivalenteEntradas, r.totals.NIO.equivalenteSalidas, r.totals.NIO.movimientos], ['USD', r.totals.USD.entradas, r.totals.USD.salidas, r.totals.USD.equivalenteEntradas, r.totals.USD.equivalenteSalidas, r.totals.USD.movimientos], ['Total general equivalente C$', r.totalGeneralEq], [], ['Fecha', 'Cuenta', 'Nombre cuenta', 'Descripción', 'Moneda', 'Monto original', 'Equivalente C$', 'T/C usado']];
  for (const x of r.rows) rows.push([x.date, x.code, x.accountName, x.desc, x.cur, x.origAmt, x.baseAmt, x.meta.exchangeRateUsed ?? '']);
  finExportReportWorkbook('ResumenMoneda', rows, `finanzas_resumen_moneda_${todayStr()}.xlsx`, 'Resumen por moneda');
  showToast('Resumen por moneda exportado a Excel');
}

function setupAccountingReportsUI() {
  const render = () => { if (finCachedData) renderAccountingReports(finCachedData); };
  [
    'rep-mayor-cuenta', 'rep-mayor-desde', 'rep-mayor-hasta', 'rep-estado-fa', 'rep-estado-desde', 'rep-estado-hasta',
    'rep-balanza-desde', 'rep-balanza-hasta', 'rep-libro-desde', 'rep-libro-hasta', 'rep-libro-origen', 'rep-moneda-desde', 'rep-moneda-hasta'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', render);
  });
  ['rep-mayor-buscar', 'rep-estado-buscar', 'rep-balanza-buscar', 'rep-libro-buscar'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => {
      clearTimeout(el._a33ReportTimer);
      el._a33ReportTimer = setTimeout(render, 180);
    });
  });
  const bind = (id, fn) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', (ev) => { ev.preventDefault(); fn().catch(err => { console.error('Error exportando reporte contable', err); alert('No se pudo exportar el reporte a Excel.'); }); });
  };
  bind('btn-export-mayor', exportMayorReportExcel);
  bind('btn-export-estado', exportEstadoCuentaReportExcel);
  bind('btn-export-balanza', exportBalanzaReportExcel);
  bind('btn-export-libro', exportLibroReportExcel);
  bind('btn-export-moneda', exportResumenMonedaReportExcel);
}

/* ---------- Render: Estado de Resultados ---------- */

function renderEstadoResultados(data) {
  const modoSel = $('#er-modo');
  const mesSel = $('#er-mes');
  const anioSel = $('#er-anio');
  const desdeInput = $('#er-desde');
  const hastaInput = $('#er-hasta');
  const eventoSel = $('#er-evento');

  const modo = modoSel ? modoSel.value : 'mes';
  let desde = null;
  let hasta = null;

  if (modo === 'mes') {
    const mes = mesSel?.value || pad2(new Date().getMonth() + 1);
    const anio = anioSel?.value || String(new Date().getFullYear());
    const range = monthRange(Number(anio), Number(mes));
    desde = range.start;
    hasta = range.end;
  } else {
    desde = (desdeInput?.value) || todayStr();
    hasta = (hastaInput?.value) || desde;
    if (hasta < desde) {
      const tmp = desde;
      desde = hasta;
      hasta = tmp;
    }
  }

  const evento = eventoSel?.value || 'ALL';
  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde,
    hasta,
    evento
  });

  const bruta = ingresos - costos;
  const neta = bruta - gastos;

  const elIng = $('#er-ingresos');
  const elCos = $('#er-costos');
  const elGas = $('#er-gastos');
  const elBruta = $('#er-bruta');
  const elNeta = $('#er-neta');

  if (elIng) elIng.textContent = finFormatCordobas(ingresos);
  if (elCos) elCos.textContent = finFormatCordobas(costos);
  if (elGas) elGas.textContent = finFormatCordobas(gastos);
  if (elBruta) elBruta.textContent = finFormatCordobas(bruta);
  if (elNeta) elNeta.textContent = finFormatCordobas(neta);
}

/* ---------- Render: Balance General ---------- */

function renderBalanceGeneral(data) {
  const corteInput = $('#bg-fecha');
  const corte = corteInput?.value || todayStr();
  const { activos, pasivos, patrimonio } = calcBalanceGroupsUntilDate(data, corte);
  const cuadre = activos - (pasivos + patrimonio);

  const elA = $('#bg-activos');
  const elP = $('#bg-pasivos');
  const elPt = $('#bg-patrimonio');
  const elC = $('#bg-cuadre');

  if (elA) elA.textContent = finFormatCordobas(activos);
  if (elP) elP.textContent = finFormatCordobas(pasivos);
  if (elPt) elPt.textContent = finFormatCordobas(patrimonio);
  if (elC) elC.textContent = finFormatCordobas(cuadre);
}

/* ---------- Guardar movimiento manual ---------- */

async function guardarMovimientoManual() {
  if (!finCachedData) {
    await refreshAllFin();
  }

  const fecha = $('#mov-fecha')?.value || todayStr();
  const tipo = $('#mov-tipo')?.value || 'ingreso';
  const montoRaw = $('#mov-monto')?.value || '';
  const cuentaCode = finNormalizeAccountCode($('#mov-cuenta')?.value || '');
  const financialAccount = finGetSelectedFinancialAccount(finCachedData);

  const eventoSel = ($('#mov-evento-sel')?.value || 'CENTRAL').toString();
  let eventScope = 'CENTRAL';
  let posEventId = null;
  let posEventNameSnapshot = null;

  if (eventoSel.startsWith('POS:')) {
    const id = parseInt(eventoSel.slice(4), 10);
    if (id) {
      eventScope = 'POS';
      posEventId = id;
      posEventNameSnapshot = getPosEventNameLiveById(id) || (Array.isArray(posActiveEvents) ? (posActiveEvents.find(e => e.id === id)?.name || null) : null);
    }
  }

  const reference = ($('#mov-evento')?.value || '').trim();
  const descripcion = ($('#mov-descripcion')?.value || '').trim();
  const originalAmount = finParseCurrencyAmount(montoRaw);

  if (!fecha) {
    alert('Ingresa la fecha del movimiento.');
    return;
  }
  if (tipo === 'transferencia') {
    alert('Use la sección Transferencias Internas para registrar movimientos entre cuentas financieras.');
    return;
  }
  if (!financialAccount) {
    alert('Configure al menos una cuenta financiera activa antes de registrar movimientos.');
    return;
  }
  if (!cuentaCode) {
    alert('Selecciona la cuenta contable contraparte.');
    return;
  }
  if (!(Number.isFinite(originalAmount) && originalAmount > 0)) {
    alert('El monto original debe ser mayor que cero.');
    return;
  }

  const financialCode = finNormalizeAccountCode(financialAccount.cuentaContableCodigo || '');
  const financialAccountRecord = financialCode && finCachedData.accountsMap ? finCachedData.accountsMap.get(financialCode) : null;
  const counterpartAccount = finCachedData.accountsMap ? finCachedData.accountsMap.get(cuentaCode) : null;
  if (!financialCode || !financialAccountRecord) {
    alert('La cuenta financiera seleccionada no tiene una cuenta contable válida asociada. Revise Cuentas Financieras.');
    return;
  }
  if (!counterpartAccount) {
    alert('La cuenta contable contraparte no existe.');
    return;
  }
  if (cuentaCode === financialCode) {
    alert('La cuenta contable contraparte no puede ser la misma cuenta financiera.');
    return;
  }

  const financialCurrency = finNormalizeCurrencyCode(financialAccount.moneda || financialAccount.financialAccountCurrency || 'NIO');
  const snapshot = finBuildExchangeRateSnapshot({ currency: financialCurrency, amount: originalAmount });
  if (!snapshot.ok || !Number.isFinite(Number(snapshot.equivalenteNIO)) || Number(snapshot.equivalenteNIO) <= 0) {
    alert(snapshot.warningMessage || FIN_CURRENCY_WARNING_MESSAGE);
    return;
  }

  const baseAmountNio = finRoundCurrency2(snapshot.equivalenteNIO);
  if (!Number.isFinite(baseAmountNio) || baseAmountNio <= 0) {
    alert('El equivalente contable en C$ es inválido.');
    return;
  }

  let debeCode;
  let haberCode;

  if (tipo === 'ingreso') {
    debeCode = financialCode;
    haberCode = cuentaCode;
  } else if (tipo === 'egreso') {
    debeCode = cuentaCode;
    haberCode = financialCode;
  } else {
    debeCode = cuentaCode;
    haberCode = financialCode;
  }

  const totalDebe = finRoundCurrency2(baseAmountNio);
  const totalHaber = finRoundCurrency2(baseAmountNio);
  if (Math.abs(Number(totalDebe) - Number(totalHaber)) > 0.005) {
    alert('El asiento no cuadra. No se guardó el movimiento.');
    return;
  }

  const movementSnapshot = finBuildManualMovementSnapshot(financialAccount, originalAmount, baseAmountNio, snapshot);
  const paymentMethod = String(financialAccount.type || financialAccount.tipo || '').toLowerCase() === 'banco' ? 'bank' : 'cash';
  const entry = {
    fecha,
    descripcion: descripcion || `Movimiento ${tipo}`,
    tipoMovimiento: tipo,
    reference,
    eventScope,
    posEventId,
    posEventNameSnapshot,
    origen: 'Interno',
    origenId: null,
    source: 'manual_financial_account',
    paymentMethod,
    medio: paymentMethod === 'bank' ? 'banco' : 'caja',
    totalDebe,
    totalHaber,
    ...movementSnapshot
  };

  const commonLineMeta = {
    originalCurrency: movementSnapshot.originalCurrency,
    originalAmount: movementSnapshot.originalAmount,
    baseCurrency: 'NIO',
    baseAmountNio: movementSnapshot.baseAmountNio,
    exchangeRateUsed: movementSnapshot.exchangeRateUsed,
    financialAccountId: movementSnapshot.financialAccountId
  };
  const lines = [
    { accountCode: String(debeCode), debe: totalDebe, haber: 0, accountNameSnapshot: getAccountDisplayNameByCode(debeCode, finCachedData.accountsMap), ...commonLineMeta },
    { accountCode: String(haberCode), debe: 0, haber: totalHaber, accountNameSnapshot: getAccountDisplayNameByCode(haberCode, finCachedData.accountsMap), ...commonLineMeta }
  ];

  // Guardado atómico: o se guarda TODO (asiento + líneas) o no se guarda NADA.
  try {
    await createJournalEntryWithLinesAtomic(entry, lines);
  } catch (err) {
    console.error('Error en guardado atómico del movimiento', err);
    alert('No se pudo guardar el movimiento (guardado atómico falló).');
    return;
  }

  const montoInput = $('#mov-monto');
  const descInput = $('#mov-descripcion');
  const eventoInput = $('#mov-evento');
  if (montoInput) montoInput.value = '';
  if (descInput) descInput.value = '';
  if (eventoInput) eventoInput.value = reference;

  showToast('Movimiento guardado en el Diario');
  await refreshAllFin();
}

/* ---------- Diario Contable real (Etapa 7/9) ---------- */

const FIN_JOURNAL_REAL_STAGE = 'finanzas_diario_contable_etapa_7_9_persist';
let finJournalLineSeq = 0;
let finJournalUiReady = false;
let finJournalSaving = false;

function finJournalMoneySymbol(currency) {
  return finNormalizeCurrencyCode(currency) === 'USD' ? 'US$' : 'C$';
}

function finJournalFormatMoney(value, currency) {
  return finNormalizeCurrencyCode(currency) === 'USD' ? finFormatDollars(value) : finFormatCordobas(value);
}

function finJournalGetCurrency() {
  return finNormalizeCurrencyCode(document.getElementById('journal-currency')?.value || 'NIO');
}

function finJournalGetExchangeRate() {
  const state = finGetCurrencyStateSafe();
  return state.hasExchangeRate && Number.isFinite(state.exchangeRate) && state.exchangeRate > 0 ? finRoundCurrency2(state.exchangeRate) : null;
}

function finJournalSetMessage(text, kind = '') {
  const el = document.getElementById('journal-status');
  if (!el) return;
  el.textContent = text || '';
  el.className = `fin-journal-status${kind ? ' is-' + kind : ''}`;
}

function finJournalLineRows() {
  return Array.from(document.querySelectorAll('#journal-lines .fin-journal-line'));
}

function finJournalLineSelectorId(lineId) {
  return `journal-line-selector-${lineId}`;
}

function finJournalGetLineData(row) {
  if (!row) return null;
  const lineId = String(row.dataset.lineId || '');
  const selectorId = finJournalLineSelectorId(lineId);
  const selectorState = finAccountSelectorInstances.get(selectorId);
  const accountCode = selectorState ? finGetAccountCode(selectorState.value || '') : '';
  const account = selectorState ? selectorState.account : null;
  const debitInput = row.querySelector('.journal-debit');
  const creditInput = row.querySelector('.journal-credit');
  const debitRaw = debitInput ? debitInput.value : '';
  const creditRaw = creditInput ? creditInput.value : '';
  const debit = finParseCurrencyAmount(debitRaw);
  const credit = finParseCurrencyAmount(creditRaw);
  const debitValue = Number.isFinite(debit) && debit > 0 ? finRoundCurrency2(debit) : 0;
  const creditValue = Number.isFinite(credit) && credit > 0 ? finRoundCurrency2(credit) : 0;
  return {
    lineId,
    accountCode,
    accountName: account ? (account.nombre || account.name || '') : '',
    account,
    debitRaw,
    creditRaw,
    debit: debitValue || 0,
    credit: creditValue || 0,
    hasDebitRaw: String(debitRaw || '').trim() !== '',
    hasCreditRaw: String(creditRaw || '').trim() !== ''
  };
}

function finJournalAccountSnapshot(account, accountCode) {
  const row = account ? finNormalizeAccountForView(account) : null;
  const code = finGetAccountCode(accountCode || row?.code || '');
  const rootCode = finGetRootFromCode(code);
  return {
    accountId: String(row?.id || code || ''),
    accountCode: code,
    accountName: String(row?.nombre || row?.name || account?.nombre || account?.name || `Cuenta ${code}`).trim(),
    accountType: finGetAccountType(row || account || code),
    accountNature: finGetAccountNature(row || account || code),
    accountRootCode: rootCode,
    accountRootName: FIN_FIXED_ROOTS_BY_CODE[rootCode]?.name || '',
    accountLevel: finGetAccountLevelFromCode(code),
    accountNameSnapshot: String(row?.nombre || row?.name || account?.nombre || account?.name || `Cuenta ${code}`).trim(),
    accountCodeSnapshot: code,
    accountTypeSnapshot: finGetAccountType(row || account || code),
    accountNatureSnapshot: finGetAccountNature(row || account || code)
  };
}

function finJournalBuildDraftPayload() {
  const currency = finJournalGetCurrency();
  const exchangeRate = currency === 'USD' ? finJournalGetExchangeRate() : null;
  const rate = currency === 'USD' ? exchangeRate : null;
  const nowISO = new Date().toISOString();
  const rows = finJournalLineRows()
    .map(finJournalGetLineData)
    .filter(Boolean)
    .filter(row => row.accountCode || row.debit > 0 || row.credit > 0 || row.hasDebitRaw || row.hasCreditRaw);
  const lines = rows.map((row, idx) => {
    const debitOriginal = finRoundCurrency2(row.debit || 0) || 0;
    const creditOriginal = finRoundCurrency2(row.credit || 0) || 0;
    const debitBase = currency === 'USD' && rate ? finRoundCurrency2(debitOriginal * rate) : debitOriginal;
    const creditBase = currency === 'USD' && rate ? finRoundCurrency2(creditOriginal * rate) : creditOriginal;
    const snap = finJournalAccountSnapshot(row.account, row.accountCode);
    return {
      lineUid: `jl-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 8)}`,
      lineId: row.lineId,
      lineNumber: idx + 1,
      ...snap,
      debitOriginal,
      creditOriginal,
      debitBase: debitBase || 0,
      creditBase: creditBase || 0,
      debe: debitBase || 0,
      haber: creditBase || 0,
      debit: debitBase || 0,
      credit: creditBase || 0,
      originalCurrency: currency,
      monedaOriginal: currency,
      currency,
      currencySymbol: finCurrencySymbol(currency),
      exchangeRateUsed: currency === 'USD' ? rate : null,
      tipoCambioUsado: currency === 'USD' ? rate : null,
      baseCurrency: 'NIO',
      monedaBase: 'NIO',
      baseAmountNio: Math.max(debitBase || 0, creditBase || 0),
      equivalenteNIO: Math.max(debitBase || 0, creditBase || 0),
      originalAmount: Math.max(debitOriginal, creditOriginal),
      montoOriginal: Math.max(debitOriginal, creditOriginal),
      createdAt: nowISO,
      createdAtISO: nowISO,
      updatedAt: nowISO,
      updatedAtISO: nowISO
    };
  });
  const totalDebit = finRoundCurrency2(lines.reduce((sum, ln) => sum + (Number(ln.debitOriginal) || 0), 0)) || 0;
  const totalCredit = finRoundCurrency2(lines.reduce((sum, ln) => sum + (Number(ln.creditOriginal) || 0), 0)) || 0;
  const totalDebitBase = finRoundCurrency2(lines.reduce((sum, ln) => sum + (Number(ln.debitBase) || 0), 0)) || 0;
  const totalCreditBase = finRoundCurrency2(lines.reduce((sum, ln) => sum + (Number(ln.creditBase) || 0), 0)) || 0;
  const difference = finRoundCurrency2(totalDebit - totalCredit) || 0;
  const differenceBase = finRoundCurrency2(totalDebitBase - totalCreditBase) || 0;
  const draftEntry = {
    stage: FIN_JOURNAL_REAL_STAGE,
    date: document.getElementById('journal-date')?.value || todayStr(),
    fecha: document.getElementById('journal-date')?.value || todayStr(),
    currency,
    originalCurrency: currency,
    monedaOriginal: currency,
    currencySymbol: finCurrencySymbol(currency),
    exchangeRateUsed: currency === 'USD' ? rate : null,
    tipoCambioUsado: currency === 'USD' ? rate : null,
    description: String(document.getElementById('journal-description')?.value || '').trim(),
    descripcion: String(document.getElementById('journal-description')?.value || '').trim(),
    reference: String(document.getElementById('journal-reference')?.value || '').trim(),
    referencia: String(document.getElementById('journal-reference')?.value || '').trim(),
    source: 'manual_journal_entry',
    origin: 'manual',
    origen: 'Manual',
    status: 'posted',
    estado: 'posted',
    schemaVersion: 2,
    legacyCompatible: true,
    createdAt: nowISO,
    createdAtISO: nowISO,
    updatedAt: nowISO,
    updatedAtISO: nowISO,
    totalDebitOriginal: totalDebit,
    totalCreditOriginal: totalCredit,
    totalDebeOriginal: totalDebit,
    totalHaberOriginal: totalCredit,
    totalDebitBase,
    totalCreditBase,
    totalDebe: totalDebitBase,
    totalHaber: totalCreditBase,
    totalOriginal: totalDebit,
    originalAmount: totalDebit,
    montoOriginal: totalDebit,
    baseCurrency: 'NIO',
    monedaBase: 'NIO',
    baseAmountNio: totalDebitBase,
    equivalenteNIO: totalDebitBase,
    differenceOriginal: difference,
    differenceBase,
    diferenciaOriginal: difference,
    diferenciaBase: differenceBase,
    linesCount: lines.length
  };
  const autoLabel = finGetAutomaticEntryLabel(draftEntry, lines);
  draftEntry.autoLabel = autoLabel;
  draftEntry.etiquetaAutomatica = autoLabel;
  draftEntry.tipoMovimiento = finJournalAutoLabelToTipoMovimiento(autoLabel);
  draftEntry.entryType = 'journal_entry';
  return {
    stage: FIN_JOURNAL_REAL_STAGE,
    ...draftEntry,
    lines,
    totals: {
      totalDebit,
      totalCredit,
      totalDebitBase,
      totalCreditBase,
      difference,
      differenceBase
    }
  };
}

function finJournalAutoLabelToTipoMovimiento(autoLabel) {
  const s = normText(autoLabel || '');
  if (s.includes('venta') || s.includes('ingreso')) return 'ingreso';
  if (s.includes('egreso') || s.includes('compra') || s.includes('inventario')) return 'egreso';
  if (s.includes('transferencia')) return 'transferencia';
  return 'ajuste';
}

function finJournalIsValidIsoDate(value) {
  const v = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function finJournalLineHasNegativeRaw(row) {
  const d = finParseCurrencyAmount(row && row.debitRaw);
  const c = finParseCurrencyAmount(row && row.creditRaw);
  return (Number.isFinite(d) && d < 0) || (Number.isFinite(c) && c < 0) || String(row?.debitRaw || '').includes('-') || String(row?.creditRaw || '').includes('-');
}

function finJournalValidateForSave() {
  const data = finCachedData || { accounts: [] };
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const selectable = getPostableAccountsForSelector(data);
  const currency = finJournalGetCurrency();
  const date = String(document.getElementById('journal-date')?.value || '').trim();
  const desc = String(document.getElementById('journal-description')?.value || '').trim();
  const rows = finJournalLineRows().map(finJournalGetLineData).filter(Boolean);
  const used = rows.filter(row => row.accountCode || row.debit > 0 || row.credit > 0 || row.hasDebitRaw || row.hasCreditRaw);

  const fail = (message) => ({ ok: false, message });
  if (!selectable.length) return fail('No hay cuentas posteables disponibles. Cree una subcuenta posteable en el Catálogo de Cuentas.');
  if (!finJournalIsValidIsoDate(date)) return fail('Ingrese una fecha válida.');
  if (!desc) return fail('La descripción general es requerida.');
  if (used.length < 2) return fail('El asiento debe tener al menos dos líneas completas.');
  if (currency === 'USD' && !finJournalGetExchangeRate()) return fail('Para asientos en US$ se requiere un T/C válido.');

  for (let i = 0; i < used.length; i += 1) {
    const row = used[i];
    if (finJournalLineHasNegativeRaw(row)) return fail('No se permiten valores negativos en Debe/Haber.');
    if (!row.accountCode) return fail(`Falta cuenta en la línea ${i + 1}.`);
    const account = finAccountSelectorFindAccountByCode(row.accountCode, data) || row.account;
    if (!account) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (!finIsActiveAccount(account)) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (finIsRootAccount(account)) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (finIsGroupingAccount(account)) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (!finIsPostableAccount(account)) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (finAccountHasActiveChildrenInList(accounts, row.accountCode)) return fail('Seleccione cuentas posteables en todas las líneas.');
    if (row.debit > 0 && row.credit > 0) return fail(`La línea ${i + 1} no puede tener Debe y Haber al mismo tiempo.`);
    if (!(row.debit > 0 || row.credit > 0)) return fail(`Falta monto Debe o Haber en la línea ${i + 1}.`);
  }

  const payload = finJournalBuildDraftPayload();
  const totalDebit = Number(payload?.totals?.totalDebit || 0);
  const totalCredit = Number(payload?.totals?.totalCredit || 0);
  const diff = Number(payload?.totals?.difference || 0);
  const diffBase = Number(payload?.totals?.differenceBase || 0);
  if (!(totalDebit > 0 && totalCredit > 0)) return fail('Debe y Haber deben tener montos mayores que cero.');
  if (Math.abs(diff) > 0.004 || Math.abs(diffBase) > 0.004) return fail('El asiento debe cuadrar antes de guardarse.');

  const journalEntryUid = `je-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const entry = { ...payload };
  delete entry.lines;
  delete entry.totals;
  entry.journalEntryUid = journalEntryUid;
  entry.entryUid = journalEntryUid;
  entry.idStable = journalEntryUid;
  const lines = payload.lines.map((ln) => ({
    ...ln,
    entryUid: journalEntryUid,
    journalEntryUid,
    description: payload.description,
    descripcion: payload.description,
    reference: payload.reference,
    referencia: payload.reference,
    autoLabel: payload.autoLabel,
    source: payload.source,
    origin: payload.origin,
    origen: payload.origen,
    status: payload.status
  }));
  return { ok: true, payload, entry, lines };
}

async function finJournalSaveEntry() {
  if (finJournalSaving) return;
  if (!finCachedData) await refreshAllFin();
  const validation = finJournalValidateForSave();
  if (!validation.ok) {
    finJournalSetMessage(validation.message || 'No se pudo guardar el asiento.', 'warn');
    showToast(validation.message || 'Revise las líneas incompletas.');
    return;
  }

  const btn = document.getElementById('journal-validate');
  finJournalSaving = true;
  if (btn) {
    btn.disabled = true;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent || 'Guardar asiento';
    btn.textContent = 'Guardando…';
  }
  try {
    await createJournalEntryWithLinesAtomic(validation.entry, validation.lines);
    finJournalSetMessage('Asiento guardado correctamente.', 'ok');
    showToast('Asiento guardado correctamente.');
    finJournalClear({ silent: true });
    await refreshAllFin();
    finJournalSetMessage('Asiento guardado correctamente.', 'ok');
  } catch (err) {
    console.error('No se pudo guardar el asiento del Diario Contable', err);
    finJournalSetMessage('No se pudo guardar el asiento. Revise las líneas incompletas.', 'warn');
    showToast('No se pudo guardar el asiento.');
  } finally {
    finJournalSaving = false;
    if (btn) {
      btn.disabled = false;
      btn.textContent = btn.dataset.originalText || 'Guardar asiento';
    }
  }
}

function finJournalRefreshCurrencyUi() {
  const currency = finJournalGetCurrency();
  const state = finGetCurrencyStateSafe();
  const rateWrap = document.getElementById('journal-rate-wrap');
  const rateInput = document.getElementById('journal-rate');
  const hint = document.getElementById('journal-currency-hint');

  if (currency === 'USD') {
    if (rateWrap) rateWrap.classList.remove('hidden');
    if (rateInput) rateInput.value = state.hasExchangeRate ? Number(state.exchangeRate).toFixed(2) : '';
    if (hint) {
      hint.textContent = state.hasExchangeRate
        ? `Fuente: ${FIN_CURRENCY_SOURCE_LABEL} · ${state.exchangeRateText} · Última actualización: ${state.updatedAtText}`
        : FIN_CURRENCY_WARNING_MESSAGE;
      hint.className = `fin-help${state.hasExchangeRate ? '' : ' fin-journal-warn-text'}`;
    }
  } else {
    if (rateWrap) rateWrap.classList.add('hidden');
    if (rateInput) rateInput.value = '';
    if (hint) {
      hint.textContent = 'Moneda base: C$. No requiere T/C.';
      hint.className = 'fin-help';
    }
  }
}

function finJournalTotals() {
  const rows = finJournalLineRows().map(finJournalGetLineData).filter(Boolean);
  const totalDebit = finRoundCurrency2(rows.reduce((sum, row) => sum + (Number(row.debit) || 0), 0)) || 0;
  const totalCredit = finRoundCurrency2(rows.reduce((sum, row) => sum + (Number(row.credit) || 0), 0)) || 0;
  const difference = finRoundCurrency2(totalDebit - totalCredit) || 0;
  return { rows, totalDebit, totalCredit, difference };
}

function finJournalUpdateTotals() {
  const currency = finJournalGetCurrency();
  const { rows, totalDebit, totalCredit, difference } = finJournalTotals();
  const totalDebitEl = document.getElementById('journal-total-debit');
  const totalCreditEl = document.getElementById('journal-total-credit');
  const diffEl = document.getElementById('journal-difference');
  const equiv = document.getElementById('journal-equivalent');
  if (totalDebitEl) totalDebitEl.textContent = finJournalFormatMoney(totalDebit, currency);
  if (totalCreditEl) totalCreditEl.textContent = finJournalFormatMoney(totalCredit, currency);
  if (diffEl) {
    diffEl.textContent = finJournalFormatMoney(Math.abs(difference), currency);
    diffEl.classList.toggle('is-balanced', Math.abs(difference) <= 0.005 && totalDebit > 0 && totalCredit > 0);
    diffEl.classList.toggle('is-unbalanced', Math.abs(difference) > 0.005);
  }

  if (equiv) {
    if (currency === 'USD') {
      const rate = finJournalGetExchangeRate();
      if (rate) {
        const eqDebit = finRoundCurrency2(totalDebit * rate) || 0;
        const eqCredit = finRoundCurrency2(totalCredit * rate) || 0;
        equiv.classList.remove('hidden');
        equiv.textContent = `Equivalente contable: Debe ${finFormatCordobas(eqDebit)} · Haber ${finFormatCordobas(eqCredit)} · T/C ${Number(rate).toFixed(2)}`;
      } else {
        equiv.classList.remove('hidden');
        equiv.textContent = 'Equivalente contable pendiente: falta T/C válido en Configuración → Moneda.';
      }
    } else {
      equiv.classList.add('hidden');
      equiv.textContent = '';
    }
  }

  const used = rows.filter(row => row.accountCode || row.debit > 0 || row.credit > 0 || row.hasDebitRaw || row.hasCreditRaw);
  if (!used.length) {
    finJournalSetMessage('Complete mínimo dos líneas para validar el asiento.', 'muted');
  } else if (Math.abs(difference) <= 0.005 && totalDebit > 0 && totalCredit > 0) {
    finJournalSetMessage('Asiento cuadrado visualmente. Presione Guardar asiento para registrarlo.', 'ok');
  } else {
    finJournalSetMessage(`Asiento descuadrado. Diferencia: ${finJournalFormatMoney(Math.abs(difference), currency)}.`, 'warn');
  }
}

function finJournalNormalizeAmountInput(input, mirrorSelector) {
  if (!input) return;
  const raw = String(input.value || '').trim();
  if (!raw) {
    finJournalUpdateTotals();
    return;
  }
  if (raw.includes('-')) {
    input.value = '';
    finJournalSetMessage('No se permiten valores negativos en Debe/Haber.', 'warn');
    finJournalUpdateTotals();
    return;
  }
  const value = finParseCurrencyAmount(raw);
  if (!Number.isFinite(value) || value < 0) {
    input.value = '';
    finJournalSetMessage('Ingrese un número válido en Debe/Haber.', 'warn');
    finJournalUpdateTotals();
    return;
  }
  if (value > 0 && mirrorSelector) {
    const row = input.closest('.fin-journal-line');
    const mirror = row ? row.querySelector(mirrorSelector) : null;
    if (mirror) mirror.value = '';
  }
  finJournalUpdateTotals();
}

function finJournalFormatAmountOnBlur(input) {
  if (!input) return;
  const raw = String(input.value || '').trim();
  if (!raw) return;
  const value = finParseCurrencyAmount(raw);
  input.value = Number.isFinite(value) && value >= 0 ? Number(value).toFixed(2) : '';
  finJournalUpdateTotals();
}

function finJournalCreateLine() {
  const list = document.getElementById('journal-lines');
  if (!list) return null;
  const lineId = ++finJournalLineSeq;
  const row = document.createElement('div');
  row.className = 'fin-journal-line';
  row.dataset.lineId = String(lineId);
  row.innerHTML = `
    <div class="fin-journal-line-account" id="journal-account-host-${lineId}"></div>
    <label>
      Debe
      <input type="number" class="journal-debit" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
    </label>
    <label>
      Haber
      <input type="number" class="journal-credit" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
    </label>
    <button type="button" class="btn-small btn-danger journal-remove-line" title="Quitar línea">Quitar</button>
  `;
  list.appendChild(row);

  const host = row.querySelector(`#journal-account-host-${lineId}`);
  createAccountSelect(host, {
    instanceId: finJournalLineSelectorId(lineId),
    data: finCachedData || { accounts: [] },
    label: 'Cuenta',
    placeholder: 'Buscar cuenta por código o nombre',
    emptyHint: 'Solo cuentas activas y posteables.',
    onSelect: () => finJournalUpdateTotals()
  });

  const debit = row.querySelector('.journal-debit');
  const credit = row.querySelector('.journal-credit');
  if (debit) {
    debit.addEventListener('input', () => finJournalNormalizeAmountInput(debit, '.journal-credit'));
    debit.addEventListener('blur', () => finJournalFormatAmountOnBlur(debit));
  }
  if (credit) {
    credit.addEventListener('input', () => finJournalNormalizeAmountInput(credit, '.journal-debit'));
    credit.addEventListener('blur', () => finJournalFormatAmountOnBlur(credit));
  }

  return row;
}

function finJournalEnsureMinimumLines() {
  const list = document.getElementById('journal-lines');
  if (!list) return;
  while (finJournalLineRows().length < 2) finJournalCreateLine();
}

function finJournalRemoveLine(row) {
  if (!row) return;
  const rows = finJournalLineRows();
  if (rows.length <= 2) {
    finJournalSetMessage('El asiento debe tener al menos dos líneas.', 'warn');
    return;
  }
  const lineId = String(row.dataset.lineId || '');
  finAccountSelectorInstances.delete(finJournalLineSelectorId(lineId));
  row.remove();
  finJournalUpdateTotals();
}

function finJournalClear({ silent = false } = {}) {
  const desc = document.getElementById('journal-description');
  const ref = document.getElementById('journal-reference');
  const date = document.getElementById('journal-date');
  const currency = document.getElementById('journal-currency');
  if (desc) desc.value = '';
  if (ref) ref.value = '';
  if (date) date.value = todayStr();
  if (currency) currency.value = 'NIO';

  for (const row of finJournalLineRows()) {
    const lineId = String(row.dataset.lineId || '');
    finAccountSelectorInstances.delete(finJournalLineSelectorId(lineId));
  }
  const list = document.getElementById('journal-lines');
  if (list) list.innerHTML = '';
  finJournalEnsureMinimumLines();
  finJournalRefreshCurrencyUi();
  finJournalUpdateTotals();
  if (!silent) finJournalSetMessage('Asiento limpiado. Fecha del día y moneda C$ listas.', 'ok');
}

function finJournalUpdateSelectorData(data) {
  const rows = finJournalLineRows();
  for (const row of rows) {
    const lineId = String(row.dataset.lineId || '');
    const state = finAccountSelectorInstances.get(finJournalLineSelectorId(lineId));
    if (!state) continue;
    state.data = data || finCachedData || { accounts: [] };
    if (state.value) {
      finAccountSelectorSetValue(state.id, state.value, { emit: false, data: state.data });
    }
  }
}

function finJournalValidateVisual() {
  const data = finCachedData || { accounts: [] };
  const selectable = getPostableAccountsForSelector(data);
  const currency = finJournalGetCurrency();
  const rows = finJournalLineRows().map(finJournalGetLineData).filter(Boolean);
  const used = rows.filter(row => row.accountCode || row.debit > 0 || row.credit > 0 || row.hasDebitRaw || row.hasCreditRaw);
  const desc = String(document.getElementById('journal-description')?.value || '').trim();

  if (!selectable.length) {
    finJournalSetMessage('No hay cuentas posteables disponibles. Cree una subcuenta posteable en el Catálogo de Cuentas.', 'warn');
    return false;
  }
  if (!desc) {
    finJournalSetMessage('La descripción general es requerida para validar el asiento.', 'warn');
    return false;
  }
  if (currency === 'USD' && !finJournalGetExchangeRate()) {
    finJournalSetMessage(FIN_CURRENCY_WARNING_MESSAGE, 'warn');
    return false;
  }
  if (rows.length < 2 || used.length < 2) {
    finJournalSetMessage('El asiento debe tener al menos dos líneas completas.', 'warn');
    return false;
  }

  for (let i = 0; i < used.length; i += 1) {
    const row = used[i];
    if (!row.accountCode) {
      finJournalSetMessage(`Falta cuenta en la línea ${i + 1}.`, 'warn');
      return false;
    }
    const account = finAccountSelectorFindAccountByCode(row.accountCode, data) || row.account;
    if (!account || !finIsActiveAccount(account) || !finIsPostableAccount(account) || finIsRootAccount(account) || finAccountHasActiveChildrenInList(data.accounts, row.accountCode)) {
      finJournalSetMessage(`La cuenta ${row.accountCode || ''} no es posteable activa.`, 'warn');
      return false;
    }
    if (row.debit > 0 && row.credit > 0) {
      finJournalSetMessage(`La línea ${i + 1} no puede tener Debe y Haber al mismo tiempo.`, 'warn');
      return false;
    }
    if (!(row.debit > 0 || row.credit > 0)) {
      finJournalSetMessage(`Falta monto Debe o Haber en la línea ${i + 1}.`, 'warn');
      return false;
    }
  }

  const { totalDebit, totalCredit, difference } = finJournalTotals();
  if (!(totalDebit > 0 && totalCredit > 0)) {
    finJournalSetMessage('Debe y Haber deben tener montos mayores que cero.', 'warn');
    return false;
  }
  if (Math.abs(difference) > 0.005) {
    finJournalSetMessage(`El asiento debe cuadrar antes de guardarse. Diferencia: ${finJournalFormatMoney(Math.abs(difference), currency)}.`, 'warn');
    return false;
  }

  const payload = finJournalBuildDraftPayload();
  window.__A33_FIN_JOURNAL_LAST_VALID_DRAFT__ = payload;
  finJournalSetMessage('Asiento listo para guardarse.', 'ok');
  showToast('Asiento listo para guardar');
  return true;
}

function setupDiarioContableVisualUI() {
  if (finJournalUiReady) return;
  const form = document.getElementById('form-diario-contable');
  if (!form) return;
  finJournalUiReady = true;

  const date = document.getElementById('journal-date');
  if (date && !date.value) date.value = todayStr();

  const currency = document.getElementById('journal-currency');
  if (currency) currency.addEventListener('change', () => {
    finJournalRefreshCurrencyUi();
    finJournalUpdateTotals();
  });

  const add = document.getElementById('journal-add-line');
  if (add) add.addEventListener('click', () => {
    finJournalCreateLine();
    finJournalUpdateTotals();
  });

  const lines = document.getElementById('journal-lines');
  if (lines) {
    lines.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.journal-remove-line');
      if (!btn) return;
      finJournalRemoveLine(btn.closest('.fin-journal-line'));
    });
  }

  const clear = document.getElementById('journal-clear');
  if (clear) clear.addEventListener('click', () => finJournalClear());

  const validate = document.getElementById('journal-validate');
  if (validate) validate.addEventListener('click', () => finJournalSaveEntry());

  ['journal-description', 'journal-reference', 'journal-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => finJournalUpdateTotals());
  });

  finJournalEnsureMinimumLines();
  finJournalRefreshCurrencyUi();
  finJournalUpdateTotals();
}

function renderDiarioContableVisual(data) {
  setupDiarioContableVisualUI();
  const msg = document.getElementById('journal-no-postable-msg');
  const selectable = getPostableAccountsForSelector(data || finCachedData || { accounts: [] });
  if (msg) msg.classList.toggle('hidden', selectable.length > 0);
  finJournalUpdateSelectorData(data || finCachedData || { accounts: [] });
  finJournalRefreshCurrencyUi();
  finJournalUpdateTotals();
}


/* ---------- Proveedores (CRUD) ---------- */

let currentSupplierEditId = null; // mantiene modo edición para UX de productos

// Modal (base): Productos por proveedor (Etapa 1/3)
let provProductsModalSupplierId = null;

// Token simple para evitar renders tardíos sobre un modal ya cerrado/reabierto.
let provProductsModalRenderToken = null;

async function provResolveSupplierForProductsModal(supplierId) {
  const sid = Number(supplierId || 0);
  if (!Number.isFinite(sid) || sid <= 0) return null;

  // 1) Cache (rápido)
  const cached = provGetSupplierFromCache(sid);
  if (cached) return normalizeSupplier(cached);

  // 2) DB (fallback)
  try {
    await openFinDB();
    const fromDb = await finGet('suppliers', sid);
    return fromDb ? normalizeSupplier(fromDb) : null;
  } catch (_) {
    return null;
  }
}

function provMakeProductsModalEmpty(text) {
  const div = document.createElement('div');
  div.className = 'fin-empty';
  div.textContent = text;
  return div;
}

async function provRenderProductsModalReadOnly() {
  const modal = document.getElementById('prov-prod-modal');
  const bodyEl = document.getElementById('prov-prod-modal-body');
  const titleEl = document.getElementById('prov-prod-modal-title');
  const subEl = document.getElementById('prov-prod-modal-sub');
  const sid = provProductsModalSupplierId;
  if (!modal || !bodyEl) return;

  if (!sid) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(provMakeProductsModalEmpty('Proveedor inválido.'));
    if (titleEl) titleEl.textContent = 'Productos';
    if (subEl) subEl.textContent = '';
    return;
  }

  const token = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  provProductsModalRenderToken = token;

  bodyEl.innerHTML = '';
  bodyEl.appendChild(provMakeProductsModalEmpty('Cargando productos…'));

  const supplier = await provResolveSupplierForProductsModal(sid);
  if (provProductsModalRenderToken !== token) return; // modal ya cambió

  if (!supplier) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(provMakeProductsModalEmpty('Proveedor eliminado o no encontrado.'));
    if (titleEl) titleEl.textContent = 'Productos';
    if (subEl) subEl.textContent = '';
    return;
  }

  // Re-hidrata header con data vigente (por si se editó mientras el modal estaba abierto).
  try {
    const rawName = (supplier && supplier.nombre != null) ? String(supplier.nombre) : '';
    const name = uiTextFIN(rawName).trim() || rawName.trim() || 'Proveedor';
    if (titleEl) titleEl.textContent = `Productos de ${name}`;

    if (subEl) {
      const tel = (supplier && supplier.telefono != null) ? String(supplier.telefono).trim() : '';
      const note = (supplier && supplier.nota != null) ? String(supplier.nota).trim() : '';
      const parts = [];
      if (tel) parts.push(`Tel: ${tel}`);
      if (note) parts.push(note);
      subEl.textContent = parts.join(' · ');
    }
  } catch (_) {
    if (titleEl) titleEl.textContent = 'Productos';
    if (subEl) subEl.textContent = '';
  }

  const productosRaw = Array.isArray(supplier.productos) ? supplier.productos : [];
  const productos = productosRaw.map(normalizeSupplierProduct);

  if (!productos.length) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(provMakeProductsModalEmpty('Sin productos.'));
    return;
  }

  // Orden por nombre (más legible)
  productos.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' }));

  // Render: pseudo-tabla responsiva (sin overflow-x)
  bodyEl.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'prov-prod-modal-wrap';

  const head = document.createElement('div');
  head.className = 'prov-prod-modal-head';
  head.innerHTML = `
    <div>Nombre</div>
    <div>Tipo</div>
    <div class="num">Precio</div>
    <div class="num">Unidades/caja</div>
  `;
  wrap.appendChild(head);

  const list = document.createElement('div');
  list.className = 'prov-prod-modal-list';

  for (const p of productos) {
    const row = document.createElement('div');
    row.className = 'prov-prod-modal-row';

    const nameRaw = uiTextFIN(p.nombre || '').trim() || '—';

    // Hardening: solo admitir tipos esperados; cualquier cosa rara → “—”
    const tipoRaw = (p.tipo != null) ? String(p.tipo).trim() : '';
    const tipoUpper = tipoRaw ? tipoRaw.toUpperCase() : '';
    const tipo = (tipoUpper === 'CAJAS' || tipoUpper === 'UNIDADES') ? tipoUpper : '—';

    // Hardening: 0 si es inválido
    const precio = normNumNonNeg(p.precio);
    const unidades = (tipo === 'CAJAS') ? normNumNonNeg(p.unidadesPorCaja) : 0;

    row.innerHTML = `
      <div class="prov-prod-modal-cell name" data-label="Nombre">
        <span class="prov-prod-modal-val" title="${escapeHtml(nameRaw)}">${escapeHtml(nameRaw || '—')}</span>
      </div>
      <div class="prov-prod-modal-cell tipo" data-label="Tipo">
        <span class="prov-prod-modal-val" title="${escapeHtml(tipo)}">${escapeHtml(tipo)}</span>
      </div>
      <div class="prov-prod-modal-cell num" data-label="Precio">
        <span class="prov-prod-modal-val" title="${escapeHtml(finFormatCordobas(precio))}">${escapeHtml(finFormatCordobas(precio))}</span>
      </div>
      <div class="prov-prod-modal-cell num" data-label="Unidades por caja">
        <span class="prov-prod-modal-val" title="${escapeHtml(String(unidades))}">${escapeHtml(String(unidades))}</span>
      </div>
    `;
    list.appendChild(row);
  }

  wrap.appendChild(list);
  bodyEl.appendChild(wrap);
}

function provOpenProductsModal(supplier) {
  const modal = document.getElementById('prov-prod-modal');
  if (!modal) return;

  const titleEl = document.getElementById('prov-prod-modal-title');
  const subEl = document.getElementById('prov-prod-modal-sub');
  const bodyEl = document.getElementById('prov-prod-modal-body');

  const sid = Number(supplier?.id || 0);
  provProductsModalSupplierId = (Number.isFinite(sid) && sid > 0) ? sid : null;

  const rawName = (supplier && supplier.nombre != null) ? String(supplier.nombre) : '';
  const name = uiTextFIN(rawName).trim() || rawName.trim() || 'Proveedor';

  if (titleEl) titleEl.textContent = `Productos de ${name}`;

  if (subEl) {
    const tel = (supplier && supplier.telefono != null) ? String(supplier.telefono).trim() : '';
    const note = (supplier && supplier.nota != null) ? String(supplier.nota).trim() : '';
    const parts = [];
    if (tel) parts.push(`Tel: ${tel}`);
    if (note) parts.push(note);
    subEl.textContent = parts.join(' · ');
  }

  if (bodyEl) {
    bodyEl.innerHTML = '';
    bodyEl.appendChild(provMakeProductsModalEmpty('Cargando productos…'));
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');

  // Render read-only (Etapa 2/3)
  provRenderProductsModalReadOnly().catch(err => {
    console.error('Error renderizando modal productos proveedor', err);
    const b = document.getElementById('prov-prod-modal-body');
    if (b) {
      b.innerHTML = '';
      b.appendChild(provMakeProductsModalEmpty('No se pudieron cargar los productos.'));
    }
  });
}

function provCloseProductsModal() {
  const modal = document.getElementById('prov-prod-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  provProductsModalSupplierId = null;
  provProductsModalRenderToken = null;
}

// Si el modal está abierto, refrescarlo luego de un refreshAllFin (cambios/borra/edición).
function provSyncOpenProductsModal() {
  const modal = document.getElementById('prov-prod-modal');
  if (!modal || !modal.classList.contains('open')) return;
  // Si está abierto pero no hay supplierId válido, solo re-renderiza el mensaje.
  provRenderProductsModalReadOnly().catch(err => {
    console.error('Error refrescando modal productos proveedor', err);
    const b = document.getElementById('prov-prod-modal-body');
    if (b) {
      b.innerHTML = '';
      b.appendChild(provMakeProductsModalEmpty('No se pudieron cargar los productos.'));
    }
  });
}


function provHideProductsUI() {
  const sec = document.getElementById('prov-products-section');
  if (sec) sec.classList.add('hidden');
  const empty = document.getElementById('prov-products-empty');
  const list = document.getElementById('prov-products-list');
  const hint = document.getElementById('prov-products-hint');
  const editor = document.getElementById('prov-prod-editor');
  if (empty) empty.classList.add('hidden');
  if (list) list.innerHTML = '';
  if (hint) hint.textContent = 'Selecciona un proveedor para ver/editar sus productos.';
  if (editor) editor.classList.add('hidden');
  const eid = document.getElementById('prov-prod-editid');
  if (eid) eid.value = '';
}

function provShowProductsUI() {
  const sec = document.getElementById('prov-products-section');
  if (sec) sec.classList.remove('hidden');
}

function provStartQuickAddProductsFlow() {
  const sec = document.getElementById('prov-products-section');
  if (sec) {
    sec.classList.remove('hidden');
    try {
      if (typeof sec.scrollIntoView === 'function') sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (_) {
      try { sec.scrollIntoView(true); } catch (__ ) {}
    }
  }

  // Abrir editor inline y enfocar el primer campo (flujo alta rápida)
  setTimeout(() => {
    try {
      provOpenProductEditor(null);
    } catch (_) {}
  }, 120);

  try {
    showToast('Agrega los productos que vende este proveedor');
  } catch (_) {}
}


function provGetSupplierFromCache(id) {
  if (!finCachedData || !Array.isArray(finCachedData.suppliers)) return null;
  const nid = Number(id || 0);
  return finCachedData.suppliers.find(x => Number(x.id) === nid) || null;
}

function provExitEditStateBecauseSupplierMissing(message) {
  const msg = String(message || 'El proveedor ya no existe. Se cerró el editor.');
  const sid = Number(currentSupplierEditId || 0);

  // Si el modal visor estaba abierto sobre este proveedor, cerrarlo para evitar estado colgado.
  try {
    if (sid > 0 && provProductsModalSupplierId && Number(provProductsModalSupplierId) === sid) {
      provCloseProductsModal();
    }
  } catch (_) {}

  try { showToast(msg); } catch (_) {}
  try { alert(msg); } catch (_) {}

  // Limpieza fuerte de estado/UI (evita crashes en siguientes clicks)
  try { resetProveedorForm(); } catch (_) {
    currentSupplierEditId = null;
    try { provHideProductsUI(); } catch (__ ) {}
  }
}

function provGenProductId() {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 10);
  return `p_${t}_${r}`;
}

function provEditorSetEnabledByTipo() {
  const tipoEl = document.getElementById('prov-prod-tipo');
  const uEl = document.getElementById('prov-prod-unidades');
  if (!tipoEl || !uEl) return;
  const t = String(tipoEl.value || '').toUpperCase();
  if (t === 'CAJAS') {
    uEl.disabled = false;
    // Si veníamos de UNIDADES, restaurar lo último que el usuario escribió (si aplica)
    const last = (uEl.dataset && typeof uEl.dataset.a33LastUnits === 'string') ? uEl.dataset.a33LastUnits : '';
    if ((!uEl.value || String(uEl.value).trim() === '') && last) {
      uEl.value = last;
    }
  } else {
    // Mantener vacío en pantalla (no mostrar 0) pero sin perder lo que el usuario pudo haber escrito
    const cur = (uEl.value != null) ? String(uEl.value).trim() : '';
    if (cur) {
      try { uEl.dataset.a33LastUnits = cur; } catch (_) {}
    }
    uEl.value = '';
    uEl.disabled = true;
  }
}

// iPad/Safari: select-all confiable (defer al siguiente tick)
function a33SelectAllOnFocus(el) {
  if (!el) return;
  try {
    if (el.dataset && el.dataset.a33SelectAll === '1') return;
    if (el.dataset) el.dataset.a33SelectAll = '1';
  } catch (_) {}

  const doSelect = () => {
    const v = (el.value != null) ? String(el.value) : '';
    if (!v) return;
    setTimeout(() => {
      try { el.select(); } catch (_) {}
      try { el.setSelectionRange(0, String(el.value || '').length); } catch (_) {}
    }, 0);
  };

  el.addEventListener('focus', doSelect);
  // En iOS, a veces el foco ya está y un tap no re-dispara focus.
  el.addEventListener('click', () => {
    try {
      if (document.activeElement === el) doSelect();
    } catch (_) {}
  });
}

function provOpenProductEditor(product) {
  const editor = document.getElementById('prov-prod-editor');
  if (!editor) return;

  const eid = document.getElementById('prov-prod-editid');
  const nombreEl = document.getElementById('prov-prod-nombre');
  const tipoEl = document.getElementById('prov-prod-tipo');
  const precioEl = document.getElementById('prov-prod-precio');
  const uEl = document.getElementById('prov-prod-unidades');

  if (eid) eid.value = product && product.id ? String(product.id) : '';
  if (nombreEl) nombreEl.value = product && product.nombre ? String(product.nombre) : '';
  if (tipoEl) {
    const t = product && product.tipo ? String(product.tipo).toUpperCase() : '';
    tipoEl.value = (t === 'CAJAS' || t === 'UNIDADES') ? t : '';
  }
  // Inputs limpios: en alta de producto (product=null) iniciar VACÍO (no 0 en pantalla)
  if (precioEl) {
    const hasFlag = (product && typeof product.precioSet === 'boolean');
    const show = product ? (hasFlag ? !!product.precioSet : (product.precio != null && Number(product.precio) !== 0)) : false;
    precioEl.value = show ? String(normNumNonNeg(product.precio)) : '';
  }
  if (uEl) {
    const tipoUpper = (product && product.tipo != null) ? String(product.tipo).toUpperCase() : '';
    const has = product && product.unidadesPorCaja != null;
    const val = has ? String(normNumNonNeg(product.unidadesPorCaja)) : '';

    // Guardar lastUnits para permitir toggle UNIDADES↔CAJAS sin perder el valor
    try { uEl.dataset.a33LastUnits = val; } catch (_) {}

    // Si NO es CAJAS, mantener vacío en pantalla (aunque internamente sea 0 al guardar)
    if (tipoUpper && tipoUpper !== 'CAJAS') {
      uEl.value = '';
    } else {
      uEl.value = val;
    }
  }

  // Auto select-all en focus (solo si tiene contenido)
  a33SelectAllOnFocus(precioEl);
  a33SelectAllOnFocus(uEl);

  editor.classList.remove('hidden');
  provEditorSetEnabledByTipo();
  if (nombreEl) nombreEl.focus();
}

function provCloseProductEditor() {
  const editor = document.getElementById('prov-prod-editor');
  if (editor) editor.classList.add('hidden');
  const eid = document.getElementById('prov-prod-editid');
  if (eid) eid.value = '';
}

function provRenderProductsList(supplier) {
  const list = document.getElementById('prov-products-list');
  const empty = document.getElementById('prov-products-empty');
  const hint = document.getElementById('prov-products-hint');
  if (!list || !empty) return;

  const productos = Array.isArray(supplier?.productos) ? supplier.productos : [];
  list.innerHTML = '';

  if (hint) {
    const name = (supplier && supplier.nombre) ? String(supplier.nombre) : '';
    hint.textContent = name ? `Proveedor: ${name}` : 'Proveedor seleccionado.';
  }

  if (!productos.length) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  for (const pRaw of productos) {
    const p = normalizeSupplierProduct(pRaw);
    const div = document.createElement('div');
    div.className = 'prov-prod-item';
    div.dataset.pid = p.id;

    const tipo = (p.tipo || '').toUpperCase();
    const tipoLabel = (tipo === 'CAJAS' || tipo === 'UNIDADES') ? tipo : '—';

    div.innerHTML = `
      <div class="prov-prod-main">
        <div class="prov-prod-title" title="${escapeHtml(p.nombre || '')}">${escapeHtml(p.nombre || '—')}</div>
        <div class="prov-prod-meta">
          <span class="prov-prod-chip">${escapeHtml(tipoLabel)}</span>
          <span>Precio: ${escapeHtml(finFormatCordobas(p.precio))}</span>
          <span>${escapeHtml(tipo === 'CAJAS' ? `U/Caja: ${String(normNumNonNeg(p.unidadesPorCaja))}` : 'U/Caja: 0')}</span>
        </div>
      </div>
      <div class="prov-prod-actions">
        <button type="button" class="btn-small prov-prod-edit" data-pid="${escapeHtml(p.id)}">Editar</button>
        <button type="button" class="btn-danger prov-prod-del" data-pid="${escapeHtml(p.id)}">Eliminar</button>
      </div>
    `;
    list.appendChild(div);
  }
}

function provApplyEditStateFromCache() {
  if (!currentSupplierEditId) {
    provHideProductsUI();
    return;
  }
  const s = provGetSupplierFromCache(currentSupplierEditId);
  if (!s) {
    currentSupplierEditId = null;
    provHideProductsUI();
    return;
  }

  // Rehidrata el formulario (por si refrescamos la data)
  const idEl = document.getElementById('prov-id');
  const nombreEl = document.getElementById('prov-nombre');
  const telEl = document.getElementById('prov-telefono');
  const notaEl = document.getElementById('prov-nota');
  const cancelar = document.getElementById('prov-cancelar');
  if (idEl) idEl.value = String(s.id);
  if (nombreEl) nombreEl.value = s.nombre || '';
  if (telEl) telEl.value = s.telefono || '';
  if (notaEl) notaEl.value = s.nota || '';
  if (cancelar) cancelar.classList.remove('hidden');

  provShowProductsUI();
  provRenderProductsList(s);
}

async function provSaveProductFromEditor() {
  if (!currentSupplierEditId) {
    alert('Primero selecciona un proveedor (Editar).');
    return;
  }

  const nombreEl = document.getElementById('prov-prod-nombre');
  const tipoEl = document.getElementById('prov-prod-tipo');
  const precioEl = document.getElementById('prov-prod-precio');
  const uEl = document.getElementById('prov-prod-unidades');
  const eidEl = document.getElementById('prov-prod-editid');

  const nombre = (nombreEl?.value || '').trim();
  const tipo = String(tipoEl?.value || '').trim().toUpperCase();
  const precioRawStr = (precioEl && precioEl.value != null) ? String(precioEl.value).trim() : '';
  const precioSet = (precioRawStr !== '');
  const precio = normNumNonNeg(precioRawStr);
  const unidadesPorCaja = normNumNonNeg(uEl?.value);
  const editId = (eidEl?.value || '').trim();

  if (!nombre) {
    alert('El nombre del producto es obligatorio.');
    return;
  }
  if (!(tipo === 'CAJAS' || tipo === 'UNIDADES')) {
    alert('Selecciona el tipo (CAJAS o UNIDADES).');
    return;
  }

  const productId = editId || provGenProductId();
  const payload = {
    id: productId,
    nombre,
    tipo,
    precio,
    precioSet,
    unidadesPorCaja: (tipo === 'CAJAS') ? unidadesPorCaja : 0
  };

  const sid = Number(currentSupplierEditId);
  if (!Number.isFinite(sid) || sid <= 0) {
    alert('Proveedor inválido.');
    return;
  }

  await openFinDB();
  const existing = await finGet('suppliers', sid);
  if (!existing) {
    provExitEditStateBecauseSupplierMissing('Este proveedor fue eliminado o no existe. Se cerró el editor de productos.');
    return;
  }

  const arr = Array.isArray(existing.productos) ? existing.productos : [];
  let found = false;
  const updated = arr.map(p => {
    const pid = (p && typeof p === 'object') ? String(p.id || '') : '';
    if (pid && pid === productId) {
      found = true;
      return { ...p, ...payload };
    }
    return p;
  });
  if (!found) updated.push(payload);

  await finPut('suppliers', { ...existing, productos: updated });
  showToast(editId ? 'Producto actualizado' : 'Producto agregado');
  provCloseProductEditor();
  await refreshAllFin();
}

async function provDeleteProduct(productId) {
  if (!currentSupplierEditId) return;
  const pid = String(productId || '').trim();
  if (!pid) return;

  const ok = confirm('¿Eliminar este producto del proveedor?');
  if (!ok) return;

  const sid = Number(currentSupplierEditId);
  if (!Number.isFinite(sid) || sid <= 0) return;

  await openFinDB();
  const existing = await finGet('suppliers', sid);
  if (!existing) {
    provExitEditStateBecauseSupplierMissing('Este proveedor fue eliminado o no existe. Se cerró el editor de productos.');
    return;
  }

  const arr = Array.isArray(existing.productos) ? existing.productos : [];
  const updated = arr.filter(p => String((p && p.id) || '') !== pid);
  await finPut('suppliers', { ...existing, productos: updated });
  showToast('Producto eliminado');
  provCloseProductEditor();
  await refreshAllFin();
}

function renderProveedores(data) {
  const tbody = document.getElementById('proveedores-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const suppliers = (data && Array.isArray(data.suppliers)) ? [...data.suppliers] : [];
  // Mostrar lo más reciente arriba (id DESC). Fallback por nombre.
  suppliers.sort((a, b) => {
    const ida = Number(a.id || 0);
    const idb = Number(b.id || 0);
    if (idb !== ida) return idb - ida;
    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });

  if (!suppliers.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3">Sin proveedores. Crea el primero arriba.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const s of suppliers) {
    const idSafe = escapeHtml(String((s && s.id) ?? ''));
    const nombreRaw = (s && s.nombre != null) ? String(s.nombre) : '';
    const notaRaw = (s && s.nota != null) ? String(s.nota) : '';

    const nombre = escapeHtml(nombreRaw.trim());
    const nota = escapeHtml((notaRaw || '—').toString().trim()) || '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td title="${nombre}">${nombre || '—'}</td>
      <td title="${nota}">${nota}</td>
      <td class="fin-actions-cell">
        <div class="fin-actions-inline fin-actions-inline--prov">
          <button type="button" class="btn-small prov-productos" data-id="${idSafe}">Productos</button>
          <button type="button" class="btn-small prov-editar" data-id="${idSafe}">Editar</button>
          <button type="button" class="btn-danger prov-borrar" data-id="${idSafe}">Eliminar</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function resetProveedorForm() {
  const id = document.getElementById('prov-id');
  const nombre = document.getElementById('prov-nombre');
  const tel = document.getElementById('prov-telefono');
  const nota = document.getElementById('prov-nota');
  const cancelar = document.getElementById('prov-cancelar');

  if (id) id.value = '';
  if (nombre) nombre.value = '';
  if (tel) tel.value = '';
  if (nota) nota.value = '';
  if (cancelar) cancelar.classList.add('hidden');

  currentSupplierEditId = null;
  provHideProductsUI();
}

async function guardarProveedor(opts) {
  if (!finCachedData) await refreshAllFin();

  const quickAdd = !!(opts && opts.quickAdd);

  const idEl = document.getElementById('prov-id');
  const nombreEl = document.getElementById('prov-nombre');
  const telEl = document.getElementById('prov-telefono');
  const notaEl = document.getElementById('prov-nota');

  const id = idEl && idEl.value ? Number(idEl.value) : null;
  const nombre = (nombreEl?.value || '').trim();
  const telefono = (telEl?.value || '').trim();
  const nota = (notaEl?.value || '').trim();

  if (!nombre) {
    alert('El nombre del proveedor es obligatorio.');
    return;
  }

  await openFinDB();

  if (id) {
    // Anti-pisado: preservar campos desconocidos (por ejemplo `productos`).
    let existing = null;
    try {
      existing = await finGet('suppliers', id);
    } catch (_) {
      existing = null;
    }

    if (existing && typeof existing === 'object') {
      const productos = Array.isArray(existing.productos) ? existing.productos : [];
      await finPut('suppliers', { ...existing, nombre, telefono, nota, productos });
    } else {
      await finPut('suppliers', { id, nombre, telefono, nota, productos: [] });
    }
    showToast('Proveedor actualizado');
    // Mantener proveedor activo (equivalente a modo Editar) para que productos siga disponible.
    currentSupplierEditId = Number(id);
    const cancelar = document.getElementById('prov-cancelar');
    if (cancelar) cancelar.classList.remove('hidden');
  } else {
    const newId = await finAdd('suppliers', { nombre, telefono, nota, productos: [] });
    showToast('Proveedor creado');

    // Auto-selección: dejar el proveedor recién creado activo para agregar productos sin tocar “Editar”.
    currentSupplierEditId = Number(newId);
    if (idEl && newId != null) idEl.value = String(newId);
    const cancelar = document.getElementById('prov-cancelar');
    if (cancelar) cancelar.classList.remove('hidden');

    // UI inmediata (antes de refreshAllFin): habilitar sección de productos en el mismo flujo.
    provShowProductsUI();
    provCloseProductEditor();
    provRenderProductsList({ id: newId, nombre, telefono, nota, productos: [] });
  }

  await refreshAllFin();

  if (quickAdd) {
    provStartQuickAddProductsFlow();
  }
}

async function eliminarProveedor(id) {
  if (!id) return;
  const ok = confirm('¿Eliminar este proveedor? (Las compras históricas se mantienen.)');
  if (!ok) return;

  await openFinDB();
  await finDelete('suppliers', Number(id));
  // Si el modal de productos estaba mostrando este proveedor, cerrarlo de forma segura.
  if (provProductsModalSupplierId && Number(provProductsModalSupplierId) === Number(id)) {
    provCloseProductsModal();
  }
  showToast('Proveedor eliminado');
  await refreshAllFin();
}

function setupProveedoresUI() {
  const btnGuardar = document.getElementById('prov-guardar');
  const btnGuardarAddProd = document.getElementById('prov-guardar-addprod');
  const btnCancelar = document.getElementById('prov-cancelar');
  const tbody = document.getElementById('proveedores-tbody');

  // Productos del proveedor
  const prodAdd = document.getElementById('prov-prod-add');
  const prodSave = document.getElementById('prov-prod-guardar');
  const prodCancel = document.getElementById('prov-prod-cancelar');
  const prodList = document.getElementById('prov-products-list');
  const prodTipo = document.getElementById('prov-prod-tipo');


  // Modal base: Productos (open/close)
  const prodModal = document.getElementById('prov-prod-modal');
  const prodModalClose = document.getElementById('prov-prod-modal-close');
  if (prodModalClose) prodModalClose.addEventListener('click', provCloseProductsModal);
  if (prodModal) {
    prodModal.addEventListener('click', (e) => {
      if (e.target === prodModal) provCloseProductsModal();
    });
  }
  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      guardarProveedor().catch(err => {
        console.error('Error guardando proveedor', err);
        alert('No se pudo guardar el proveedor.');
      });
    });
  }

  if (btnGuardarAddProd) {
    btnGuardarAddProd.addEventListener('click', () => {
      guardarProveedor({ quickAdd: true }).catch(err => {
        console.error('Error guardando proveedor (alta rápida)', err);
        alert('No se pudo guardar el proveedor.');
      });
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      resetProveedorForm();
    });
  }

  if (prodAdd) {
    prodAdd.addEventListener('click', () => {
      if (!currentSupplierEditId) {
        alert('Primero selecciona un proveedor (Editar).');
        return;
      }
      // Hardening: si el proveedor ya no existe (por borrado externo), salir limpio.
      const sx = provGetSupplierFromCache(currentSupplierEditId);
      if (!sx) {
        provExitEditStateBecauseSupplierMissing('El proveedor seleccionado ya no existe.');
        return;
      }
      provOpenProductEditor(null);
    });
  }

  if (prodCancel) {
    prodCancel.addEventListener('click', () => {
      provCloseProductEditor();
    });
  }

  if (prodSave) {
    prodSave.addEventListener('click', () => {
      provSaveProductFromEditor().catch(err => {
        console.error('Error guardando producto proveedor', err);
        alert('No se pudo guardar el producto.');
      });
    });
  }

  if (prodTipo) {
    prodTipo.addEventListener('change', () => {
      provEditorSetEnabledByTipo();
    });
  }

  if (prodList) {
    prodList.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.prov-prod-edit');
      const delBtn = e.target.closest('.prov-prod-del');
      if (!currentSupplierEditId || !finCachedData) return;

      const sid = Number(currentSupplierEditId);
      const s = finCachedData.suppliers.find(x => Number(x.id) === sid);
      if (!s) {
        provExitEditStateBecauseSupplierMissing('El proveedor seleccionado ya no existe.');
        return;
      }

      if (editBtn) {
        const pid = String(editBtn.dataset.pid || '').trim();
        const p = (Array.isArray(s.productos) ? s.productos : []).find(x => String((x && x.id) || '') === pid);
        if (!p) return;
        provOpenProductEditor(p);
        return;
      }

      if (delBtn) {
        const pid = String(delBtn.dataset.pid || '').trim();
        provDeleteProduct(pid).catch(err => {
          console.error('Error eliminando producto proveedor', err);
          alert('No se pudo eliminar el producto.');
        });
      }
    });
  }

  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.prov-editar');
      const delBtn = e.target.closest('.prov-borrar');
      const prodBtn = e.target.closest('.prov-productos');

      if (prodBtn) {
        const id = Number(prodBtn.dataset.id || '0');
        if (!Number.isFinite(id) || id <= 0) return;
        const s = finCachedData && Array.isArray(finCachedData.suppliers)
          ? finCachedData.suppliers.find(x => Number(x.id) === id)
          : null;
        provOpenProductsModal(s || { id, nombre: 'Proveedor', telefono: '', nota: '' });
        return;
      }


      if (editBtn && finCachedData) {
        const id = Number(editBtn.dataset.id || '0');
        const s = finCachedData.suppliers.find(x => Number(x.id) === id);
        if (!s) return;

        currentSupplierEditId = id;

        document.getElementById('prov-id').value = String(s.id);
        document.getElementById('prov-nombre').value = s.nombre || '';
        document.getElementById('prov-telefono').value = s.telefono || '';
        document.getElementById('prov-nota').value = s.nota || '';
        const cancelar = document.getElementById('prov-cancelar');
        if (cancelar) cancelar.classList.remove('hidden');

        provShowProductsUI();
        provCloseProductEditor();
        provRenderProductsList(s);
        return;
      }

      if (delBtn) {
        const id = Number(delBtn.dataset.id || '0');
        if (currentSupplierEditId && Number(currentSupplierEditId) === id) {
          resetProveedorForm();
        }
        eliminarProveedor(id).catch(err => {
          console.error('Error eliminando proveedor', err);
          alert('No se pudo eliminar el proveedor.');
        });
      }
    });
  }
}

/* ---------- Catálogo de Cuentas (CRUD + protecciones) ---------- */

function catComputeDiaryRevision(data) {
  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  const lines = (data && Array.isArray(data.lines)) ? data.lines : [];
  const receipts = (data && Array.isArray(data.receipts)) ? data.receipts : [];
  const transfers = (data && Array.isArray(data.internalTransfers)) ? data.internalTransfers : [];
  const financialAccounts = (data && Array.isArray(data.financialAccounts)) ? data.financialAccounts : [];
  const lastId = (arr, key = 'id') => {
    if (!Array.isArray(arr) || !arr.length) return 0;
    const last = arr[arr.length - 1] || {};
    const raw = last[key] ?? last.receiptId ?? last.transferId ?? last.journalEntryId ?? 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : String(raw || '').slice(-18);
  };
  return `e${entries.length}-${lastId(entries)}-l${lines.length}-${lastId(lines)}-r${receipts.length}-${lastId(receipts, 'receiptId')}-t${transfers.length}-${lastId(transfers, 'transferId')}-fa${financialAccounts.length}`;
}

function catReadUsageCache() {
  try {
    const raw = localStorage.getItem(CAT_USAGE_CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.rev !== 'string' || typeof obj.counts !== 'object') return null;
    return obj;
  } catch (e) {
    return null;
  }
}

function catWriteUsageCache(rev, countsObj) {
  try {
    localStorage.setItem(CAT_USAGE_CACHE_KEY, JSON.stringify({
      rev,
      counts: countsObj,
      updatedAt: new Date().toISOString()
    }));
  } catch (e) {}
}

function catAddUsageCount(counts, code, weight = 1) {
  const c = finGetAccountCode(code);
  if (!c || !finGetRootFromCode(c)) return;
  counts[c] = (counts[c] || 0) + Math.max(1, Number(weight) || 1);
}

function catLooksLikeAccountField(key) {
  const k = String(key || '').toLowerCase();
  if (!k) return false;
  if (k.includes('account') || k.includes('cuenta') || k.includes('contable')) return true;
  if (k === 'debeCode'.toLowerCase() || k === 'haberCode'.toLowerCase() || k === 'debitcode' || k === 'creditcode') return true;
  return false;
}

function catCollectAccountCodesFromValue(value, keyHint = '', out = new Set(), depth = 0) {
  if (value == null || depth > 4) return out;

  if (typeof value === 'string' || typeof value === 'number') {
    if (!catLooksLikeAccountField(keyHint)) return out;
    const raw = String(value || '').trim();
    const direct = finGetAccountCode(raw);
    if (direct && finGetRootFromCode(direct)) out.add(direct);
    const matches = raw.match(/\b[1-7][0-9]{3}\b/g) || [];
    matches.forEach(code => {
      const c = finGetAccountCode(code);
      if (c && finGetRootFromCode(c)) out.add(c);
    });
    return out;
  }

  if (Array.isArray(value)) {
    for (const item of value) catCollectAccountCodesFromValue(item, keyHint, out, depth + 1);
    return out;
  }

  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const lower = String(key || '').toLowerCase();
      if (lower.includes('date') || lower.includes('fecha') || lower.includes('phone') || lower.includes('telefono')) continue;
      catCollectAccountCodesFromValue(child, key, out, depth + 1);
    }
  }
  return out;
}

function catGetUsageCounts(data) {
  const rev = catComputeDiaryRevision(data);

  if (catUsageCache && catUsageCache.rev === rev && catUsageCache.countsObj) {
    return { rev, countsObj: catUsageCache.countsObj };
  }

  const cached = catReadUsageCache();
  if (cached && cached.rev === rev && cached.counts) {
    catUsageCache = { rev, countsObj: cached.counts, updatedAt: cached.updatedAt || null };
    return { rev, countsObj: cached.counts };
  }

  const counts = {};
  const scanRecord = (record, weight = 1) => {
    const codes = catCollectAccountCodesFromValue(record);
    codes.forEach(code => catAddUsageCount(counts, code, weight));
  };

  const lines = (data && Array.isArray(data.lines)) ? data.lines : [];
  for (const ln of lines) scanRecord(ln, 1);

  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  for (const entry of entries) scanRecord(entry, 1);

  const receipts = (data && Array.isArray(data.receipts)) ? data.receipts : [];
  for (const receipt of receipts) scanRecord(receipt, 1);

  const transfers = (data && Array.isArray(data.internalTransfers)) ? data.internalTransfers : [];
  for (const tr of transfers) scanRecord(tr, 1);

  // Si una cuenta contable está vinculada a una cuenta financiera activa, se considera vinculada a estructura activa.
  const financialAccounts = (data && Array.isArray(data.financialAccounts)) ? data.financialAccounts : [];
  for (const fa of financialAccounts) {
    catAddUsageCount(counts, fa && (fa.cuentaContableCodigo || fa.financialAccountAccountingCode || fa.accountCode), 1);
  }

  catUsageCache = { rev, countsObj: counts, updatedAt: new Date().toISOString() };
  catWriteUsageCache(rev, counts);
  return { rev, countsObj: counts };
}

function catGetCatalogChildren(data, parentCode) {
  const p = finGetAccountCode(parentCode);
  if (!p) return [];
  return finGetVisibleCatalogAccounts(data || finCachedData || {})
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean)
    .filter(acc => finGetAccountCode(acc) !== p)
    .filter(acc => String(acc.parentId || finInferParentCodeFromCode(acc.code) || '') === p)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

function catAccountHasChildren(data, accountOrCode) {
  return catGetCatalogChildren(data, accountOrCode).length > 0;
}

function catGetActiveChildren(data, accountOrCode) {
  return catGetCatalogChildren(data, accountOrCode).filter(child => finIsActiveAccount(child) && child.isHidden !== true);
}

function catGetAccountUsageCount(data, accountOrCode) {
  const code = finGetAccountCode(accountOrCode);
  if (!code) return 0;
  const { countsObj } = catGetUsageCounts(data || finCachedData || {});
  return Number(countsObj?.[code] || 0);
}

function catBuildAccountRuleState(data, account) {
  const row = finNormalizeAccountForView(account);
  if (!row) return null;
  const hasChildren = catAccountHasChildren(data, row.code);
  const activeChildrenCount = catGetActiveChildren(data, row.code).length;
  const usedCount = catGetAccountUsageCount(data, row.code);
  const hasMovements = usedCount > 0;
  const isRoot = catIsRootLockedForUI(row);
  const isUserCatalog = finIsUserCatalogAccount(row);
  const isLocked = isRoot || (!isUserCatalog && (row.isLocked === true || row.systemProtected === true));
  const isLegacy = isUserCatalog ? false : finIsLegacyAccount(row);
  const isActive = finIsActiveAccount(row) && row.isHidden !== true;
  const effectivePostable = !isRoot && !hasChildren && isActive && finIsPostableAccount({ ...row, hasChildren: false });
  const isGrouping = isRoot || hasChildren || !effectivePostable;
  const level = Number(row.level || finGetAccountLevelFromCode(row.code) || 0);
  const canEditName = !isRoot && !isLocked && !isLegacy;
  const canChangePostable = !isRoot && !isLocked && !isLegacy && !hasChildren && !hasMovements;
  // Una raíz está bloqueada para edición/borrado/inactivación, pero SÍ debe servir como padre.
  // El bloqueo de raíz no puede impedir la creación de subcuentas de nivel 2.
  const belongsToValidRoot = isRoot || !!finGetRootFromCode(row.code);
  const lockedForChildren = !isRoot && (isLocked || isLegacy);
  const canCreateChild = isActive && level >= 1 && level < FIN_ACCOUNT_MAX_LEVEL && belongsToValidRoot && !effectivePostable && !lockedForChildren;
  const canToggleActive = !isRoot && !isLocked && !isLegacy && (isActive ? activeChildrenCount === 0 : true);
  const canDelete = !isRoot && !isLocked && !isLegacy && !hasChildren && !hasMovements;

  let createChildMessage = '';
  if (!isActive) createChildMessage = 'La cuenta está inactiva y no acepta nuevas subcuentas.';
  else if (level >= FIN_ACCOUNT_MAX_LEVEL) createChildMessage = 'Por ahora el catálogo permite hasta 4 niveles.';
  else if (effectivePostable) createChildMessage = FIN_ACCOUNT_CATALOG_POSTABLE_CHILD_LOCK_MESSAGE;
  else if (!isRoot && (isLocked || isLegacy)) createChildMessage = 'Esta cuenta está protegida por compatibilidad histórica.';

  let editMessage = '';
  if (isRoot) editMessage = FIN_ACCOUNT_CATALOG_LOCK_MESSAGE;
  else if (isLocked || isLegacy) editMessage = 'Esta cuenta está protegida por compatibilidad histórica.';
  else if (hasMovements) editMessage = FIN_ACCOUNT_CATALOG_STRUCTURAL_LOCK_MESSAGE;

  let toggleMessage = '';
  if (isRoot) toggleMessage = FIN_ACCOUNT_CATALOG_LOCK_MESSAGE;
  else if (isLocked || isLegacy) toggleMessage = 'Esta cuenta está protegida por compatibilidad histórica.';
  else if (isActive && activeChildrenCount > 0) toggleMessage = 'No se puede inactivar una cuenta con subcuentas activas.';

  let deleteMessage = '';
  if (isRoot) deleteMessage = FIN_ACCOUNT_CATALOG_LOCK_MESSAGE;
  else if (isLocked || isLegacy) deleteMessage = 'Esta cuenta está protegida por compatibilidad histórica.';
  else if (hasChildren) deleteMessage = 'No se puede borrar una cuenta con subcuentas.';
  else if (hasMovements) deleteMessage = 'No se puede borrar una cuenta con movimientos.';

  return {
    ...row,
    hasChildren,
    activeChildrenCount,
    usedCount,
    hasMovements,
    isRoot,
    isLocked,
    isLegacy,
    isActive,
    isGrouping,
    effectivePostable,
    canPost: effectivePostable,
    canCreateChild,
    canEditName,
    canChangePostable,
    canToggleActive,
    canDelete,
    createChildMessage,
    editMessage,
    toggleMessage,
    deleteMessage
  };
}

function inferTipoForNewAccount(code) {
  const s = String(code || '').trim();
  if (s.startsWith('71')) return 'ingreso';
  if (s.startsWith('72')) return 'gasto';
  return inferTipoFromCode(s) || 'otro';
}

function catMakePill(text, variant) {
  const v = variant ? ` fin-pill--${variant}` : '';
  return `<span class="fin-pill${v}">${text}</span>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function uiTextFIN(text){
  try{
    if (window.A33Presentations && typeof A33Presentations.canonicalizeText === 'function'){
      return A33Presentations.canonicalizeText(text);
    }
  }catch(_){ }
  return String(text || '');
}

function catIsRootLockedForUI(acc) {
  return finIsRootAccount(acc) || FIN_FIXED_ROOT_CODES.includes(finGetAccountCode(acc));
}

function catCanHaveChildren(acc, data = finCachedData) {
  const state = catBuildAccountRuleState(data || finCachedData || {}, acc);
  return !!(state && state.canCreateChild);
}

function catGetParentCandidateAccounts(data = finCachedData || {}) {
  const source = data || { accounts: [] };
  const rows = finGetVisibleCatalogAccounts(source)
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean);
  const byCode = new Map();
  for (const root of finBuildFixedRootAccountRows()) {
    const r = finNormalizeAccountForView(root);
    if (r && r.code) byCode.set(r.code, r);
  }
  for (const row of rows) {
    if (row && row.code) byCode.set(row.code, row);
  }
  return Array.from(byCode.values())
    .filter(acc => {
      const state = catBuildAccountRuleState(source, acc);
      return !!(state && state.canCreateChild);
    })
    .sort((a, b) => String(a.code).localeCompare(String(b.code), 'es', { numeric: true }));
}

function catParentLabel(acc) {
  const row = finNormalizeAccountForView(acc);
  if (!row) return '';
  const level = Number(row.level || 1);
  const indent = level > 1 ? '· '.repeat(Math.max(0, level - 1)) : '';
  return `${indent}${row.code} — ${row.nombre || row.name || 'Cuenta'}`;
}

function catFindVisibleAccountByCode(data, code) {
  const c = finGetAccountCode(code);
  return finGetVisibleCatalogAccounts(data || finCachedData || {})
    .find(acc => finGetAccountCode(acc) === c) || null;
}

function catGetParentSelectValue() {
  return finGetAccountCode(document.getElementById('cat-parent')?.value || '');
}

function catGetPostableChoice() {
  const raw = String(document.getElementById('cat-postable')?.value || 'postable').toLowerCase();
  return raw === 'grouping' ? 'grouping' : 'postable';
}

function catGetSuggestedCodeForParent(parentCode) {
  const data = finCachedData || { accounts: [] };
  const parent = catFindVisibleAccountByCode(data, parentCode);
  if (!parent) return { ok: false, code: '', message: 'Seleccione una cuenta padre válida.' };
  const state = catBuildAccountRuleState(data, parent);
  if (!state || !state.canCreateChild) {
    return { ok: false, code: '', message: (state && state.createChildMessage) || 'Cuenta padre inválida o sin espacio para más niveles.' };
  }
  return finSuggestNextAccountCode(parent, finGetCatalogCodeReservationAccounts(data));
}

function catRefreshSuggestedCode() {
  const codeEl = document.getElementById('cat-code');
  const typeEl = document.getElementById('cat-type-preview');
  const natureEl = document.getElementById('cat-nature-preview');
  const parentCode = catGetParentSelectValue();
  const data = finCachedData || { accounts: [] };
  const parent = catFindVisibleAccountByCode(data, parentCode);
  const suggestion = parent ? catGetSuggestedCodeForParent(parentCode) : { ok: false, code: '', message: 'Seleccione una cuenta padre válida.' };
  if (codeEl) codeEl.value = suggestion.ok ? suggestion.code : '';
  if (typeEl) typeEl.value = parent ? (finGetAccountType(parent) || '').toString() : '';
  if (natureEl) natureEl.value = parent ? (finGetAccountNature(parent) || '').toString() : '';
  if (!suggestion.ok && parentCode) setCatFormMessage(suggestion.message || 'No hay códigos disponibles bajo esta cuenta padre.', true);
  else setCatFormMessage('');
  return suggestion;
}

function catHasVisibleDuplicateName(data, parentCode, name, ignoreCode = '') {
  const target = normText(name).trim();
  if (!target) return false;
  const p = finGetAccountCode(parentCode);
  const ignore = finGetAccountCode(ignoreCode);
  return finGetVisibleCatalogAccounts(data || {})
    .map(acc => finNormalizeAccountForView(acc))
    .filter(Boolean)
    .some(acc => {
      if (ignore && finGetAccountCode(acc) === ignore) return false;
      const accParent = String(acc.parentId || finInferParentCodeFromCode(acc.code) || '');
      if (accParent !== p) return false;
      return normText(acc.nombre || acc.name || '').trim() === target;
    });
}

function catBuildAccountRowForSave({ existing = null, code, name, parent, postableChoice }) {
  const nowISO = new Date().toISOString();
  const parentRow = finNormalizeAccountForView(parent);
  const rootCode = finGetRootFromCode(parentRow.code) || parentRow.code;
  const root = FIN_FIXED_ROOTS_BY_CODE[rootCode] || null;
  const level = Math.min(FIN_ACCOUNT_MAX_LEVEL, Number(parentRow.level || finGetAccountLevelFromCode(parentRow.code) || 1) + 1);
  const isPostable = postableChoice !== 'grouping';
  const previousName = existing ? String(existing.nombre || existing.name || '').trim() : '';
  const legacyNames = Array.isArray(existing && existing.legacyNames) ? [...existing.legacyNames] : [];
  if (previousName && !legacyNames.map(normText).includes(normText(previousName))) legacyNames.push(previousName);

  return {
    ...(existing || {}),
    id: code,
    code,
    nombre: name,
    name,
    parentId: parentRow.code,
    parentCode: parentRow.code,
    rootCode,
    level,
    type: root ? root.type : finGetAccountType(parentRow),
    tipo: root ? root.tipo : (parentRow.tipo || finGetAccountType(parentRow)),
    rootType: root ? root.rootType : String(parentRow.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase(),
    nature: root ? root.nature : finGetAccountNature(parentRow),
    isRoot: false,
    isLocked: false,
    systemProtected: false,
    isPostable,
    postable: isPostable,
    noPostable: !isPostable,
    isGrouping: !isPostable,
    grouping: !isPostable,
    accountMode: isPostable ? 'postable' : 'grouping',
    isActive: true,
    active: true,
    isHidden: false,
    isLegacy: false,
    legacy: false,
    legacyFinancialAccount: false,
    a33CatalogVisible: true,
    a33CatalogUserCreated: true,
    a33CatalogActivatedAt: existing && existing.a33CatalogActivatedAt ? existing.a33CatalogActivatedAt : nowISO,
    generatedFrom: FIN_ACCOUNT_CATALOG_SOURCE,
    sourceModule: FIN_ACCOUNT_CATALOG_SOURCE,
    sourceCatalog: 'Finanzas → Catálogo de Cuentas',
    legacyNames,
    createdAt: existing && (existing.createdAt || existing.createdAtISO) ? (existing.createdAt || existing.createdAtISO) : nowISO,
    updatedAt: nowISO,
    createdAtISO: existing && existing.createdAtISO ? existing.createdAtISO : nowISO,
    updatedAtISO: nowISO,
    a33AccountCatalogVisibleMode: FIN_ACCOUNT_CATALOG_VISIBLE_MODE,
    a33AccountHierarchyStage: FIN_ACCOUNTING_REDESIGN_STAGE,
    a33AccountHierarchyVersion: FIN_ACCOUNT_HIERARCHY_VERSION
  };
}

function catFillParentSelect(selectedCode = '') {
  const sel = document.getElementById('cat-parent');
  if (!sel) return;
  const data = finCachedData || { accounts: [] };
  const rows = catGetParentCandidateAccounts(data);

  const prev = finGetAccountCode(selectedCode || sel.value || '');
  sel.innerHTML = '<option value="">Seleccione cuenta padre…</option>';
  for (const acc of rows) {
    const opt = document.createElement('option');
    opt.value = acc.code;
    opt.textContent = catParentLabel(acc);
    sel.appendChild(opt);
  }
  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  else if (!sel.value && rows.length) sel.value = rows[0].code;
  catRefreshSuggestedCode();
}




/* ---------- Selector contable reutilizable (Etapa 5/9) ---------- */

const finAccountSelectorInstances = new Map();
let finAccountSelectorSeq = 0;
let finAccountPickerState = null;

function finAccountSelectorFindAccountByCode(code, data = finCachedData || {}) {
  const c = finGetAccountCode(code);
  if (!c) return null;
  const selectable = getPostableAccountsForSelector(data);
  return selectable.find(acc => finGetAccountCode(acc) === c) || null;
}

function finAccountSelectorDisplayLabel(accountOrCode, data = finCachedData || {}) {
  const acc = (accountOrCode && typeof accountOrCode === 'object')
    ? finNormalizeAccountForView(accountOrCode)
    : finAccountSelectorFindAccountByCode(accountOrCode, data);
  if (!acc) return '';
  return `${acc.code} — ${acc.nombre || acc.name || 'Cuenta'}`;
}

function finAccountSelectorSetValue(instanceId, accountOrCode, opts = {}) {
  const state = finAccountSelectorInstances.get(instanceId);
  if (!state) return null;
  const data = opts.data || finCachedData || state.data || { accounts: [] };
  const account = (accountOrCode && typeof accountOrCode === 'object')
    ? finNormalizeAccountForView(accountOrCode)
    : finAccountSelectorFindAccountByCode(accountOrCode, data);

  state.value = account ? finGetAccountCode(account) : '';
  state.account = account || null;
  state.data = data;

  const host = state.host;
  if (host) {
    const hidden = host.querySelector('.fin-account-selector-value');
    const trigger = host.querySelector('.fin-account-selector-trigger');
    const meta = host.querySelector('.fin-account-selector-meta');
    const clear = host.querySelector('.fin-account-selector-clear');
    if (hidden) hidden.value = state.value;
    if (trigger) {
      trigger.textContent = account ? finAccountSelectorDisplayLabel(account, data) : (state.placeholder || 'Buscar cuenta por código o nombre');
      trigger.classList.toggle('has-value', !!account);
    }
    if (meta) {
      meta.textContent = account
        ? finAccountSelectorMetaText(account, data)
        : (state.emptyHint || 'Solo muestra cuentas activas y posteables.');
    }
    if (clear) clear.hidden = !account;
  }

  if (opts.emit !== false && typeof state.onSelect === 'function') {
    try { state.onSelect(account, state.value); } catch (err) { console.error('Error en selector contable', err); }
  }
  return account;
}

function createAccountSelect(target, options = {}) {
  const host = typeof target === 'string' ? document.querySelector(target) : target;
  if (!host) return null;

  const instanceId = String(options.instanceId || host.dataset.accountSelectorId || `fin-account-selector-${++finAccountSelectorSeq}`);
  host.dataset.accountSelectorId = instanceId;

  const state = {
    id: instanceId,
    host,
    value: finGetAccountCode(options.value || ''),
    account: null,
    data: options.data || finCachedData || { accounts: [] },
    label: options.label || 'Cuenta contable',
    placeholder: options.placeholder || 'Buscar cuenta por código o nombre',
    emptyHint: options.emptyHint || 'Solo muestra cuentas activas y posteables.',
    onSelect: typeof options.onSelect === 'function' ? options.onSelect : null
  };
  finAccountSelectorInstances.set(instanceId, state);

  host.classList.add('fin-account-selector-host');
  host.innerHTML = `
    <div class="fin-account-selector" data-selector-id="${escapeHtml(instanceId)}">
      <label class="fin-account-selector-label">${escapeHtml(state.label)}</label>
      <div class="fin-account-selector-row">
        <button type="button" class="fin-account-selector-trigger">${escapeHtml(state.placeholder)}</button>
        <button type="button" class="btn-small fin-account-selector-clear" hidden>Limpiar</button>
      </div>
      <input type="hidden" class="fin-account-selector-value" value="">
      <div class="fin-account-selector-meta">${escapeHtml(state.emptyHint)}</div>
    </div>
  `;

  const trigger = host.querySelector('.fin-account-selector-trigger');
  const clear = host.querySelector('.fin-account-selector-clear');
  if (trigger) trigger.addEventListener('click', () => openAccountPicker({ instanceId }));
  if (clear) clear.addEventListener('click', () => finAccountSelectorSetValue(instanceId, null));

  if (state.value) finAccountSelectorSetValue(instanceId, state.value, { emit: false, data: state.data });

  return {
    id: instanceId,
    getValue: () => (finAccountSelectorInstances.get(instanceId) || {}).value || '',
    getAccount: () => (finAccountSelectorInstances.get(instanceId) || {}).account || null,
    setValue: (value, setOpts = {}) => finAccountSelectorSetValue(instanceId, value, setOpts),
    clear: () => finAccountSelectorSetValue(instanceId, null),
    destroy: () => {
      finAccountSelectorInstances.delete(instanceId);
      if (host) host.innerHTML = '';
    }
  };
}

function renderAccountSelector(target, options = {}) { return createAccountSelect(target, options); }
function setupAccountSearchSelector(target, options = {}) { return createAccountSelect(target, options); }

function finEnsureAccountPickerModal() {
  const modal = document.getElementById('account-picker-modal');
  if (!modal || modal.dataset.bound === '1') return modal;
  modal.dataset.bound = '1';

  const close = document.getElementById('account-picker-close');
  const cancel = document.getElementById('account-picker-cancel');
  const search = document.getElementById('account-picker-search');
  const clear = document.getElementById('account-picker-clear');
  const results = document.getElementById('account-picker-results');

  const closePicker = () => closeAccountPicker();
  if (close) close.addEventListener('click', closePicker);
  if (cancel) cancel.addEventListener('click', closePicker);
  if (clear && search) clear.addEventListener('click', () => {
    search.value = '';
    if (finAccountPickerState) finAccountPickerState.query = '';
    finRenderAccountPickerResults();
    search.focus();
  });
  if (search) search.addEventListener('input', () => {
    if (finAccountPickerState) finAccountPickerState.query = search.value || '';
    finRenderAccountPickerResults();
  });
  if (results) results.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-account-code]');
    if (!btn || !finAccountPickerState) return;
    const account = finAccountPickerState.accounts.find(acc => finGetAccountCode(acc) === finGetAccountCode(btn.dataset.accountCode));
    if (!account) return;
    finAccountSelectorSetValue(finAccountPickerState.instanceId, account, { data: finAccountPickerState.data });
    closeAccountPicker();
  });
  modal.addEventListener('click', (ev) => {
    if (ev.target === modal) closeAccountPicker();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && modal.classList.contains('open')) closeAccountPicker();
  });
  return modal;
}

function openAccountPicker(options = {}) {
  const instanceId = String(options.instanceId || '');
  const instance = finAccountSelectorInstances.get(instanceId);
  if (!instance) return;
  const modal = finEnsureAccountPickerModal();
  if (!modal) return;
  const data = options.data || finCachedData || instance.data || { accounts: [] };
  const accounts = getPostableAccountsForSelector(data);
  finAccountPickerState = { instanceId, data, accounts, query: '' };

  const search = document.getElementById('account-picker-search');
  if (search) search.value = '';
  const title = document.getElementById('account-picker-title');
  if (title) title.textContent = instance.label || 'Seleccionar cuenta contable';

  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  finRenderAccountPickerResults();
  setTimeout(() => search?.focus(), 0);
}

function closeAccountPicker() {
  const modal = document.getElementById('account-picker-modal');
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  finAccountPickerState = null;
}

function finRenderAccountPickerResults() {
  const results = document.getElementById('account-picker-results');
  const count = document.getElementById('account-picker-count');
  if (!results || !finAccountPickerState) return;
  const q = finNormalizeAccountSearchText(finAccountPickerState.query || '');
  const data = finAccountPickerState.data || { accounts: [] };
  const filtered = q
    ? finAccountPickerState.accounts.filter(acc => {
        const haystack = finNormalizeAccountSearchText([
          acc.code,
          acc.nombre,
          acc.name,
          finGetAccountType(acc),
          finGetAccountNature(acc),
          finGetAccountPathLabel(acc, data),
          acc.currency,
          acc.currencyCode,
          acc.moneda
        ].filter(Boolean).join(' '));
        return haystack.includes(q);
      })
    : finAccountPickerState.accounts;

  if (count) {
    count.textContent = finAccountPickerState.accounts.length
      ? `${filtered.length} cuenta${filtered.length === 1 ? '' : 's'} disponible${filtered.length === 1 ? '' : 's'}`
      : 'Sin cuentas posteables disponibles';
  }

  if (!finAccountPickerState.accounts.length) {
    results.innerHTML = `<div class="fin-account-picker-empty">No hay cuentas posteables disponibles. Cree una subcuenta posteable en el Catálogo de Cuentas.</div>`;
    return;
  }
  if (!filtered.length) {
    results.innerHTML = `<div class="fin-account-picker-empty">No hay resultados para esta búsqueda.</div>`;
    return;
  }

  results.innerHTML = filtered.slice(0, 80).map(acc => {
    const label = finAccountSelectorDisplayLabel(acc, data);
    const meta = finAccountSelectorMetaText(acc, data);
    return `
      <button type="button" class="fin-account-picker-result" data-account-code="${escapeHtml(acc.code)}">
        <span class="fin-account-picker-main">
          <strong>${escapeHtml(label)}</strong>
          <span class="fin-pill fin-pill--green">Posteable</span>
        </span>
        <span class="fin-account-picker-meta">${escapeHtml(meta)}</span>
      </button>
    `;
  }).join('') + (filtered.length > 80 ? `<div class="fin-account-picker-empty">Mostrando 80 resultados. Afine la búsqueda para ver menos ruido.</div>` : '');
}

function renderCatalogAccountSelectorDemo(data) {
  const host = document.getElementById('cat-account-selector-test');
  if (!host) return;
  const selectedText = document.getElementById('cat-account-selector-selected');
  createAccountSelect(host, {
    instanceId: 'cat-account-selector-test-instance',
    data: data || finCachedData || { accounts: [] },
    label: 'Prueba segura de selector contable',
    placeholder: 'Buscar cuenta por código o nombre',
    emptyHint: 'No registra movimientos; solo valida qué cuentas serían seleccionables en el futuro Diario Contable.',
    onSelect: (account) => {
      if (selectedText) {
        selectedText.textContent = account
          ? `Seleccionada: ${finAccountSelectorDisplayLabel(account, data || finCachedData || {})}`
          : 'Sin cuenta seleccionada.';
      }
    }
  });
  if (selectedText && !selectedText.textContent.trim()) selectedText.textContent = 'Sin cuenta seleccionada.';
}

function finSetupAccountPickerModal() {
  finEnsureAccountPickerModal();
}

function renderCatalogoCuentas(data) {
  const tbody = document.getElementById('cat-tbody');
  if (!tbody) return;

  let accounts = [];
  try {
    accounts = finGetVisibleCatalogAccounts(data || finCachedData || { accounts: [] })
      .map(acc => catBuildAccountRuleState(data || finCachedData || { accounts: [] }, acc))
      .filter(Boolean);
  } catch (err) {
    console.error('Error preparando Catálogo de Cuentas; usando raíces de emergencia', err);
    accounts = finBuildFixedRootAccountRows()
      .map(acc => ({
        ...acc,
        hasChildren: false,
        activeChildrenCount: 0,
        usedCount: 0,
        hasMovements: false,
        isRoot: true,
        isLocked: true,
        isLegacy: false,
        isActive: true,
        isGrouping: true,
        effectivePostable: false,
        canPost: false,
        canCreateChild: true,
        canEditName: false,
        canChangePostable: false,
        canToggleActive: false,
        canDelete: false,
        createChildMessage: '',
        editMessage: FIN_ACCOUNT_CATALOG_LOCK_MESSAGE,
        toggleMessage: FIN_ACCOUNT_CATALOG_LOCK_MESSAGE,
        deleteMessage: FIN_ACCOUNT_CATALOG_LOCK_MESSAGE
      }));
  }

  const q = normText(catQuery || '').trim();

  accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const filtered = q
    ? accounts.filter(a => {
        const code = String(a.code || '');
        const name = String(a.nombre || a.name || '');
        const parent = String(a.parentId || '');
        return normText(code).includes(q) || normText(name).includes(q) || normText(parent).includes(q);
      })
    : accounts;

  tbody.innerHTML = '';

  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7">Sin resultados. Presione Actualizar; si continúa, cierre y abra de nuevo la PWA.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const acc of filtered) {
    const code = String(acc.code);
    const name = (acc.nombre || acc.name || '').toString();
    const level = Number(acc.level || finGetAccountLevelFromCode(code) || 1);
    const rootType = String(acc.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase();
    const isRoot = acc.isRoot;
    const isProtected = isRoot || acc.isLocked;
    const usedCount = Number(acc.usedCount || 0);
    const isUsed = usedCount > 0;
    const estadoPill = acc.isActive ? catMakePill('Activa', 'green') : catMakePill('Inactiva', 'red');
    const protPill = isRoot ? catMakePill('Raíz', 'gold') : (isProtected ? catMakePill('Protegida', 'gold') : catMakePill('Editable', 'muted'));
    const usedPill = isUsed ? catMakePill(`Sí (${usedCount})`, 'green') : catMakePill('No', 'muted');
    const typePill = catMakePill(rootType, 'muted');
    const classPill = acc.effectivePostable ? catMakePill('Posteable', 'green') : catMakePill('Agrupadora', 'gold');
    const inactivePill = acc.isActive ? '' : catMakePill('Inactiva', 'red');
    const childPill = acc.hasChildren ? catMakePill(`${acc.activeChildrenCount || 0} hijas activas`, 'muted') : '';
    const levelPill = catMakePill(`Nivel ${level}`, isRoot ? 'gold' : 'muted');

    const tr = document.createElement('tr');
    tr.className = `cat-account-row cat-level-${Math.max(1, Math.min(FIN_ACCOUNT_MAX_LEVEL, level))}${isRoot ? ' cat-root-row' : ''}${!acc.isActive ? ' cat-inactive-row' : ''}`;

    const pad = Math.max(0, level - 1) * 18;
    const safeName = escapeHtml(name) || '—';
    const addTitle = acc.canCreateChild ? 'Agregar subcuenta' : (acc.createChildMessage || 'No se puede agregar subcuenta');
    const editTitle = acc.canEditName ? 'Editar nombre y clasificación segura' : (acc.editMessage || 'No se puede editar esta cuenta');
    const toggleTitle = acc.canToggleActive ? (acc.isActive ? 'Inactivar cuenta' : 'Reactivar cuenta') : (acc.toggleMessage || 'No se puede cambiar el estado');
    const deleteTitle = acc.canDelete ? 'Borrar cuenta sin movimientos ni subcuentas' : (acc.deleteMessage || 'No se puede borrar esta cuenta');

    tr.innerHTML = `
      <td><strong>${escapeHtml(code)}</strong></td>
      <td>
        <div class="cat-account-name" style="--cat-indent:${pad}px">
          <strong>${safeName}</strong>
          <div class="cat-account-badges">${levelPill}${classPill}${inactivePill}${childPill}</div>
        </div>
      </td>
      <td>${typePill}</td>
      <td>${estadoPill}</td>
      <td>${protPill}</td>
      <td>${usedPill}</td>
      <td class="fin-actions-cell cat-actions-cell">
        <button type="button" class="btn-small cat-add-child" data-code="${escapeHtml(code)}" ${acc.canCreateChild ? '' : 'disabled'} title="${escapeHtml(addTitle)}">+ Subcuenta</button>
        <button type="button" class="btn-small cat-edit" data-code="${escapeHtml(code)}" ${acc.canEditName ? '' : 'disabled'} title="${escapeHtml(editTitle)}">Editar</button>
        <button type="button" class="btn-small cat-toggle" data-code="${escapeHtml(code)}" ${acc.canToggleActive ? '' : 'disabled'} title="${escapeHtml(toggleTitle)}">${isRoot ? 'Fija' : (acc.isActive ? 'Inactivar' : 'Activar')}</button>
        <button type="button" class="btn-small btn-danger cat-delete" data-code="${escapeHtml(code)}" ${acc.canDelete ? '' : 'disabled'} title="${escapeHtml(deleteTitle)}">Borrar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  try { renderCatalogAccountSelectorDemo(data || finCachedData || { accounts: [] }); } catch (err) { console.error('Error renderizando demo del selector contable', err); }
}

function catMakeFileStamp(d) {
  const dt = (d instanceof Date) ? d : new Date(d || Date.now());
  const yyyy = dt.getFullYear();
  const mm = pad2(dt.getMonth() + 1);
  const dd = pad2(dt.getDate());
  const hh = pad2(dt.getHours());
  const mi = pad2(dt.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
}

function catBuildCatalogWorkbook(data) {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return null;
  }

  const accounts = finGetVisibleCatalogAccounts(data)
    .map(acc => catBuildAccountRuleState(data, acc))
    .filter(Boolean);

  // Orden por código asc
  accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  // Hoja: Cuentas
  const rows = [[
    'Código',
    'Nombre',
    'Raíz/Tipo',
    'Estado (Activa/Inactiva)',
    'Protegida',
    'Posteable',
    'Usada (Sí/No)',
    '#Movimientos (count)'
  ]];

  let total = 0;
  let activas = 0;
  let ocultas = 0;
  const byRoot = {};

  for (const acc of accounts) {
    const code = String(acc.code || '').trim();
    if (!code) continue;
    const name = (acc.nombre || acc.name || '').toString();
    const rootType = String(acc.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase();
    const isActive = !!acc.isActive;
    const isProtected = !!(acc.systemProtected || acc.isLocked || acc.isRoot);
    const usedCount = Number(acc.usedCount || 0);
    const isUsed = usedCount > 0;

    total += 1;
    if (isActive) activas += 1; else ocultas += 1;
    byRoot[rootType] = (byRoot[rootType] || 0) + 1;

    rows.push([
      code,
      name,
      rootType,
      isActive ? 'Activa' : 'Inactiva',
      isProtected ? 'Sí' : 'No',
      acc.effectivePostable ? 'Sí' : 'No / Agrupadora',
      isUsed ? 'Sí' : 'No',
      usedCount
    ]);
  }

  const wsCuentas = XLSX.utils.aoa_to_sheet(rows);
  wsCuentas['!cols'] = [
    { wch: 10 },
    { wch: 44 },
    { wch: 16 },
    { wch: 20 },
    { wch: 18 },
    { wch: 14 },
    { wch: 18 },
    { wch: 18 }
  ];

  // Hoja: Resumen (opcional)
  const now = new Date();
  const resumenRows = [
    ['Suite A33', 'Finanzas · Catálogo de Cuentas'],
    ['Exportado', fmtDDMMYYYYHHMM(now)],
    [],
    ['Total de cuentas', total],
    ['Activas', activas],
    ['Inactivas', ocultas],
    [],
    ['Por rootType', 'Conteo']
  ];

  // Respetar el orden de ROOT_TYPES, pero incluir extras si existieran
  const seen = new Set();
  for (const rt of (Array.isArray(ROOT_TYPES) ? ROOT_TYPES : [])) {
    const key = String(rt || '').toUpperCase();
    if (!key) continue;
    resumenRows.push([key, Number(byRoot[key] || 0)]);
    seen.add(key);
  }
  Object.keys(byRoot)
    .map(k => String(k).toUpperCase())
    .filter(k => !seen.has(k))
    .sort((a, b) => a.localeCompare(b))
    .forEach(k => resumenRows.push([k, Number(byRoot[k] || 0)]));

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 20 }, { wch: 56 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsCuentas, 'Cuentas');
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
  return wb;
}

async function catExportCatalogExcel() {
  try {
    if (!finCachedData) await refreshAllFin();
    const wb = catBuildCatalogWorkbook(finCachedData || { accounts: [], entries: [], lines: [] });
    if (!wb) return;
    const stamp = catMakeFileStamp(new Date());
    const filename = `A33_Finanzas_CatalogoCuentas_${stamp}.xlsx`;
    finAttachExportCurrencyMetadata(wb);
    XLSX.writeFile(wb, filename);
    showToast('Catálogo exportado a Excel');
  } catch (err) {
    console.error('Error exportando Catálogo a Excel', err);
    alert('Ocurrió un error exportando el Catálogo a Excel.');
  }
}

function openCatModal() {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeCatModal() {
  const modal = document.getElementById('cat-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function setCatFormMessage(msg, isError = false) {
  const el = document.getElementById('cat-form-msg');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = isError ? '#ffd6d6' : '';
}

function populateCatRootSelect() {
  catFillParentSelect();
}

function catDefaultPostableChoiceForParent(parentCode) {
  const parent = catFindVisibleAccountByCode(finCachedData || {}, parentCode);
  const level = parent ? Number(finNormalizeAccountForView(parent)?.level || finGetAccountLevelFromCode(parentCode) || 1) : 1;
  // Nivel 2 y 3 suelen ser agrupadores para permitir llegar a nivel 3/4.
  // El cuarto nivel ya debe quedar listo para recibir Debe/Haber.
  return level >= 3 ? 'postable' : 'grouping';
}

function setCatModalMode(mode, acc = null, parentCodeForNew = '') {
  const modeEl = document.getElementById('cat-mode');
  const editCodeEl = document.getElementById('cat-edit-code');
  const codeEl = document.getElementById('cat-code');
  const nameEl = document.getElementById('cat-name');
  const parentEl = document.getElementById('cat-parent');
  const postableEl = document.getElementById('cat-postable');
  const titleEl = document.getElementById('cat-modal-title');
  const subEl = document.getElementById('cat-modal-sub');

  if (!modeEl || !editCodeEl || !codeEl || !nameEl || !parentEl) return;

  setCatFormMessage('');
  codeEl.disabled = true;
  codeEl.readOnly = true;

  if (mode === 'edit' && acc) {
    const row = catBuildAccountRuleState(finCachedData || {}, acc) || finNormalizeAccountForView(acc);
    const code = String(row.code);
    modeEl.value = 'edit';
    editCodeEl.value = code;
    codeEl.value = code;
    nameEl.value = (row.nombre || row.name || '').toString();
    nameEl.disabled = !row.canEditName;
    catFillParentSelect(row.parentId || finInferParentCodeFromCode(code) || '');
    parentEl.disabled = true;
    if (postableEl) {
      postableEl.value = row.effectivePostable ? 'postable' : 'grouping';
      postableEl.disabled = !row.canChangePostable;
    }
    if (titleEl) titleEl.textContent = 'Editar cuenta';
    if (subEl) subEl.textContent = `Código automático bloqueado: ${code}`;
    if (!row.canEditName && row.editMessage) setCatFormMessage(row.editMessage, true);
    catRefreshSuggestedCode();
    codeEl.value = code;
  } else {
    modeEl.value = 'new';
    editCodeEl.value = '';
    nameEl.value = '';
    nameEl.disabled = false;
    parentEl.disabled = false;
    if (postableEl) {
      postableEl.disabled = false;
      postableEl.value = catDefaultPostableChoiceForParent(parentCodeForNew || '1000');
    }
    catFillParentSelect(parentCodeForNew || '1000');
    if (postableEl) postableEl.value = catDefaultPostableChoiceForParent(catGetParentSelectValue() || parentCodeForNew || '1000');
    if (titleEl) titleEl.textContent = 'Nueva subcuenta';
    if (subEl) subEl.textContent = 'Selecciona la cuenta padre; el código se asigna automáticamente.';
  }
}

async function saveCatAccount() {
  if (!finCachedData) await refreshAllFin();

  const mode = document.getElementById('cat-mode')?.value || 'new';
  const editCode = finGetAccountCode(document.getElementById('cat-edit-code')?.value || '');
  const codeEl = document.getElementById('cat-code');
  const nameEl = document.getElementById('cat-name');
  const parentEl = document.getElementById('cat-parent');

  const codeRaw = finGetAccountCode(codeEl?.value || '');
  const name = String(nameEl?.value || '').trim();
  const parentCode = finGetAccountCode(parentEl?.value || '');
  const postableChoice = catGetPostableChoice();

  if (!name) {
    setCatFormMessage('El nombre es obligatorio.', true);
    return;
  }

  await openFinDB();

  if (mode === 'edit') {
    const code = editCode || codeRaw;
    const existing = finCachedData.accountsMap.get(code) || await finGet('accounts', code);
    if (!existing) {
      setCatFormMessage('No se encontró la cuenta a editar.', true);
      return;
    }
    const state = catBuildAccountRuleState(finCachedData, existing);
    if (!state || state.isRoot) {
      setCatFormMessage(FIN_ACCOUNT_CATALOG_LOCK_MESSAGE, true);
      return;
    }
    if (!state.canEditName) {
      setCatFormMessage(state.editMessage || FIN_ACCOUNT_CATALOG_STRUCTURAL_LOCK_MESSAGE, true);
      return;
    }
    const parentCodeEdit = state.parentId || finInferParentCodeFromCode(code) || '';
    if (catHasVisibleDuplicateName(finCachedData, parentCodeEdit, name, code)) {
      setCatFormMessage('Ya existe una cuenta con ese nombre bajo la misma cuenta padre.', true);
      return;
    }

    const wantsPostable = postableChoice !== 'grouping';
    if (wantsPostable && state.hasChildren) {
      setCatFormMessage(FIN_ACCOUNT_CATALOG_CHILDREN_LOCK_MESSAGE, true);
      return;
    }
    if (wantsPostable !== state.effectivePostable && !state.canChangePostable) {
      setCatFormMessage(state.hasMovements ? FIN_ACCOUNT_CATALOG_STRUCTURAL_LOCK_MESSAGE : 'No se puede cambiar la clasificación de esta cuenta.', true);
      return;
    }

    existing.nombre = name;
    existing.name = name;
    existing.isPostable = wantsPostable;
    existing.postable = wantsPostable;
    existing.noPostable = !wantsPostable;
    existing.isGrouping = !wantsPostable;
    existing.grouping = !wantsPostable;
    existing.accountMode = wantsPostable ? 'postable' : 'grouping';
    existing.isLocked = false;
    existing.systemProtected = false;
    existing.isLegacy = false;
    existing.legacy = false;
    existing.legacyFinancialAccount = false;
    existing.generatedFrom = FIN_ACCOUNT_CATALOG_SOURCE;
    existing.sourceModule = FIN_ACCOUNT_CATALOG_SOURCE;
    existing.sourceCatalog = 'Finanzas → Catálogo de Cuentas';
    existing.a33CatalogVisible = true;
    existing.a33CatalogUserCreated = true;
    existing.a33AccountCatalogVisibleMode = FIN_ACCOUNT_CATALOG_VISIBLE_MODE;
    existing.a33AccountHierarchyStage = FIN_ACCOUNTING_REDESIGN_STAGE;
    existing.a33AccountHierarchyVersion = FIN_ACCOUNT_HIERARCHY_VERSION;
    existing.updatedAt = new Date().toISOString();
    existing.updatedAtISO = existing.updatedAt;
    await finPut('accounts', existing);
    showToast('Cuenta actualizada');
    closeCatModal();
    await refreshAllFin();
    return;
  }

  const parent = catFindVisibleAccountByCode(finCachedData, parentCode);
  const parentState = parent ? catBuildAccountRuleState(finCachedData, parent) : null;
  if (!parent || !parentState || !parentState.canCreateChild) {
    setCatFormMessage((parentState && parentState.createChildMessage) || 'Cuenta padre inválida o sin espacio para más niveles.', true);
    return;
  }

  const suggestion = catGetSuggestedCodeForParent(parentCode);
  if (!suggestion.ok || !suggestion.code) {
    setCatFormMessage(suggestion.message || 'No hay códigos disponibles bajo esta cuenta padre.', true);
    return;
  }
  const code = suggestion.code;

  if (FIN_FIXED_ROOT_CODES.includes(code)) {
    setCatFormMessage('La raíz está protegida.', true);
    return;
  }
  if (catFindVisibleAccountByCode(finCachedData, code)) {
    setCatFormMessage('Ya existe una cuenta con ese código.', true);
    return;
  }
  if (catHasVisibleDuplicateName(finCachedData, parentCode, name)) {
    setCatFormMessage('Ya existe una cuenta con ese nombre bajo la misma cuenta padre.', true);
    return;
  }

  const existingInternal = await finGet('accounts', code);
  if (existingInternal && finIsCatalogManagedAccount(existingInternal) && !finIsRootAccount(existingInternal)) {
    setCatFormMessage('Ya existe una cuenta con ese código.', true);
    return;
  }

  const newAcc = catBuildAccountRowForSave({ existing: existingInternal || null, code, name, parent, postableChoice });
  await finPut('accounts', newAcc);
  showToast('Cuenta creada correctamente');
  closeCatModal();
  await refreshAllFin();
}

async function toggleCatAccount(code) {
  if (!finCachedData) await refreshAllFin();
  const c = finGetAccountCode(code);
  const acc = finCachedData.accountsMap.get(c) || await finGet('accounts', c);
  if (!acc) return;
  const state = catBuildAccountRuleState(finCachedData, acc);
  if (!state || !state.canToggleActive) {
    showToast((state && state.toggleMessage) || FIN_ACCOUNT_CATALOG_LOCK_MESSAGE);
    return;
  }

  const nextActive = !state.isActive;
  acc.isActive = nextActive;
  acc.active = nextActive;
  acc.activa = nextActive;
  acc.inactive = !nextActive;
  // Compatibilidad con filtros legacy: isHidden equivale a inactiva para registros nuevos.
  acc.isHidden = !nextActive;
  acc.updatedAt = new Date().toISOString();
  acc.updatedAtISO = acc.updatedAt;
  await openFinDB();
  await finPut('accounts', acc);
  showToast(nextActive ? 'Cuenta reactivada' : 'La cuenta se inactivó. Seguirá disponible en históricos.');
  await refreshAllFin();
}

async function deleteCatAccount(code) {
  if (!finCachedData) await refreshAllFin();
  const c = finGetAccountCode(code);
  const acc = finCachedData.accountsMap.get(c) || await finGet('accounts', c);
  if (!acc) return;
  const state = catBuildAccountRuleState(finCachedData, acc);
  if (!state || !state.canDelete) {
    showToast((state && state.deleteMessage) || 'No se puede borrar esta cuenta.');
    return;
  }
  const label = `${state.code} — ${state.nombre || state.name || 'Cuenta'}`;
  if (!confirm(`¿Borrar la cuenta ${label}?\n\nSolo se permite porque no tiene movimientos ni subcuentas.`)) return;
  await openFinDB();
  await finDelete('accounts', c);
  showToast('Cuenta borrada');
  await refreshAllFin();
}

function setupCatalogoUI() {
  catFillParentSelect();
  finSetupAccountPickerModal();

  const search = document.getElementById('cat-search');
  const btnNew = document.getElementById('cat-new');
  const btnRefresh = document.getElementById('cat-refresh');
  const btnExport = document.getElementById('cat-export');
  const tbody = document.getElementById('cat-tbody');

  const modal = document.getElementById('cat-modal');
  const closeBtn = document.getElementById('cat-modal-close');
  const cancelBtn = document.getElementById('cat-cancel');
  const saveBtn = document.getElementById('cat-save');

  const parentEl = document.getElementById('cat-parent');
  const postableEl = document.getElementById('cat-postable');

  if (search) {
    search.addEventListener('input', (e) => {
      catQuery = e.target.value || '';
      renderCatalogoCuentas(finCachedData || { accounts: [] });
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      (async () => {
        await ensureBaseAccounts();
        await normalizeAccountsCatalog();
        await refreshAllFin();
      })().catch(err => {
        console.error('Error refrescando Finanzas', err);
        alert('No se pudo actualizar Finanzas.');
      });
    });
  }

  if (btnNew) {
    btnNew.disabled = false;
    btnNew.title = 'Crear subcuenta con código automático';
    btnNew.textContent = '+ Nueva subcuenta';
    btnNew.addEventListener('click', () => {
      (async () => {
        if (!finCachedData || !catFindVisibleAccountByCode(finCachedData, '1000')) {
          await ensureBaseAccounts();
          await normalizeAccountsCatalog();
          await refreshAllFin();
        }
        setCatModalMode('new', null, '1000');
        openCatModal();
        setTimeout(() => document.getElementById('cat-name')?.focus(), 0);
      })().catch(err => {
        console.error('Error abriendo nueva cuenta del catálogo', err);
        alert('No se pudo abrir el formulario de cuenta. Presione Actualizar y vuelva a intentar.');
      });
    });
  }

  if (btnExport) {
    btnExport.addEventListener('click', (ev) => {
      ev.preventDefault();
      catExportCatalogExcel();
    });
  }

  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const add = e.target.closest('.cat-add-child');
      const edit = e.target.closest('.cat-edit');
      const tog = e.target.closest('.cat-toggle');
      const del = e.target.closest('.cat-delete');

      if (add && add.disabled) { showToast(add.title || 'No se puede agregar subcuenta.'); return; }
      if (edit && edit.disabled) { showToast(edit.title || 'No se puede editar esta cuenta.'); return; }
      if (tog && tog.disabled) { showToast(tog.title || 'No se puede cambiar el estado.'); return; }
      if (del && del.disabled) { showToast(del.title || 'No se puede borrar esta cuenta.'); return; }

      if (add && !add.disabled) {
        const code = String(add.dataset.code || '');
        setCatModalMode('new', null, code);
        openCatModal();
        setTimeout(() => document.getElementById('cat-name')?.focus(), 0);
        return;
      }

      if (edit && !edit.disabled) {
        const code = String(edit.dataset.code || '');
        const acc = catFindVisibleAccountByCode(finCachedData || {}, code) || finCachedData?.accountsMap.get(code);
        if (!acc) return;
        setCatModalMode('edit', acc);
        openCatModal();
        setTimeout(() => document.getElementById('cat-name')?.focus(), 0);
        return;
      }

      if (tog && !tog.disabled) {
        const code = String(tog.dataset.code || '');
        toggleCatAccount(code).catch(err => {
          console.error('Error activando/inactivando cuenta', err);
          alert('No se pudo actualizar la cuenta.');
        });
        return;
      }

      if (del && !del.disabled) {
        const code = String(del.dataset.code || '');
        deleteCatAccount(code).catch(err => {
          console.error('Error borrando cuenta', err);
          alert('No se pudo borrar la cuenta.');
        });
      }
    });
  }

  if (closeBtn) closeBtn.addEventListener('click', closeCatModal);
  if (cancelBtn) cancelBtn.addEventListener('click', () => { closeCatModal(); });
  if (saveBtn) saveBtn.addEventListener('click', () => { saveCatAccount().catch(err => {
    console.error('Error guardando cuenta', err);
    setCatFormMessage('No se pudo guardar. Revisa los campos e intenta de nuevo.', true);
  }); });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeCatModal();
    });
  }

  // "Editar en Compras" desde el detalle (compras a proveedor)
  const detalleMeta = $('#detalle-meta');
  if (detalleMeta) {
    detalleMeta.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-edit-compra');
      if (!btn) return;
      const id = Number(btn.dataset.entryId || '0');
      if (!id || !finCachedData) return;
      closeDetalleModal();
      try { compraStartEditFromEntryId(id); } catch (err) {
        console.error('No se pudo cargar compra para editar', err);
        alert('No se pudo abrir la compra para editar.');
      }
    });
  }

  if (parentEl) {
    parentEl.addEventListener('change', () => {
      const mode = document.getElementById('cat-mode')?.value || 'new';
      if (mode === 'new' && postableEl) postableEl.value = catDefaultPostableChoiceForParent(parentEl.value);
      catRefreshSuggestedCode();
    });
  }

  if (postableEl) {
    postableEl.addEventListener('change', () => {
      setCatFormMessage('');
    });
  }
}

/* ---------- Compras pagadas a proveedor (wizard) ---------- */

let compraMontoAuto = true; // controla auto-sinc visual hacia "Monto" (sin cambiar persistencia)
let compraMontoAutoValue = null; // último valor auto aplicado (para no pelear con el usuario)

// Etapa 2: modo edición (actualiza un asiento existente) + snapshot para productos borrados
let compraEditingEntryId = null;
// { supplierId, id, nombre, tipo, precioRef }
let compraMissingProductSnapshot = null;

function compraSetMontoAuto(enabled) {
  compraMontoAuto = !!enabled;
  if (!compraMontoAuto) compraMontoAutoValue = null;
}

function compraParseNumMaybe(v) {
  const s = String(v ?? '').trim().replace(',', '.');
  if (!s) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function compraClearCalcFields(opts = {}) {
  const tipoEl = document.getElementById('compra-prod-tipo');
  const priceEl = document.getElementById('compra-precio-unit');
  const qtyEl = document.getElementById('compra-cantidad');
  const totalEl = document.getElementById('compra-total');

  if (tipoEl) tipoEl.value = '';
  if (priceEl && !opts.keepPrice) priceEl.value = '';
  if (qtyEl && !opts.keepQty) qtyEl.value = '';
  if (totalEl) totalEl.value = '';

  if (opts.resetMontoAuto) compraSetMontoAuto(false);
  if (opts.clearMissingSnapshot) compraMissingProductSnapshot = null;
}

function compraMaybeSyncMonto(total) {
  const montoEl = document.getElementById('compra-monto');
  if (!montoEl) return;
  if (!compraMontoAuto) return;
  if (!Number.isFinite(total)) return;

  const curStr = String(montoEl.value ?? '').trim();
  const cur = compraParseNumMaybe(curStr);

  // Si está vacío o venía de auto, podemos actualizar.
  const canOverwrite = (curStr === '') || (Number.isFinite(cur) && compraMontoAutoValue != null && Math.abs(cur - compraMontoAutoValue) < 1e-9);

  if (canOverwrite) {
    montoEl.value = total.toFixed(2);
    compraMontoAutoValue = total;
    return;
  }

  // Si el usuario ya lo igualó al total, mantener auto sin tocar.
  if (Number.isFinite(cur) && Math.abs(cur - total) < 1e-9) {
    compraMontoAutoValue = total;
    return;
  }

  // Si diverge, asumimos que el usuario mandó manual.
  compraSetMontoAuto(false);
}

function compraRenderTotalCalc() {
  const priceEl = document.getElementById('compra-precio-unit');
  const qtyEl = document.getElementById('compra-cantidad');
  const totalEl = document.getElementById('compra-total');
  if (!priceEl || !qtyEl || !totalEl) return;

  const price = compraParseNumMaybe(priceEl.value);
  const qty = compraParseNumMaybe(qtyEl.value);

  const valid = Number.isFinite(price) && price >= 0 && Number.isFinite(qty) && qty >= 0;
  if (!valid) {
    totalEl.value = '';
    return;
  }

  const total = Math.max(0, price) * Math.max(0, qty);
  const currency = compraGetSelectedFinancialCurrency(finCachedData || null);
  totalEl.value = finFormatOriginalAmount(total, currency);
  compraMaybeSyncMonto(total);
  try { compraSyncFinancialAccountUI(finCachedData || null); } catch (_) {}
}

function compraProductHasPriceRef(p) {
  if (!p || typeof p !== 'object') return false;
  if (typeof p.precioSet === 'boolean') return !!p.precioSet;
  const n = normNumNonNeg(p.precio);
  return n !== 0;
}

function compraAutofillFieldsFromSelectedProduct(data, opts = {}) {
  const tipoEl = document.getElementById('compra-prod-tipo');
  const priceEl = document.getElementById('compra-precio-unit');
  const qtyEl = document.getElementById('compra-cantidad');
  const totalEl = document.getElementById('compra-total');

  const p = compraGetSelectedProduct(data);
  if (!p) {
    compraClearCalcFields({ resetMontoAuto: opts.resetMontoAuto });
    return;
  }

  if (tipoEl) tipoEl.value = String(p.tipo || '').toUpperCase().trim();

  // Precio unitario: auto solo si está vacío o si se fuerza (al seleccionar producto)
  const pref = normNumNonNeg(p.precio);
  const hasPriceRef = compraProductHasPriceRef(p);
  if (priceEl) {
    const cur = String(priceEl.value ?? '').trim();
    if (opts.forcePrice || !cur) {
      priceEl.value = hasPriceRef ? pref.toFixed(2) : '';
    }
  }

  if (qtyEl && opts.resetQty) qtyEl.value = '';
  if (totalEl && opts.resetTotal) totalEl.value = '';

  if (opts.enableMontoAuto) {
    compraMontoAutoValue = null;
    compraSetMontoAuto(true);
  }

  compraRenderTotalCalc();
}

function compraFocusCantidad() {
  const qtyEl = document.getElementById('compra-cantidad');
  if (!qtyEl || qtyEl.disabled) return;

  // iPad/Safari: diferir al siguiente tick para evitar focus perdido.
  requestAnimationFrame(() => {
    setTimeout(() => {
      try { qtyEl.focus(); } catch (_) {}
      try { if (qtyEl.select) qtyEl.select(); } catch (_) {}
    }, 0);
  });
}

function compraUpdateEditUI() {
  const btnGuardar = document.getElementById('compra-guardar');
  if (btnGuardar) btnGuardar.textContent = compraEditingEntryId ? 'Actualizar compra' : 'Guardar compra';
  const btnCancel = document.getElementById('compra-cancel-edit');
  if (btnCancel) btnCancel.classList.toggle('hidden', !compraEditingEntryId);
}

function compraEnsureOption(selectEl, value, label) {
  if (!selectEl) return;
  const v = String(value);
  if (!v) return;
  const exists = Array.from(selectEl.options).some(o => String(o.value) === v);
  if (exists) return;
  const opt = document.createElement('option');
  opt.value = v;
  opt.textContent = label || v;
  // Insertar al inicio (después del placeholder si existe)
  const first = selectEl.options[0];
  if (first) {
    selectEl.insertBefore(opt, first.nextSibling);
  } else {
    selectEl.appendChild(opt);
  }
}

function compraCancelEditMode() {
  compraEditingEntryId = null;
  compraMissingProductSnapshot = null;

  // Reset form (sin mostrar "0" por defecto)
  try { document.getElementById('compra-proveedor').value = ''; } catch (_) {}
  try { document.getElementById('compra-fecha').value = todayStr(); } catch (_) {}
  try { document.getElementById('compra-tipo').value = 'inventory'; } catch (_) {}
  try { document.getElementById('compra-medio').value = 'cash'; } catch (_) {}
  try { document.getElementById('compra-financial-account').value = ''; } catch (_) {}
  try { document.getElementById('compra-moneda').value = ''; } catch (_) {}
  try { document.getElementById('compra-tc').value = ''; } catch (_) {}
  try { document.getElementById('compra-equivalente').value = ''; } catch (_) {}
  try { document.getElementById('compra-descripcion').value = ''; } catch (_) {}
  try { document.getElementById('compra-referencia').value = ''; } catch (_) {}
  try { document.getElementById('compra-monto').value = ''; } catch (_) {}
  try { document.getElementById('compra-producto').value = ''; } catch (_) {}
  try { if (finCachedData) { compraPopulateFinancialAccountSelect(finCachedData); fillCompraCuentaDebe(finCachedData); fillCompraCuentaHaber(finCachedData); compraSyncFinancialAccountUI(finCachedData); } } catch (_) {}
  try { compraClearCalcFields({ resetMontoAuto: true, clearMissingSnapshot: true }); } catch (_) {}
  try { compraRenderProductoHint(finCachedData || null); } catch (_) {}
  try { compraRenderTotalCalc(); } catch (_) {}

  compraUpdateEditUI();
}

function compraStartEditFromEntryId(entryId) {
  if (!finCachedData) return;
  const id = Number(entryId);
  if (!Number.isFinite(id) || id <= 0) return;
  const entry = finCachedData.entries.find(e => Number(e.id) === id);
  if (!entry) return;

  // Ir a pestaña Compras
  try { setActiveFinView('compras'); } catch (_) {}

  compraEditingEntryId = id;

  const provSel = document.getElementById('compra-proveedor');
  const sid = Number(entry.supplierId || 0);
  const sName = getSupplierLabelFromEntry(entry, finCachedData);
  if (provSel && sid) {
    compraEnsureOption(provSel, sid, `⚠ ${sName}`);
    provSel.value = String(sid);
  }

  const fechaEl = document.getElementById('compra-fecha');
  if (fechaEl) fechaEl.value = String(entry.fecha || entry.date || todayStr());

  const tipoEl = document.getElementById('compra-tipo');
  if (tipoEl) tipoEl.value = String(entry.purchaseKind || 'inventory');

  const pmEl = document.getElementById('compra-medio');
  if (pmEl) pmEl.value = String(entry.paymentMethod || 'cash');

  // Asegurar listas de cuentas coherentes con tipo/medio antes de setear valores
  try { fillCompraCuentaDebe(finCachedData); } catch (_) {}
  try { fillCompraCuentaHaber(finCachedData); } catch (_) {}

  const descEl = document.getElementById('compra-descripcion');
  if (descEl) descEl.value = String(entry.descripcion || entry.description || '');

  const refEl = document.getElementById('compra-referencia');
  if (refEl) refEl.value = String(entry.reference || '').trim();

  const montoEl = document.getElementById('compra-monto');
  const amountSource = (entry.originalAmount != null || entry.montoOriginal != null || entry.totalOriginal != null)
    ? (entry.originalAmount ?? entry.montoOriginal ?? entry.totalOriginal)
    : (entry.totalDebe != null ? entry.totalDebe : (entry.total || 0));
  const amount = n2(amountSource);
  if (montoEl) montoEl.value = amount > 0 ? amount.toFixed(2) : '';

  // Cuentas desde líneas
  const lines = finCachedData.linesByEntry?.get(id) || [];
  const lDebe = lines.find(ln => n2(ln.debe) > 0) || null;
  const lHaber = lines.find(ln => n2(ln.haber) > 0) || null;
  const debeSel = document.getElementById('compra-cuenta-debe');
  const haberSel = document.getElementById('compra-cuenta-haber');
  if (debeSel && lDebe?.accountCode) {
    const code = String(lDebe.accountCode);
    const acc = findAccountByCode(finCachedData, code);
    compraEnsureOption(debeSel, code, acc ? `${code} – ${(acc.nombre || acc.name || 'Cuenta')}` : code);
    debeSel.value = code;
  }
  if (haberSel && lHaber?.accountCode) {
    const code = String(lHaber.accountCode);
    const acc = findAccountByCode(finCachedData, code);
    compraEnsureOption(haberSel, code, acc ? `${code} – ${(acc.nombre || acc.name || 'Cuenta')}` : code);
    haberSel.value = code;
  }

  // Cuenta financiera de pago (nuevas compras ya traen snapshot; históricas pueden inferirse por cuenta HABER solo al editar)
  try {
    compraPopulateFinancialAccountSelect(finCachedData);
    const faSel = document.getElementById('compra-financial-account');
    if (faSel) {
      const savedFaId = String(entry.financialAccountId || entry.cuentaFinancieraId || '').trim();
      const rows = finGetActiveFinancialAccountsForMovements(finCachedData);
      let fa = savedFaId ? rows.find(r => finGetFinancialAccountId(r) === savedFaId) : null;
      if (!fa && lHaber?.accountCode) {
        const code = finNormalizeAccountCode(lHaber.accountCode);
        fa = rows.find(r => finNormalizeAccountCode(r.cuentaContableCodigo || r.financialAccountAccountingCode || '') === code) || null;
      }
      if (fa) {
        faSel.value = finGetFinancialAccountId(fa);
        compraSyncFinancialAccountUI(finCachedData);
      }
    }
  } catch (_) {}

  // Producto (live o snapshot)
  const pid = String(entry.productoId || entry.supplierProductId || '').trim();
  if (sid && pid) {
    compraMissingProductSnapshot = {
      supplierId: sid,
      id: pid,
      nombre: entry.supplierProductName || null,
      tipo: entry.tipo || entry.supplierProductType || null,
      precioRef: (entry.supplierProductPriceRef != null) ? entry.supplierProductPriceRef : null,
      unidadesPorCaja: (entry.supplierProductUnitsPerBox != null || entry.supplierProductUnitsPerCaja != null || entry.unidadesPorCaja != null)
        ? (entry.supplierProductUnitsPerBox ?? entry.supplierProductUnitsPerCaja ?? entry.unidadesPorCaja)
        : 0
    };
  } else {
    compraMissingProductSnapshot = null;
  }

  try { compraUpdateProductoSelect(finCachedData); } catch (_) {}
  const prodSel = document.getElementById('compra-producto');
  if (prodSel) {
    if (pid) {
      compraEnsureOption(prodSel, pid, `⚠ ${compraMissingProductSnapshot?.nombre || 'Producto no disponible'}`);
      prodSel.value = pid;
    } else {
      prodSel.value = '';
    }
  }

  const tipoProdEl = document.getElementById('compra-prod-tipo');
  if (tipoProdEl) tipoProdEl.value = String(entry.tipo || entry.supplierProductType || '').trim();

  const priceEl = document.getElementById('compra-precio-unit');
  const price = n2(entry.precioUnit);
  if (priceEl) priceEl.value = price > 0 ? price.toFixed(2) : '';

  const qtyEl = document.getElementById('compra-cantidad');
  const qty = n2(entry.cantidad);
  if (qtyEl) qtyEl.value = qty > 0 ? String(qty) : '';

  // No pelear con el usuario al abrir
  compraSetMontoAuto(false);
  compraRenderProductoHint(finCachedData);
  compraRenderTotalCalc();

  compraUpdateEditUI();
  compraFocusCantidad();
}


function compraGetSelectedSupplierId() {
  const supplierIdStr = document.getElementById('compra-proveedor')?.value || '';
  const sid = Number(supplierIdStr);
  return (Number.isFinite(sid) && sid > 0) ? sid : null;
}

function compraGetSupplierProducts(data, supplierId) {
  if (!data || !data.suppliersMap || supplierId == null) return [];
  const s = data.suppliersMap.get(Number(supplierId));
  const arr = Array.isArray(s?.productos) ? s.productos : [];
  // Ya vienen normalizados en getAllFinData, pero re-normalizamos suave por seguridad.
  return arr.map(normalizeSupplierProduct);
}

function compraGetSelectedProduct(data) {
  const sid = compraGetSelectedSupplierId();
  if (!sid) return null;
  const pid = String(document.getElementById('compra-producto')?.value || '').trim();
  if (!pid) return null;
  const prods = compraGetSupplierProducts(data, sid);
  const live = prods.find(p => String(p.id) === pid) || null;
  if (live) return live;

  // Producto ya no existe en el catálogo: usar snapshot si coincide (Etapa 2 hardening)
  const snap = compraMissingProductSnapshot;
  if (snap && String(snap.id) === pid && Number(snap.supplierId) === Number(sid)) {
    return normalizeSupplierProduct({
      id: snap.id,
      nombre: snap.nombre || 'Producto no disponible',
      tipo: snap.tipo || '',
      precio: snap.precioRef,
      precioSet: (snap.precioRef != null),
      unidadesPorCaja: snap.unidadesPorCaja
    });
  }
  return null;
}

function compraRenderProductoHint(data) {
  const hint = document.getElementById('compra-producto-hint');
  if (!hint) return;

  const p = compraGetSelectedProduct(data);
  if (!p) {
    hint.textContent = '';
    return;
  }

  const tipo = String(p.tipo || '').toUpperCase().trim();
  const tipoLabel = (tipo === 'CAJAS' || tipo === 'UNIDADES') ? tipo : '—';
  const hasPriceRef = compraProductHasPriceRef(p);
  const precio = normNumNonNeg(p.precio);
  const unitsPart = (tipoLabel === 'CAJAS') ? ` · U/caja: ${pcFmtQty ? pcFmtQty(normNumNonNeg(p.unidadesPorCaja)) : String(normNumNonNeg(p.unidadesPorCaja))}` : '';
  hint.textContent = hasPriceRef
    ? `Tipo: ${tipoLabel} · Precio ref: ${finFormatOriginalAmount(precio, compraGetSelectedFinancialCurrency(data || finCachedData || null))}${unitsPart}`
    : `Tipo: ${tipoLabel} · Precio ref: —${unitsPart}`;
}

function compraUpdateProductoSelect(data) {
  const row = document.getElementById('compra-producto-row');
  const sel = document.getElementById('compra-producto');
  const hint = document.getElementById('compra-producto-hint');
  if (!row || !sel) return;

  const sid = compraGetSelectedSupplierId();
  if (!sid) {
    row.classList.add('hidden');
    sel.innerHTML = '';
    sel.value = '';
    sel.disabled = true;
    if (hint) hint.textContent = '';
    // Hardening: limpiar UI de Cantidad/Precio/Total al quedar sin proveedor
    try { compraClearCalcFields({ resetMontoAuto: true, clearMissingSnapshot: true }); } catch (_) {}
    return;
  }

  row.classList.remove('hidden');

  const productos = compraGetSupplierProducts(data, sid)
    .slice()
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

  const snap = (compraMissingProductSnapshot && Number(compraMissingProductSnapshot.supplierId) === Number(sid)) ? compraMissingProductSnapshot : null;

  const prev = String(sel.value || '').trim();
  sel.innerHTML = '';

  if (!productos.length) {
    if (snap && snap.id != null) {
      // Hardening: proveedor sin catálogo pero la compra tiene producto snapshot
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = '— Seleccione (opcional) —';
      sel.appendChild(opt0);

      const optS = document.createElement('option');
      optS.value = String(snap.id);
      const name = snap.nombre ? String(snap.nombre) : 'Producto no disponible';
      optS.textContent = `⚠ ${name}`;
      sel.appendChild(optS);

      sel.disabled = false;
      sel.value = prev === String(snap.id) ? prev : String(snap.id);
      compraRenderProductoHint(data);
      return;
    }

    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin productos';
    sel.appendChild(opt);
    sel.value = '';
    sel.disabled = true;
    if (hint) hint.textContent = '';
    // Si no hay catálogo, mantener campos vacíos (sin crashes)
    try { compraClearCalcFields({ resetMontoAuto: true, clearMissingSnapshot: true }); } catch (_) {}
    return;
  }

  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Seleccione (opcional) —';
  sel.appendChild(opt0);

  for (const p of productos) {
    const opt = document.createElement('option');
    opt.value = String(p.id || '');
    opt.textContent = p.nombre || '—';
    sel.appendChild(opt);
  }

  // Si el producto seleccionado ya no existe, agregar opción snapshot (sin romper selección)
  if (snap && snap.id != null) {
    const sidValue = String(snap.id);
    const exists = Array.from(sel.options).some(o => o.value === sidValue);
    if (!exists) {
      const optS = document.createElement('option');
      optS.value = sidValue;
      const name = snap.nombre ? String(snap.nombre) : 'Producto no disponible';
      optS.textContent = `⚠ ${name}`;
      sel.appendChild(optS);
    }
  }

  sel.disabled = false;
  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  else sel.value = '';

  compraRenderProductoHint(data);
  // Mantener Tipo/Precio/Total coherentes si hay producto seleccionado (sin pisar precio manual)
  try { compraAutofillFieldsFromSelectedProduct(data, { forcePrice: false, resetQty: false, resetTotal: false, enableMontoAuto: false }); } catch (_) {}
}

function compraTryPrefillDescripcionFromProducto(data) {
  const p = compraGetSelectedProduct(data);
  if (!p) return;
  const descEl = document.getElementById('compra-descripcion');
  if (!descEl) return;
  const cur = String(descEl.value || '').trim();
  if (cur) return; // NO sobrescribir
  if (p.nombre) descEl.value = p.nombre;
}

function findAccountByCode(data, code) {
  if (!data || !Array.isArray(data.accounts)) return null;
  return data.accounts.find(a => String(a.code) === String(code)) || null;
}

function fillCompraCuentaDebe(data) {
  const sel = document.getElementById('compra-cuenta-debe');
  if (!sel || !data) return;

  const tipoCompra = document.getElementById('compra-tipo')?.value || 'inventory';
  const cuentas = [...data.accounts].sort((a, b) => String(a.code).localeCompare(String(b.code)));

  sel.innerHTML = '<option value="">Seleccione cuenta…</option>';

  for (const acc of cuentas) {
    // Cuentas inactivas y agrupadoras no deben aparecer en selects para movimientos nuevos.
    if (!finIsActiveAccount(acc) || (acc && acc.isHidden === true) || !finIsPostableAccount(acc)) continue;

    const tipo = getTipoCuenta(acc);
    const code = String(acc.code);
    const nombre = acc.nombre || acc.name || `Cuenta ${acc.code}`;

    let permitido = false;
    if (tipoCompra === 'inventory') {
      // Inventarios: preferimos 14xx y nombres con inventario
      permitido = (tipo === 'activo' && (code.startsWith('14') || normStr(nombre).includes('inventario')));
    } else {
      // Gasto inmediato: gastos y costos
      permitido = (tipo === 'gasto' || tipo === 'costo');
    }

    if (!permitido) continue;

    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} – ${nombre}`;
    sel.appendChild(opt);
  }

  // Defaults
  const defaultCode = (tipoCompra === 'inventory') ? '1400' : '6100';
  if (Array.from(sel.options).some(o => o.value === defaultCode)) {
    sel.value = defaultCode;
  } else if (sel.options.length > 1) {
    sel.selectedIndex = 1;
  }
}

function fillCompraCuentaHaber(data) {
  const sel = document.getElementById('compra-cuenta-haber');
  if (!sel || !data) return;

  const pm = document.getElementById('compra-medio')?.value || 'cash';
  const cuentas = [...data.accounts].sort((a, b) => String(a.code).localeCompare(String(b.code)));

  sel.innerHTML = '<option value="">Seleccione cuenta…</option>';

  for (const acc of cuentas) {
    // Cuentas inactivas y agrupadoras no deben aparecer en selects para movimientos nuevos.
    if (!finIsActiveAccount(acc) || (acc && acc.isHidden === true) || !finIsPostableAccount(acc)) continue;

    const tipo = getTipoCuenta(acc);
    const code = String(acc.code);
    const nombre = acc.nombre || acc.name || `Cuenta ${acc.code}`;

    // Permitimos activos, pero priorizamos caja/banco
    if (tipo !== 'activo') continue;

    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = `${code} – ${nombre}`;
    sel.appendChild(opt);
  }

  const defaultCode = finResolveLegacyCashOrBankCodeByMedium(pm);
  if (Array.from(sel.options).some(o => o.value === defaultCode)) {
    sel.value = defaultCode;
  } else if (sel.options.length > 1) {
    sel.selectedIndex = 1;
  }
}


/* ---------- Compras a Proveedor: cuenta financiera / moneda / T.C. (Etapa 7/10) ---------- */

const FIN_PURCHASE_WARNING_MESSAGE = 'Configure el tipo de cambio vigente en Configuración → Moneda para registrar compras en US$.';

function compraFinancialAccountOptionLabel(row) {
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || 'Cuenta financiera').trim();
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || finCurrencySymbol(currency));
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  return `${name} · ${symbol} · ${code}${accName ? ' ' + accName : ''}`;
}

function compraPopulateFinancialAccountSelect(data) {
  const sel = document.getElementById('compra-financial-account');
  if (!sel) return;
  const prev = String(sel.value || '').trim();
  const rows = finGetActiveFinancialAccountsForMovements(data);
  sel.innerHTML = '';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = rows.length ? 'Seleccione cuenta financiera…' : 'Sin cuentas financieras activas';
  sel.appendChild(first);

  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = finGetFinancialAccountId(row);
    opt.textContent = compraFinancialAccountOptionLabel(row);
    opt.dataset.currency = finNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
    opt.dataset.accountCode = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
    sel.appendChild(opt);
  }

  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  else if (!sel.value && rows.length === 1) sel.value = finGetFinancialAccountId(rows[0]);

  compraSyncFinancialAccountUI(data);
}

function compraGetSelectedFinancialAccount(data) {
  const sel = document.getElementById('compra-financial-account');
  const id = String(sel && sel.value || '').trim();
  if (!id) return null;
  return finFindFinancialAccountById(data, id);
}

function compraGetSelectedFinancialCurrency(data) {
  const row = compraGetSelectedFinancialAccount(data || finCachedData || null);
  return finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
}

function compraGetCurrentOriginalTotal() {
  const priceN = compraParseNumMaybe(document.getElementById('compra-precio-unit')?.value || '');
  const qtyN = compraParseNumMaybe(document.getElementById('compra-cantidad')?.value || '');
  const calcValid = Number.isFinite(priceN) && priceN >= 0 && Number.isFinite(qtyN) && qtyN >= 0;
  if (calcValid) return Math.max(0, priceN) * Math.max(0, qtyN);
  const montoRaw = document.getElementById('compra-monto')?.value || '';
  const monto = compraParseNumMaybe(montoRaw);
  return (Number.isFinite(monto) && monto >= 0) ? monto : NaN;
}

function compraEnsureHaberOptionForFinancialAccount(row, data) {
  const sel = document.getElementById('compra-cuenta-haber');
  if (!sel || !row) return;
  const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
  if (!code) return;
  const acc = (data && data.accountsMap && data.accountsMap.get(code)) ? data.accountsMap.get(code) : null;
  compraEnsureOption(sel, code, acc ? `${code} – ${(acc.nombre || acc.name || 'Cuenta')}` : compraFinancialAccountOptionLabel(row));
  sel.value = code;
}

function compraSyncFinancialAccountUI(data) {
  const row = compraGetSelectedFinancialAccount(data || finCachedData || null);
  const pmEl = document.getElementById('compra-medio');
  const monedaEl = document.getElementById('compra-moneda');
  const tcEl = document.getElementById('compra-tc');
  const eqEl = document.getElementById('compra-equivalente');

  if (pmEl && row) {
    const type = String(row.type || row.tipo || '').toLowerCase();
    pmEl.value = type === 'banco' ? 'bank' : 'cash';
  }

  if (row) compraEnsureHaberOptionForFinancialAccount(row, data || finCachedData || null);

  const currency = row ? finNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO') : '';
  if (monedaEl) monedaEl.value = row ? `${finCurrencySymbol(currency)} / ${currency}` : '';

  const amount = compraGetCurrentOriginalTotal();
  const snapshot = row ? finBuildExchangeRateSnapshot({ currency, amount: Number.isFinite(amount) ? amount : 0 }) : null;

  if (tcEl) {
    tcEl.value = (row && currency === 'USD' && snapshot && snapshot.tipoCambioUsado)
      ? Number(snapshot.tipoCambioUsado).toFixed(2)
      : '';
  }
  if (eqEl) {
    const hasAmount = Number.isFinite(amount) && amount > 0;
    eqEl.value = (row && hasAmount && snapshot && Number.isFinite(Number(snapshot.equivalenteNIO)))
      ? finFormatCordobas(snapshot.equivalenteNIO)
      : '';
  }

  compraUpdateFinancialPreview(data || finCachedData || null, row, snapshot);
}

function compraUpdateFinancialPreview(data, row, snapshotArg) {
  const box = document.getElementById('compra-financial-meta');
  if (!box) return;
  const rows = finGetActiveFinancialAccountsForMovements(data || {});
  if (!rows.length) {
    box.className = 'fin-movement-meta compra-financial-meta is-warn';
    box.textContent = 'Configure al menos una cuenta financiera activa antes de registrar compras.';
    return;
  }
  if (!row) {
    box.className = 'fin-movement-meta compra-financial-meta';
    box.textContent = 'Seleccione una cuenta financiera activa para detectar moneda, T/C y cuenta contable de pago.';
    return;
  }

  const currency = finNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
  const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
  const accName = String(row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '').trim();
  const name = String(row.nombreVisible || row.financialAccountNameSnapshot || 'Cuenta financiera').trim();
  const amount = compraGetCurrentOriginalTotal();
  const snapshot = snapshotArg || finBuildExchangeRateSnapshot({ currency, amount: Number.isFinite(amount) ? amount : 0 });

  if (currency === 'USD' && (!snapshot || snapshot.ok === false)) {
    box.className = 'fin-movement-meta compra-financial-meta is-warn';
    box.textContent = FIN_PURCHASE_WARNING_MESSAGE;
    return;
  }

  const amountText = Number.isFinite(amount) && amount > 0 ? ` · Total original: ${finFormatOriginalAmount(amount, currency)}` : '';
  const rateText = currency === 'USD' && snapshot && snapshot.tipoCambioUsado ? ` · T/C snapshot ${Number(snapshot.tipoCambioUsado).toFixed(2)}` : '';
  const eqText = Number.isFinite(amount) && amount > 0 && snapshot && Number.isFinite(Number(snapshot.equivalenteNIO)) ? ` · Eq. ${finFormatCordobas(snapshot.equivalenteNIO)}` : '';
  box.className = 'fin-movement-meta compra-financial-meta';
  box.innerHTML = `${escapeHtml(name)} · ${escapeHtml(finFinancialAccountTypeLabel(row.type || row.tipo))} · ${escapeHtml(finCurrencySymbol(currency))} / ${escapeHtml(currency)} · HABER ${escapeHtml(code)} ${escapeHtml(accName)}${escapeHtml(amountText + rateText + eqText)}`;
}

function compraBuildPurchaseFinancialSnapshot(row, originalAmount, baseAmountNio, exchangeSnapshot) {
  const currency = finNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const type = String(row && (row.type || row.tipo || 'caja') || 'caja').toLowerCase();
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || '').trim();
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || finCurrencySymbol(currency));
  const rate = currency === 'USD' ? finRoundCurrency2(exchangeSnapshot && exchangeSnapshot.tipoCambioUsado) : null;
  const rateDate = currency === 'USD' ? String((exchangeSnapshot && exchangeSnapshot.fechaTipoCambio) || '') : '';
  const roundedOriginal = finRoundCurrency2(originalAmount);
  const roundedBase = finRoundCurrency2(baseAmountNio);
  return {
    financialAccountId: finGetFinancialAccountId(row),
    financialAccountNameSnapshot: name,
    financialAccountType: type,
    financialAccountCurrency: currency,
    financialAccountSymbol: symbol,
    financialAccountAccountingCode: code,
    financialAccountAccountingNameSnapshot: accName,
    originalCurrency: currency,
    originalSymbol: symbol,
    originalAmount: roundedOriginal,
    exchangeRateUsed: rate,
    exchangeRateDateSnapshot: rateDate,
    exchangeRateSource: currency === 'USD' ? FIN_CURRENCY_SOURCE_LABEL : '',
    baseCurrency: 'NIO',
    baseAmountNio: roundedBase,
    isMulticurrency: currency === 'USD',
    purchasePaymentSource: 'financial_account',

    // Aliases en español / conceptuales para reportes e históricos.
    cuentaFinancieraId: finGetFinancialAccountId(row),
    cuentaFinancieraNombreSnapshot: name,
    cuentaFinancieraTipo: type,
    cuentaFinancieraMoneda: currency,
    cuentaFinancieraSimbolo: symbol,
    cuentaFinancieraCodigoContable: code,
    cuentaFinancieraNombreContableSnapshot: accName,
    monedaOriginal: currency,
    simboloOriginal: symbol,
    montoOriginal: roundedOriginal,
    totalOriginal: roundedOriginal,
    tipoCambioUsado: rate,
    fechaTipoCambio: rateDate,
    fuenteTipoCambio: currency === 'USD' ? FIN_CURRENCY_SOURCE_LABEL : '',
    monedaBase: 'NIO',
    equivalenteNIO: roundedBase,
    baseAmount: roundedBase
  };
}

async function guardarCompraProveedor() {
  if (!finCachedData) await refreshAllFin();

  const supplierIdStr = document.getElementById('compra-proveedor')?.value || '';
  const fecha = document.getElementById('compra-fecha')?.value || todayStr();
  const tipoCompra = document.getElementById('compra-tipo')?.value || 'inventory';
  const financialRows = finGetActiveFinancialAccountsForMovements(finCachedData);
  const financialAccount = compraGetSelectedFinancialAccount(finCachedData);
  const financialType = String(financialAccount && (financialAccount.type || financialAccount.tipo || '') || '').toLowerCase();
  const pm = financialAccount ? (financialType === 'banco' ? 'bank' : 'cash') : (document.getElementById('compra-medio')?.value || 'cash');
  const montoRaw = document.getElementById('compra-monto')?.value || '';
  const debeCode = document.getElementById('compra-cuenta-debe')?.value || '';
  let haberCode = '';
  const desc = (document.getElementById('compra-descripcion')?.value || '').trim();
  const ref = (document.getElementById('compra-referencia')?.value || '').trim();

  // Cálculo robusto: Total = (cantidad*precioUnit) si es válido; si no, usar Monto como fallback (compatibilidad)
  const priceN = compraParseNumMaybe(document.getElementById('compra-precio-unit')?.value || '');
  const qtyN = compraParseNumMaybe(document.getElementById('compra-cantidad')?.value || '');
  const calcValid = Number.isFinite(priceN) && priceN >= 0 && Number.isFinite(qtyN) && qtyN >= 0;
  const calcTotal = calcValid ? (Math.max(0, priceN) * Math.max(0, qtyN)) : NaN;
  const montoFallback = compraParseNumMaybe(montoRaw);
  const total = Number.isFinite(calcTotal) ? calcTotal : ((Number.isFinite(montoFallback) && montoFallback >= 0) ? montoFallback : 0);
  const monto = total;

  if (!supplierIdStr) {
    alert('Selecciona un proveedor.');
    return;
  }
  const supplierId = Number(supplierIdStr);
  const supplierObj = finCachedData.suppliersMap ? finCachedData.suppliersMap.get(supplierId) : null;
  const supplierName = (supplierObj && supplierObj.nombre) ? supplierObj.nombre : `Proveedor ${supplierId}`;

  if (!fecha) {
    alert('Ingresa la fecha.');
    return;
  }
  if (!(monto > 0)) {
    alert('El total debe ser mayor que cero.');
    return;
  }
  if (!debeCode) {
    alert('Selecciona la cuenta DEBE.');
    return;
  }
  if (!financialRows.length) {
    alert('Configure al menos una cuenta financiera activa antes de registrar compras.');
    return;
  }
  if (!financialAccount) {
    alert('Selecciona la cuenta financiera de pago.');
    return;
  }
  if (financialAccount.activa === false) {
    alert('La cuenta financiera seleccionada está inactiva.');
    return;
  }

  const financialCode = finNormalizeAccountCode(financialAccount.cuentaContableCodigo || financialAccount.financialAccountAccountingCode || '');
  const financialAccountRecord = financialCode && finCachedData.accountsMap ? finCachedData.accountsMap.get(financialCode) : null;
  if (!financialCode || !financialAccountRecord) {
    alert('La cuenta financiera seleccionada no tiene una cuenta contable válida asociada. Revise Cuentas Financieras.');
    return;
  }
  if (String(debeCode) === String(financialCode)) {
    alert('La cuenta DEBE no puede ser la misma cuenta financiera de pago.');
    return;
  }

  haberCode = financialCode;
  const financialCurrency = finNormalizeCurrencyCode(financialAccount.moneda || financialAccount.financialAccountCurrency || 'NIO');
  const exchangeSnapshot = finBuildExchangeRateSnapshot({ currency: financialCurrency, amount: monto });
  if (!exchangeSnapshot || exchangeSnapshot.ok === false) {
    alert(financialCurrency === 'USD' ? FIN_PURCHASE_WARNING_MESSAGE : (exchangeSnapshot && exchangeSnapshot.warningMessage) || 'El equivalente contable en C$ es inválido.');
    return;
  }
  const baseAmountNio = finRoundCurrency2(exchangeSnapshot.equivalenteNIO);
  if (!(Number.isFinite(baseAmountNio) && baseAmountNio > 0)) {
    alert('El equivalente contable en C$ es inválido.');
    return;
  }
  const purchaseFinancialSnapshot = compraBuildPurchaseFinancialSnapshot(financialAccount, monto, baseAmountNio, exchangeSnapshot);
  const totalDebe = finRoundCurrency2(baseAmountNio);
  const totalHaber = finRoundCurrency2(baseAmountNio);

  // Producto asistido (opcional) + snapshot robusto (si luego se borra del proveedor)
  const productId = String(document.getElementById('compra-producto')?.value || '').trim();
  let productSnapshot = null;
  if (productId) {
    try {
      const p = compraGetSelectedProduct(finCachedData);
      if (p) {
        const hasPriceRef = compraProductHasPriceRef(p);
        const tipoProd = String((p.tipo || 'UNIDADES')).toUpperCase();
        productSnapshot = {
          id: String(p.id || ''),
          nombre: String(p.nombre || ''),
          tipo: tipoProd,
          precio: hasPriceRef ? normNumNonNeg(p.precio) : null,
          precioSet: hasPriceRef,
          unidadesPorCaja: (tipoProd === 'CAJAS') ? normNumNonNeg(p.unidadesPorCaja) : 0
        };
      }
    } catch (_) {
      productSnapshot = null;
    }
  }

  const prodSelEl = document.getElementById('compra-producto');
  const prodOptLabelRaw = prodSelEl ? String(prodSelEl.selectedOptions?.[0]?.textContent || '') : '';
  const prodOptLabel = prodOptLabelRaw.replace(/^⚠\s*/, '').trim();

  // Snapshots desde UI (por si el producto fue eliminado y no hay catálogo live)
  const tipoSnapUI = String(document.getElementById('compra-prod-tipo')?.value || '').trim().toUpperCase();
  const tipoSnap = (tipoSnapUI === 'CAJAS' || tipoSnapUI === 'UNIDADES') ? tipoSnapUI : (productSnapshot ? String(productSnapshot.tipo || '').toUpperCase() : '—');
  const precioUnit = (Number.isFinite(priceN) && priceN >= 0) ? priceN : 0;
  const cantidad = (Number.isFinite(qtyN) && qtyN >= 0) ? qtyN : 0;

  const isEdit = (compraEditingEntryId != null);
  const existing = (isEdit && finCachedData && Array.isArray(finCachedData.entries))
    ? (finCachedData.entries.find(e => Number(e.id) === Number(compraEditingEntryId)) || null)
    : null;
  const entryBase = existing ? { ...existing } : {};
  const sameSupplierOnEdit = !!(isEdit && String(entryBase.supplierId ?? '') === String(supplierId));
  const existingProductId = String(entryBase.supplierProductId || entryBase.productoId || '').trim();
  const sameProductOnEdit = !!(sameSupplierOnEdit && existingProductId && String(existingProductId) === String(productId || ''));
  const supplierNameForEntry = (sameSupplierOnEdit && String(entryBase.supplierName || '').trim())
    ? String(entryBase.supplierName).trim()
    : supplierName;

  const entryBaseUnitsFallback = (entryBase && (entryBase.supplierProductUnitsPerBox != null || entryBase.supplierProductUnitsPerCaja != null || entryBase.unidadesPorCaja != null))
    ? (entryBase.supplierProductUnitsPerBox ?? entryBase.supplierProductUnitsPerCaja ?? entryBase.unidadesPorCaja)
    : null;
  const missingUnitsFallback = (compraMissingProductSnapshot && Number(compraMissingProductSnapshot.supplierId) === Number(supplierId) && String(compraMissingProductSnapshot.id || '') === String(productId || ''))
    ? compraMissingProductSnapshot.unidadesPorCaja
    : null;
  const unidadesPorCajaSnap = (sameProductOnEdit && entryBaseUnitsFallback != null)
    ? normNumNonNeg(entryBaseUnitsFallback)
    : (productSnapshot
      ? normNumNonNeg(productSnapshot.unidadesPorCaja)
      : normNumNonNeg(missingUnitsFallback ?? entryBaseUnitsFallback));
  const productNameForEntry = (sameProductOnEdit && String(entryBase.supplierProductName || '').trim())
    ? String(entryBase.supplierProductName).trim()
    : (productSnapshot ? productSnapshot.nombre : ((prodOptLabel || null) || (entryBase.supplierProductName || null)));
  const productTypeForEntry = (sameProductOnEdit && String(entryBase.supplierProductType || entryBase.tipo || '').trim())
    ? String(entryBase.supplierProductType || entryBase.tipo).trim().toUpperCase()
    : (productSnapshot ? productSnapshot.tipo : (tipoSnap || entryBase.tipo || entryBase.supplierProductType || null));
  const productPriceRefForEntry = (sameProductOnEdit && Object.prototype.hasOwnProperty.call(entryBase, 'supplierProductPriceRef'))
    ? entryBase.supplierProductPriceRef
    : (productSnapshot ? productSnapshot.precio : (entryBase.supplierProductPriceRef || null));

  // Si el producto no existe en catálogo pero sí está seleccionado, guardar snapshot para no crashear al reabrir.
  if (productId && !productSnapshot) {
    compraMissingProductSnapshot = {
      supplierId,
      id: productId,
      nombre: desc || null,
      tipo: tipoSnapUI || null,
      precioRef: null,
      unidadesPorCaja: unidadesPorCajaSnap
    };
  } else if (productSnapshot) {
    compraMissingProductSnapshot = {
      supplierId,
      id: productSnapshot.id,
      nombre: productSnapshot.nombre,
      tipo: productSnapshot.tipo,
      precioRef: productSnapshot.precio,
      unidadesPorCaja: productSnapshot.unidadesPorCaja
    };
  }


  const entry = {
    ...entryBase,
    ...(isEdit ? { id: Number(compraEditingEntryId) } : null),
    fecha,
    descripcion: desc || `Compra a proveedor: ${supplierNameForEntry}`,
    tipoMovimiento: 'egreso',
    evento: normalizeEventForPurchases(),
    origen: 'Interno',
    origenId: null,
    totalDebe,
    totalHaber,

    // Metadata compras
    entryType: 'purchase',
    purchaseKind: tipoCompra,
    supplierId,
    supplierName: supplierNameForEntry,
    paymentMethod: pm,
    paymentAccountSource: 'financial_account',
    reference: ref,
    ...purchaseFinancialSnapshot,

    // Producto asistido (opcional) - snapshot para robustez (si luego se borra del proveedor)
    supplierProductId: productSnapshot ? productSnapshot.id : (productId || null),
    supplierProductName: productNameForEntry,
    supplierProductType: productTypeForEntry,
    supplierProductPriceRef: productPriceRefForEntry,
    supplierProductUnitsPerBox: unidadesPorCajaSnap,
    supplierProductUnitsPerCaja: unidadesPorCajaSnap,
    supplierProductPriceUsed: precioUnit,

    // Etapa 2: campos persistidos del flujo Cantidad/PrecioUnit/Total (compatibles con registros viejos)
    productoId: productId || null,
    tipo: productTypeForEntry || tipoSnap || entryBase.tipo || entryBase.supplierProductType || null,
    unidadesPorCaja: unidadesPorCajaSnap,
    precioUnit,
    cantidad,
    total
  };
  // Guardado atómico: o se guarda TODO (asiento + líneas) o no se guarda NADA.
  try {
    const lines = [
      { accountCode: String(debeCode), debe: totalDebe, haber: 0, originalAmount: finRoundCurrency2(monto), originalCurrency: financialCurrency, financialAccountId: finGetFinancialAccountId(financialAccount), exchangeRateUsed: purchaseFinancialSnapshot.exchangeRateUsed },
      { accountCode: String(haberCode), debe: 0, haber: totalHaber, originalAmount: finRoundCurrency2(monto), originalCurrency: financialCurrency, financialAccountId: finGetFinancialAccountId(financialAccount), exchangeRateUsed: purchaseFinancialSnapshot.exchangeRateUsed }
    ];

    if (isEdit) {
      await updateJournalEntryWithLinesAtomic(Number(compraEditingEntryId), entry, lines);
    } else {
      await createJournalEntryWithLinesAtomic(entry, lines);
    }
  } catch (err) {
    console.error('Error en guardado atómico de compra', err);
    alert('No se pudo guardar la compra (guardado atómico falló).');
    return;
  }

  // Limpieza parcial
  const montoEl = document.getElementById('compra-monto');
  const descEl = document.getElementById('compra-descripcion');
  const refEl = document.getElementById('compra-referencia');
  const prodEl = document.getElementById('compra-producto');
  const prodHint = document.getElementById('compra-producto-hint');
  if (montoEl) montoEl.value = '';
  if (descEl) descEl.value = '';
  if (refEl) refEl.value = '';
  if (prodEl) prodEl.value = '';
  if (prodHint) prodHint.textContent = '';

  // Limpiar UI de Cantidad/Precio/Total (Etapa 1)
  try { compraClearCalcFields({ resetMontoAuto: true, clearMissingSnapshot: true }); } catch (_) {}

  // Salir de modo edición
  compraEditingEntryId = null;
  compraUpdateEditUI();

  showToast(isEdit ? 'Compra actualizada' : 'Compra guardada');
  await refreshAllFin();
}

function getComprasPeriodo() {
  const modo = document.getElementById('compras-modo')?.value || 'mes';

  if (modo === 'mes') {
    const mes = document.getElementById('compras-mes')?.value || pad2(new Date().getMonth() + 1);
    const anio = document.getElementById('compras-anio')?.value || String(new Date().getFullYear());
    const { start, end } = monthRange(Number(anio), Number(mes));
    return { desde: start, hasta: end, modo: 'mes' };
  }

  let desde = document.getElementById('compras-desde')?.value || todayStr();
  let hasta = document.getElementById('compras-hasta')?.value || desde;
  if (hasta < desde) {
    const tmp = desde;
    desde = hasta;
    hasta = tmp;
  }
  return { desde, hasta, modo: 'rango' };
}

function renderComprasPorProveedor(data) {
  const tbody = document.getElementById('compras-tbody');
  const ayuda = document.getElementById('compras-ayuda');
  if (!tbody) return;

  tbody.innerHTML = '';

  const periodo = getComprasPeriodo();
  const supplierFilter = document.getElementById('compras-proveedor')?.value || 'ALL';

  const entries = (data && Array.isArray(data.entries)) ? data.entries : [];
  const purchases = entries.filter(e => (e && e.entryType === 'purchase'));

  const inRange = purchases.filter(e => {
    const f = e.fecha || e.date || '';
    if (periodo.desde && f < periodo.desde) return false;
    if (periodo.hasta && f > periodo.hasta) return false;
    if (supplierFilter !== 'ALL') {
      return String(e.supplierId || '') === String(supplierFilter);
    }
    return true;
  });

  if (!inRange.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="5">Sin compras registradas en el periodo seleccionado.</td>`;
    tbody.appendChild(tr);
    if (ayuda) ayuda.textContent = '';
    return;
  }

  const map = new Map(); // supplierId -> agg
  for (const e of inRange) {
    const key = String(e.supplierId || '');
    const name = getSupplierLabelFromEntry(e, data);
    if (!map.has(key)) {
      map.set(key, { supplierId: key, supplier: name, count: 0, totalBase: 0, originals: new Map(), accounts: new Set(), rates: new Set() });
    }
    const b = map.get(key);
    const baseAmt = finParseCurrencyAmount(e.baseAmountNio ?? e.equivalenteNIO ?? e.totalDebe ?? e.totalHaber ?? 0) || 0;
    const currency = finNormalizeCurrencyCode(e.originalCurrency || e.monedaOriginal || e.financialAccountCurrency || e.cuentaFinancieraMoneda || 'NIO');
    const origAmtParsed = finParseCurrencyAmount(e.originalAmount ?? e.montoOriginal ?? e.totalOriginal ?? baseAmt);
    const origAmt = Number.isFinite(origAmtParsed) ? origAmtParsed : baseAmt;
    b.count += 1;
    b.totalBase += baseAmt;
    b.originals.set(currency, (b.originals.get(currency) || 0) + origAmt);

    const faName = String(e.financialAccountNameSnapshot || e.cuentaFinancieraNombreSnapshot || '').trim();
    if (faName) b.accounts.add(faName);
    else {
      const pm = String(e.paymentMethod || '').trim();
      b.accounts.add(pm === 'bank' ? 'Banco legacy' : 'Caja legacy');
    }
    const rate = finParseCurrencyAmount(e.exchangeRateUsed ?? e.tipoCambioUsado ?? '');
    if (currency === 'USD' && Number.isFinite(rate) && rate > 0) b.rates.add(Number(rate).toFixed(2));
  }

  const rows = Array.from(map.values()).sort((a, b) => a.supplier.localeCompare(b.supplier, 'es'));

  for (const r of rows) {
    const originalParts = Array.from(r.originals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([currency, amount]) => `<span class="fin-pill ${currency === 'USD' ? 'fin-pill--gold' : 'fin-pill--cash'}">${escapeHtml(finFormatOriginalAmount(amount, currency))}</span>`);
    const accountParts = Array.from(r.accounts).slice(0, 3).map(name => `<span class="fin-pill fin-pill--muted">${escapeHtml(name)}</span>`);
    if (r.accounts.size > 3) accountParts.push(`<span class="fin-pill fin-pill--muted">+${r.accounts.size - 3}</span>`);
    const rateParts = Array.from(r.rates).slice(0, 2).map(rate => `<span class="fin-pill fin-pill--muted">T/C ${escapeHtml(rate)}</span>`);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(r.supplier)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${finFormatCordobas(r.totalBase)}</td>
      <td><div class="fin-badge-strip">${originalParts.concat(rateParts).join(' ') || '<span class="fin-pill fin-pill--muted">—</span>'}</div></td>
      <td><div class="fin-badge-strip">${accountParts.join(' ') || '<span class="fin-pill fin-pill--muted">Legacy</span>'}</div></td>
    `;
    tbody.appendChild(tr);
  }

  const totalAll = rows.reduce((s, r) => s + r.totalBase, 0);
  const cntAll = rows.reduce((s, r) => s + r.count, 0);
  if (ayuda) {
    ayuda.textContent = `Periodo: ${periodo.desde} → ${periodo.hasta} · Compras: ${cntAll} · Total contable: ${finFormatCordobas(totalAll)}`;
  }
}

function setupComprasUI() {
  // Toggle modo periodo reporte
  const modoSel = document.getElementById('compras-modo');
  const contMes = document.getElementById('compras-filtros-mes');
  const contRango = document.getElementById('compras-filtros-rango');

  const updateModo = () => {
    const modo = modoSel?.value || 'mes';
    if (modo === 'mes') {
      contMes?.classList.remove('hidden');
      contRango?.classList.add('hidden');
    } else {
      contMes?.classList.add('hidden');
      contRango?.classList.remove('hidden');
    }
  };

  if (modoSel) {
    modoSel.addEventListener('change', () => {
      updateModo();
      if (finCachedData) renderComprasPorProveedor(finCachedData);
    });
    updateModo();
  }

  ['compras-mes', 'compras-anio', 'compras-desde', 'compras-hasta', 'compras-proveedor'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) renderComprasPorProveedor(finCachedData);
    });
  });

  // Form compra
  const btnGuardar = document.getElementById('compra-guardar');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      guardarCompraProveedor().catch(err => {
        console.error('Error guardando compra proveedor', err);
        alert('No se pudo guardar la compra.');
      });
    });
  }

  // Botón cancelar edición (se inserta al lado del Guardar si no existe)
  if (btnGuardar) {
    let btnCancel = document.getElementById('compra-cancel-edit');
    if (!btnCancel) {
      btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.id = 'compra-cancel-edit';
      btnCancel.className = 'btn btn-ghost hidden';
      btnCancel.textContent = 'Cancelar edición';
      btnGuardar.insertAdjacentElement('afterend', btnCancel);
    }
    btnCancel.addEventListener('click', () => {
      try { compraCancelEditMode(); } catch (err) {
        console.error('Error cancelando edición', err);
      }
    });
    compraUpdateEditUI();
  }

  // Producto asistido por proveedor
  const provSel = document.getElementById('compra-proveedor');
  if (provSel) {
    provSel.addEventListener('change', () => {
      // Hardening: al cambiar proveedor, limpiar campos calculados
      try { compraClearCalcFields({ resetMontoAuto: true, clearMissingSnapshot: true }); } catch (_) {}
      if (finCachedData) compraUpdateProductoSelect(finCachedData);
    });
  }

  const prodSel = document.getElementById('compra-producto');
  if (prodSel) {
    prodSel.addEventListener('change', () => {
      if (!finCachedData) return;
      compraRenderProductoHint(finCachedData);
      compraTryPrefillDescripcionFromProducto(finCachedData);

      // Autofill Tipo/Precio + reset qty/total y foco a Cantidad (Etapa 1)
      try {
        compraAutofillFieldsFromSelectedProduct(finCachedData, {
          forcePrice: true,
          resetQty: true,
          resetTotal: true,
          enableMontoAuto: true,
          resetMontoAuto: false
        });
      } catch (_) {}

      const chosen = String(prodSel.value || '').trim();
      if (chosen) {
        try { compraFocusCantidad(); } catch (_) {}
      }
    });
  }

  // Recalculo en vivo: Cantidad x Precio unitario = Total
  const priceEl = document.getElementById('compra-precio-unit');
  const qtyEl = document.getElementById('compra-cantidad');

  // iPad/Safari: tap/focus con auto select-all (solo si hay contenido)
  a33SelectAllOnFocus(priceEl);
  a33SelectAllOnFocus(qtyEl);

  if (priceEl) {
    const onPrice = () => { try { compraRenderTotalCalc(); } catch (_) {} };
    priceEl.addEventListener('input', onPrice);
    priceEl.addEventListener('change', onPrice);
  }
  if (qtyEl) {
    const onQty = () => { try { compraRenderTotalCalc(); } catch (_) {} };
    qtyEl.addEventListener('input', onQty);
    qtyEl.addEventListener('change', onQty);
  }

  // Si el usuario toca Monto manualmente, desactivar auto-sync visual
  const montoEl = document.getElementById('compra-monto');
  if (montoEl) {
    const onMonto = () => { try { compraSetMontoAuto(false); compraSyncFinancialAccountUI(finCachedData || null); } catch (_) {} };
    montoEl.addEventListener('input', onMonto);
    montoEl.addEventListener('change', onMonto);
  }

  // Change handlers for accounts
  const tipoSel = document.getElementById('compra-tipo');
  const pmSel = document.getElementById('compra-medio');
  const compraFaSel = document.getElementById('compra-financial-account');
  if (tipoSel) tipoSel.addEventListener('change', () => {
    if (finCachedData) fillCompraCuentaDebe(finCachedData);
  });
  if (pmSel) pmSel.addEventListener('change', () => {
    if (finCachedData) fillCompraCuentaHaber(finCachedData);
  });
  if (compraFaSel) compraFaSel.addEventListener('change', () => {
    try {
      compraSyncFinancialAccountUI(finCachedData || null);
      compraRenderTotalCalc();
      compraRenderProductoHint(finCachedData || null);
    } catch (_) {}
  });
}



/* ---------- Compras (planificación / histórico, NO contable) ---------- */

const PC_CURRENT_KEY = 'a33_finanzas_compras_current_v1';
const PC_HISTORY_KEY = 'a33_finanzas_compras_history_v1';

let pcCurrent = null;
let pcHistory = null; // {version, history: []}
let pcHistoryQuery = '';
let pcModalRecordId = null;

function pcSafeParseJSON(raw) {
  try { return JSON.parse(raw); } catch (_) { return null; }
}

function pcNewId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function pcDeepClone(obj) {
  try { return JSON.parse(JSON.stringify(obj)); } catch (_) { return obj; }
}

function pcParseNum(v) {
  if (v == null) return 0;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function pcFmtQty(n) {
  const v = Number(n || 0);
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-9) return String(Math.round(v));
  return v.toLocaleString('es-NI', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function pcBuildEmptyLine() {
  return {
    id: pcNewId('l'),
    supplierId: '',
    supplierName: '',
    productId: '',
    product: '',
    type: 'UNIDADES',
    quantity: '',
    price: '',
    purchased: false
  };
}

function pcBuildEmptyCurrent() {
  return {
    version: 1,
    notes: '',
    sections: { proveedores: [], varias: [] },
    updatedAtISO: '',
    updatedAtDisplay: ''
  };
}

function pcBuildEmptyHistory() {
  return { version: 1, history: [] };
}

function pcNormBool(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  // Evitar que strings tipo "false" se vuelvan truthy
  const s = String(v).trim().toLowerCase();
  return (s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes');
}

function pcNormalizeLine(src) {
  const base = pcBuildEmptyLine();
  if (!src || typeof src !== 'object') return base;
  const unitsRaw = (src.supplierProductUnitsPerBox != null || src.supplierProductUnitsPerCaja != null || src.unidadesPorCaja != null)
    ? (src.supplierProductUnitsPerBox ?? src.supplierProductUnitsPerCaja ?? src.unidadesPorCaja)
    : '';
  const priceRefRaw = (src.supplierProductPriceRef != null) ? src.supplierProductPriceRef : '';
  const priceUsedRaw = (src.supplierProductPriceUsed != null) ? src.supplierProductPriceUsed : src.price;
  return {
    id: src.id ? String(src.id) : base.id,
    supplierId: src.supplierId == null ? '' : String(src.supplierId),
    supplierName: src.supplierName ? String(src.supplierName) : '',
    productId: src.productId == null ? '' : String(src.productId),
    product: src.product ? String(src.product) : '',
    type: (String(src.type || '').toUpperCase() === 'CAJAS') ? 'CAJAS' : 'UNIDADES',
    quantity: (src.quantity == null) ? '' : String(src.quantity),
    price: (src.price == null) ? '' : String(src.price),
    purchased: pcNormBool(src.purchased),
    supplierProductName: src.supplierProductName ? String(src.supplierProductName) : (src.product ? String(src.product) : ''),
    supplierProductType: src.supplierProductType ? String(src.supplierProductType) : (src.type ? String(src.type) : ''),
    supplierProductPriceRef: priceRefRaw === '' ? null : pcParseNum(priceRefRaw),
    supplierProductPriceUsed: (priceUsedRaw == null || String(priceUsedRaw).trim() === '') ? null : pcParseNum(priceUsedRaw),
    supplierProductUnitsPerBox: unitsRaw === '' ? 0 : pcParseNum(unitsRaw),
    supplierProductUnitsPerCaja: unitsRaw === '' ? 0 : pcParseNum(unitsRaw),
    unidadesPorCaja: unitsRaw === '' ? 0 : pcParseNum(unitsRaw)
  };
}

function pcNormalizeCurrent(obj) {
  const out = pcBuildEmptyCurrent();
  if (!obj || typeof obj !== 'object') return out;

  out.version = 1;
  out.notes = obj.notes ? String(obj.notes) : '';
  out.updatedAtISO = obj.updatedAtISO ? String(obj.updatedAtISO) : '';
  out.updatedAtDisplay = obj.updatedAtDisplay ? String(obj.updatedAtDisplay) : '';

  const sec = obj.sections || {};
  const prov = Array.isArray(sec.proveedores) ? sec.proveedores : [];
  const varr = Array.isArray(sec.varias) ? sec.varias : [];

  out.sections.proveedores = prov.map(pcNormalizeLine);
  out.sections.varias = varr.map(pcNormalizeLine);

  return out;
}

function pcNormalizeHistory(obj) {
  const out = pcBuildEmptyHistory();
  if (!obj || typeof obj !== 'object') return out;
  const arr = Array.isArray(obj.history) ? obj.history : (Array.isArray(obj) ? obj : []);
  out.history = arr
    .filter(x => x && typeof x === 'object')
    .map(x => ({
      id: x.id ? String(x.id) : pcNewId('p'),
      notes: x.notes ? String(x.notes) : '',
      sections: {
        proveedores: (x.sections && Array.isArray(x.sections.proveedores)) ? x.sections.proveedores.map(pcNormalizeLine) : [],
        varias: (x.sections && Array.isArray(x.sections.varias)) ? x.sections.varias.map(pcNormalizeLine) : []
      },
      totals: {
        proveedores: pcParseNum(x.totals && x.totals.proveedores),
        varias: pcParseNum(x.totals && x.totals.varias),
        general: pcParseNum(x.totals && x.totals.general)
      },
      createdAtISO: x.createdAtISO ? String(x.createdAtISO) : '',
      createdAtDisplay: x.createdAtDisplay ? String(x.createdAtDisplay) : ''
    }));
  return out;
}

async function pcLoadAll() {
  // Current
  let cur = null;
  try {
    const rec = await finGet('settings', PC_CURRENT_KEY);
    if (rec && rec.data) cur = rec.data;
  } catch (_) {}
  if (!cur) {
    try { cur = pcSafeParseJSON(localStorage.getItem(PC_CURRENT_KEY)); } catch (_) {}
  }
  pcCurrent = pcNormalizeCurrent(cur);

  // History
  let hist = null;
  try {
    const rec = await finGet('settings', PC_HISTORY_KEY);
    if (rec && rec.data) hist = rec.data;
  } catch (_) {}
  if (!hist) {
    try { hist = pcSafeParseJSON(localStorage.getItem(PC_HISTORY_KEY)); } catch (_) {}
  }
  pcHistory = pcNormalizeHistory(hist);

  pcHistory.history.sort((a, b) => String(b.createdAtISO || '').localeCompare(String(a.createdAtISO || '')));
}

async function pcPersistSetting(id, data) {
  try {
    await finPut('settings', { id, data });
  } catch (err) {
    console.warn('No se pudo guardar en settings', id, err);
  }
  try {
    localStorage.setItem(id, JSON.stringify(data));
  } catch (_) {}
}

function pcSetUpdatedUI() {
  const el = document.getElementById('pc-updated');
  if (!el) return;
  el.textContent = `Actualizado: ${pcCurrent && pcCurrent.updatedAtDisplay ? pcCurrent.updatedAtDisplay : '—'}`;
}

function pcSetMsg(msg) {
  const el = document.getElementById('pc-msg');
  if (!el) return;
  el.textContent = msg || '';
}

function pcGetLineTotal(line) {
  const q = pcParseNum(line && line.quantity);
  const p = pcParseNum(line && line.price);
  const t = q * p;
  return Math.round(t * 100) / 100;
}

function pcFindLiveSupplierById(supplierId) {
  const sid = Number(supplierId || 0);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  return (finCachedData && finCachedData.suppliersMap) ? (finCachedData.suppliersMap.get(sid) || null) : null;
}

function pcFindLiveProductByIds(supplierId, productId) {
  const pid = String(productId || '').trim();
  if (!pid) return null;
  const catalog = pcGetSupplierCatalogById(supplierId);
  return (Array.isArray(catalog) ? catalog : []).find(p => String(p && p.id) === pid) || null;
}

function pcSnapshotLineForward(line) {
  const out = pcNormalizeLine(line);
  const supplier = pcFindLiveSupplierById(out.supplierId);
  if (supplier && supplier.nombre) out.supplierName = String(supplier.nombre);

  const liveProduct = pcFindLiveProductByIds(out.supplierId, out.productId);
  if (liveProduct) {
    const p = normalizeSupplierProduct(liveProduct);
    const tipo = String(p.tipo || '').toUpperCase();
    out.product = p.nombre || out.product || '';
    out.supplierProductName = p.nombre || out.product || '';
    out.type = (tipo === 'CAJAS') ? 'CAJAS' : 'UNIDADES';
    out.supplierProductType = out.type;
    out.supplierProductPriceRef = compraProductHasPriceRef(p) ? normNumNonNeg(p.precio) : null;
    out.supplierProductUnitsPerBox = (out.type === 'CAJAS') ? normNumNonNeg(p.unidadesPorCaja) : 0;
    out.supplierProductUnitsPerCaja = out.supplierProductUnitsPerBox;
    out.unidadesPorCaja = out.supplierProductUnitsPerBox;
  } else {
    out.supplierProductName = out.supplierProductName || out.product || '';
    out.supplierProductType = out.supplierProductType || out.type || '';
  }

  out.supplierProductPriceUsed = (String(out.price || '').trim() === '') ? null : pcParseNum(out.price);
  return out;
}

function pcSnapshotSectionsForward(sections) {
  const sec = sections || {};
  const prov = Array.isArray(sec.proveedores) ? sec.proveedores : [];
  const varr = Array.isArray(sec.varias) ? sec.varias : [];
  return {
    proveedores: prov.map(pcSnapshotLineForward),
    varias: varr.map(pcSnapshotLineForward)
  };
}

function pcComputeSectionTotal(lines) {
  let sum = 0;
  for (const l of (lines || [])) sum += pcGetLineTotal(l);
  return Math.round(sum * 100) / 100;
}

function pcComputeTotalsFromSections(sections) {
  const prov = pcComputeSectionTotal((sections && sections.proveedores) || []);
  const varr = pcComputeSectionTotal((sections && sections.varias) || []);
  return {
    proveedores: prov,
    varias: varr,
    general: Math.round((prov + varr) * 100) / 100
  };
}

function pcComputeProductSummary(sections) {
  const map = new Map();
  const pushLine = (l) => {
    const prodRaw = (l && l.product != null) ? String(l.product) : '';
    const prod = prodRaw.trim();
    if (!prod) return;
    const key = normStr(prod);
    const q = pcParseNum(l.quantity);
    const tot = pcGetLineTotal(l);
    if (!map.has(key)) {
      map.set(key, { product: prod, qty: 0, total: 0 });
    }
    const cur = map.get(key);
    cur.qty += q;
    cur.total += tot;
  };

  const prov = (sections && Array.isArray(sections.proveedores)) ? sections.proveedores : [];
  const varr = (sections && Array.isArray(sections.varias)) ? sections.varias : [];
  prov.forEach(pushLine);
  varr.forEach(pushLine);

  const out = Array.from(map.values());
  out.sort((a, b) => a.product.localeCompare(b.product, 'es'));
  return out.map(x => ({
    product: x.product,
    qty: Math.round(x.qty * 100) / 100,
    total: Math.round(x.total * 100) / 100
  }));
}

function pcUpdateComputedUI() {
  if (!pcCurrent) return;

  const totals = pcComputeTotalsFromSections(pcCurrent.sections);

  const elProv = document.getElementById('pc-total-proveedores');
  const elVar = document.getElementById('pc-total-varias');
  const elGen = document.getElementById('pc-total-general');

  if (elProv) elProv.textContent = finFormatCordobas(totals.proveedores);
  if (elVar) elVar.textContent = finFormatCordobas(totals.varias);
  if (elGen) elGen.textContent = finFormatCordobas(totals.general);

  const tbody = document.getElementById('pc-product-tbody');
  if (tbody) {
    tbody.innerHTML = '';
    const rows = pcComputeProductSummary(pcCurrent.sections);

    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 3;
      td.className = 'muted';
      td.textContent = 'Sin productos aún';
      tr.appendChild(td);
      tbody.appendChild(tr);
    } else {
      for (const r of rows) {
        const tr = document.createElement('tr');
        const tdP = document.createElement('td');
        tdP.textContent = r.product;
        const tdQ = document.createElement('td');
        tdQ.className = 'num';
        tdQ.textContent = pcFmtQty(r.qty);
        const tdT = document.createElement('td');
        tdT.className = 'num';
        tdT.textContent = finFormatCordobas(r.total);
        tr.appendChild(tdP);
        tr.appendChild(tdQ);
        tr.appendChild(tdT);
        tbody.appendChild(tr);
      }
    }
  }
}

function pcAttachSelectAllOnFocus(el) {
  if (!el) return;
  el.addEventListener('focus', () => {
    const v = String(el.value ?? '').trim();
    if (v !== '') {
      try { el.select(); } catch (_) {}
    }
  });
}

function pcBuildSupplierSelect(currentId, currentName) {
  const sel = document.createElement('select');

  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '—';
  sel.appendChild(optEmpty);

  const suppliers = finGetSuppliersForNewPurchases(finCachedData || {});

  const idStr = currentId ? String(currentId) : '';
  let found = false;

  for (const s of suppliers) {
    const opt = document.createElement('option');
    opt.value = String(s.id);
    opt.textContent = s.nombre || `Proveedor ${s.id}`;
    if (idStr && opt.value === idStr) found = true;
    sel.appendChild(opt);
  }

  if (idStr && !found) {
    const opt = document.createElement('option');
    opt.value = idStr;
    opt.textContent = `${currentName || ('Proveedor ' + idStr)} (no existe)`;
    sel.insertBefore(opt, sel.children[1]);
  }

  sel.value = idStr;
  return sel;
}

function pcTruncLabel(s, maxLen = 34) {
  const t = String(s ?? '').trim();
  if (!t) return '—';
  return t.length > maxLen ? (t.slice(0, Math.max(1, maxLen - 1)) + '…') : t;
}

function pcGetSupplierCatalogById(supplierId) {
  const sid = Number(supplierId || 0);
  if (!Number.isFinite(sid) || sid <= 0) return [];
  const s = (finCachedData && finCachedData.suppliersMap) ? finCachedData.suppliersMap.get(sid) : null;
  const arr = Array.isArray(s && s.productos) ? s.productos : [];
  // `s.productos` ya viene normalizado, pero igual protegemos por si acaso.
  return arr.map(normalizeSupplierProduct).filter(p => p && p.id);
}

function pcFindProductInCatalogByName(catalog, name) {
  const needle = normStr(name || '', 160);
  if (!needle) return null;
  const n = normStr(needle, 160).toLowerCase();
  for (const p of (Array.isArray(catalog) ? catalog : [])) {
    const nm = normStr(p && p.nombre, 160).toLowerCase();
    if (nm && nm === n) return p;
  }
  return null;
}

function pcBuildProductSelect(catalog, currentProductId, currentProductName) {
  const sel = document.createElement('select');

  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '— Seleccionar —';
  sel.appendChild(optEmpty);

  const arr = (Array.isArray(catalog) ? [...catalog] : []);
  arr.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

  const idStr = currentProductId ? String(currentProductId) : '';
  let found = false;

  for (const p of arr) {
    const opt = document.createElement('option');
    opt.value = String(p.id || '');
    opt.textContent = pcTruncLabel(p.nombre || '—', 38);
    if (idStr && opt.value === idStr) found = true;
    sel.appendChild(opt);
  }

  // Producto guardado pero ya no existe en el catálogo del proveedor.
  if (idStr && !found) {
    const opt = document.createElement('option');
    opt.value = idStr;
    opt.textContent = `${pcTruncLabel(currentProductName || 'Producto', 34)} (no existe)`;
    sel.insertBefore(opt, sel.children[1]);
    sel.value = idStr;
    return sel;
  }

  // Producto manual (texto) sin productId: lo mostramos como opción informativa.
  const manualName = (currentProductName || '').toString().trim();
  if (!idStr && manualName) {
    const opt = document.createElement('option');
    opt.value = '__manual__';
    opt.textContent = `${pcTruncLabel(manualName, 34)} (manual)`;
    sel.insertBefore(opt, sel.children[1]);
    sel.value = '__manual__';
    return sel;
  }

  sel.value = idStr;
  return sel;
}

function pcRenderSection(sectionKey) {
  if (!pcCurrent) return;

  const host = document.getElementById(sectionKey === 'proveedores' ? 'pc-grid-proveedores' : 'pc-grid-varias');
  if (!host) return;

  const lines = (pcCurrent.sections && pcCurrent.sections[sectionKey]) ? pcCurrent.sections[sectionKey] : [];

  host.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'purchase-grid-header';
  header.innerHTML = `
    <div>Proveedor</div>
    <div>Producto</div>
    <div>Tipo</div>
    <div>Cantidad</div>
    <div>Precio</div>
    <div class="num">Total</div>
    <div class="purchase-col-purchased" title="Comprado" aria-label="Comprado">✓</div>
    <div></div>
  `;
  host.appendChild(header);

  if (!lines.length) {
    const empty = document.createElement('div');
    empty.className = 'fin-help';
    empty.style.margin = '8px 0 2px';
    empty.textContent = 'Sin líneas aún. Usa “+ Agregar línea”.';
    host.appendChild(empty);
    return;
  }

  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'purchase-grid-row';

    // Proveedor
    const cSupplier = document.createElement('div');
    cSupplier.className = 'purchase-cell cell-supplier';
    const selSupplier = pcBuildSupplierSelect(line.supplierId, line.supplierName);
    selSupplier.addEventListener('change', () => {
      const prev = line.supplierId || '';
      const next = selSupplier.value || '';
      line.supplierId = next;
      if (!next) {
        line.supplierName = '';
      } else {
        const sid = Number(next);
        const obj = finCachedData && finCachedData.suppliersMap ? finCachedData.suppliersMap.get(sid) : null;
        line.supplierName = obj ? (obj.nombre || '') : (line.supplierName || '');
      }

      // Si cambió el proveedor, evitamos inconsistencias: se re-elige producto y se re-autofill.
      if (next !== prev) {
        line.productId = '';
        line.product = '';
        line.supplierProductName = '';
        line.supplierProductType = '';
        line.supplierProductPriceRef = null;
        line.supplierProductUnitsPerBox = 0;
        line.supplierProductUnitsPerCaja = 0;
        line.unidadesPorCaja = 0;
        line.type = 'UNIDADES';
        line.price = '';
      }

      pcRenderSection(sectionKey);
      pcUpdateComputedUI();
    });
    cSupplier.appendChild(selSupplier);

    // Producto
    const cProd = document.createElement('div');
    cProd.className = 'purchase-cell cell-product';
    const catalog = pcGetSupplierCatalogById(line.supplierId);
    const hasCatalog = Array.isArray(catalog) && catalog.length > 0;

    // Snapshot conservador: si una línea histórica/manual solo tiene nombre y no tiene ID,
    // no la vinculamos automáticamente por coincidencia de nombre. Así evitamos enlazar
    // compras antiguas a un producto incorrecto después de editar Catálogos.

    let prodControl = null;
    if (hasCatalog) {
      const selProd = pcBuildProductSelect(catalog, line.productId, line.product);
      selProd.addEventListener('change', () => {
        const v = selProd.value || '';

        // Opción informativa de "manual": no toca nada.
        if (v === '__manual__') {
          pcUpdateComputedUI();
          return;
        }

        if (!v) {
          line.productId = '';
          line.product = '';
          line.supplierProductName = '';
          line.supplierProductType = '';
          line.supplierProductPriceRef = null;
          line.supplierProductUnitsPerBox = 0;
          line.supplierProductUnitsPerCaja = 0;
          line.unidadesPorCaja = 0;
          pcUpdateComputedUI();
          return;
        }

        const pid = String(v);
        const p = catalog.find(x => String(x && x.id) === pid) || null;
        line.productId = pid;

        if (p) {
          line.product = (p.nombre || '').toString();
          line.supplierProductName = line.product;
          const tipo = String(p.tipo || '').toUpperCase();
          line.type = (tipo === 'CAJAS') ? 'CAJAS' : 'UNIDADES';
          line.supplierProductType = line.type;
          const hasPriceRef = compraProductHasPriceRef(p);
          line.supplierProductPriceRef = hasPriceRef ? normNumNonNeg(p.precio) : null;
          line.supplierProductUnitsPerBox = (line.type === 'CAJAS') ? normNumNonNeg(p.unidadesPorCaja) : 0;
          line.supplierProductUnitsPerCaja = line.supplierProductUnitsPerBox;
          line.unidadesPorCaja = line.supplierProductUnitsPerBox;
          line.price = hasPriceRef ? String(Math.round(normNumNonNeg(p.precio) * 100) / 100) : '';

          // Autofill UI (sin pelearse: solo ocurre al seleccionar).
          try { if (selTipo) selTipo.value = line.type; } catch (_) {}
          try { if (inpPrice) inpPrice.value = line.price; } catch (_) {}
          try { totalEl.textContent = finFormatCordobas(pcGetLineTotal(line)); } catch (_) {}
        } else {
          // No existe en catálogo: mantenemos texto actual y evitamos crash.
          line.product = (line.product || '').toString();
          line.supplierProductName = line.supplierProductName || line.product;
        }

        pcUpdateComputedUI();
      });
      prodControl = selProd;
    } else {
      const inpProd = document.createElement('input');
      inpProd.type = 'text';
      inpProd.placeholder = 'Producto';
      inpProd.value = line.product || '';
      inpProd.addEventListener('input', () => {
        line.productId = '';
        line.product = inpProd.value;
        pcUpdateComputedUI();
      });
      pcAttachSelectAllOnFocus(inpProd);
      prodControl = inpProd;
    }

    if (prodControl) cProd.appendChild(prodControl);

    // Tipo
    const cTipo = document.createElement('div');
    cTipo.className = 'purchase-cell cell-type';
    const selTipo = document.createElement('select');
    ['CAJAS', 'UNIDADES'].forEach(v => {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      selTipo.appendChild(opt);
    });
    selTipo.value = (String(line.type || '').toUpperCase() === 'CAJAS') ? 'CAJAS' : 'UNIDADES';
    selTipo.addEventListener('change', () => {
      line.type = selTipo.value;
      line.supplierProductType = selTipo.value;
      if (line.type !== 'CAJAS') {
        line.supplierProductUnitsPerBox = 0;
        line.supplierProductUnitsPerCaja = 0;
        line.unidadesPorCaja = 0;
      }
      pcUpdateComputedUI();
    });
    cTipo.appendChild(selTipo);

    // Total cell (needs to exist before input handlers)
    const cTotal = document.createElement('div');
    cTotal.className = 'purchase-cell cell-total';
    const totalEl = document.createElement('div');
    totalEl.className = 'purchase-total-cell';
    totalEl.textContent = finFormatCordobas(pcGetLineTotal(line));
    cTotal.appendChild(totalEl);

    // Cantidad
    const cQty = document.createElement('div');
    cQty.className = 'purchase-cell cell-qty';
    const inpQty = document.createElement('input');
    inpQty.type = 'text';
    inpQty.inputMode = 'decimal';
    inpQty.placeholder = '—';
    inpQty.value = (line.quantity == null) ? '' : String(line.quantity);
    inpQty.addEventListener('input', () => {
      line.quantity = inpQty.value;
      totalEl.textContent = finFormatCordobas(pcGetLineTotal(line));
      pcUpdateComputedUI();
    });
    pcAttachSelectAllOnFocus(inpQty);
    cQty.appendChild(inpQty);

    // Precio
    const cPrice = document.createElement('div');
    cPrice.className = 'purchase-cell cell-price';
    const inpPrice = document.createElement('input');
    inpPrice.type = 'text';
    inpPrice.inputMode = 'decimal';
    inpPrice.placeholder = '—';
    inpPrice.value = (line.price == null) ? '' : String(line.price);
    inpPrice.addEventListener('input', () => {
      line.price = inpPrice.value;
      line.supplierProductPriceUsed = String(inpPrice.value || '').trim() === '' ? null : pcParseNum(inpPrice.value);
      totalEl.textContent = finFormatCordobas(pcGetLineTotal(line));
      pcUpdateComputedUI();
    });
    pcAttachSelectAllOnFocus(inpPrice);
    cPrice.appendChild(inpPrice);

    // Delete
    const cDel = document.createElement('div');
    cDel.className = 'purchase-cell cell-del purchase-row-del';
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'btn-close';
    btnDel.title = 'Eliminar fila';
    btnDel.textContent = '×';
    btnDel.addEventListener('click', () => {
      const ok = confirm('Eliminar esta línea de compra?');
      if (!ok) return;
      const idx = lines.findIndex(x => x && x.id === line.id);
      if (idx >= 0) lines.splice(idx, 1);
      pcRenderSection(sectionKey);
      pcUpdateComputedUI();
    });
    cDel.appendChild(btnDel);

    // Comprado
    const cPurchased = document.createElement('div');
    cPurchased.className = 'purchase-cell cell-purchased';
    const chkPurchased = document.createElement('input');
    chkPurchased.type = 'checkbox';
    chkPurchased.checked = !!line.purchased;
    chkPurchased.title = 'Comprado';
    chkPurchased.addEventListener('change', () => {
      line.purchased = !!chkPurchased.checked;
      pcAutoSaveDraftSilent().catch(err => console.warn('Auto-guardado falló', err));
    });
    cPurchased.appendChild(chkPurchased);

    row.appendChild(cSupplier);
    row.appendChild(cProd);
    row.appendChild(cTipo);
    row.appendChild(cQty);
    row.appendChild(cPrice);
    row.appendChild(cTotal);
    row.appendChild(cPurchased);
    row.appendChild(cDel);

    host.appendChild(row);
  }
}

function pcRenderCurrent() {
  if (!pcCurrent) return;

  const notes = document.getElementById('pc-notes');
  if (notes && notes.value !== pcCurrent.notes) notes.value = pcCurrent.notes || '';

  pcRenderSection('proveedores');
  pcRenderSection('varias');

  pcSetUpdatedUI();
  pcUpdateComputedUI();
}

function pcRenderHistoryList() {
  const tbody = document.getElementById('ph-tbody');
  const help = document.getElementById('ph-help');
  if (!tbody) return;

  tbody.innerHTML = '';

  const q = normStr(pcHistoryQuery || '');

  const list = (pcHistory && Array.isArray(pcHistory.history)) ? pcHistory.history : [];

  const filtered = !q ? list : list.filter(rec => {
    const n = normStr(rec.notes || '');
    if (n.includes(q)) return true;

    const allLines = [];
    const sp = (rec.sections && Array.isArray(rec.sections.proveedores)) ? rec.sections.proveedores : [];
    const sv = (rec.sections && Array.isArray(rec.sections.varias)) ? rec.sections.varias : [];
    allLines.push(...sp, ...sv);

    for (const l of allLines) {
      if (normStr(l.product || '').includes(q)) return true;
      if (normStr(l.supplierName || '').includes(q)) return true;
    }
    return false;
  });

  if (!filtered.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'muted';
    td.textContent = q ? 'Sin resultados.' : 'Aún no hay compras guardadas en el histórico.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const rec of filtered) {
      const tr = document.createElement('tr');

      const tdF = document.createElement('td');
      tdF.textContent = rec.createdAtDisplay || '—';

      const tdN = document.createElement('td');
      const preview = (rec.notes || '').trim();
      tdN.textContent = preview.length > 120 ? (preview.slice(0, 120) + '…') : (preview || '—');

      const tdT = document.createElement('td');
      tdT.className = 'num';
      tdT.textContent = finFormatCordobas(rec.totals && rec.totals.general);

      const tdC = document.createElement('td');
      tdC.className = 'num';
      const cnt = ((rec.sections && rec.sections.proveedores) ? rec.sections.proveedores.length : 0) + ((rec.sections && rec.sections.varias) ? rec.sections.varias.length : 0);
      tdC.textContent = String(cnt);

      const tdA = document.createElement('td');
      tdA.style.whiteSpace = 'nowrap';

      const btnVer = document.createElement('button');
      btnVer.type = 'button';
      btnVer.className = 'btn-small';
      btnVer.textContent = 'Ver';
      btnVer.addEventListener('click', () => pcOpenHistoryModal(rec.id));

      const btnDup = document.createElement('button');
      btnDup.type = 'button';
      btnDup.className = 'btn-small';
      btnDup.textContent = 'Duplicar';
      btnDup.addEventListener('click', () => {
        const ok = confirm('Copiar esta compra al editor (Compra Actual)?');
        if (!ok) return;
        pcCurrent.notes = rec.notes || '';
        pcCurrent.sections = pcDeepClone(rec.sections || { proveedores: [], varias: [] });
        pcCurrent.updatedAtISO = '';
        pcCurrent.updatedAtDisplay = '';
        pcRenderCurrent();
        setActiveFinView('comprasplan');
        window.location.hash = 'tab=comprasplan';
        showToast('Compra copiada a Compra Actual');
      });

      const btnXls = document.createElement('button');
      btnXls.type = 'button';
      btnXls.className = 'btn-small';
      btnXls.textContent = 'Excel';
      btnXls.addEventListener('click', () => {
        pcExportRecordExcel(rec);
      });

      const btnDel = document.createElement('button');
      btnDel.type = 'button';
      btnDel.className = 'btn-danger';
      btnDel.textContent = 'Eliminar';
      btnDel.addEventListener('click', async () => {
        const ok = confirm('Eliminar este registro del histórico? Esta acción no se puede deshacer.');
        if (!ok) return;
        const idx = pcHistory.history.findIndex(x => x.id === rec.id);
        if (idx >= 0) pcHistory.history.splice(idx, 1);
        await pcPersistSetting(PC_HISTORY_KEY, pcHistory);
        pcRenderHistoryList();
        showToast('Registro eliminado');
      });

      tdA.appendChild(btnVer);
      tdA.appendChild(btnDup);
      tdA.appendChild(btnXls);
      tdA.appendChild(btnDel);

      tr.appendChild(tdF);
      tr.appendChild(tdN);
      tr.appendChild(tdT);
      tr.appendChild(tdC);
      tr.appendChild(tdA);

      tbody.appendChild(tr);
    }
  }

  if (help) {
    const total = list.length;
    const shown = filtered.length;
    help.textContent = q ? `Mostrando ${shown} de ${total} registros.` : `${total} registros.`;
  }
}

function pcOpenHistoryModal(recordId) {
  const modal = document.getElementById('ph-modal');
  if (!modal || !pcHistory) return;
  const rec = pcHistory.history.find(x => x.id === recordId);
  if (!rec) return;
  pcModalRecordId = recordId;

  const meta = document.getElementById('ph-modal-meta');
  if (meta) {
    meta.innerHTML = `
      <div><strong>Fecha:</strong> ${rec.createdAtDisplay || '—'}</div>
      <div><strong># Ítems:</strong> ${((rec.sections && rec.sections.proveedores) ? rec.sections.proveedores.length : 0) + ((rec.sections && rec.sections.varias) ? rec.sections.varias.length : 0)}</div>
    `;
  }

  const notes = document.getElementById('ph-modal-notes');
  if (notes) notes.textContent = (rec.notes || '').trim() || '—';

  const tProv = document.getElementById('ph-modal-total-proveedores');
  const tVar = document.getElementById('ph-modal-total-varias');
  const tGen = document.getElementById('ph-modal-total-general');
  if (tProv) tProv.textContent = finFormatCordobas(rec.totals && rec.totals.proveedores);
  if (tVar) tVar.textContent = finFormatCordobas(rec.totals && rec.totals.varias);
  if (tGen) tGen.textContent = finFormatCordobas(rec.totals && rec.totals.general);

  const fillLines = (tbodyId, lines) => {
    const tb = document.getElementById(tbodyId);
    if (!tb) return;
    tb.innerHTML = '';
    const arr = Array.isArray(lines) ? lines : [];
    if (!arr.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 6;
      td.className = 'muted';
      td.textContent = 'Sin líneas.';
      tr.appendChild(td);
      tb.appendChild(tr);
      return;
    }
    for (const l of arr) {
      const tr = document.createElement('tr');
      const tdS = document.createElement('td');
      tdS.textContent = l.supplierName || '—';
      const tdP = document.createElement('td');
      tdP.textContent = (l.product || '').trim() || '—';
      const tdT = document.createElement('td');
      tdT.textContent = l.type || 'UNIDADES';
      const tdQ = document.createElement('td');
      tdQ.className = 'num';
      tdQ.textContent = pcFmtQty(pcParseNum(l.quantity));
      const tdPr = document.createElement('td');
      tdPr.className = 'num';
      tdPr.textContent = fmtCurrency(pcParseNum(l.price));
      const tdTot = document.createElement('td');
      tdTot.className = 'num';
      tdTot.textContent = fmtCurrency(pcGetLineTotal(l));
      tr.appendChild(tdS);
      tr.appendChild(tdP);
      tr.appendChild(tdT);
      tr.appendChild(tdQ);
      tr.appendChild(tdPr);
      tr.appendChild(tdTot);
      tb.appendChild(tr);
    }
  };

  fillLines('ph-modal-tbody-proveedores', rec.sections && rec.sections.proveedores);
  fillLines('ph-modal-tbody-varias', rec.sections && rec.sections.varias);

  modal.classList.add('open');
}

function pcCloseHistoryModal() {
  const modal = document.getElementById('ph-modal');
  if (!modal) return;
  modal.classList.remove('open');
  pcModalRecordId = null;
}

function pcMakeFileStamp(isoOrDate) {
  const d = (isoOrDate instanceof Date) ? isoOrDate : new Date(isoOrDate || Date.now());
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}_${hh}${mi}`;
}

function pcBuildWorkbook(payload) {
  if (typeof XLSX === 'undefined') {
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return null;
  }

  const sections = payload.sections || { proveedores: [], varias: [] };
  const totals = pcComputeTotalsFromSections(sections);
  const productSummary = pcComputeProductSummary(sections);

  const metaLabel = payload.metaLabel || 'Fecha/Hora';
  const metaValue = payload.metaValue || '';
  const notes = (payload.notes || '').toString();

  const resumenRows = [
    ['Suite A33', 'Finanzas · Compras'],
    [metaLabel, metaValue],
    ['Notas', notes],
    [],
    ['Total COMPRAS PROVEEDORES', totals.proveedores],
    ['Total COMPRAS VARIAS', totals.varias],
    ['Total General', totals.general]
  ];

  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  wsResumen['!cols'] = [{ wch: 24 }, { wch: 72 }];

  const buildDetailSheet = (lines) => {
    const rows = [[
      'PROVEEDOR', 'PRODUCTO', 'TIPO', 'CANTIDAD', finMoneyColumnHeader('PRECIO'), finMoneyColumnHeader('TOTAL')
    ]];
    (Array.isArray(lines) ? lines : []).forEach(l => {
      rows.push([
        (l.supplierName || '').toString(),
        (l.product || '').toString(),
        (l.type || 'UNIDADES').toString(),
        pcParseNum(l.quantity),
        pcParseNum(l.price),
        pcGetLineTotal(l)
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 22 }, { wch: 30 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }];
    return ws;
  };

  const wsProv = buildDetailSheet(sections.proveedores);
  const wsVar = buildDetailSheet(sections.varias);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsProv, 'Compras Proveedores');
  XLSX.utils.book_append_sheet(wb, wsVar, 'Compras Varias');

  if (productSummary && productSummary.length) {
    const rows = [['PRODUCTO', 'CANTIDAD TOTAL', finMoneyColumnHeader('TOTAL')]];
    productSummary.forEach(r => {
      rows.push([r.product, r.qty, r.total]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Totales por Producto');
  }

  return wb;
}

function pcExportCurrentExcel() {
  if (!pcCurrent) return;
  const now = new Date();
  const stampISO = now.toISOString();
  const metaValue = (pcCurrent.updatedAtDisplay && pcCurrent.updatedAtDisplay.trim())
    ? pcCurrent.updatedAtDisplay
    : fmtDDMMYYYYHHMM(now);

  const wb = pcBuildWorkbook({
    notes: pcCurrent.notes || '',
    sections: pcCurrent.sections || { proveedores: [], varias: [] },
    metaLabel: 'Actualizado',
    metaValue
  });
  if (!wb) return;

  const filename = `A33_Finanzas_Compras_${pcMakeFileStamp(stampISO)}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Compras exportadas a Excel');
}

function pcExportRecordExcel(rec) {
  if (!rec) return;
  const stamp = rec.createdAtISO || new Date().toISOString();

  const wb = pcBuildWorkbook({
    notes: rec.notes || '',
    sections: rec.sections || { proveedores: [], varias: [] },
    metaLabel: 'Creado',
    metaValue: rec.createdAtDisplay || ''
  });
  if (!wb) return;

  const filename = `A33_Finanzas_Compras_HIST_${pcMakeFileStamp(stamp)}.xlsx`;
  finAttachExportCurrencyMetadata(wb);
  XLSX.writeFile(wb, filename);
  showToast('Histórico exportado a Excel');
}

let pcAutoSaveChain = Promise.resolve();

async function pcAutoSaveDraftSilent() {
  if (!pcCurrent) return;
  const now = new Date();
  pcCurrent.updatedAtISO = now.toISOString();
  pcCurrent.updatedAtDisplay = fmtDDMMYYYYHHMM(now);
  pcCurrent.sections = pcSnapshotSectionsForward(pcCurrent.sections || { proveedores: [], varias: [] });
  pcSetUpdatedUI();
  // Guardado silencioso: sin toast / alert por click
  pcAutoSaveChain = pcAutoSaveChain.then(() => pcPersistSetting(PC_CURRENT_KEY, pcCurrent));
  return pcAutoSaveChain;
}

async function pcSaveDraft() {
  if (!pcCurrent) pcCurrent = pcBuildEmptyCurrent();

  const notesEl = document.getElementById('pc-notes');
  if (notesEl) pcCurrent.notes = String(notesEl.value || '');

  const now = new Date();
  pcCurrent.updatedAtISO = now.toISOString();
  pcCurrent.updatedAtDisplay = fmtDDMMYYYYHHMM(now);
  pcCurrent.sections = pcSnapshotSectionsForward(pcCurrent.sections || { proveedores: [], varias: [] });

  await pcPersistSetting(PC_CURRENT_KEY, pcCurrent);
  pcSetUpdatedUI();
  pcSetMsg(`Guardado: ${pcCurrent.updatedAtDisplay}`);
  showToast('Compra actual guardada');
}

async function pcSaveToHistory() {
  if (!pcCurrent || !pcHistory) return;

  // snapshot del editor
  const notesEl = document.getElementById('pc-notes');
  const snapshotNotes = notesEl ? String(notesEl.value || '') : (pcCurrent.notes || '');

  const now = new Date();
  const snapshotSections = pcSnapshotSectionsForward(pcCurrent.sections || { proveedores: [], varias: [] });
  const rec = {
    id: pcNewId('p'),
    notes: snapshotNotes,
    sections: pcDeepClone(snapshotSections),
    totals: pcComputeTotalsFromSections(snapshotSections),
    createdAtISO: now.toISOString(),
    createdAtDisplay: fmtDDMMYYYYHHMM(now)
  };

  pcHistory.history.unshift(rec);
  await pcPersistSetting(PC_HISTORY_KEY, pcHistory);

  showToast('Guardado en histórico');
  pcRenderHistoryList();
}

function pcLineHasContent(line) {
  if (!line || typeof line !== 'object') return false;
  const supplierId = (line.supplierId == null) ? '' : String(line.supplierId).trim();
  const supplierName = (line.supplierName == null) ? '' : String(line.supplierName).trim();
  const product = (line.product == null) ? '' : String(line.product).trim();
  const quantity = (line.quantity == null) ? '' : String(line.quantity).trim();
  const price = (line.price == null) ? '' : String(line.price).trim();
  return !!(supplierId || supplierName || product || quantity || price);
}

function pcGetContentLinesFromCurrent() {
  const sec = (pcCurrent && pcCurrent.sections) ? pcCurrent.sections : {};
  const prov = Array.isArray(sec.proveedores) ? sec.proveedores : [];
  const varr = Array.isArray(sec.varias) ? sec.varias : [];
  const all = [];
  all.push(...prov, ...varr);
  return all.filter(pcLineHasContent);
}

async function pcDeleteAllCurrent() {
  if (!pcCurrent) pcCurrent = pcBuildEmptyCurrent();

  const contentLines = pcGetContentLinesFromCurrent();
  const missing = contentLines.reduce((acc, l) => acc + (pcNormBool(l && l.purchased) ? 0 : 1), 0);

  if (contentLines.length > 0 && missing > 0) {
    const msg = `No puedo borrar: faltan ${missing} ítems por marcar como comprados.`;
    pcSetMsg(msg);
    showToast(msg);
    return;
  }

  const ok = confirm('Borrar todo: esto limpiará la Compra Actual (no afecta el histórico).\n\n⚠️ Esta acción no se puede deshacer.');
  if (!ok) return;

  pcCurrent = pcBuildEmptyCurrent();
  await pcPersistSetting(PC_CURRENT_KEY, pcCurrent);
  pcRenderCurrent();
  pcSetMsg('Compra actual borrada');
  showToast('Compra actual borrada');
}

function pcAddLine(sectionKey) {
  if (!pcCurrent) pcCurrent = pcBuildEmptyCurrent();
  if (!pcCurrent.sections) pcCurrent.sections = { proveedores: [], varias: [] };
  if (!Array.isArray(pcCurrent.sections[sectionKey])) pcCurrent.sections[sectionKey] = [];
  pcCurrent.sections[sectionKey].push(pcBuildEmptyLine());
  pcRenderSection(sectionKey);
  pcUpdateComputedUI();
}

function setupComprasPlanUI() {
  const btnAddProv = document.getElementById('pc-add-proveedores');
  if (btnAddProv) btnAddProv.addEventListener('click', (e) => { e.preventDefault(); pcAddLine('proveedores'); });

  const btnAddVar = document.getElementById('pc-add-varias');
  if (btnAddVar) btnAddVar.addEventListener('click', (e) => { e.preventDefault(); pcAddLine('varias'); });

  const btnSave = document.getElementById('pc-save');
  if (btnSave) btnSave.addEventListener('click', (e) => { e.preventDefault(); pcSaveDraft(); });

  const btnSaveHist = document.getElementById('pc-save-history');
  if (btnSaveHist) btnSaveHist.addEventListener('click', (e) => { e.preventDefault(); pcSaveToHistory(); });

  const btnDeleteAll = document.getElementById('pc-delete-all');
  if (btnDeleteAll) btnDeleteAll.addEventListener('click', (e) => { e.preventDefault(); pcDeleteAllCurrent(); });

  const btnExport = document.getElementById('pc-export');
  if (btnExport) btnExport.addEventListener('click', (e) => { e.preventDefault(); pcExportCurrentExcel(); });

  const notes = document.getElementById('pc-notes');
  if (notes) {
    notes.addEventListener('input', () => {
      if (!pcCurrent) pcCurrent = pcBuildEmptyCurrent();
      pcCurrent.notes = String(notes.value || '');
    });
  }

  const search = document.getElementById('ph-search');
  if (search) {
    search.addEventListener('input', () => {
      pcHistoryQuery = search.value || '';
      pcRenderHistoryList();
    });
  }

  const clear = document.getElementById('ph-clear');
  if (clear) clear.addEventListener('click', () => {
    pcHistoryQuery = '';
    if (search) search.value = '';
    pcRenderHistoryList();
  });

  const close = document.getElementById('ph-modal-close');
  if (close) close.addEventListener('click', () => pcCloseHistoryModal());

  const modal = document.getElementById('ph-modal');
  if (modal) {
    modal.addEventListener('click', (ev) => {
      if (ev.target === modal) pcCloseHistoryModal();
    });
  }
}

function pcRenderAll() {
  if (!pcCurrent || !pcHistory) return;
  pcRenderCurrent();
  pcRenderHistoryList();
}




/* ---------- Recibos (Etapa 2) ---------- */

let rcList = [];            // histórico completo
let rcCurrent = null;       // recibo activo (view/edit)
let rcPaymentType = 'CASH'; // estado UI
let rcEditorMode = 'edit';  // 'edit' | 'view'
let rcSaving = false;

// Histórico: buscar / filtros
let rcQuery = '';
let rcFilterStatus = 'all'; // all | DRAFT | ISSUED | VOID
let rcFilterFrom = '';      // YYYY-MM-DD
let rcFilterTo = '';        // YYYY-MM-DD
let rcFilterPay = 'all';    // all | CASH | TRANSFER
let rcFilterPanelOpen = false;

function rcPad2(n){ return String(n).padStart(2,'0'); }
function rcTodayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${rcPad2(d.getMonth()+1)}-${rcPad2(d.getDate())}`;
}
function rcLongDateDisplay(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const days = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const dayName = days[dt.getDay()] || '';
  const dd = dt.getDate();
  const mm = months[dt.getMonth()] || '';
  const yyyy = dt.getFullYear();
  // Formato EXACTO requerido: “Martes, 13 de enero del 2026”
  return `${dayName}, ${dd} de ${mm} del ${yyyy}`;
}
function rcDateDisplayFromISO(iso){
  if (!iso || typeof iso !== 'string') return '';
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
function rcMakeId(){
  try {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch(_) {}
  return `rc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
function rcRound2(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function rcSafeNum(v){
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function rcParseNumberOrZero(v){
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) return NaN;
  return n;
}

// Para inputs numéricos editables: mostrar vacío cuando el valor lógico es 0.
// (El placeholder "0" guía visual; el parsing vacío→0 se mantiene en rcParseNumberOrZero).
function rcNumInputValueOrBlank(v){
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (n === 0) return '';
  return String(n);
}
function rcPayLabel(pt){
  return (pt === 'TRANSFER') ? 'TRANSFERENCIA' : 'EFECTIVO';
}
function rcPayPill(pt){
  if (pt === 'TRANSFER') return '<span class="fin-pill fin-pill--transfer">TRANSFERENCIA</span>';
  return '<span class="fin-pill fin-pill--cash">EFECTIVO</span>';
}

const RC_FINANCIAL_STAGE = 'finanzas_multibanco_etapa_8_10_recibos';
const RC_EXCHANGE_WARNING_MESSAGE = 'Configure el tipo de cambio vigente en Configuración → Moneda para registrar recibos en US$.';
const RC_FINANCIAL_ACCOUNT_WARNING_MESSAGE = 'Configure al menos una cuenta financiera activa antes de registrar recibos.';

function rcNormalizeCurrencyCode(value){
  try { return finNormalizeCurrencyCode(value || 'NIO'); } catch (_) {
    const raw = String(value || 'NIO').trim().toUpperCase();
    return (raw === 'USD' || raw === 'US$') ? 'USD' : 'NIO';
  }
}

function rcCurrencySymbol(currency){
  try { return finCurrencySymbol(rcNormalizeCurrencyCode(currency)); } catch (_) {
    return rcNormalizeCurrencyCode(currency) === 'USD' ? 'US$' : 'C$';
  }
}

function rcFormatOriginalMoney(value, currency){
  try { return finFormatOriginalAmount(value, rcNormalizeCurrencyCode(currency)); } catch (_) {
    const symbol = rcCurrencySymbol(currency);
    return `${symbol} ${fmtCurrency(value)}`;
  }
}

function rcGetReceiptCurrency(receipt){
  return rcNormalizeCurrencyCode(receipt && (receipt.monedaOriginal || receipt.originalCurrency || receipt.financialAccountCurrency || receipt.cuentaFinancieraMoneda || 'NIO'));
}

function rcGetReceiptSymbol(receipt){
  const explicit = String(receipt && (receipt.simboloOriginal || receipt.originalSymbol || receipt.financialAccountSymbol || '') || '').trim();
  return explicit || rcCurrencySymbol(rcGetReceiptCurrency(receipt));
}

function rcGetReceiptOriginalTotal(receipt){
  if (!receipt) return 0;
  const explicit = receipt.totalOriginal ?? receipt.originalAmount ?? receipt.montoOriginal;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n;
  }
  return rcSafeNum(receipt.totals && receipt.totals.total);
}

function rcGetReceiptBaseAmount(receipt){
  if (!receipt) return 0;
  const explicit = receipt.baseAmountNio ?? receipt.equivalenteNIO ?? receipt.equivalenteCordobas;
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    const n = Number(explicit);
    if (Number.isFinite(n)) return n;
  }
  const currency = rcGetReceiptCurrency(receipt);
  if (currency === 'NIO') return rcGetReceiptOriginalTotal(receipt);
  return 0;
}

function rcReceiptHasFinancialMetadata(receipt){
  return !!(receipt && (
    receipt.financialAccountId ||
    receipt.cuentaFinancieraId ||
    receipt.financialAccountNameSnapshot ||
    receipt.cuentaFinancieraNombreSnapshot ||
    receipt.receiptCurrencyStage ||
    receipt.journalEntryId ||
    receipt.exchangeRateUsed ||
    receipt.tipoCambioUsado
  ));
}

function rcGetActiveFinancialAccounts(data){
  try { return finGetActiveFinancialAccountsForMovements(data); } catch (_) { return []; }
}

function rcFindFinancialAccount(data, id){
  const key = String(id || '').trim();
  if (!key) return null;
  try {
    if (typeof finFindFinancialAccountById === 'function') return finFindFinancialAccountById(data, key);
  } catch (_) {}
  const rows = Array.isArray(data && data.financialAccounts) ? data.financialAccounts : [];
  return rows.find(row => String(row && (row.id || row.uniqueKey || '')) === key) || null;
}

function rcFinancialAccountLabel(row){
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || 'Cuenta financiera').trim();
  const currency = rcNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || rcCurrencySymbol(currency)).trim();
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  return `${name} · ${symbol} · ${code}${accName ? ' ' + accName : ''}`;
}

function rcPopulateFinancialAccountSelect(data){
  const sel = document.getElementById('rec-financial-account');
  if (!sel) return;
  const prev = sel.value;
  const rows = rcGetActiveFinancialAccounts(data);
  sel.innerHTML = '';

  const first = document.createElement('option');
  first.value = '';
  first.textContent = rows.length ? 'Seleccione cuenta financiera…' : 'Sin cuentas financieras activas';
  sel.appendChild(first);

  for (const row of rows) {
    const opt = document.createElement('option');
    opt.value = String(row.id || row.uniqueKey || '');
    opt.textContent = rcFinancialAccountLabel(row);
    opt.dataset.currency = rcNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
    opt.dataset.accountCode = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
    sel.appendChild(opt);
  }

  if (prev && Array.from(sel.options).some(o => o.value === prev)) sel.value = prev;
  else if (rcCurrent && rcCurrent.financialAccountId && Array.from(sel.options).some(o => o.value === String(rcCurrent.financialAccountId))) sel.value = String(rcCurrent.financialAccountId);

  rcSyncFinancialAccountUI();
}

function rcGetSelectedFinancialAccount(){
  const sel = document.getElementById('rec-financial-account');
  const id = String(sel && sel.value || '').trim();
  if (!id) return null;
  return rcFindFinancialAccount(finCachedData, id);
}

function rcBuildFinancialSnapshot(row, totalOriginal){
  const currency = rcNormalizeCurrencyCode(row && (row.moneda || row.financialAccountCurrency || 'NIO'));
  const symbol = String(row && (row.simbolo || row.financialAccountSymbol) || rcCurrencySymbol(currency));
  const type = String(row && (row.type || row.tipo || 'caja') || 'caja').toLowerCase();
  const code = finNormalizeAccountCode(row && (row.cuentaContableCodigo || row.financialAccountAccountingCode || ''));
  const accName = String(row && (row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '') || '').trim();
  const name = String(row && (row.nombreVisible || row.financialAccountNameSnapshot || '') || '').trim();
  const snapshot = finBuildExchangeRateSnapshot({ currency, amount: totalOriginal });
  const baseAmount = currency === 'USD' ? snapshot.equivalenteNIO : finRoundCurrency2(totalOriginal);
  return {
    ok: !!(snapshot && snapshot.ok),
    warningMessage: snapshot && snapshot.warningMessage ? String(snapshot.warningMessage).replace('movimientos en USD', 'recibos en US$') : '',
    receiptId: rcCurrent && rcCurrent.receiptId ? rcCurrent.receiptId : '',
    totalOriginal: finRoundCurrency2(totalOriginal),
    originalAmount: finRoundCurrency2(totalOriginal),
    montoOriginal: finRoundCurrency2(totalOriginal),
    monedaOriginal: currency,
    originalCurrency: currency,
    simboloOriginal: symbol,
    originalSymbol: symbol,
    financialAccountId: String(row && (row.id || row.uniqueKey || '') || ''),
    cuentaFinancieraId: String(row && (row.id || row.uniqueKey || '') || ''),
    financialAccountNameSnapshot: name,
    cuentaFinancieraNombreSnapshot: name,
    financialAccountType: type,
    cuentaFinancieraTipo: type,
    financialAccountCurrency: currency,
    cuentaFinancieraMoneda: currency,
    financialAccountSymbol: symbol,
    financialAccountAccountingCode: code,
    cuentaFinancieraCodigoContable: code,
    financialAccountAccountingNameSnapshot: accName,
    cuentaFinancieraCuentaNombreSnapshot: accName,
    exchangeRateUsed: currency === 'USD' ? finRoundCurrency2(snapshot && snapshot.tipoCambioUsado) : null,
    tipoCambioUsado: currency === 'USD' ? finRoundCurrency2(snapshot && snapshot.tipoCambioUsado) : null,
    exchangeRateDateSnapshot: currency === 'USD' ? String((snapshot && snapshot.fechaTipoCambio) || '') : '',
    exchangeRateSource: FIN_CURRENCY_SOURCE_LABEL,
    fuenteTipoCambio: FIN_CURRENCY_SOURCE_LABEL,
    baseCurrency: 'NIO',
    monedaBase: 'NIO',
    baseAmountNio: finRoundCurrency2(baseAmount),
    equivalenteNIO: finRoundCurrency2(baseAmount),
    referenciaPago: String(rcCurrent && rcCurrent.paymentRef || '').trim(),
    formaPagoSnapshot: rcPayLabel(rcCurrent && rcCurrent.paymentType),
    bancoNombreSnapshot: String(rcCurrent && rcCurrent.paymentBank || row && row.bancoNombreSnapshot || '').trim(),
    fechaRegistro: new Date().toISOString(),
    exchangeRateDateRaw: finGetCurrencyStateSafe().updatedAtRaw || '',
    exchangeRateUpdatedAtText: finGetCurrencyStateSafe().updatedAtText || '',
    receiptCurrencyStage: RC_FINANCIAL_STAGE,
    a33FinanceStage: RC_FINANCIAL_STAGE
  };
}

function rcApplyFinancialSnapshotToCurrent(){
  if (!rcCurrent) return { ok:false, msg:'No hay recibo en edición.' };
  const rows = rcGetActiveFinancialAccounts(finCachedData);
  if (!rows.length) return { ok:false, msg:RC_FINANCIAL_ACCOUNT_WARNING_MESSAGE };
  const row = rcGetSelectedFinancialAccount();
  if (!row) return { ok:false, msg:'Seleccione la cuenta financiera de cobro.' };
  const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
  const accountsMap = finCachedData && finCachedData.accountsMap ? finCachedData.accountsMap : new Map();
  if (!code || (accountsMap && typeof accountsMap.get === 'function' && !accountsMap.get(code))) {
    return { ok:false, msg:'La cuenta financiera de cobro no tiene una cuenta contable válida asociada.' };
  }
  const currency = rcNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
  const totalOriginal = rcSafeNum(rcCurrent.totals && rcCurrent.totals.total);
  const snap = rcBuildFinancialSnapshot(row, totalOriginal);
  if (currency === 'USD' && !snap.ok) return { ok:false, msg:RC_EXCHANGE_WARNING_MESSAGE };
  Object.assign(rcCurrent, snap);
  return { ok:true, msg:'', row, snapshot:snap };
}

function rcSyncFinancialAccountUI(){
  const sel = document.getElementById('rec-financial-account');
  const meta = document.getElementById('rec-financial-meta');
  const currencyLabel = document.getElementById('rec-currency-label');
  const baseTotal = document.getElementById('rec-base-total');
  const rows = rcGetActiveFinancialAccounts(finCachedData);
  const row = rcGetSelectedFinancialAccount();
  if (sel && rcCurrent && rcCurrent.financialAccountId && sel.value !== rcCurrent.financialAccountId && Array.from(sel.options).some(o => o.value === String(rcCurrent.financialAccountId))) {
    sel.value = String(rcCurrent.financialAccountId);
  }

  const total = rcSafeNum(rcCurrent && rcCurrent.totals && rcCurrent.totals.total);
  let currency = rcGetReceiptCurrency(rcCurrent);
  let symbol = rcGetReceiptSymbol(rcCurrent);
  let base = rcGetReceiptBaseAmount(rcCurrent);
  let rateText = '';

  if (rcEditorMode === 'view' && rcCurrent && !row) {
    if (rcReceiptHasFinancialMetadata(rcCurrent)) {
      const acct = String(rcCurrent.financialAccountNameSnapshot || rcCurrent.cuentaFinancieraNombreSnapshot || 'Cuenta financiera histórica').trim();
      const code = String(rcCurrent.financialAccountAccountingCode || rcCurrent.cuentaFinancieraCodigoContable || '').trim();
      const rate = rcCurrent.exchangeRateUsed || rcCurrent.tipoCambioUsado || null;
      if (currency === 'USD' && rate) rateText = ` · T/C ${Number(rate).toFixed(2)}`;
      if (meta) {
        meta.className = 'fin-movement-meta';
        meta.innerHTML = `${escapeHTML(acct)}${code ? ` · ${escapeHTML(code)}` : ''}<br>${escapeHTML(rcFormatOriginalMoney(rcGetReceiptOriginalTotal(rcCurrent), currency))}${currency === 'USD' ? ` · Eq. ${escapeHTML(finFormatCordobas(base))}${rate ? ` · T/C ${escapeHTML(Number(rate).toFixed(2))}` : ''}` : ''}`;
      }
      if (currencyLabel) currencyLabel.textContent = `${symbol} / ${currency}${rateText}`;
      if (baseTotal) baseTotal.textContent = finFormatCordobas(base || 0);
      const elSub = document.getElementById('rec-subtotal');
      const elDisc = document.getElementById('rec-discount');
      const elTot = document.getElementById('rec-total');
      if (elSub) elSub.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.subtotal), currency);
      if (elDisc) elDisc.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.discountTotal), currency);
      if (elTot) elTot.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.total), currency);
      return;
    }
    if (meta) {
      meta.className = 'fin-movement-meta';
      meta.textContent = 'Recibo histórico sin metadata multicuenta/multimoneda. Se conserva como estaba.';
    }
    currency = 'NIO'; symbol = rcCurrencySymbol(currency); base = total;
    if (currencyLabel) currencyLabel.textContent = `${symbol} / ${currency}`;
    if (baseTotal) baseTotal.textContent = finFormatCordobas(base || 0);
    const elSub = document.getElementById('rec-subtotal');
    const elDisc = document.getElementById('rec-discount');
    const elTot = document.getElementById('rec-total');
    if (elSub) elSub.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.subtotal), currency);
    if (elDisc) elDisc.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.discountTotal), currency);
    if (elTot) elTot.textContent = rcFormatOriginalMoney(rcSafeNum(rcCurrent.totals && rcCurrent.totals.total), currency);
    return;
  }

  if (!rows.length) {
    if (meta) { meta.className = 'fin-movement-meta is-warn'; meta.textContent = RC_FINANCIAL_ACCOUNT_WARNING_MESSAGE; }
    currency = 'NIO'; symbol = rcCurrencySymbol(currency); base = total;
  } else if (!row) {
    if (meta) { meta.className = 'fin-movement-meta'; meta.textContent = 'Seleccione una cuenta financiera activa para detectar moneda, cuenta contable y equivalente C$.'; }
  } else {
    currency = rcNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
    symbol = String(row.simbolo || row.financialAccountSymbol || rcCurrencySymbol(currency));
    const code = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
    const name = String(row.nombreVisible || row.financialAccountNameSnapshot || 'Cuenta financiera');
    const type = finFinancialAccountTypeLabel(row.type || row.tipo || 'caja');
    const accName = String(row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '').trim();
    if (currency === 'USD') {
      const state = finGetCurrencyStateSafe();
      if (!state.hasExchangeRate) {
        if (meta) {
          meta.className = 'fin-movement-meta is-warn';
          meta.innerHTML = `${escapeHTML(name)} · US$ / USD · ${escapeHTML(code)} ${escapeHTML(accName)}<br>${escapeHTML(RC_EXCHANGE_WARNING_MESSAGE)}`;
        }
        base = 0;
      } else {
        const converted = finConvertUsdToCordobas(total, state.exchangeRate);
        base = converted.ok ? converted.value : 0;
        rateText = ` · T/C ${Number(state.exchangeRate).toFixed(2)}`;
        if (meta) {
          meta.className = 'fin-movement-meta';
          meta.innerHTML = `${escapeHTML(name)} · ${escapeHTML(type)} · US$ / USD · ${escapeHTML(code)} ${escapeHTML(accName)}<br>${escapeHTML(rcFormatOriginalMoney(total, 'USD'))} × ${escapeHTML(Number(state.exchangeRate).toFixed(2))} = ${escapeHTML(finFormatCordobas(base))} · Fuente: ${escapeHTML(FIN_CURRENCY_SOURCE_LABEL)}`;
        }
      }
    } else {
      base = finRoundCurrency2(total);
      if (meta) {
        meta.className = 'fin-movement-meta';
        meta.innerHTML = `${escapeHTML(name)} · ${escapeHTML(type)} · C$ / NIO · ${escapeHTML(code)} ${escapeHTML(accName)}<br>Equivalente contable: ${escapeHTML(finFormatCordobas(base))}`;
      }
    }
  }

  if (currencyLabel) currencyLabel.textContent = `${symbol} / ${currency}${rateText}`;
  if (baseTotal) baseTotal.textContent = finFormatCordobas(base || 0);

  const elSub = document.getElementById('rec-subtotal');
  const elDisc = document.getElementById('rec-discount');
  const elTot = document.getElementById('rec-total');
  if (rcCurrent) {
    const sub = rcSafeNum(rcCurrent.totals && rcCurrent.totals.subtotal);
    const disc = rcSafeNum(rcCurrent.totals && rcCurrent.totals.discountTotal);
    const tot = rcSafeNum(rcCurrent.totals && rcCurrent.totals.total);
    if (elSub) elSub.textContent = rcFormatOriginalMoney(sub, currency);
    if (elDisc) elDisc.textContent = rcFormatOriginalMoney(disc, currency);
    if (elTot) elTot.textContent = rcFormatOriginalMoney(tot, currency);
  }
}

function rcSanitizeFilePart(s){
  // Reglas: sin caracteres inválidos / \ : * ? " < > |
  let out = String(s || '').trim();
  out = out.replace(/[\u0000-\u001F\u007F]/g, '');
  out = out.replace(/[\\/:*?"<>|]/g, '');
  out = out.replace(/\s+/g, ' ').trim();
  // Evitar nombres vacíos
  return out || 'Cliente';
}

function rcDDMMYYYYFromISO(iso){
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}${m[2]}${m[1]}`;
}

function rcNumber4(n){
  if (n == null || n === '') return '';
  const raw = String(n).trim();
  const asInt = parseInt(raw, 10);
  if (Number.isFinite(asInt)) return String(asInt).padStart(4,'0');
  return raw;
}

function rcSuggestedPdfName(receipt){
  const num = rcNumber4(receipt?.number);
  const cli = rcSanitizeFilePart(receipt?.clientName);
  const ddmmyyyy = rcDDMMYYYYFromISO(receipt?.dateISO);
  const parts = [];
  if (num) parts.push(`${num}-`);
  parts.push(cli);
  if (ddmmyyyy) parts.push(ddmmyyyy);
  return parts.join(' ').replace(/\s+/g,' ').trim();
}

function rcNextConsecutive4(){
  let max = 0;
  for (const r of (rcList || [])) {
    const raw = (r && r.number != null) ? String(r.number).trim() : '';
    if (!raw) continue;
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  const next = max + 1;
  if (next <= 9999) return String(next).padStart(4, '0');
  return String(next);
}

function rcNormalizeReceipt(r){
  const nowISO = new Date().toISOString();
  // Compatibilidad: si un recibo viejo no trae fecha, NO inventar una.
  const dateISO = (r && typeof r.dateISO === 'string' && r.dateISO.trim()) ? String(r.dateISO).trim() : '';
  const out = {
    receiptId: r && r.receiptId ? String(r.receiptId) : rcMakeId(),
    number: (r && (r.number !== undefined)) ? r.number : null,
    status: r && r.status ? String(r.status) : 'DRAFT',
    issuedAt: r && r.issuedAt ? String(r.issuedAt) : null,
    voidedAt: r && r.voidedAt ? String(r.voidedAt) : null,
    voidReason: r && r.voidReason ? String(r.voidReason) : '',
    reissuedFrom: r && r.reissuedFrom ? String(r.reissuedFrom) : null,
    createdAt: r && r.createdAt ? String(r.createdAt) : nowISO,
    updatedAt: r && r.updatedAt ? String(r.updatedAt) : nowISO,
    dateISO,
    dateDisplay: (r && r.dateDisplay) ? String(r.dateDisplay) : (dateISO ? rcDateDisplayFromISO(dateISO) : ''),
    clientName: r && r.clientName ? String(r.clientName) : '',
    clientPhone: r && r.clientPhone ? String(r.clientPhone) : '',
    paymentType: r && r.paymentType ? String(r.paymentType) : 'CASH',
    paymentBank: (r && (r.paymentBank !== undefined && r.paymentBank !== null)) ? String(r.paymentBank) : '',
    paymentRef: (r && (r.paymentRef !== undefined && r.paymentRef !== null)) ? String(r.paymentRef) : '',
    lines: Array.isArray(r && r.lines) ? r.lines.map(l => ({
      itemName: l && l.itemName ? String(l.itemName) : '',
      qty: rcSafeNum(l && l.qty),
      unitPrice: rcSafeNum(l && l.unitPrice),
      discountPerUnit: rcSafeNum(l && l.discountPerUnit),
      lineTotal: rcSafeNum(l && l.lineTotal)
    })) : [],
    totals: (r && r.totals && typeof r.totals === 'object') ? {
      subtotal: rcSafeNum(r.totals.subtotal),
      discountTotal: rcSafeNum(r.totals.discountTotal),
      total: rcSafeNum(r.totals.total)
    } : { subtotal: 0, discountTotal: 0, total: 0 },
    totalOriginal: rcSafeNum(r && (r.totalOriginal ?? r.originalAmount ?? r.montoOriginal ?? (r.totals && r.totals.total))),
    originalAmount: rcSafeNum(r && (r.originalAmount ?? r.totalOriginal ?? r.montoOriginal ?? (r.totals && r.totals.total))),
    montoOriginal: rcSafeNum(r && (r.montoOriginal ?? r.totalOriginal ?? r.originalAmount ?? (r.totals && r.totals.total))),
    monedaOriginal: rcNormalizeCurrencyCode(r && (r.monedaOriginal || r.originalCurrency || r.financialAccountCurrency || r.cuentaFinancieraMoneda || 'NIO')),
    originalCurrency: rcNormalizeCurrencyCode(r && (r.originalCurrency || r.monedaOriginal || r.financialAccountCurrency || r.cuentaFinancieraMoneda || 'NIO')),
    simboloOriginal: String(r && (r.simboloOriginal || r.originalSymbol || r.financialAccountSymbol || '') || '').trim(),
    financialAccountId: String(r && (r.financialAccountId || r.cuentaFinancieraId || '') || '').trim(),
    cuentaFinancieraId: String(r && (r.cuentaFinancieraId || r.financialAccountId || '') || '').trim(),
    financialAccountNameSnapshot: String(r && (r.financialAccountNameSnapshot || r.cuentaFinancieraNombreSnapshot || '') || '').trim(),
    cuentaFinancieraNombreSnapshot: String(r && (r.cuentaFinancieraNombreSnapshot || r.financialAccountNameSnapshot || '') || '').trim(),
    financialAccountType: String(r && (r.financialAccountType || r.cuentaFinancieraTipo || '') || '').trim(),
    financialAccountCurrency: rcNormalizeCurrencyCode(r && (r.financialAccountCurrency || r.cuentaFinancieraMoneda || r.monedaOriginal || 'NIO')),
    financialAccountSymbol: String(r && (r.financialAccountSymbol || r.simboloOriginal || '') || '').trim(),
    financialAccountAccountingCode: finNormalizeAccountCode(r && (r.financialAccountAccountingCode || r.cuentaFinancieraCodigoContable || '')),
    financialAccountAccountingNameSnapshot: String(r && (r.financialAccountAccountingNameSnapshot || r.cuentaFinancieraCuentaNombreSnapshot || '') || '').trim(),
    exchangeRateUsed: (r && (r.exchangeRateUsed ?? r.tipoCambioUsado)) != null && (r && (r.exchangeRateUsed ?? r.tipoCambioUsado)) !== '' ? finRoundCurrency2(r.exchangeRateUsed ?? r.tipoCambioUsado) : null,
    tipoCambioUsado: (r && (r.tipoCambioUsado ?? r.exchangeRateUsed)) != null && (r && (r.tipoCambioUsado ?? r.exchangeRateUsed)) !== '' ? finRoundCurrency2(r.tipoCambioUsado ?? r.exchangeRateUsed) : null,
    exchangeRateDateSnapshot: String(r && (r.exchangeRateDateSnapshot || r.fechaTipoCambio || '') || '').trim(),
    exchangeRateSource: String(r && (r.exchangeRateSource || r.fuenteTipoCambio || '') || '').trim(),
    baseCurrency: rcNormalizeCurrencyCode(r && (r.baseCurrency || r.monedaBase || 'NIO')),
    baseAmountNio: rcSafeNum(r && (r.baseAmountNio ?? r.equivalenteNIO ?? r.equivalenteCordobas ?? (r.totals && r.totals.total))),
    equivalenteNIO: rcSafeNum(r && (r.equivalenteNIO ?? r.baseAmountNio ?? r.equivalenteCordobas ?? (r.totals && r.totals.total))),
    referenciaPago: String(r && (r.referenciaPago || r.paymentRef || '') || '').trim(),
    formaPagoSnapshot: String(r && (r.formaPagoSnapshot || '') || '').trim(),
    bancoNombreSnapshot: String(r && (r.bancoNombreSnapshot || r.paymentBank || '') || '').trim(),
    journalEntryId: r && r.journalEntryId ? String(r.journalEntryId) : '',
    fechaRegistro: String(r && (r.fechaRegistro || '') || '').trim(),
    receiptCurrencyStage: String(r && (r.receiptCurrencyStage || r.a33FinanceStage || '') || '').trim(),
    operationalClass: finInferReceiptOperationalClass(r),
    clasificacionOperativa: finInferReceiptOperationalClass(r),
    operationalClassLabel: finOperationalClassLabel(finInferReceiptOperationalClass(r)),
    operationalStage: FIN_OPERATIONAL_CLASS_STAGE
  };

  if (!out.lines.length) {
    out.lines = [{ itemName: '', qty: 1, unitPrice: 0, discountPerUnit: 0, lineTotal: 0 }];
  }

  if (out.paymentType !== 'CASH' && out.paymentType !== 'TRANSFER') out.paymentType = 'CASH';
  if (out.paymentType === 'CASH') { out.paymentBank = ''; out.paymentRef = ''; }

  rcRecalc(out);
  return out;
}

async function rcLoadAll(){
  try {
    const arr = await finGetAll('receipts');
    rcList = (arr || []).map(rcNormalizeReceipt);
    rcList.sort((a,b) => {
      const da = a.dateISO || '';
      const db = b.dateISO || '';
      if (da !== db) return db.localeCompare(da);
      const ua = a.updatedAt || '';
      const ub = b.updatedAt || '';
      return ub.localeCompare(ua);
    });
  } catch (e) {
    rcList = [];
  }
}

function rcStatusPill(status){
  const s = String(status || 'DRAFT');
  if (s === 'ISSUED') return '<span class="fin-pill fin-pill--green">EMITIDO</span>';
  if (s === 'VOID') return '<span class="fin-pill fin-pill--red">ANULADO</span>';
  return '<span class="fin-pill fin-pill--muted">BORRADOR</span>';
}

function rcFmtMoney(v){ return finFormatCordobas(v); }

function rcHasActiveFilters(){
  return Boolean(String(rcQuery||'').trim())
    || (rcFilterStatus && rcFilterStatus !== 'all')
    || (rcFilterPay && rcFilterPay !== 'all')
    || Boolean(rcFilterFrom)
    || Boolean(rcFilterTo);
}

function rcMatchesQuery(r, q){
  const qq = String(q || '').trim().toLowerCase();
  if (!qq) return true;

  const client = String(r.clientName || '').toLowerCase();

  // N°: aceptar búsqueda por "1" y también por "0001" (si el número existe)
  let num = '';
  let numPad = '';
  if (!(r.number === null || r.number === undefined || r.number === '')) {
    num = String(r.number).toLowerCase();
    const n = Number(r.number);
    if (Number.isFinite(n)) numPad = String(Math.trunc(n)).padStart(4,'0').toLowerCase();
  }

  return client.includes(qq) || (num && num.includes(qq)) || (numPad && numPad.includes(qq));
}

function rcInDateRange(r){
  const d = String(r.dateISO || '');
  if (rcFilterFrom && d && d < rcFilterFrom) return false;
  if (rcFilterTo && d && d > rcFilterTo) return false;
  return true;
}

function rcFilteredList(){
  const q = String(rcQuery || '').trim();
  return (rcList || []).filter(r => {
    if (!rcMatchesQuery(r, q)) return false;
    if (rcFilterStatus && rcFilterStatus !== 'all' && String(r.status||'') !== rcFilterStatus) return false;
    if (rcFilterPay && rcFilterPay !== 'all' && String(r.paymentType||'') !== rcFilterPay) return false;
    if (!rcInDateRange(r)) return false;
    return true;
  });
}

function rcRenderList(){
  const tbody = document.getElementById('rec-tbody');
  const cnt = document.getElementById('rec-count');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filtered = rcFilteredList();
  if (cnt) {
    if (!rcList.length) cnt.textContent = 'Sin recibos aún';
    else if (rcHasActiveFilters()) cnt.textContent = `${filtered.length}/${rcList.length} recibo(s)`;
    else cnt.textContent = `${rcList.length} recibo(s)`;
  }

  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7" class="fin-muted" style="padding:12px;">No hay resultados con esos filtros.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const r of filtered) {
    const tr = document.createElement('tr');
    tr.dataset.rcid = r.receiptId;

    const num = (r.number === null || r.number === undefined || r.number === '') ? '—' : String(r.number);
    // En histórico, mostrar fecha compacta para no romper layout.
    const fecha = (r.dateISO ? rcDateDisplayFromISO(r.dateISO) : (r.dateDisplay || '')) || '—';
    const cli = r.clientName || '—';
    const total = (r.totals && Number.isFinite(Number(r.totals.total))) ? Number(r.totals.total) : 0;
    const currency = rcGetReceiptCurrency(r);
    const totalOriginal = rcGetReceiptOriginalTotal(r);
    const baseAmount = rcGetReceiptBaseAmount(r);
    const acctName = String(r.financialAccountNameSnapshot || r.cuentaFinancieraNombreSnapshot || '').trim();
    const ref = String(r.paymentRef || r.referenciaPago || '').trim();
    const rate = r.exchangeRateUsed || r.tipoCambioUsado || null;
    const opClass = finNormalizeOperationalClass(r.operationalClass || r.clasificacionOperativa, FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);
    const opLabel = finOperationalClassLabel(opClass);

    const st = String(r.status || 'DRAFT');
    const canEdit = st === 'DRAFT';
    const canVoid = st === 'ISSUED';
    const canReemit = (st === 'ISSUED' || st === 'VOID');
    const canPrint = (st === 'ISSUED' || st === 'VOID');

    tr.innerHTML = `
      <td>${escapeHTML(num)}</td>
      <td>${escapeHTML(fecha)}</td>
      <td><span class="fin-cell-text fin-clamp-2">${escapeHTML(cli)}</span><div class="rec-account-mini">${escapeHTML(opLabel)}</div></td>
      <td>
        ${rcPayPill(r.paymentType)}
        ${(acctName || ref) ? `<div class="rec-account-mini">${acctName ? escapeHTML(acctName) : ''}${ref ? `${acctName ? ' · ' : ''}Ref: ${escapeHTML(ref)}` : ''}</div>` : ''}
      </td>
      <td class="num"><div class="rec-total-stack"><strong>${rcFormatOriginalMoney(totalOriginal || total, currency)}</strong>${currency === 'USD' ? `<span>Eq. ${escapeHTML(finFormatCordobas(baseAmount))}</span>${rate ? `<span>T/C ${escapeHTML(Number(rate).toFixed(2))}</span>` : ''}` : ''}</div></td>
      <td>${rcStatusPill(r.status)}</td>
      <td class="fin-actions-cell">
        <div class="fin-actions-inline">
          <button type="button" class="btn-small" data-act="view">Ver</button>
          ${canPrint ? `<button type="button" class="btn-small" data-act="print">Imprimir/PDF</button>` : ``}
          ${canEdit ? `<button type="button" class="btn-small" data-act="edit">Editar</button>` : ``}
          ${canVoid ? `<button type="button" class="btn-small" data-act="void">Anular</button>` : ``}
          ${canReemit ? `<button type="button" class="btn-small" data-act="reemit">Reemitir</button>` : ``}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function rcShowAlert(msg, kind='info'){
  const el = document.getElementById('rec-alert');
  if (!el) return;
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.innerHTML = `<strong>${kind === 'error' ? 'Error' : 'Aviso'}:</strong> ${escapeHTML(String(msg))}`;
}

function rcToggleEditor(show){
  const list = document.getElementById('recibos-list');
  const editor = document.getElementById('recibos-editor');
  if (!list || !editor) return;
  if (show) {
    list.classList.add('hidden');
    editor.classList.remove('hidden');
  } else {
    editor.classList.add('hidden');
    list.classList.remove('hidden');
  }
}

function rcUpdateEditorMeta(){
  const meta = document.getElementById('rec-editor-meta');
  if (!meta || !rcCurrent) return;

  const num = (rcCurrent.number === null || rcCurrent.number === undefined || rcCurrent.number === '') ? '—' : String(rcCurrent.number);
  const st = String(rcCurrent.status || 'DRAFT');
  const stLabel = (st === 'ISSUED') ? 'EMITIDO' : (st === 'VOID') ? 'ANULADO' : 'BORRADOR';
  const pay = rcPayLabel(rcCurrent.paymentType);
  const bank = String(rcCurrent.paymentBank || '').trim();
  const ref = String(rcCurrent.paymentRef || '').trim();

  const fecha = String(rcCurrent.dateDisplay || rcDateDisplayFromISO(rcCurrent.dateISO) || '').trim();
  const parts = [
    `N°: ${escapeHTML(num)}`,
    `Fecha: ${escapeHTML(fecha || '—')}`,
    `Estado: ${escapeHTML(stLabel)}`,
    `Pago: ${escapeHTML(pay)}`
  ];
  if (rcCurrent.paymentType === 'TRANSFER' && bank) parts.push(`Banco: ${escapeHTML(bank)}`);
  if (rcCurrent.paymentType === 'TRANSFER' && ref) parts.push(`Ref: ${escapeHTML(ref)}`);
  const faName = String(rcCurrent.financialAccountNameSnapshot || rcCurrent.cuentaFinancieraNombreSnapshot || '').trim();
  const cur = rcGetReceiptCurrency(rcCurrent);
  if (faName) parts.push(`Cuenta: ${escapeHTML(faName)}`);
  if (rcReceiptHasFinancialMetadata(rcCurrent)) parts.push(`Moneda: ${escapeHTML(rcGetReceiptSymbol(rcCurrent))}/${escapeHTML(cur)}`);
  if (cur === 'USD' && (rcCurrent.exchangeRateUsed || rcCurrent.tipoCambioUsado)) parts.push(`T/C: ${escapeHTML(Number(rcCurrent.exchangeRateUsed || rcCurrent.tipoCambioUsado).toFixed(2))}`);

  if (st === 'VOID') {
    const vr = String(rcCurrent.voidReason || '').trim();
    if (vr) parts.push(`Motivo: ${escapeHTML(vr)}`);
  }

  if (rcCurrent.reissuedFrom) {
    let fromLabel = String(rcCurrent.reissuedFrom);
    const hit = (rcList || []).find(x => x && x.receiptId === rcCurrent.reissuedFrom);
    if (hit && hit.number != null && hit.number !== '') fromLabel = `N° ${String(hit.number)}`;
    else if (fromLabel.length > 12) fromLabel = fromLabel.slice(0, 12) + '…';
    parts.push(`Reemitido de: ${escapeHTML(fromLabel)}`);
  }

  meta.textContent = parts.join(' · ');
}

function rcSetEditorMode(mode){
  rcEditorMode = (mode === 'view') ? 'view' : 'edit';

  const editor = document.getElementById('recibos-editor');
  if (editor) editor.classList.toggle('rec-readonly', rcEditorMode === 'view');

  const title = document.getElementById('rec-editor-title');
  const hint = document.getElementById('rec-mode-hint');
  if (title) title.textContent = (rcEditorMode === 'view') ? 'Detalle de recibo' : 'Editar borrador';
  if (hint) hint.textContent = (rcEditorMode === 'view')
    ? 'Modo lectura.'
    : 'Modo edición (solo BORRADOR).';

  const isView = (rcEditorMode === 'view');

  const idsDisable = ['rec-client','rec-date','rec-bank','rec-ref','rec-financial-account','rec-operational-class'];
  idsDisable.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = isView;
  });

  const bCash = document.getElementById('rec-pay-cash');
  const bTr = document.getElementById('rec-pay-transfer');
  if (bCash) bCash.disabled = isView;
  if (bTr) bTr.disabled = isView;

  const btnSave = document.getElementById('rec-save');
  const btnIssue = document.getElementById('rec-issue');
  const btnAdd = document.getElementById('rec-add-line');
  const btnPrint = document.getElementById('rec-print');
  if (btnSave) btnSave.classList.toggle('hidden', isView);
  if (btnIssue) btnIssue.classList.toggle('hidden', isView);
  if (btnAdd) btnAdd.classList.toggle('hidden', isView);

  // Imprimir solo en lectura y solo para EMITIDO/ANULADO (no aplica a borrador)
  const st = rcCurrent ? String(rcCurrent.status || 'DRAFT') : 'DRAFT';
  const canPrint = (st === 'ISSUED' || st === 'VOID');
  if (btnPrint) btnPrint.classList.toggle('hidden', !(isView && canPrint));
  if (btnPrint) btnPrint.disabled = rcSaving;

  // Etiqueta del botón cancelar/volver
  const btnCancel = document.getElementById('rec-cancel');
  if (btnCancel) btnCancel.textContent = isView ? 'Volver' : 'Cancelar';

  // Aplicar disabled a inputs de líneas, por si ya están renderizadas
  const linesTbody = document.getElementById('rec-lines-tbody');
  if (linesTbody) {
    linesTbody.querySelectorAll('input').forEach(inp => inp.disabled = isView);
    linesTbody.querySelectorAll('button[data-act="del"]').forEach(btn => btn.disabled = isView);
  }
}

function rcSetPaymentType(pt){
  rcPaymentType = (pt === 'TRANSFER') ? 'TRANSFER' : 'CASH';
  const bCash = document.getElementById('rec-pay-cash');
  const bTr = document.getElementById('rec-pay-transfer');

  const bankWrap = document.getElementById('rec-bank-wrap');
  const bankInput = document.getElementById('rec-bank');
  const refWrap = document.getElementById('rec-ref-wrap');
  const refInput = document.getElementById('rec-ref');

  if (bCash) bCash.classList.toggle('active', rcPaymentType === 'CASH');
  if (bTr) bTr.classList.toggle('active', rcPaymentType === 'TRANSFER');

  const isTransfer = (rcPaymentType === 'TRANSFER');
  if (bankWrap) bankWrap.classList.toggle('hidden', !isTransfer);
  if (refWrap) refWrap.classList.toggle('hidden', !isTransfer);

  if (rcCurrent) {
    rcCurrent.paymentType = rcPaymentType;
    if (rcPaymentType === 'CASH') {
      rcCurrent.paymentBank = '';
      rcCurrent.paymentRef = '';
      if (bankInput) bankInput.value = '';
      if (refInput) refInput.value = '';
    }
  }

  rcUpdateEditorMeta();
  try { rcSyncFinancialAccountUI(); } catch (_) {}
}

function rcRecalc(r){
  const receipt = r || rcCurrent;
  if (!receipt) return;
  let subtotal = 0;
  let discountTotal = 0;

  for (const line of (receipt.lines || [])) {
    const q = rcSafeNum(line.qty);
    const u = rcSafeNum(line.unitPrice);
    const d = rcSafeNum(line.discountPerUnit);

    const ls = q * u;
    const ld = q * d;
    const lt = ls - ld;

    line.qty = q;
    line.unitPrice = u;
    line.discountPerUnit = d;
    line.lineTotal = rcRound2(lt);

    subtotal += ls;
    discountTotal += ld;
  }

  const total = subtotal - discountTotal;
  receipt.totals = {
    subtotal: rcRound2(subtotal),
    discountTotal: rcRound2(discountTotal),
    total: rcRound2(total)
  };

  const elSub = document.getElementById('rec-subtotal');
  const elDisc = document.getElementById('rec-discount');
  const elTot = document.getElementById('rec-total');
  if (elSub) elSub.textContent = rcFmtMoney(receipt.totals.subtotal);
  if (elDisc) elDisc.textContent = rcFmtMoney(receipt.totals.discountTotal);
  if (elTot) elTot.textContent = rcFmtMoney(receipt.totals.total);

  if (receipt === rcCurrent) {
    try { rcSyncFinancialAccountUI(); } catch (_) {}
  }
}

function rcRenderLines(){
  const tbody = document.getElementById('rec-lines-tbody');
  if (!tbody || !rcCurrent) return;
  tbody.innerHTML = '';

  const isView = (rcEditorMode === 'view');

  rcCurrent.lines = Array.isArray(rcCurrent.lines) ? rcCurrent.lines : [];
  if (!rcCurrent.lines.length) rcCurrent.lines.push({ itemName: '', qty: 1, unitPrice: 0, discountPerUnit: 0, lineTotal: 0 });

  rcCurrent.lines.forEach((ln, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = String(idx);

    const dis = isView ? 'disabled' : '';
    const delBtn = isView ? '' : `<button type="button" class="btn-danger" data-act="del" title="Eliminar">×</button>`;

    tr.innerHTML = `
      <td><input type="text" ${dis} data-f="itemName" value="${escapeAttr(ln.itemName || '')}" placeholder="Ej: Djeba 750 ml"></td>
      <td class="num"><input type="number" ${dis} inputmode="decimal" step="1" min="0" data-f="qty" value="${escapeAttr(rcNumInputValueOrBlank(ln.qty))}" placeholder="0"></td>
      <td class="num"><input type="number" ${dis} inputmode="decimal" step="0.01" min="0" data-f="unitPrice" value="${escapeAttr(rcNumInputValueOrBlank(ln.unitPrice))}" placeholder="0"></td>
      <td class="num"><input type="number" ${dis} inputmode="decimal" step="0.01" min="0" data-f="discountPerUnit" value="${escapeAttr(rcNumInputValueOrBlank(ln.discountPerUnit))}" placeholder="0"></td>
      <td class="num"><span class="rec-line-total">${rcFmtMoney(ln.lineTotal || 0)}</span></td>
      <td class="num">${delBtn}</td>
    `;
    tbody.appendChild(tr);
  });

  rcRecalc(rcCurrent);
}

function rcFillEditor(){
  if (!rcCurrent) return;
  const id = document.getElementById('rec-id');
  const cli = document.getElementById('rec-client');
  const date = document.getElementById('rec-date');
  const bank = document.getElementById('rec-bank');
  const ref = document.getElementById('rec-ref');
  const fa = document.getElementById('rec-financial-account');
  const op = document.getElementById('rec-operational-class');

  if (id) id.value = rcCurrent.receiptId;
  if (cli) cli.value = rcCurrent.clientName || '';
  // No fabricar fecha para recibos viejos sin dateISO.
  if (date) date.value = rcCurrent.dateISO || '';
  if (bank) bank.value = rcCurrent.paymentBank || '';
  if (ref) ref.value = rcCurrent.paymentRef || '';
  if (fa) {
    rcPopulateFinancialAccountSelect(finCachedData);
    fa.value = rcCurrent.financialAccountId || rcCurrent.cuentaFinancieraId || '';
  }
  if (op) op.value = finNormalizeOperationalClass(rcCurrent.operationalClass || rcCurrent.clasificacionOperativa, FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);

  rcSetPaymentType(rcCurrent.paymentType || 'CASH');
  rcRenderLines();
  rcShowAlert('');
  rcUpdateEditorMeta();
  rcSetEditorMode(rcEditorMode); // reaplica disabled/hides
}

function rcNewDraft(){
  const now = new Date();
  const dateISO = rcTodayISO();
  rcCurrent = rcNormalizeReceipt({
    receiptId: rcMakeId(),
    number: null,
    status: 'DRAFT',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    dateISO,
    dateDisplay: rcDateDisplayFromISO(dateISO),
    clientName: '',
    paymentType: 'CASH',
    paymentBank: '',
    paymentRef: '',
    financialAccountId: '',
    cuentaFinancieraId: '',
    monedaOriginal: 'NIO',
    simboloOriginal: rcCurrencySymbol('NIO'),
    baseCurrency: 'NIO',
    baseAmountNio: 0,
    exchangeRateSource: FIN_CURRENCY_SOURCE_LABEL,
    operationalClass: FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME,
    clasificacionOperativa: FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME,
    operationalStage: FIN_OPERATIONAL_CLASS_STAGE,
    lines: [{ itemName: '', qty: 1, unitPrice: 0, discountPerUnit: 0, lineTotal: 0 }],
    totals: { subtotal: 0, discountTotal: 0, total: 0 }
  });
  rcEditorMode = 'edit';
  rcToggleEditor(true);
  rcFillEditor();
}

function rcOpenReceiptById(id, mode){
  const found = rcList.find(r => r.receiptId === id);
  if (!found) return;

  const st = String(found.status || 'DRAFT');
  const want = (mode === 'edit') ? 'edit' : 'view';
  rcEditorMode = (want === 'edit' && st === 'DRAFT') ? 'edit' : 'view';

  rcCurrent = rcNormalizeReceipt(found);
  rcToggleEditor(true);
  rcFillEditor();
}

function rcValidateCurrent(opts={}){
  if (!rcCurrent) return { ok:false, msg:'No hay recibo en edición.' };

  const forIssue = !!(opts && opts.forIssue);

  const clientName = String(rcCurrent.clientName || '').trim();
  if (!clientName) return { ok:false, msg:'Cliente es obligatorio.' };

  const dateISO = String(rcCurrent.dateISO || '').trim();
  if (!dateISO) return { ok:false, msg:'Fecha es obligatoria.' };

  const pt = rcCurrent.paymentType;
  if (pt !== 'CASH' && pt !== 'TRANSFER') return { ok:false, msg:'Tipo de pago inválido.' };

  const bank = String(rcCurrent.paymentBank || '').trim();
  const ref = String(rcCurrent.paymentRef || '').trim();

  if (pt === 'TRANSFER') {
    if (forIssue && !bank) return { ok:false, msg:'Banco requerido para Transferencia.' };
    // Referencia opcional
    rcCurrent.paymentBank = bank;
    rcCurrent.paymentRef = ref; // puede ser ''
  } else {
    // EFECTIVO: no se usan campos de transferencia
    rcCurrent.paymentBank = '';
    rcCurrent.paymentRef = '';
  }


  const lines = Array.isArray(rcCurrent.lines) ? rcCurrent.lines : [];
  if (!lines.length) return { ok:false, msg:'Debe existir al menos 1 línea.' };

  for (let i=0;i<lines.length;i++){
    const ln = lines[i] || {};
    const item = String(ln.itemName || '').trim();
    if (!item) return { ok:false, msg:`Línea ${i+1}: ítem es obligatorio.` };

    const qty = rcParseNumberOrZero(ln.qty);
    const unit = rcParseNumberOrZero(ln.unitPrice);
    const disc = rcParseNumberOrZero(ln.discountPerUnit);

    // No NaN / Infinity
    if (!Number.isFinite(qty) || !Number.isFinite(unit) || !Number.isFinite(disc)) {
      return { ok:false, msg:`Línea ${i+1}: qty/precio/descuento deben ser numéricos válidos.` };
    }

    // Validaciones solicitadas
    if (qty <= 0) return { ok:false, msg:`Línea ${i+1}: qty debe ser > 0.` };
    if (unit < 0) return { ok:false, msg:`Línea ${i+1}: precio no puede ser negativo.` };
    if (disc < 0) return { ok:false, msg:`Línea ${i+1}: descuento por unidad no puede ser negativo.` };

    // Normalizar valores ya validados
    ln.qty = qty;
    ln.unitPrice = unit;
    ln.discountPerUnit = disc;
  }

  rcRecalc(rcCurrent);

  const t = rcCurrent.totals || {};
  if (![t.subtotal, t.discountTotal, t.total].every(x => Number.isFinite(Number(x)))) {
    return { ok:false, msg:'Totales inválidos.' };
  }
  if (Number(t.total) <= 0) return { ok:false, msg:'El total del recibo debe ser mayor que 0.' };

  const finSnap = rcApplyFinancialSnapshotToCurrent();
  if (!finSnap.ok) return { ok:false, msg:finSnap.msg || 'Cuenta financiera inválida.' };

  const opSel = document.getElementById('rec-operational-class');
  const opClass = finNormalizeOperationalClass(opSel ? opSel.value : (rcCurrent.operationalClass || rcCurrent.clasificacionOperativa), FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);

  rcCurrent.clientName = clientName;
  rcCurrent.dateISO = dateISO;
  rcCurrent.dateDisplay = rcDateDisplayFromISO(dateISO);
  rcCurrent.operationalClass = opClass;
  rcCurrent.clasificacionOperativa = opClass;
  rcCurrent.operationalClassLabel = finOperationalClassLabel(opClass);
  rcCurrent.operationalStage = FIN_OPERATIONAL_CLASS_STAGE;

  return { ok:true, msg:'' };
}

function rcSetSaving(on){
  rcSaving = Boolean(on);
  const btnSave = document.getElementById('rec-save');
  const btnIssue = document.getElementById('rec-issue');
  const btnPrint = document.getElementById('rec-print');
  const btnCancel = document.getElementById('rec-cancel');
  const btnAdd = document.getElementById('rec-add-line');
  const btnNew = document.getElementById('rec-new');
  const btnRef = document.getElementById('rec-refresh');

  if (btnSave) {
    btnSave.disabled = rcSaving;
    btnSave.textContent = rcSaving ? 'Guardando…' : 'Guardar borrador';
  }
  if (btnIssue) btnIssue.disabled = rcSaving;
  if (btnPrint) btnPrint.disabled = rcSaving;
  if (btnCancel) btnCancel.disabled = rcSaving;
  if (btnAdd) btnAdd.disabled = rcSaving;
  if (btnNew) btnNew.disabled = rcSaving;
  if (btnRef) btnRef.disabled = rcSaving;

  // Inputs principales
  const ids = ['rec-client','rec-date','rec-bank','rec-ref','rec-financial-account','rec-operational-class'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el && rcEditorMode === 'edit') el.disabled = rcSaving;
  });

  // Botones de pago
  const bCash = document.getElementById('rec-pay-cash');
  const bTr = document.getElementById('rec-pay-transfer');
  if (bCash && rcEditorMode === 'edit') bCash.disabled = rcSaving;
  if (bTr && rcEditorMode === 'edit') bTr.disabled = rcSaving;

  // Líneas
  const linesTbody = document.getElementById('rec-lines-tbody');
  if (linesTbody) {
    linesTbody.querySelectorAll('input').forEach(inp => {
      if (rcEditorMode === 'edit') inp.disabled = rcSaving;
    });
    linesTbody.querySelectorAll('button[data-act="del"]').forEach(btn => {
      if (rcEditorMode === 'edit') btn.disabled = rcSaving;
    });
  }
}

async function rcIssueCurrent(){
  if (rcSaving) return false;
  if (!rcCurrent) return false;
  if (rcEditorMode !== 'edit') return false;
  if (String(rcCurrent.status || 'DRAFT') !== 'DRAFT') return false;

  const v = rcValidateCurrent({ forIssue:true });
  if (!v.ok) {
    rcShowAlert(v.msg, 'error');
    return false;
  }

  if (!confirm('¿Emitir este recibo?\n\nAl emitir: se asigna N° automático, se sella la fecha y se bloquea la edición.')) {
    return false;
  }

  rcSetSaving(true);
  try {
    // Asegurar histórico cargado para consecutivo correcto
    await rcLoadAll();

    const now = new Date();
    const nowISO = now.toISOString();
    const todayISO = rcTodayISO();

    rcCurrent.number = rcNextConsecutive4();
    rcCurrent.status = 'ISSUED';
    rcCurrent.issuedAt = nowISO;
    rcCurrent.updatedAt = nowISO;

    // Fecha automática (sellada)
    rcCurrent.dateISO = todayISO;
    rcCurrent.dateDisplay = rcLongDateDisplay(now);

    // Pago/referencia/banco sellados (normalizar)
    if (rcCurrent.paymentType === 'CASH') { rcCurrent.paymentBank = ''; rcCurrent.paymentRef = ''; }
    if (rcCurrent.paymentType === 'TRANSFER') {
      rcCurrent.paymentBank = String(rcCurrent.paymentBank || '').trim();
      rcCurrent.paymentRef = String(rcCurrent.paymentRef || '').trim();
    }

    rcRecalc(rcCurrent);

    await finPut('receipts', rcCurrent);

    const saved = await finGet('receipts', rcCurrent.receiptId);
    if (!saved) throw new Error('No se confirmó el emitido en IndexedDB.');

    await rcLoadAll();
    rcRenderList();

    rcEditorMode = 'view';
    rcFillEditor();
    rcShowAlert(`Recibo emitido. N° ${rcCurrent.number}.`, 'info');
    return true;
  } catch (err) {
    console.error('Error emitiendo recibo', err);
    rcShowAlert('No se pudo emitir el recibo.', 'error');
    return false;
  } finally {
    rcSetSaving(false);
  }
}

async function rcVoidReceiptById(id){
  const found = rcList.find(r => r.receiptId === id);
  if (!found) return;
  const st = String(found.status || 'DRAFT');
  if (st !== 'ISSUED') {
    alert('Solo se puede anular un recibo EMITIDO.');
    return;
  }

  const num = (found.number == null || found.number === '') ? '—' : String(found.number);
  if (!confirm(`¿Anular el recibo N° ${num}?\n\nEsto NO borra el recibo: queda en histórico como ANULADO.`)) return;

  const motivo = String(prompt('Motivo de anulación (obligatorio):') || '').trim();
  if (!motivo) {
    alert('Motivo obligatorio.');
    return;
  }

  try {
    const r = rcNormalizeReceipt(found);
    const nowISO = new Date().toISOString();
    r.status = 'VOID';
    r.voidReason = motivo;
    r.voidedAt = nowISO;
    r.updatedAt = nowISO;
    await finPut('receipts', r);

    // refrescar lista
    await rcLoadAll();
    rcRenderList();

    // si está abierto en editor, refrescar
    if (rcCurrent && rcCurrent.receiptId === id) {
      rcCurrent = rcNormalizeReceipt(r);
      rcEditorMode = 'view';
      rcFillEditor();
      rcShowAlert('Recibo anulado.', 'info');
    }
  } catch (err) {
    console.error('Error anulando recibo', err);
    alert('No se pudo anular el recibo.');
  }
}

function rcReemitReceiptById(id){
  const found = rcList.find(r => r.receiptId === id);
  if (!found) return;
  const st = String(found.status || 'DRAFT');
  if (!(st === 'ISSUED' || st === 'VOID')) {
    alert('Reemitir solo aplica a recibos EMITIDOS o ANULADOS.');
    return;
  }

  const num = (found.number == null || found.number === '') ? '—' : String(found.number);
  if (!confirm(`¿Reemitir el recibo N° ${num}?\n\nSe creará un NUEVO BORRADOR copiado. El original se conserva en histórico.`)) return;

  const base = rcNormalizeReceipt(found);
  const now = new Date();
  const nowISO = now.toISOString();
  const dateISO = rcTodayISO();

  const draft = {
    receiptId: rcMakeId(),
    number: null,
    status: 'DRAFT',
    reissuedFrom: base.receiptId,
    createdAt: nowISO,
    updatedAt: nowISO,
    dateISO,
    dateDisplay: rcDateDisplayFromISO(dateISO),
    clientName: base.clientName || '',
    clientPhone: base.clientPhone || '',
    paymentType: (base.paymentType === 'TRANSFER') ? 'TRANSFER' : 'CASH',
    paymentBank: (base.paymentType === 'TRANSFER') ? String(base.paymentBank || '') : '',
    paymentRef: (base.paymentType === 'TRANSFER') ? String(base.paymentRef || '') : '',
    financialAccountId: base.financialAccountId || base.cuentaFinancieraId || '',
    cuentaFinancieraId: base.cuentaFinancieraId || base.financialAccountId || '',
    financialAccountNameSnapshot: base.financialAccountNameSnapshot || base.cuentaFinancieraNombreSnapshot || '',
    financialAccountType: base.financialAccountType || '',
    financialAccountCurrency: base.financialAccountCurrency || base.monedaOriginal || 'NIO',
    financialAccountSymbol: base.financialAccountSymbol || base.simboloOriginal || '',
    financialAccountAccountingCode: base.financialAccountAccountingCode || '',
    financialAccountAccountingNameSnapshot: base.financialAccountAccountingNameSnapshot || '',
    monedaOriginal: base.monedaOriginal || 'NIO',
    simboloOriginal: base.simboloOriginal || '',
    lines: (base.lines || []).map(l => ({
      itemName: String(l.itemName || ''),
      qty: rcSafeNum(l.qty),
      unitPrice: rcSafeNum(l.unitPrice),
      discountPerUnit: rcSafeNum(l.discountPerUnit),
      lineTotal: rcSafeNum(l.lineTotal)
    })),
    totals: { subtotal: 0, discountTotal: 0, total: 0 }
  };

  rcCurrent = rcNormalizeReceipt(draft);
  rcEditorMode = 'edit';
  rcToggleEditor(true);
  rcFillEditor();
}

function rcFmtMoneyPrint(v){
  // En impresión preferimos números compactos sin prefijo.
  return fmtCurrency(v);
}

function rcBuildPrintReceiptInnerHTML(r){
  const receipt = rcNormalizeReceipt(r);
  const num4 = rcNumber4(receipt.number);
  const fecha = String(receipt.dateDisplay || rcDateDisplayFromISO(receipt.dateISO) || '').trim() || '—';
  const payLbl = rcPayLabel(receipt.paymentType);
  const bank = String(receipt.paymentBank || '').trim();
  const ref = String(receipt.paymentRef || '').trim();
  const showTransfer = (receipt.paymentType === 'TRANSFER');
  const showRef = showTransfer && (ref.trim() !== '');
  const bankDisp = bank || '—';
  const currency = rcGetReceiptCurrency(receipt);
  const accountName = String(receipt.financialAccountNameSnapshot || receipt.cuentaFinancieraNombreSnapshot || '').trim();
  const accountCode = String(receipt.financialAccountAccountingCode || receipt.cuentaFinancieraCodigoContable || '').trim();
  const rate = receipt.exchangeRateUsed || receipt.tipoCambioUsado || null;
  const baseAmount = rcGetReceiptBaseAmount(receipt);
  const hasFinancial = rcReceiptHasFinancialMetadata(receipt);

  const cli = String(receipt.clientName || '').trim() || '—';

  const rows = (receipt.lines || []).map((ln, idx) => {
    const q = rcSafeNum(ln.qty);
    const nameBase = String(ln.itemName || '').trim() || '—';
    const name = nameBase;
    const qDisp = (Number.isFinite(q) && q > 0) ? pcFmtQty(q) : '';
    const discCell = (rcSafeNum(ln.discountPerUnit) === 0) ? '' : rcFmtMoneyPrint(ln.discountPerUnit || 0);
    return `
      <tr>
        <td class="ncol">${idx + 1}</td>
        <td>${escapeHTML(name)}</td>
        <td class="num qcol">${escapeHTML(qDisp)}</td>
        <td class="num pcol">${rcFormatOriginalMoney(ln.unitPrice || 0, currency)}</td>
        <td class="num dcol">${discCell ? rcFormatOriginalMoney(ln.discountPerUnit || 0, currency) : ''}</td>
        <td class="num tcol">${rcFormatOriginalMoney(ln.lineTotal || 0, currency)}</td>
      </tr>
    `;
  }).join('');

  const sub = receipt.totals?.subtotal ?? 0;
  const disc = receipt.totals?.discountTotal ?? 0;
  const tot = receipt.totals?.total ?? 0;

  const discTotalDisp = (rcSafeNum(disc) === 0) ? '' : rcFormatOriginalMoney(disc, currency);
  const currencyNote = hasFinancial ? `
    <div><span class="lbl">CUENTA:</span> ${escapeHTML(accountName || '—')}${accountCode ? ` · ${escapeHTML(accountCode)}` : ''}</div><div><span class="lbl">MONEDA:</span> ${escapeHTML(rcGetReceiptSymbol(receipt))} / ${escapeHTML(currency)}</div>
    ${currency === 'USD' ? `<div><span class="lbl">T/C:</span> ${escapeHTML(rate ? Number(rate).toFixed(2) : '—')}</div><div><span class="lbl">EQ. C$:</span> ${escapeHTML(finFormatCordobas(baseAmount))}</div>` : ''}
  ` : '';

  return `
    <div class="rc-print-header">
      <div class="rc-print-title">RECIBO DE CAJA</div>
      <img class="rc-print-logo" src="images/logo.png" alt="Arcano 33">
    </div>

    <div class="rc-print-meta">
      <div><span class="lbl">FECHA:</span> ${escapeHTML(fecha)}</div>
      <div><span class="lbl">N°:</span> <span class="rc-num-red">${escapeHTML(num4 || '—')}</span></div>
      <div><span class="lbl">PAGO:</span> ${escapeHTML(payLbl)}</div>
      <div><span class="lbl">CLIENTE:</span> ${escapeHTML(cli)}</div>
      ${showTransfer ? `<div><span class="lbl">BANCO:</span> ${escapeHTML(bankDisp)}</div><div></div>` : ``}
      ${showRef ? `<div><span class="lbl">REF:</span> ${escapeHTML(ref)}</div><div></div>` : ``}
      ${currencyNote}
    </div>

    <table class="rc-print-table">
      <thead>
        <tr>
          <th class="ncol">N°</th>
          <th>PRODUCTO</th>
          <th class="num qcol">CANTIDAD</th>
          <th class="num pcol">P/UNITARIO</th>
          <th class="num dcol">DESC. UNIT</th>
          <th class="num tcol">TOTAL</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <div class="rc-print-totals">
      <div class="row"><div><strong>SUBTOTAL</strong></div><div>${rcFormatOriginalMoney(sub, currency)}</div></div>
      <div class="row"><div><strong>DESCUENTO</strong></div><div>${discTotalDisp}</div></div>
      <div class="row"><div><strong>TOTAL</strong></div><div><strong>${rcFormatOriginalMoney(tot, currency)}</strong></div></div>
      ${currency === 'USD' ? `<div class="row"><div><strong>EQUIV. CONTABLE C$</strong></div><div><strong>${escapeHTML(finFormatCordobas(baseAmount))}</strong></div></div>` : ''}
    </div>

    <div class="rc-print-sign">
      <div class="rc-sign-box">RECIBÍ CONFORME</div>
      <div class="rc-sign-box">ENTREGUÉ CONFORME</div>
    </div>
  `;
}

function rcEnsurePrintRoot(){
  let root = document.getElementById('rc-print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'rc-print-root';
    root.className = 'rc-print-root';
    document.body.appendChild(root);
  }
  return root;
}

function rcPrintReceipt(receipt){
  if (!receipt) return;
  const st = String(receipt.status || 'DRAFT');
  if (!(st === 'ISSUED' || st === 'VOID')) {
    alert('Solo se puede imprimir un recibo EMITIDO o ANULADO.');
    return;
  }

  const num4 = rcNumber4(receipt.number);
  if (!num4) {
    alert('Este recibo no tiene número.');
    return;
  }

  const suggestedName = rcSuggestedPdfName(receipt);
  const oldTitle = document.title;
  const root = rcEnsurePrintRoot();

  root.innerHTML = `
    <div class="rc-print-page">
      <div class="rc-receipt-copy rc-receipt-copy--top">${rcBuildPrintReceiptInnerHTML(receipt)}</div>
      <div class="rc-cut-line"><span>cortar aquí</span></div>
      <div class="rc-receipt-copy rc-receipt-copy--bottom">${rcBuildPrintReceiptInnerHTML(receipt)}</div>
    </div>
  `;

  // Sugerir nombre de archivo vía title (la mayoría de navegadores lo usan para print-to-PDF).
  if (suggestedName) document.title = suggestedName;

  document.body.classList.add('rc-printing');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.title = oldTitle;
    document.body.classList.remove('rc-printing');
    root.innerHTML = '';
  };

  const onAfter = () => {
    window.removeEventListener('afterprint', onAfter);
    cleanup();
  };
  window.addEventListener('afterprint', onAfter);

  // Disparar impresión
  try { window.print(); } catch (_) {}

  // Fallback: algunos navegadores no disparan afterprint.
  // Largo para no limpiar mientras el usuario está en el diálogo de impresión.
  setTimeout(cleanup, 60000);
}

async function rcPrintReceiptById(id){
  try {
    const raw = await finGet('receipts', id);
    if (!raw) {
      alert('No se encontró el recibo en la base local.');
      return;
    }
    const r = rcNormalizeReceipt(raw);
    rcPrintReceipt(r);
  } catch (e) {
    console.error('Error imprimiendo recibo', e);
    alert('No se pudo preparar la impresión.');
  }
}

async function rcSaveCurrent(){
  if (rcSaving) return false;
  if (rcEditorMode !== 'edit') return false;

  const v = rcValidateCurrent();
  if (!v.ok) {
    rcShowAlert(v.msg, 'error');
    return false;
  }

  rcSetSaving(true);

  try {
    const nowISO = new Date().toISOString();
    rcCurrent.updatedAt = nowISO;
    rcCurrent.dateDisplay = rcDateDisplayFromISO(rcCurrent.dateISO);

    await finPut('receipts', rcCurrent);

    // Confirmar persistencia antes de cerrar
    const saved = await finGet('receipts', rcCurrent.receiptId);
    if (!saved) throw new Error('No se confirmó el guardado en IndexedDB.');

    await rcLoadAll();
    rcRenderList();
    rcToggleEditor(false);
    rcCurrent = null;
    rcShowAlert('');
    return true;
  } catch (err) {
    console.error('Error guardando recibo', err);
    rcShowAlert('No se pudo guardar el borrador.', 'error');
    return false;
  } finally {
    rcSetSaving(false);
  }
}

async function rcEnterView(force=false){
  // Solo refrescar cuando estamos en lista o forzado.
  const list = document.getElementById('recibos-list');
  if (!list) return;
  if (force || !list.classList.contains('hidden')) {
    await rcLoadAll();
    rcRenderList();
  }
}

function rcResetFilters(){
  rcQuery = '';
  rcFilterStatus = 'all';
  rcFilterFrom = '';
  rcFilterTo = '';
  rcFilterPay = 'all';

  const q = document.getElementById('rec-search'); if (q) q.value = '';
  const st = document.getElementById('rec-filter-status'); if (st) st.value = 'all';
  const df = document.getElementById('rec-filter-from'); if (df) df.value = '';
  const dt = document.getElementById('rec-filter-to'); if (dt) dt.value = '';
  const pay = document.getElementById('rec-filter-pay'); if (pay) pay.value = 'all';
}

function setupRecibosUI(){
  const btnNew = document.getElementById('rec-new');
  const btnRef = document.getElementById('rec-refresh');
  const tbody = document.getElementById('rec-tbody');
  const btnAdd = document.getElementById('rec-add-line');
  const btnSave = document.getElementById('rec-save');
  const btnIssue = document.getElementById('rec-issue');
  const btnPrint = document.getElementById('rec-print');
  const btnCancel = document.getElementById('rec-cancel');

  const cli = document.getElementById('rec-client');
  const date = document.getElementById('rec-date');
  const bank = document.getElementById('rec-bank');
  const ref = document.getElementById('rec-ref');
  const financialAccount = document.getElementById('rec-financial-account');
  const operationalClass = document.getElementById('rec-operational-class');
  const payCash = document.getElementById('rec-pay-cash');
  const payTr = document.getElementById('rec-pay-transfer');

  const search = document.getElementById('rec-search');
  const btnFilter = document.getElementById('rec-filter-toggle');
  const btnClear = document.getElementById('rec-filter-clear');
  const panel = document.getElementById('rec-filters-panel');
  const fStatus = document.getElementById('rec-filter-status');
  const fFrom = document.getElementById('rec-filter-from');
  const fTo = document.getElementById('rec-filter-to');
  const fPay = document.getElementById('rec-filter-pay');

  if (btnNew) btnNew.addEventListener('click', () => rcNewDraft());
  if (btnRef) btnRef.addEventListener('click', () => rcEnterView(true).catch(() => {}));

  if (search) {
    search.addEventListener('input', () => {
      rcQuery = search.value || '';
      rcRenderList();
    });
  }

  if (btnFilter && panel) {
    btnFilter.addEventListener('click', () => {
      rcFilterPanelOpen = !rcFilterPanelOpen;
      panel.classList.toggle('hidden', !rcFilterPanelOpen);
    });
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      rcResetFilters();
      rcRenderList();
    });
  }

  const onFilterChange = () => {
    if (fStatus) rcFilterStatus = fStatus.value || 'all';
    if (fFrom) rcFilterFrom = fFrom.value || '';
    if (fTo) rcFilterTo = fTo.value || '';
    if (fPay) rcFilterPay = fPay.value || 'all';
    rcRenderList();
  };

  if (fStatus) fStatus.addEventListener('change', onFilterChange);
  if (fFrom) fFrom.addEventListener('change', onFilterChange);
  if (fTo) fTo.addEventListener('change', onFilterChange);
  if (fPay) fPay.addEventListener('change', onFilterChange);

  if (tbody) {
    tbody.addEventListener('click', (ev) => {
      const btn = ev.target.closest && ev.target.closest('button[data-act]');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const id = tr.dataset.rcid;
      if (!id) return;

      const act = btn.dataset.act;
      if (act === 'view') rcOpenReceiptById(id, 'view');
      if (act === 'print') rcPrintReceiptById(id).catch(() => {});
      if (act === 'edit') rcOpenReceiptById(id, 'edit');
      if (act === 'void') rcVoidReceiptById(id).catch(() => {});
      if (act === 'reemit') rcReemitReceiptById(id);
    });
  }

  if (payCash) payCash.addEventListener('click', () => { if (rcEditorMode === 'edit') rcSetPaymentType('CASH'); });
  if (payTr) payTr.addEventListener('click', () => { if (rcEditorMode === 'edit') rcSetPaymentType('TRANSFER'); });

  if (cli) cli.addEventListener('input', () => { if (rcCurrent && rcEditorMode === 'edit') rcCurrent.clientName = cli.value; });
  if (date) date.addEventListener('change', () => {
    if (rcCurrent && rcEditorMode === 'edit') {
      rcCurrent.dateISO = date.value;
      rcCurrent.dateDisplay = rcDateDisplayFromISO(date.value);
      rcUpdateEditorMeta();
    }
  });
  if (bank) bank.addEventListener('input', () => { if (rcCurrent && rcEditorMode === 'edit') { rcCurrent.paymentBank = bank.value; rcUpdateEditorMeta(); rcSyncFinancialAccountUI(); } });
  if (ref) ref.addEventListener('input', () => { if (rcCurrent && rcEditorMode === 'edit') { rcCurrent.paymentRef = ref.value; rcUpdateEditorMeta(); rcSyncFinancialAccountUI(); } });
  if (financialAccount) financialAccount.addEventListener('change', () => {
    if (!rcCurrent || rcEditorMode !== 'edit') { rcSyncFinancialAccountUI(); return; }
    const row = rcGetSelectedFinancialAccount();
    rcCurrent.financialAccountId = financialAccount.value || '';
    rcCurrent.cuentaFinancieraId = rcCurrent.financialAccountId;
    if (row) {
      rcCurrent.monedaOriginal = rcNormalizeCurrencyCode(row.moneda || row.financialAccountCurrency || 'NIO');
      rcCurrent.simboloOriginal = String(row.simbolo || row.financialAccountSymbol || rcCurrencySymbol(rcCurrent.monedaOriginal));
      rcCurrent.financialAccountNameSnapshot = String(row.nombreVisible || row.financialAccountNameSnapshot || '');
      rcCurrent.financialAccountCurrency = rcCurrent.monedaOriginal;
      rcCurrent.financialAccountSymbol = rcCurrent.simboloOriginal;
      rcCurrent.financialAccountType = String(row.type || row.tipo || '');
      rcCurrent.financialAccountAccountingCode = finNormalizeAccountCode(row.cuentaContableCodigo || row.financialAccountAccountingCode || '');
      rcCurrent.financialAccountAccountingNameSnapshot = String(row.cuentaContableNombreSnapshot || row.financialAccountAccountingNameSnapshot || '');
      if (String(row.type || row.tipo || '').toLowerCase() === 'banco' && rcCurrent.paymentType === 'TRANSFER' && !String(rcCurrent.paymentBank || '').trim()) {
        rcCurrent.paymentBank = String(row.bancoNombreSnapshot || row.nombreVisible || '').replace(/—\s*(C\$|US\$)\s*$/,'').trim();
        if (bank) bank.value = rcCurrent.paymentBank;
      }
    }
    rcSyncFinancialAccountUI();
    rcUpdateEditorMeta();
  });

  if (operationalClass) operationalClass.addEventListener('change', () => {
    if (!rcCurrent || rcEditorMode !== 'edit') return;
    const opClass = finNormalizeOperationalClass(operationalClass.value, FIN_OPERATIONAL_CLASSES.ADDITIONAL_INCOME);
    rcCurrent.operationalClass = opClass;
    rcCurrent.clasificacionOperativa = opClass;
    rcCurrent.operationalClassLabel = finOperationalClassLabel(opClass);
    rcCurrent.operationalStage = FIN_OPERATIONAL_CLASS_STAGE;
  });

  if (btnAdd) btnAdd.addEventListener('click', () => {
    if (!rcCurrent || rcEditorMode !== 'edit' || rcSaving) return;
    rcCurrent.lines.push({ itemName:'', qty:1, unitPrice:0, discountPerUnit:0, lineTotal:0 });
    rcRenderLines();
  });

  const linesTbody = document.getElementById('rec-lines-tbody');
  if (linesTbody) {
    // UX: al tocar un input numérico, seleccionar todo para evitar append accidental ("0"+"30" => "030").
    linesTbody.addEventListener('focusin', (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (t.type !== 'number') return;
      if (t.disabled) return;
      // iOS/Safari a veces requiere defer.
      setTimeout(() => { try { t.select(); } catch(_) {} }, 0);
    });

    linesTbody.addEventListener('input', (ev) => {
      if (rcEditorMode !== 'edit' || rcSaving) return;
      const t = ev.target;
      if (!(t instanceof HTMLInputElement)) return;
      const tr = t.closest('tr');
      if (!tr || !rcCurrent) return;
      const idx = Number(tr.dataset.idx);
      const f = t.dataset.f;
      const ln = rcCurrent.lines[idx];
      if (!ln) return;

      if (f === 'itemName') ln.itemName = t.value;

      if (f === 'qty') ln.qty = rcParseNumberOrZero(t.value);
      if (f === 'unitPrice') ln.unitPrice = rcParseNumberOrZero(t.value);
      if (f === 'discountPerUnit') ln.discountPerUnit = rcParseNumberOrZero(t.value);

      // vacío o "0" => 0 (no rompe). Si NaN por algo raro, forzar a 0 para recálculo.
      if (!Number.isFinite(ln.qty)) ln.qty = 0;
      if (!Number.isFinite(ln.unitPrice)) ln.unitPrice = 0;
      if (!Number.isFinite(ln.discountPerUnit)) ln.discountPerUnit = 0;

      rcRecalc(rcCurrent);

      const totalCell = tr.querySelector('.rec-line-total');
      if (totalCell) totalCell.textContent = rcFmtMoney(ln.lineTotal || 0);
    });

    linesTbody.addEventListener('click', (ev) => {
      if (rcEditorMode !== 'edit' || rcSaving) return;
      const btn = ev.target;
      if (!(btn instanceof HTMLElement)) return;
      if (btn.dataset.act !== 'del') return;
      const tr = btn.closest('tr');
      if (!tr || !rcCurrent) return;
      const idx = Number(tr.dataset.idx);
      if (!Number.isFinite(idx)) return;
      rcCurrent.lines.splice(idx, 1);
      if (!rcCurrent.lines.length) rcCurrent.lines.push({ itemName:'', qty:1, unitPrice:0, discountPerUnit:0, lineTotal:0 });
      rcRenderLines();
    });
  }

  if (btnSave) btnSave.addEventListener('click', () => {
    rcSaveCurrent().catch(err => {
      console.error('Error guardando recibo', err);
      rcShowAlert('No se pudo guardar el borrador.', 'error');
      rcSetSaving(false);
    });
  });

  if (btnIssue) btnIssue.addEventListener('click', () => {
    rcIssueCurrent().catch(err => {
      console.error('Error emitiendo recibo', err);
      rcShowAlert('No se pudo emitir el recibo.', 'error');
      rcSetSaving(false);
    });
  });

  if (btnPrint) btnPrint.addEventListener('click', () => {
    if (!rcCurrent) return;
    rcPrintReceipt(rcCurrent);
  });

  if (btnCancel) btnCancel.addEventListener('click', () => {
    if (rcSaving) return;
    rcCurrent = null;
    rcShowAlert('');
    rcToggleEditor(false);
  });
}

// Helpers de escape básicos para evitar inyección en tablas
function escapeHTML(s){
  return String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s){
  return escapeHTML(s)
    .replace(/[\r\n\t]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}


/* ---------- Cuentas Financieras (Etapa 3/10) ---------- */

const FIN_FINANCIAL_ACCOUNTS_STAGE = 'finanzas_multibanco_etapa_3_10';
const FINANCIAL_ACCOUNTS_SOURCE = 'Gestión Operativa → Catálogos → Bancos';
const FINANCIAL_ACCOUNT_CASH_DEFS = Object.freeze([
  { id:'fa-caja-general-nio', uniqueKey:'caja:caja_general:NIO', type:'caja', cajaKey:'caja_general', nombreVisible:'Caja general C$', moneda:'NIO', simbolo:'C$', cuentaContableCodigo:'1100' },
  { id:'fa-caja-general-usd', uniqueKey:'caja:caja_general:USD', type:'caja', cajaKey:'caja_general', nombreVisible:'Caja general US$', moneda:'USD', simbolo:'US$', cuentaContableCodigo:'1105' },
  { id:'fa-caja-eventos-nio', uniqueKey:'caja:caja_eventos:NIO', type:'caja', cajaKey:'caja_eventos', nombreVisible:'Caja eventos C$', moneda:'NIO', simbolo:'C$', cuentaContableCodigo:'1110' },
  { id:'fa-caja-eventos-usd', uniqueKey:'caja:caja_eventos:USD', type:'caja', cajaKey:'caja_eventos', nombreVisible:'Caja eventos US$', moneda:'USD', simbolo:'US$', cuentaContableCodigo:'1115' }
]);

function finFinancialAccountCurrencySymbol(code) {
  return finCurrencySymbol(finNormalizeCurrencyCode(code));
}

function finFinancialAccountTypeLabel(type) {
  return String(type || '').toLowerCase() === 'banco' ? 'Banco' : 'Caja';
}

function finFinancialAccountStatusLabel(row) {
  return row && row.activa === false ? 'Inactiva' : 'Activa';
}

function finGetCatalogBanksForFinancialAccounts(rawBanks) {
  const map = new Map();
  for (const bank of (Array.isArray(rawBanks) ? rawBanks : [])) {
    if (!bank || typeof bank !== 'object') continue;
    const name = finNormalizeCatalogBankName(bank.name || bank.nombre || bank.bankName || bank.label || '');
    if (!name) continue;
    const id = bank.id != null ? String(bank.id) : '';
    const type = String(bank.type || bank.bankType || bank.paymentType || 'transferencia').trim().toLowerCase();
    const key = id ? `id:${id}` : `name:${normText(name)}:${type}`;
    if (!map.has(key)) map.set(key, { ...bank, id: id || key.replace(/[^a-z0-9_-]/gi, '-'), name });
  }
  return [...map.values()].sort((a, b) => finCatalogBankSortKey(a).localeCompare(finCatalogBankSortKey(b)));
}

function finGetActiveCatalogBanksForFinancialAccounts(rawBanks) {
  return finGetCatalogBanksForFinancialAccounts(rawBanks).filter(finCatalogBankIsActive);
}

function finFindSpecificBankAccountCode(bank, currency, accounts) {
  const cur = finNormalizeCurrencyCode(currency);
  const bankId = String(bank && bank.id != null ? bank.id : '');
  const bankName = normText(bank && (bank.name || bank.nombre || bank.bankName || ''));
  const list = Array.isArray(accounts) ? accounts : [];

  const candidates = list.filter(acc => {
    if (!acc || !finIsBankAccount(acc)) return false;
    if (finIsLegacyBankAccountCode(acc.code || acc.accountCode || acc.codigo || '')) return false;
    return finGetFinancialAccountCurrencyCode(acc) === cur;
  });

  if (bankId) {
    const byId = candidates.find(acc => String(acc.bankCatalogId || '') === bankId);
    if (byId) return finNormalizeAccountCode(byId.code || byId.accountCode || byId.codigo || '');
  }

  if (bankName) {
    const byName = candidates.find(acc => {
      const text = normText(`${acc.nombre || acc.name || ''} ${acc.bankCatalogName || ''} ${acc.bankNameSnapshot || ''}`);
      return text.includes(bankName);
    });
    if (byName) return finNormalizeAccountCode(byName.code || byName.accountCode || byName.codigo || '');
  }

  const slot = finBankPreferredSlot(bank, 0);
  const pair = finBankCodePairFromSlot(slot);
  const expected = pair[cur];
  const byExpected = candidates.find(acc => finNormalizeAccountCode(acc.code || acc.accountCode || acc.codigo || '') === expected);
  return byExpected ? expected : '';
}

function finBuildFinancialAccountDefinitions(rawBanks, accounts) {
  const defs = FINANCIAL_ACCOUNT_CASH_DEFS.map(d => ({ ...d, bancoId:null, bancoNombreSnapshot:'', sourceCatalog:'Finanzas → Caja operativa' }));
  const banks = finGetActiveCatalogBanksForFinancialAccounts(rawBanks);

  for (const bank of banks) {
    const bankId = String(bank && bank.id != null ? bank.id : '');
    const bankName = finNormalizeCatalogBankName(bank.name || bank.nombre || bank.bankName || 'Banco');
    for (const currency of FIN_SUPPORTED_CURRENCY_CODES) {
      const cur = finNormalizeCurrencyCode(currency);
      const symbol = finFinancialAccountCurrencySymbol(cur);
      const accountCode = finFindSpecificBankAccountCode(bank, cur, accounts);
      defs.push({
        id: `fa-banco-${bankId || normText(bankName).replace(/[^a-z0-9]+/g, '-')}-${cur.toLowerCase()}`,
        uniqueKey: `banco:${bankId || normText(bankName)}:${cur}`,
        type: 'banco',
        bancoId: bankId,
        bancoNombreSnapshot: bankName,
        bancoTipoSnapshot: String(bank.type || bank.bankType || bank.paymentType || 'transferencia'),
        nombreVisible: `${bankName} — ${symbol}`,
        moneda: cur,
        simbolo: symbol,
        cuentaContableCodigo: accountCode,
        sourceCatalog: FINANCIAL_ACCOUNTS_SOURCE
      });
    }
  }

  return defs;
}

function finFinancialAccountDefinitionToRecord(def, accountsMap, nowISO) {
  const code = finNormalizeAccountCode(def.cuentaContableCodigo || '');
  const acc = code && accountsMap && accountsMap.get(code) ? accountsMap.get(code) : null;
  return {
    id: String(def.id || def.uniqueKey || `fa-${Date.now()}`),
    uniqueKey: String(def.uniqueKey || def.id || ''),
    type: String(def.type || 'caja').toLowerCase(),
    tipo: String(def.type || 'caja').toLowerCase(),
    cajaKey: def.cajaKey || '',
    bancoId: def.bancoId != null ? String(def.bancoId) : null,
    bancoNombreSnapshot: def.bancoNombreSnapshot || '',
    bancoTipoSnapshot: def.bancoTipoSnapshot || '',
    nombreVisible: def.nombreVisible || 'Cuenta financiera',
    moneda: finNormalizeCurrencyCode(def.moneda),
    simbolo: finCurrencySymbol(def.moneda),
    cuentaContableCodigo: code,
    cuentaContableNombreSnapshot: acc ? String(acc.nombre || acc.name || `Cuenta ${code}`) : '',
    activa: true,
    fechaCreacion: nowISO,
    fechaActualizacion: nowISO,
    createdAtISO: nowISO,
    updatedAtISO: nowISO,
    sourceCatalog: def.sourceCatalog || '',
    generatedFrom: 'finanzas_cuentas_financieras',
    a33FinanceStage: FIN_FINANCIAL_ACCOUNTS_STAGE
  };
}

function finMergeFinancialAccountRecord(current, def, accountsMap, nowISO) {
  const base = finFinancialAccountDefinitionToRecord(def, accountsMap, nowISO);
  if (!current) return base;

  const out = { ...current };
  const forceKeys = [
    'uniqueKey', 'type', 'tipo', 'cajaKey', 'bancoId', 'bancoNombreSnapshot', 'bancoTipoSnapshot',
    'nombreVisible', 'moneda', 'simbolo', 'sourceCatalog', 'generatedFrom', 'a33FinanceStage'
  ];
  for (const k of forceKeys) out[k] = base[k];

  const currentCode = finNormalizeAccountCode(current.cuentaContableCodigo || '');
  if (currentCode && accountsMap && accountsMap.get(currentCode)) {
    out.cuentaContableCodigo = currentCode;
    const acc = accountsMap.get(currentCode);
    out.cuentaContableNombreSnapshot = String(acc.nombre || acc.name || `Cuenta ${currentCode}`);
  } else {
    out.cuentaContableCodigo = base.cuentaContableCodigo;
    out.cuentaContableNombreSnapshot = base.cuentaContableNombreSnapshot;
  }

  if (typeof current.activa === 'boolean') out.activa = current.activa;
  else out.activa = true;

  out.fechaCreacion = current.fechaCreacion || current.createdAtISO || nowISO;
  out.createdAtISO = current.createdAtISO || current.fechaCreacion || nowISO;
  out.fechaActualizacion = nowISO;
  out.updatedAtISO = nowISO;
  return out;
}

async function finEnsureFinancialAccountsBase() {
  await openFinDB();
  const [existing, accounts, rawBanks] = await Promise.all([
    finGetAll('financialAccounts').catch(() => []),
    finGetAll('accounts'),
    getAllPosBanksSafe()
  ]);
  const accountsMap = new Map((accounts || []).map(acc => [finNormalizeAccountCode(acc.code), acc]));
  const defs = finBuildFinancialAccountDefinitions(rawBanks, accounts);
  const byId = new Map((existing || []).map(row => [String(row && row.id), row]));
  const nowISO = new Date().toISOString();
  let changed = 0;

  for (const def of defs) {
    const row = finMergeFinancialAccountRecord(byId.get(String(def.id)), def, accountsMap, nowISO);
    await finPut('financialAccounts', row);
    byId.set(String(row.id), row);
    changed += 1;
  }

  return changed;
}

function finBuildFinancialAccountWarnings(row, accountsMap, banksById) {
  const warnings = [];
  const code = finNormalizeAccountCode(row && row.cuentaContableCodigo);
  const mappedAcc = code && accountsMap ? accountsMap.get(code) : null;
  if (!code || !mappedAcc) {
    warnings.push('Sin cuenta contable válida asociada.');
  } else if (finGetFinancialAccountCurrencyCode(mappedAcc) !== finNormalizeCurrencyCode(row && row.moneda)) {
    warnings.push('La moneda de la cuenta contable asociada no coincide con esta cuenta financiera.');
  }
  if (String(row && row.type) === 'banco') {
    if (!row.bancoId) warnings.push('Banco sin id maestro; se conserva por compatibilidad.');
    const bank = row.bancoId ? banksById.get(String(row.bancoId)) : null;
    if (bank && !finCatalogBankIsActive(bank)) warnings.push('Banco inactivo en Catálogos.');
    if (code && finIsLegacyBankAccountCode(code)) warnings.push('1200 es legacy/histórica; usa una cuenta bancaria específica para operaciones nuevas.');
  }
  return warnings;
}

function finAccountOptionLabel(acc) {
  const code = finNormalizeAccountCode(acc && (acc.code || acc.accountCode || acc.codigo || ''));
  const name = String(acc && (acc.nombre || acc.name || '') || '').trim();
  const cur = finGetFinancialAccountCurrencyCode(acc);
  const extra = finIsLegacyBankAccountCode(code) ? ' · legacy' : (finIsCashAccount(acc) || finIsBankAccount(acc) ? ` · ${finFinancialAccountCurrencySymbol(cur)}` : '');
  return `${code} — ${name || 'Cuenta sin nombre'}${extra}`;
}

function finGetFinancialAccountSelectableAccounts(accounts) {
  return (Array.isArray(accounts) ? accounts : [])
    .filter(acc => {
      if (!acc) return false;
      if (!finIsActiveAccount(acc) || acc.isHidden === true || !finIsPostableAccount(acc)) return false;
      const root = String(acc.rootType || inferRootTypeFromCode(acc.code) || '').toUpperCase();
      const tipo = String(acc.tipo || '').toLowerCase();
      return root === 'ACTIVO' || tipo === 'activo' || finIsFinancialCashOrBankAccount(acc);
    })
    .sort((a, b) => String(a.code || '').localeCompare(String(b.code || '')));
}

function finRenderFinancialAccountCard(row, accounts, accountsMap, banksById) {
  const id = escapeAttr(row.id);
  const code = finNormalizeAccountCode(row.cuentaContableCodigo || '');
  const warnings = finBuildFinancialAccountWarnings(row, accountsMap, banksById);
  const isActive = row.activa !== false;
  const type = String(row.type || row.tipo || 'caja').toLowerCase();
  const selectOptions = accounts.map(acc => {
    const accCode = finNormalizeAccountCode(acc.code || acc.accountCode || acc.codigo || '');
    const selected = accCode === code ? ' selected' : '';
    return `<option value="${escapeAttr(accCode)}"${selected}>${escapeHTML(finAccountOptionLabel(acc))}</option>`;
  }).join('');
  const warningHTML = warnings.length
    ? `<div class="fa-warnings">${warnings.map(w => `<span>${escapeHTML(w)}</span>`).join('')}</div>`
    : '';
  const inactiveClass = isActive ? '' : ' is-inactive';
  return `
    <article class="fa-card${inactiveClass}" data-fa-id="${id}">
      <div class="fa-card-head">
        <div class="fa-title-block">
          <div class="fa-title-row">
            <strong>${escapeHTML(row.nombreVisible || 'Cuenta financiera')}</strong>
            <span class="fin-pill ${type === 'banco' ? 'fin-pill--gold' : 'fin-pill--cash'}">${escapeHTML(finFinancialAccountTypeLabel(type))}</span>
            <span class="fin-pill ${isActive ? 'fin-pill--green' : 'fin-pill--muted'}">${escapeHTML(finFinancialAccountStatusLabel(row))}</span>
          </div>
          <p>${escapeHTML(row.sourceCatalog || (type === 'banco' ? FINANCIAL_ACCOUNTS_SOURCE : 'Caja operativa'))}</p>
        </div>
        <span class="fa-currency">${escapeHTML(row.simbolo || finFinancialAccountCurrencySymbol(row.moneda))}</span>
      </div>
      <div class="fa-meta-grid">
        <div><small>Moneda</small><b>${escapeHTML(finNormalizeCurrencyCode(row.moneda))}</b></div>
        <div><small>Banco</small><b>${escapeHTML(row.bancoNombreSnapshot || (type === 'banco' ? 'Banco maestro' : '—'))}</b></div>
        <div><small>Cuenta actual</small><b>${escapeHTML(code ? `${code} · ${row.cuentaContableNombreSnapshot || 'Sin nombre'}` : 'Sin mapear')}</b></div>
        <div><small>ID interno</small><b>${escapeHTML(row.id || '—')}</b></div>
      </div>
      ${warningHTML}
      <div class="fa-edit-row">
        <label>
          Cuenta contable asociada
          <select class="fa-account-select" data-fa-id="${id}">
            <option value="">Seleccionar cuenta…</option>
            ${selectOptions}
          </select>
        </label>
        <label class="fa-active-check">
          <input type="checkbox" class="fa-active-input" data-fa-id="${id}" ${isActive ? 'checked' : ''}>
          Activa
        </label>
        <button type="button" class="btn-small fa-save" data-fa-id="${id}">Guardar</button>
      </div>
    </article>
  `;
}

async function renderFinancialAccountsView() {
  const host = document.getElementById('fa-list');
  if (!host) return;
  const status = document.getElementById('fa-status');
  const summary = document.getElementById('fa-summary');
  try {
    await openFinDB();
    const [rows, accounts, rawBanks] = await Promise.all([
      finGetAll('financialAccounts').catch(() => []),
      finGetAll('accounts'),
      getAllPosBanksSafe()
    ]);
    const accountsMap = new Map((accounts || []).map(acc => [finNormalizeAccountCode(acc.code), acc]));
    const banks = finGetCatalogBanksForFinancialAccounts(rawBanks);
    const banksById = new Map(banks.map(b => [String(b.id), b]));
    const selectableAccounts = finGetFinancialAccountSelectableAccounts(accounts);
    const sortedRows = (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
      const ta = String(a.type || a.tipo || '').localeCompare(String(b.type || b.tipo || ''));
      if (ta) return ta;
      const na = String(a.nombreVisible || '');
      const nb = String(b.nombreVisible || '');
      return na.localeCompare(nb, 'es');
    });

    const activeBanks = banks.filter(finCatalogBankIsActive).length;
    const activeRows = sortedRows.filter(r => r && r.activa !== false).length;
    const missingMap = sortedRows.filter(r => !r.cuentaContableCodigo || !accountsMap.get(finNormalizeAccountCode(r.cuentaContableCodigo))).length;

    if (summary) {
      summary.innerHTML = `
        <div class="fa-summary-item"><span>Cuentas configuradas</span><strong>${sortedRows.length}</strong></div>
        <div class="fa-summary-item"><span>Activas</span><strong>${activeRows}</strong></div>
        <div class="fa-summary-item"><span>Bancos activos leídos</span><strong>${activeBanks}</strong></div>
        <div class="fa-summary-item"><span>Alertas de mapeo</span><strong>${missingMap}</strong></div>
      `;
    }

    if (status) {
      status.textContent = banks.length
        ? 'Bancos leídos desde Gestión Operativa → Catálogos → Bancos. Finanzas no administra bancos aquí.'
        : 'No hay bancos maestros disponibles todavía. Crea bancos en Gestión Operativa → Catálogos → Bancos.';
      status.className = banks.length ? 'fin-help fa-status-ok' : 'fin-help fa-status-warn';
    }

    if (!sortedRows.length) {
      host.innerHTML = '<div class="fa-empty">No hay cuentas financieras preparadas. Usa “Revisar base” para inicializar la capa.</div>';
      return;
    }

    host.innerHTML = sortedRows.map(row => finRenderFinancialAccountCard(row, selectableAccounts, accountsMap, banksById)).join('');
  } catch (err) {
    console.error('Error renderizando Cuentas Financieras', err);
    if (status) {
      status.textContent = 'No se pudieron cargar las Cuentas Financieras.';
      status.className = 'fin-help fa-status-warn';
    }
    host.innerHTML = '<div class="fa-empty">Error cargando la sección. Revisa consola.</div>';
  }
}

async function finSaveFinancialAccountFromUI(id) {
  await openFinDB();
  const row = await finGet('financialAccounts', id);
  if (!row) {
    alert('La cuenta financiera ya no existe.');
    await renderFinancialAccountsView();
    return;
  }
  const select = Array.from(document.querySelectorAll('.fa-account-select')).find(el => String(el.getAttribute('data-fa-id') || '') === String(id));
  const active = Array.from(document.querySelectorAll('.fa-active-input')).find(el => String(el.getAttribute('data-fa-id') || '') === String(id));
  const code = finNormalizeAccountCode(select ? select.value : '');
  const acc = code ? await finGet('accounts', code) : null;
  if (!acc) {
    alert('Selecciona una cuenta contable existente antes de guardar. Aquí no hacemos magia negra contable, todavía.');
    return;
  }
  row.cuentaContableCodigo = code;
  row.cuentaContableNombreSnapshot = String(acc.nombre || acc.name || `Cuenta ${code}`);
  row.activa = active ? !!active.checked : row.activa !== false;
  row.fechaActualizacion = new Date().toISOString();
  row.updatedAtISO = row.fechaActualizacion;
  row.manualEdited = true;
  row.updatedFrom = 'finanzas_cuentas_financieras_ui';
  await finPut('financialAccounts', row);
  showToast('Cuenta financiera guardada');
  if (finCachedData) await refreshAllFin();
  else await renderFinancialAccountsView();
}

function setupFinancialAccountsUI() {
  const btnRefresh = document.getElementById('fa-refresh');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', async () => {
      try {
        await ensureBaseAccounts();
        await finEnsureFinancialAccountsBase();
        await renderFinancialAccountsView();
        if (finCachedData) await refreshAllFin();
        showToast('Cuentas Financieras revisadas');
      } catch (err) {
        console.error('Error revisando Cuentas Financieras', err);
        alert('No se pudieron revisar las Cuentas Financieras.');
      }
    });
  }

  const btnGoBanks = document.getElementById('fa-go-banks');
  if (btnGoBanks) {
    btnGoBanks.addEventListener('click', () => {
      window.location.href = '../catalogos/index.html#bancos';
    });
  }

  const host = document.getElementById('fa-list');
  if (host) {
    host.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.fa-save');
      if (!btn) return;
      const id = btn.getAttribute('data-fa-id') || '';
      if (!id) return;
      finSaveFinancialAccountFromUI(id).catch(err => {
        console.error('Error guardando cuenta financiera', err);
        alert('No se pudo guardar la cuenta financiera.');
      });
    });
  }
}

/* ---------- Tabs y eventos UI ---------- */



const FIN_HIDDEN_MAIN_VIEWS = Object.freeze(['diario', 'estados', 'catalogo', 'comprasplan', 'compras', 'cuentasfinancieras', 'transferencias']);

function finIsHiddenMainView(view) {
  const v = String(view || '').trim().toLowerCase();
  return FIN_HIDDEN_MAIN_VIEWS.indexOf(v) >= 0;
}

function finFindVisibleTabButton(view) {
  const candidate = String(view || '').trim().toLowerCase();
  return Array.from(document.querySelectorAll('.fin-tab-btn')).find((btn) => {
    const btnView = btn && btn.dataset ? String(btn.dataset.view || '').trim().toLowerCase() : '';
    return btnView === candidate && !finIsHiddenMainView(btnView) && btn.hidden !== true;
  }) || null;
}

function finFallbackVisibleView() {
  const preferred = ['tablero', 'cajachica', 'recibos'];
  for (const view of preferred) {
    if (finFindVisibleTabButton(view)) return view;
  }
  const firstVisible = Array.from(document.querySelectorAll('.fin-tab-btn')).find((btn) => {
    const btnView = btn && btn.dataset ? String(btn.dataset.view || '').trim().toLowerCase() : '';
    return btnView && !finIsHiddenMainView(btnView) && btn.hidden !== true;
  });
  return firstVisible && firstVisible.dataset ? firstVisible.dataset.view : 'diario';
}

function finNormalizeViewName(view) {
  const raw = String(view || '').trim().toLowerCase();
  const rawKey = raw.replace(/[\s_-]+/g, '');
  const aliases = {
    proveedores: 'compras',
    proveedor: 'compras',
    comprasproveedor: 'compras',
    compras_proveedor: 'compras',
    comprasaproveedor: 'compras',
    compras_a_proveedor: 'compras',
    cuentasfinancieras: 'cuentasfinancieras',
    cuentas_financieras: 'cuentasfinancieras',
    transferenciasinternas: 'transferencias',
    transferencias_internas: 'transferencias',
    diarioyajustes: 'diario',
    diario_y_ajustes: 'diario',
    diarioajustes: 'diario',
    ajustes: 'diario',
    journal: 'diario'
  };
  const candidate = aliases[raw] || aliases[rawKey] || raw || 'tablero';
  if (finIsHiddenMainView(candidate)) return finFallbackVisibleView();
  return finFindVisibleTabButton(candidate) ? candidate : finFallbackVisibleView();
}

function finRunViewSideEffects(view) {
  const v = finNormalizeViewName(view);
  if (v === 'recibos') { rcEnterView(true).catch(() => {}); }
  if (v === 'cuentasfinancieras') { renderFinancialAccountsView().catch(() => {}); }
  if (v === 'transferencias') { try { renderInternalTransfersView(finCachedData || {}); } catch (_) {} }
  if (v === 'estados' && finCachedData) { try { finReportEnsureSelectors(finCachedData); renderAccountingReports(finCachedData); } catch (_) {} }
}

function setActiveFinView(view) {
  const buttons = document.querySelectorAll('.fin-tab-btn');
  const normalized = finNormalizeViewName(view);
  let target = null;

  buttons.forEach(btn => {
    if (btn.dataset.view === normalized) {
      target = btn;
    }
  });

  // Si no se encuentra una vista válida, usar una pestaña visible segura.
  if (!target && buttons.length > 0) {
    const fallback = finFallbackVisibleView();
    target = finFindVisibleTabButton(fallback) || Array.from(buttons).find((btn) => {
      const btnView = btn && btn.dataset ? String(btn.dataset.view || '').trim().toLowerCase() : '';
      return btnView && !finIsHiddenMainView(btnView) && btn.hidden !== true;
    }) || null;
  }

  const activeView = (target && target.dataset && target.dataset.view) ? target.dataset.view : normalized;

  buttons.forEach(btn => {
    btn.classList.toggle('active', btn === target);
  });

  document.querySelectorAll('.fin-view').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${activeView}`);
  });

  return activeView;
}

function setupTabs() {
  const buttons = document.querySelectorAll('.fin-tab-btn');

  buttons.forEach(btn => {
    if (btn.dataset.a33TabBound === '1') return;
    btn.dataset.a33TabBound = '1';
    btn.addEventListener('click', () => {
      const view = finNormalizeViewName(btn.dataset.view);
      const activeView = setActiveFinView(view);
      finRunViewSideEffects(activeView);
      // Actualizar hash para que si el usuario regresa, mantenga la pestaña
      if (activeView && window.location.hash !== `#tab=${activeView}`) {
        try { window.history.replaceState(null, '', `#tab=${activeView}`); } catch (_) { window.location.hash = `tab=${activeView}`; }
      }
    });
  });

  // Vista inicial según hash de la URL. Las vistas contables/pesadas caen al Tablero operativo.
  const initialView = (window.location.hash && window.location.hash.startsWith('#tab='))
    ? finNormalizeViewName(window.location.hash.slice(5))
    : 'tablero';

  const activeView = setActiveFinView(initialView);
  finRunViewSideEffects(activeView);
  if (window.location.hash && window.location.hash !== `#tab=${activeView}`) {
    try { window.history.replaceState(null, '', `#tab=${activeView}`); } catch (_) { window.location.hash = `tab=${activeView}`; }
  }

  if (!window.__a33FinHashBound) {
    window.__a33FinHashBound = true;
    window.addEventListener('hashchange', () => {
      try {
        const next = (window.location.hash && window.location.hash.startsWith('#tab='))
          ? finNormalizeViewName(window.location.hash.slice(5))
          : 'tablero';
        const active = setActiveFinView(next);
        finRunViewSideEffects(active);
        if (active && window.location.hash !== `#tab=${active}`) {
          try { window.history.replaceState(null, '', `#tab=${active}`); } catch (_) {}
        }
      } catch (_) {}
    });
  }
}

function setupEstadosSubtabs() {
  const btns = document.querySelectorAll('.fin-subtab-btn');
  btns.forEach(btn => {
    if (btn.dataset.a33SubtabBound === '1') return;
    btn.dataset.a33SubtabBound = '1';
    btn.addEventListener('click', () => {
      const view = btn.dataset.subview;
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.fin-subview').forEach(sec => {
        sec.classList.toggle('active', sec.id === `sub-${view}`);
      });
    });
  });
}

function setupModoERToggle() {
  const modoSel = $('#er-modo');
  const contMes = $('#er-filtros-mes');
  const contRango = $('#er-filtros-rango');
  if (!modoSel || !contMes || !contRango) return;

  const update = () => {
    const modo = modoSel.value;
    if (modo === 'mes') {
      contMes.classList.remove('hidden');
      contRango.classList.add('hidden');
    } else {
      contMes.classList.add('hidden');
      contRango.classList.remove('hidden');
    }
  };

  modoSel.addEventListener('change', () => {
    update();
    if (finCachedData) {
      renderEstadoResultados(finCachedData);
      renderRentabilidadPresentacion(finCachedData);
      renderComparativoEventos(finCachedData);
      renderFlujoCaja(finCachedData);
    }
  });

  update();
}

function setupFilterListeners() {
  // Tablero
  ['tab-mes', 'tab-anio', 'tab-vista', 'tab-evento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) renderTablero(finCachedData);
    });
  });

  // Diario
  ['filtro-tipo', 'filtro-evento-diario', 'filtro-proveedor', 'filtro-origen', 'diario-desde', 'diario-hasta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) renderDiario(finCachedData);
    });
  });


  const diarioPresets = document.getElementById('diario-presets');
  if (diarioPresets) {
    diarioPresets.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-diario-preset]');
      if (!btn) return;
      applyDiaryPreset(btn.dataset.diarioPreset || '');
    });
  }

  const movTipo = $('#mov-tipo');
  if (movTipo) {
    movTipo.addEventListener('change', () => {
      if (finCachedData) fillCuentaSelect(finCachedData);
      updateManualMovementCurrencyPreview();
    });
  }

  const movFinancialAccount = document.getElementById('mov-financial-account');
  if (movFinancialAccount) {
    movFinancialAccount.addEventListener('change', updateManualMovementCurrencyPreview);
  }

  const movMonto = document.getElementById('mov-monto');
  if (movMonto) {
    movMonto.addEventListener('input', updateManualMovementCurrencyPreview);
  }

  const btnGuardar = $('#mov-guardar');
  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      guardarMovimientoManual().catch(err => {
        console.error('Error guardando movimiento', err);
        alert('No se pudo guardar el movimiento en Finanzas.');
      });
    });
  }


  setupInternalTransfersUI();

  // Estados de Resultados + Rentabilidad + Comparativo eventos + Flujo de Caja
  ['er-mes', 'er-anio', 'er-desde', 'er-hasta', 'er-evento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (finCachedData) {
        renderEstadoResultados(finCachedData);
        renderRentabilidadPresentacion(finCachedData);
        renderComparativoEventos(finCachedData);
        renderFlujoCaja(finCachedData);
      }
    });
  });

  // Balance
  const bgFecha = $('#bg-fecha');
  if (bgFecha) {
    bgFecha.addEventListener('change', () => {
      if (finCachedData) renderBalanceGeneral(finCachedData);
    });
  }

  // Detalle modal
  const cerrar = $('#detalle-cerrar');
  const modal = $('#detalle-modal');
  if (cerrar) cerrar.addEventListener('click', closeDetalleModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDetalleModal();
    });
  }

  // Delegación Ver detalle
  const diarioTbody = $('#diario-tbody');
  if (diarioTbody) {
    diarioTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.ver-detalle');
      if (!btn) return;
      const id = Number(btn.dataset.id || '0');
      if (id && finCachedData) openDetalleModal(id);
    });
  }
}

/* ---------- Ciclo principal ---------- */

function finSafeRenderBlock(label, fn) {
  try {
    if (typeof fn === 'function') return fn();
  } catch (err) {
    console.error(`Error renderizando ${label}`, err);
  }
  return null;
}

async function refreshAllFin() {
  finCachedData = await getAllFinData();
  const data = finCachedData;

  // Evento (POS): refrescar lista de eventos activos para dropdown y resolución live por ID.
  await refreshPosEventsCache();
  populateMovimientoEventoSelect();
  updateEventFilters(data);
  updateSupplierSelects(data);
  fillCuentaSelect(data);
  fillFinancialAccountSelect(data);
  rcPopulateFinancialAccountSelect(data);
  compraPopulateFinancialAccountSelect(data);
  fillCompraCuentaDebe(data);
  fillCompraCuentaHaber(data);
  compraSyncFinancialAccountUI(data);
  finRenderCurrencyReference();
  // El Catálogo debe pintarse aunque otra sección de Finanzas falle en iPad/PWA.
  finSafeRenderBlock('Catálogo de Cuentas', () => renderCatalogoCuentas(data));
  finSafeRenderBlock('Tablero', () => renderTablero(data));
  finSafeRenderBlock('Diario Contable visual', () => renderDiarioContableVisual(data));
  finSafeRenderBlock('Diario histórico', () => renderDiario(data));
  finSafeRenderBlock('Compras a Proveedor', () => renderComprasPorProveedor(data));
  renderFinancialAccountsView().catch(err => console.error('Error renderizando Cuentas Financieras', err));
  finSafeRenderBlock('Transferencias Internas', () => renderInternalTransfersView(data));
  finSafeRenderBlock('Estado de Resultados', () => renderEstadoResultados(data));
  finSafeRenderBlock('Balance General', () => renderBalanceGeneral(data));
  finSafeRenderBlock('Rentabilidad por presentación', () => renderRentabilidadPresentacion(data));
  finSafeRenderBlock('Comparativo de eventos', () => renderComparativoEventos(data));
  finSafeRenderBlock('Flujo de Caja', () => renderFlujoCaja(data));
  finSafeRenderBlock('Reportes contables', () => renderAccountingReports(data));

  // Compras (planificación)
  if (typeof pcRenderAll === 'function') pcRenderAll();
}


/* ---------- POS: Importar cierres diarios (asiento consolidado) ---------- */

const POS_DAILY_CLOSE_SOURCE = 'POS_DAILY_CLOSE';
const POS_DAILY_CLOSE_REVERSAL_SOURCE = 'POS_DAILY_CLOSE_REVERSAL';

function n0(v) {
  if (v == null) return 0;
  const s = (typeof v === 'string') ? v.replace(',', '.') : v;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function n2(v) {
  return Math.round((n0(v) + Number.EPSILON) * 100) / 100;
}

function buildEventDateKey(eventId, dateKey) {
  const id = (typeof eventId === 'number') ? eventId : parseInt(String(eventId || '').trim(), 10);
  const dk = (dateKey || '').toString().slice(0, 10);
  return `${id || 0}|${dk || ''}`;
}

function isValidISODateKey(dk) {
  const s = String(dk || '').trim();
  const mm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mm) return false;
  const y = Number(mm[1]);
  const mo = Number(mm[2]);
  const d = Number(mm[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  // Guardas razonables para evitar basura
  if (y < 2000 || y > 2100) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === mo && dt.getUTCDate() === d;
}

function toNumberMaybe(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.replace(',', '.').trim();
    if (!s) return null;
    return Number(s);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : n;
}

function isBadAmount(v) {
  if (v == null) return false;
  const n = toNumberMaybe(v);
  if (n == null) return false;
  if (!Number.isFinite(n)) return true;
  if (n < 0) return true;
  return false;
}

function validatePosClosureForImport(closure) {
  const closureId = String(closure?.closureId || '').trim() || '(sin closureId)';

  const eventId = (typeof closure?.eventId === 'number') ? closure.eventId : parseInt(String(closure?.eventId || '').trim(), 10);
  if (!eventId || eventId <= 0) {
    return { ok: false, msg: `${closureId}: falta eventId` };
  }

  const dateKey = String(closure?.dateKey || '').slice(0, 10).trim();
  if (!isValidISODateKey(dateKey)) {
    return { ok: false, msg: `${closureId}: fecha inválida` };
  }

  const totals = (closure && closure.totals && typeof closure.totals === 'object') ? closure.totals : {};

  // Totales (si vienen)
  if (isBadAmount(totals.totalGeneral)) return { ok: false, msg: `${closureId}: totalGeneral inválido` };

  // Métodos de pago
  const pm = (totals && totals.ventasPorMetodo && typeof totals.ventasPorMetodo === 'object') ? totals.ventasPorMetodo : null;
  if (pm) {
    for (const k of Object.keys(pm)) {
      if (isBadAmount(pm[k])) return { ok: false, msg: `${closureId}: método ${k} inválido` };
    }
  }

  // Costos
  const costKeys = ['costoVentasTotal', 'costoCortesiasTotal', 'cortesiaCostoTotal'];
  for (const ck of costKeys) {
    if (isBadAmount(totals[ck])) return { ok: false, msg: `${closureId}: ${ck} inválido` };
  }
  if (isBadAmount(totals.cortesiaCantidad)) return { ok: false, msg: `${closureId}: cortesiaCantidad inválida` };

  // Caja Chica (si viene)
  const petty = (totals && totals.pettyCash && typeof totals.pettyCash === 'object') ? totals.pettyCash : null;
  if (petty) {
    const pcKeys = ['ingresosNio', 'egresosNio', 'ingresosUsd', 'egresosUsd'];
    for (const pk of pcKeys) {
      if (isBadAmount(petty[pk])) return { ok: false, msg: `${closureId}: caja chica ${pk} inválido` };
    }
    // fxRateUsed puede existir; si viene, que no sea negativo/NaN
    if (isBadAmount(petty.fxRateUsed)) return { ok: false, msg: `${closureId}: caja chica fxRate inválido` };
  }

  return { ok: true, eventId, dateKey };
}



function resolvePosCloseEventName(eventId, closure) {
  const snap = String((closure && (closure.eventNameSnapshot || closure.posEventNameSnapshot || closure.eventName || closure.posEventName)) || '').trim();
  if (snap) return snap;

  const live = getPosEventNameLiveById(eventId);
  if (live) return live;

  // Fallback humano
  return eventId ? 'Evento' : 'Central';
}

function resolvePosCloseClosedAtTs(closure) {
  const raw = (closure && (closure.closedAt ?? closure.createdAt)) ?? null;
  const d = new Date(raw);
  if (raw != null && !Number.isNaN(d.getTime())) return d.getTime();
  return Date.now(); // último recurso
}

function buildPosCloseHumanDescription(prefix, eventName, closedAtTs) {
  const when = fmtDDMMYYYYHHMM(closedAtTs);
  return `${prefix} — ${eventName} — ${when || fmtDDMMYYYYHHMM(Date.now())}`;
}


async function finGetLinesForEntryId(idEntry) {
  await openFinDB();
  return new Promise((resolve, reject) => {
    let store;
    try {
      store = finTx('journalLines', 'readonly');
    } catch (err) {
      resolve([]);
      return;
    }
    const out = [];
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        resolve(out);
        return;
      }
      const v = cursor.value;
      if (v && Number(v.idEntry || 0) === Number(idEntry || 0)) out.push(v);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

function findCourtesyExpenseAccountCode(data) {
  const accounts = (data && Array.isArray(data.accounts)) ? data.accounts : [];
  for (const a of accounts) {
    const nm = (a && a.nombre) ? String(a.nombre).toLowerCase() : '';
    const tp = getTipoCuenta(a);
    if (tp === 'gasto' && (nm.includes('cortesia') || nm.includes('cortesía') || nm.includes('promocion') || nm.includes('promoción'))) {
      return String(a.code || '');
    }
  }
  // Fallback razonable: marketing.
  return '6105';
}

async function createJournalEntryWithLines(entry, lines) {
  // Compatibilidad: ahora es atómico.
  return createJournalEntryWithLinesAtomic(entry, lines);
}

function getMissingAccountCodes(codes, accountsMap) {
  const out = [];
  const set = new Set();
  for (const c of (Array.isArray(codes) ? codes : [])) {
    const s = String(c || '').trim();
    if (!s || set.has(s)) continue;
    set.add(s);
    if (!accountsMap || typeof accountsMap.get !== 'function' || !accountsMap.get(s)) out.push(s);
  }
  return out;
}

function validatePostableAccountCodesForAutoEntry(codes, data, contextLabel = 'asiento automático') {
  const accountsMap = data && data.accountsMap ? data.accountsMap : null;
  const accounts = Array.isArray(data && data.accounts) ? data.accounts : [];
  const missing = [];
  const blocked = [];
  const seen = new Set();

  for (const rawCode of (Array.isArray(codes) ? codes : [])) {
    const code = finNormalizeAccountCode(rawCode);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const acc = accountsMap && typeof accountsMap.get === 'function' ? accountsMap.get(code) : null;
    if (!acc) {
      missing.push(code);
      continue;
    }
    const view = finNormalizeAccountForView({ ...acc, hasChildren: finAccountHasChildrenInList(accounts, code) });
    if (!finIsPostableAccount(view)) blocked.push(`${code} ${finGetAccountName(view) || ''}`.trim());
  }

  if (missing.length) {
    return { ok: false, message: `Para convertir POS a asiento contable completo, cree y configure cuentas posteables. Faltan: ${missing.join(', ')}.` };
  }
  if (blocked.length) {
    return { ok: false, message: `Para ${contextLabel}, las cuentas deben ser posteables y activas. Revise: ${blocked.join(', ')}.` };
  }
  return { ok: true, message: '' };
}


// Etapa 3/3 Tablero: mapeo seguro POS → cuentas posteables del nuevo Catálogo.
// No crea cuentas; solo resuelve cuentas existentes y bloquea importaciones incompletas.
function finPosAutoAccountsList(data) {
  if (Array.isArray(data && data.accounts)) return data.accounts;
  if (data && data.accountsMap && typeof data.accountsMap.values === 'function') return [...data.accountsMap.values()];
  return [];
}

function finPosAutoAccountByCode(data, code) {
  const c = finNormalizeAccountCode(code);
  if (!c) return null;
  const map = data && data.accountsMap;
  if (map && typeof map.get === 'function' && map.get(c)) return map.get(c);
  return finPosAutoAccountsList(data).find(a => finGetAccountCode(a) === c) || null;
}

function finPosAutoIsPostableAccount(data, accountOrCode) {
  const accounts = finPosAutoAccountsList(data);
  const acc = (accountOrCode && typeof accountOrCode === 'object') ? accountOrCode : finPosAutoAccountByCode(data, accountOrCode);
  if (!acc) return false;
  const code = finGetAccountCode(acc);
  const view = finNormalizeAccountForView({ ...acc, hasChildren: finAccountHasChildrenInList(accounts, code) });
  return !!finIsPostableAccount(view);
}

function finPosAutoAccountName(data, code) {
  const acc = finPosAutoAccountByCode(data, code);
  return acc ? finGetAccountName(acc) : '';
}

function finPosAutoMatchesWords(text, words) {
  const hay = normText(text || '');
  const arr = Array.isArray(words) ? words : [words];
  return arr.every(w => hay.includes(normText(w || '')));
}

function finPosAutoResolvePostableAccount(data, opts = {}) {
  const accounts = finPosAutoAccountsList(data);
  const candidateCodes = Array.isArray(opts.candidateCodes) ? opts.candidateCodes : [];
  for (const raw of candidateCodes) {
    const code = finNormalizeAccountCode(raw);
    if (code && finPosAutoIsPostableAccount(data, code)) return code;
  }

  const typeWanted = opts.tipo ? normText(opts.tipo) : '';
  const rootWanted = opts.rootCode ? finNormalizeAccountCode(opts.rootCode) : '';
  const currencyWanted = opts.currency ? finNormalizeCurrencyCode(opts.currency) : '';
  const roleWanted = opts.role ? normText(opts.role) : '';
  const nameGroups = Array.isArray(opts.nameGroups) ? opts.nameGroups : [];
  const predicate = (typeof opts.predicate === 'function') ? opts.predicate : null;

  const rows = accounts
    .map(a => {
      const code = finGetAccountCode(a);
      return { raw: a, view: finNormalizeAccountForView({ ...a, hasChildren: finAccountHasChildrenInList(accounts, code) }) };
    })
    .filter(row => row.view && finIsPostableAccount(row.view));

  const filtered = rows.filter(({ raw, view }) => {
    if (typeWanted && normText(getTipoCuenta(view)) !== typeWanted && normText(finGetAccountType(view)) !== typeWanted) return false;
    if (rootWanted && finGetRootFromCode(finGetAccountCode(view)) !== rootWanted) return false;
    if (currencyWanted && finGetFinancialAccountCurrencyCode(view) !== currencyWanted) return false;
    if (roleWanted) {
      const roleText = [raw.role, raw.kind, raw.accountRole, raw.generatedFrom, raw.sourceCatalog, raw.nombre, raw.name].filter(Boolean).join(' ');
      if (!normText(roleText).includes(roleWanted)) return false;
    }
    if (nameGroups.length) {
      const nm = [view.nombre, view.name, raw.nombre, raw.name, raw.bankCatalogName, raw.bankNameSnapshot].filter(Boolean).join(' ');
      if (!nameGroups.some(group => finPosAutoMatchesWords(nm, group))) return false;
    }
    if (predicate && !predicate(raw, view)) return false;
    return true;
  });

  if (!filtered.length) return '';
  filtered.sort((a, b) => finGetAccountCode(a.view).localeCompare(finGetAccountCode(b.view), 'es'));
  return finGetAccountCode(filtered[0].view);
}

function finPosAutoResolveCashAccount(data, currency = 'NIO') {
  const cur = finNormalizeCurrencyCode(currency);
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: cur === 'USD' ? ['1122', '1112', '1105', '1115'] : ['1121', '1111', '1100', '1110'],
    tipo: 'activo',
    currency: cur,
    nameGroups: cur === 'USD'
      ? [['caja', 'eventos', 'us'], ['caja', 'general', 'us']]
      : [['caja', 'eventos'], ['caja', 'general'], ['efectivo']]
  });
}

function finPosAutoResolveBankAccount(data, currency = 'NIO') {
  const cur = finNormalizeCurrencyCode(currency);
  const generated = finPosAutoResolvePostableAccount(data, {
    tipo: 'activo',
    currency: cur,
    predicate: (raw, view) => finIsBankAccount(raw || view) && String(raw && raw.generatedFrom || '').toLowerCase().includes('catalogos_bancos')
  });
  if (generated) return generated;
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: cur === 'USD' ? ['1202', '1212', '1222'] : ['1201', '1211', '1221'],
    tipo: 'activo',
    currency: cur,
    predicate: (raw, view) => finIsBankAccount(raw || view) || normText(finGetAccountName(view)).includes('banco'),
    nameGroups: [['banco']]
  });
}

function finPosAutoResolveCreditAccount(data, currency = 'NIO') {
  const cur = finNormalizeCurrencyCode(currency);
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: cur === 'USD' ? ['1312'] : ['1311'],
    tipo: 'activo',
    currency: cur,
    nameGroups: [['clientes', 'credito'], ['cuentas', 'cobrar']]
  });
}

function finPosAutoResolveIncomeAccount(data) {
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: ['4211', '4111'],
    tipo: 'ingreso',
    nameGroups: [['ventas', 'pos'], ['ventas', 'directas'], ['ventas']]
  });
}

function finPosProductKeyFromName(name) {
  const n = normText(name || '');
  if (n.includes('vaso')) return 'vaso';
  if (n.includes('pulso') || n.includes('250')) return 'pulso';
  if (n.includes('media') || n.includes('375')) return 'media';
  if (n.includes('djeba') || n.includes('750')) return 'djeba';
  if (n.includes('litro') || n.includes('1000')) return 'litro';
  if (n.includes('galon') || n.includes('gallon') || n.includes('3750')) return 'galon';
  return '';
}

const FIN_POS_PRODUCT_ACCOUNT_MAP = Object.freeze({
  galon: Object.freeze({ inventory: ['1421'], cogs: ['5211'], income: ['4111'] }),
  litro: Object.freeze({ inventory: ['1422'], cogs: ['5212'], income: ['4112'] }),
  djeba: Object.freeze({ inventory: ['1423'], cogs: ['5213'], income: ['4113'] }),
  media: Object.freeze({ inventory: ['1424'], cogs: ['5214'], income: ['4114'] }),
  pulso: Object.freeze({ inventory: ['1425'], cogs: ['5215'], income: ['4115'] }),
  vaso: Object.freeze({ inventory: ['1441'], cogs: ['5131'], income: ['4211'] })
});

function finPosAutoResolveProductAccount(data, productName, kind) {
  const key = finPosProductKeyFromName(productName);
  const spec = key ? FIN_POS_PRODUCT_ACCOUNT_MAP[key] : null;
  const candidates = spec && Array.isArray(spec[kind]) ? spec[kind] : [];

  // Productos dinámicos: si no reconocemos presentación legacy, NO caen a Galón por fallback.
  // Se usan cuentas genéricas/posteables por tipo; así Catrina, Vaso u otros productos futuros
  // conservan su nombre snapshot sin mapearse como 1421/5211 salvo que el catálogo realmente coincida.
  if (kind === 'inventory') {
    const genericCandidates = key ? ['1421', '1441', '1411', '1501', '1500'] : ['1501', '1500'];
    const genericGroups = key
      ? [['sangria'], ['producto', 'terminado'], ['vasos'], ['inventario']]
      : [['producto', 'terminado'], ['inventario', 'producto'], ['inventario']];
    return finPosAutoResolvePostableAccount(data, {
      candidateCodes: [...candidates, ...genericCandidates],
      tipo: 'activo',
      nameGroups: genericGroups,
      predicate: key ? null : ((raw, view) => {
        const code = finNormalizeAccountCode(finGetAccountCode(view));
        if (['1421','1422','1423','1424','1425','1441'].includes(code)) return false;
        const nm = normText([finGetAccountName(view), raw && raw.nombre, raw && raw.name].filter(Boolean).join(' '));
        if (['galon','litro','djeba','media','pulso','vaso'].some(w => nm.includes(w))) return false;
        return nm.includes('inventar') || nm.includes('producto terminado') || nm.includes('stock');
      })
    });
  }
  if (kind === 'cogs') {
    const genericCandidates = key ? ['5211', '5131', '5111', '5101', '5100'] : ['5101', '5100', '5111'];
    const genericGroups = key
      ? [['costo', 'vendido'], ['costo', 'vasos'], ['costo']]
      : [['costo', 'ventas'], ['costo', 'vendido'], ['costo']];
    return finPosAutoResolvePostableAccount(data, {
      candidateCodes: [...candidates, ...genericCandidates],
      tipo: 'costo',
      nameGroups: genericGroups,
      predicate: key ? null : ((raw, view) => {
        const code = finNormalizeAccountCode(finGetAccountCode(view));
        if (['5211','5212','5213','5214','5215','5131'].includes(code)) return false;
        const nm = normText([finGetAccountName(view), raw && raw.nombre, raw && raw.name].filter(Boolean).join(' '));
        if (['galon','litro','djeba','media','pulso','vaso'].some(w => nm.includes(w))) return false;
        return nm.includes('costo');
      })
    });
  }
  if (kind === 'income') {
    return finPosAutoResolvePostableAccount(data, {
      candidateCodes: [...candidates, '4211', '4111', '4101', '4100'],
      tipo: 'ingreso',
      nameGroups: [['ventas', 'pos'], ['ventas']]
    });
  }
  return '';
}

function finPosAutoResolveCourtesyExpenseAccount(data) {
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: ['6113', '4312', '6111', '6312'],
    nameGroups: [['degustaciones'], ['muestras'], ['cortesias'], ['cortesías'], ['promocion'], ['promoción']],
    predicate: (raw, view) => ['gasto', 'ingreso'].includes(normText(getTipoCuenta(view)))
  });
}

function finPosAutoResolvePettyExpenseAccount(data) {
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: ['6123', '6121', '6221', '6113'],
    tipo: 'gasto',
    nameGroups: [['logistica'], ['transporte'], ['eventos'], ['papeleria'], ['muestras']]
  });
}

function finPosAutoResolveOtherIncomeAccount(data) {
  return finPosAutoResolvePostableAccount(data, {
    candidateCodes: ['7112', '7111', '7213'],
    tipo: 'ingreso',
    nameGroups: [['ajustes', 'favorables'], ['recuperacion'], ['otros', 'ingresos']]
  });
}

function finPosAutoLine(data, accountCode, debe, haber, meta = {}) {
  const code = finNormalizeAccountCode(accountCode);
  return {
    accountCode: code,
    accountNameSnapshot: finPosAutoAccountName(data, code) || null,
    debe: n2(debe),
    haber: n2(haber),
    originalCurrency: meta.originalCurrency || 'NIO',
    currency: meta.currency || meta.originalCurrency || 'NIO',
    sourceMap: meta.sourceMap || 'POS_AUTO_POSTABLE_MAP',
    mapRole: meta.mapRole || null,
    productNameSnapshot: meta.productNameSnapshot || null
  };
}

function finPosAutoAddBalancedCostLines(lines, data, productName, amount, kind = 'paid') {
  const value = n2(amount);
  if (!(value > 0)) return;
  const cogsCode = kind === 'courtesy'
    ? finPosAutoResolveCourtesyExpenseAccount(data)
    : finPosAutoResolveProductAccount(data, productName, 'cogs');
  const invCode = finPosAutoResolveProductAccount(data, productName, 'inventory');
  if (!cogsCode || !invCode) {
    throw new Error(`Falta cuenta posteable para costo POS (${productName || 'producto'}).`);
  }
  lines.push(finPosAutoLine(data, cogsCode, value, 0, { mapRole: kind === 'courtesy' ? 'courtesy_cost' : 'cogs', productNameSnapshot: productName || null }));
  lines.push(finPosAutoLine(data, invCode, 0, value, { mapRole: 'inventory_out', productNameSnapshot: productName || null }));
}

function finPosAutoAddCostBreakdownLines(lines, data, breakdown, fallbackPaid, fallbackCourtesy) {
  const rows = Array.isArray(breakdown) ? breakdown : [];
  let usedPaid = 0;
  let usedCourtesy = 0;
  for (const row of rows) {
    const name = String(row && (row.productName || row.name || row.producto || '') || '').trim();
    const paid = n2(row && row.totalCostPaid);
    const courtesy = n2(row && row.totalCostCourtesy);
    if (paid > 0) {
      finPosAutoAddBalancedCostLines(lines, data, name, paid, 'paid');
      usedPaid = n2(usedPaid + paid);
    }
    if (courtesy > 0) {
      finPosAutoAddBalancedCostLines(lines, data, name, courtesy, 'courtesy');
      usedCourtesy = n2(usedCourtesy + courtesy);
    }
  }
  const remPaid = n2(n2(fallbackPaid) - usedPaid);
  const remCourtesy = n2(n2(fallbackCourtesy) - usedCourtesy);
  if (remPaid > 0.01) finPosAutoAddBalancedCostLines(lines, data, 'Sangría Artesanal Premium', remPaid, 'paid');
  if (remCourtesy > 0.01) finPosAutoAddBalancedCostLines(lines, data, 'Sangría Artesanal Premium', remCourtesy, 'courtesy');
}

function finPosAutoBuildClosureLines(closure, data) {
  const pm = (closure && closure.totals && closure.totals.ventasPorMetodo) ? closure.totals.ventasPorMetodo : {};
  const efectivo = n2(pm.efectivo);
  const transferencia = n2(pm.transferencia);
  const credito = n2(pm.credito);
  let otros = 0;
  const extras = {};
  if (pm && typeof pm === 'object') {
    for (const k of Object.keys(pm)) {
      if (k === 'efectivo' || k === 'transferencia' || k === 'credito') continue;
      const v = n2(pm[k]);
      if (v > 0) {
        otros = n2(otros + v);
        extras[k] = v;
      }
    }
  }

  const total = n2(efectivo + transferencia + credito + otros);
  const legacyCortesiaCosto = n2(closure && closure.totals && closure.totals.cortesiaCostoTotal);
  const costoVentasTotal = n2(closure && closure.totals && closure.totals.costoVentasTotal);
  let costoCortesiasTotal = n2(closure && closure.totals && closure.totals.costoCortesiasTotal);
  if (!(costoCortesiasTotal > 0) && legacyCortesiaCosto > 0) costoCortesiasTotal = legacyCortesiaCosto;

  const lines = [];
  const cashCode = finPosAutoResolveCashAccount(data, 'NIO');
  const bankCode = finPosAutoResolveBankAccount(data, 'NIO');
  const creditCode = finPosAutoResolveCreditAccount(data, 'NIO');
  const otherCollectionCode = bankCode || cashCode;
  const incomeCode = finPosAutoResolveIncomeAccount(data);

  if (efectivo > 0) {
    if (!cashCode) throw new Error('Falta cuenta posteable para efectivo C$ de POS.');
    lines.push(finPosAutoLine(data, cashCode, efectivo, 0, { mapRole: 'payment_cash_nio' }));
  }
  if (transferencia > 0) {
    if (!bankCode) throw new Error('Falta cuenta posteable para transferencia/banco C$ de POS.');
    lines.push(finPosAutoLine(data, bankCode, transferencia, 0, { mapRole: 'payment_bank_nio' }));
  }
  if (credito > 0) {
    if (!creditCode) throw new Error('Falta cuenta posteable para crédito/CxC C$ de POS.');
    lines.push(finPosAutoLine(data, creditCode, credito, 0, { mapRole: 'payment_credit_nio' }));
  }
  if (otros > 0) {
    if (!otherCollectionCode) throw new Error('Falta cuenta posteable para otros métodos de cobro POS.');
    lines.push(finPosAutoLine(data, otherCollectionCode, otros, 0, { mapRole: 'payment_other_nio' }));
  }

  if (total > 0) {
    if (!incomeCode) throw new Error('Falta cuenta posteable para ingresos operativos POS.');
    lines.push(finPosAutoLine(data, incomeCode, 0, total, { mapRole: 'sales_income' }));
  }

  finPosAutoAddCostBreakdownLines(lines, data, closure && closure.totals && closure.totals.costBreakdown, costoVentasTotal, costoCortesiasTotal);

  const petty = closure && closure.totals ? (closure.totals.pettyCash || null) : null;
  const pcEgresos = n2(petty && petty.egresosNio);
  const pcIngresos = n2(petty && petty.ingresosNio);
  if (pcEgresos > 0) {
    const expCode = finPosAutoResolvePettyExpenseAccount(data);
    if (!expCode || !cashCode) throw new Error('Falta cuenta posteable para egresos de Caja Chica POS.');
    lines.push(finPosAutoLine(data, expCode, pcEgresos, 0, { mapRole: 'petty_expense' }));
    lines.push(finPosAutoLine(data, cashCode, 0, pcEgresos, { mapRole: 'petty_cash_out' }));
  }
  if (pcIngresos > 0) {
    const otherIncomeCode = finPosAutoResolveOtherIncomeAccount(data);
    if (!otherIncomeCode || !cashCode) throw new Error('Falta cuenta posteable para ingresos de Caja Chica POS.');
    lines.push(finPosAutoLine(data, cashCode, pcIngresos, 0, { mapRole: 'petty_cash_in' }));
    lines.push(finPosAutoLine(data, otherIncomeCode, 0, pcIngresos, { mapRole: 'petty_other_income' }));
  }

  const mappedPaymentBreakdown = {
    efectivo,
    transferencia,
    credito,
    otros,
    extras,
    total,
    accounts: { efectivo: cashCode, transferencia: bankCode, credito: creditCode, otros: otherCollectionCode }
  };

  return {
    lines,
    paymentBreakdown: mappedPaymentBreakdown,
    costBreakdown: {
      costoVentasTotal,
      costoCortesiasTotal,
      costoTotalSalidaInventario: n2(costoVentasTotal + costoCortesiasTotal)
    },
    accountMap: {
      cashCode,
      bankCode,
      creditCode,
      otherCollectionCode,
      incomeCode,
      pettyExpenseCode: pcEgresos > 0 ? finPosAutoResolvePettyExpenseAccount(data) : null,
      pettyIncomeCode: pcIngresos > 0 ? finPosAutoResolveOtherIncomeAccount(data) : null,
      courtesyExpenseCode: costoCortesiasTotal > 0 ? finPosAutoResolveCourtesyExpenseAccount(data) : null
    }
  };
}
// Útil para importaciones críticas (POS→Finanzas).
async function createJournalEntryWithLinesAtomic(entry, lines) {
  await openFinDB();
  return new Promise((resolve, reject) => {
    let entryId = null;
    let tx;
    try {
      tx = finDB.transaction(['journalEntries', 'journalLines'], 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }

    const stE = tx.objectStore('journalEntries');
    const stL = tx.objectStore('journalLines');

    const req = stE.add(entry);
    req.onsuccess = (e) => {
      entryId = e.target.result;
      for (const ln of (Array.isArray(lines) ? lines : [])) {
        stL.add({ ...ln, idEntry: entryId, journalEntryId: entryId, entryId });
      }
    };

    tx.oncomplete = () => resolve(entryId);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
    tx.onerror = () => { /* onabort maneja */ };
  });
}

// Etapa 2: actualización atómica de un asiento y sus líneas (sin migraciones destructivas).
// Nota: journalLines no tiene índice por idEntry, así que se borra por cursor (acotado a pocas líneas).
async function updateJournalEntryWithLinesAtomic(entryId, entry, lines) {
  await openFinDB();
  return new Promise((resolve, reject) => {
    const id = Number(entryId);
    if (!Number.isFinite(id) || id <= 0) {
      reject(new Error('entryId inválido para updateJournalEntryWithLinesAtomic'));
      return;
    }

    let tx;
    try {
      tx = finDB.transaction(['journalEntries', 'journalLines'], 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }

    const stE = tx.objectStore('journalEntries');
    const stL = tx.objectStore('journalLines');

    try {
      stE.put({ ...(entry || {}), id });
    } catch (err) {
      try { tx.abort(); } catch (_) {}
      reject(err);
      return;
    }

    const reqCur = stL.openCursor();
    reqCur.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        for (const ln of (Array.isArray(lines) ? lines : [])) {
          if (!ln) continue;
          stL.add({ ...ln, idEntry: id, journalEntryId: id, entryId: id });
        }
        return;
      }
      const v = cursor.value;
      if (v && Number(v.idEntry) === id) {
        try { cursor.delete(); } catch (_) {}
      }
      cursor.continue();
    };

    tx.oncomplete = () => resolve(id);
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
    tx.onerror = () => { /* onabort maneja */ };
  });
}

// Importación atómica (journalEntries + journalLines + posDailyCloseImports).
// Si falla cualquier parte (incl. reverso), NO queda nada a medias.
async function importPosCloseAtomic({ newEntry, newLines, newImportRec, prevImportUpdate, revEntry, revLines }) {
  await openFinDB();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = finDB.transaction(['journalEntries', 'journalLines', 'posDailyCloseImports'], 'readwrite');
    } catch (err) {
      reject(err);
      return;
    }
    const stE = tx.objectStore('journalEntries');
    const stL = tx.objectStore('journalLines');
    const stI = tx.objectStore('posDailyCloseImports');

    let newEntryId = null;
    let revEntryId = null;

    const addNewReq = stE.add(newEntry);
    addNewReq.onsuccess = (e) => {
      newEntryId = e.target.result;
      for (const ln of (Array.isArray(newLines) ? newLines : [])) {
        if (!ln) continue;
        stL.add({ ...ln, idEntry: newEntryId });
      }

      // Con reverso: solo después de crear el asiento nuevo, intentamos el reverso.
      if (revEntry) {
        const addRevReq = stE.add(revEntry);
        addRevReq.onsuccess = (ev) => {
          revEntryId = ev.target.result;
          for (const ln of (Array.isArray(revLines) ? revLines : [])) {
            if (!ln) continue;
            stL.add({ ...ln, idEntry: revEntryId });
          }

          if (prevImportUpdate) {
            prevImportUpdate.reversalJournalEntryId = revEntryId;
            stI.put(prevImportUpdate);
          }

          stI.put({ ...newImportRec, journalEntryId: newEntryId });
        };
      } else {
        if (prevImportUpdate) stI.put(prevImportUpdate);
        stI.put({ ...newImportRec, journalEntryId: newEntryId });
      }
    };

    tx.oncomplete = () => resolve({ newEntryId, revEntryId });
    tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
    tx.onerror = () => { /* onabort maneja */ };
  });
}

// Construye el asiento del cierre POS (sin escribirlo aún). Se escribe de forma atómica desde importPosCloseAtomic().
async function createPosDailyCloseEntry(closure, data) {
  const closureId = String(closure?.closureId || '').trim();
  if (!closureId) throw new Error('Cierre sin closureId');

  const v = validatePosClosureForImport(closure);
  if (!v.ok) throw new Error('Cierre inválido: ' + v.msg);

  const eventId = v.eventId;
  const dateKey = v.dateKey;
  const version = Number(closure.version || 1) || 1;

  const eventName = resolvePosCloseEventName(eventId, closure);
  const closedAtTs = resolvePosCloseClosedAtTs(closure);
  const humanDesc = buildPosCloseHumanDescription('Cierre diario POS', eventName, closedAtTs);
  const pm = (closure.totals && closure.totals.ventasPorMetodo) ? closure.totals.ventasPorMetodo : {};

  const efectivo = n2(pm.efectivo);
  const transferencia = n2(pm.transferencia);
  const credito = n2(pm.credito);

  // Cualquier método adicional → Otros activos (debe), pero lo dejamos trazado.
  let otros = 0;
  const extras = {};
  if (pm && typeof pm === 'object') {
    for (const k of Object.keys(pm)) {
      if (k === 'efectivo' || k === 'transferencia' || k === 'credito') continue;
      const v = n2(pm[k]);
      if (v > 0) {
        otros += v;
        extras[k] = v;
      }
    }
  }

  let total = n2(efectivo + transferencia + credito + otros);
  const totalGeneralRaw = closure?.totals?.totalGeneral;
  const totalGeneral = n2(totalGeneralRaw);
  const hasTotalGeneral = (totalGeneralRaw != null) && !Number.isNaN(toNumberMaybe(totalGeneralRaw));
  const totalMismatch = (hasTotalGeneral && Math.abs(totalGeneral - total) > 0.01)
    ? n2(totalGeneral - total)
    : 0;

  // Costos (COGS + cortesías) vienen consolidados desde POS
  const legacyCortesiaCosto = n2(closure?.totals?.cortesiaCostoTotal);
  const cortesiaCantidad = Number(closure?.totals?.cortesiaCantidad || 0) || 0;

  const costoVentasTotal = n2(closure?.totals?.costoVentasTotal);
  let costoCortesiasTotal = n2(closure?.totals?.costoCortesiasTotal);
  if (!(costoCortesiasTotal > 0) && legacyCortesiaCosto > 0) costoCortesiasTotal = legacyCortesiaCosto;
  const costoTotalSalidaInventario = n2(costoVentasTotal + costoCortesiasTotal);

  const posAuto = finPosAutoBuildClosureLines(closure, data);
  const lines = posAuto.lines;

  // Mapeo real hacia cuentas posteables: se guarda como snapshot técnico para auditoría.
  const mappedPaymentBreakdown = posAuto.paymentBreakdown;
  const mappedCostBreakdown = posAuto.costBreakdown;
  const mappedAccountMap = posAuto.accountMap;
  const petty = closure?.totals?.pettyCash || null;
  const pcEgresos = n2(petty?.egresosNio);
  const pcIngresos = n2(petty?.ingresosNio);

  const totalDebe = n2(lines.reduce((s, ln) => s + n0(ln.debe), 0));
  const totalHaber = n2(lines.reduce((s, ln) => s + n0(ln.haber), 0));

    // Nota: la descripción queda humana; closureId y datos técnicos se guardan en campos técnicos.

  const entry = {
    fecha: dateKey,
    descripcion: humanDesc,
    tipoMovimiento: 'ingreso',
    reference: dateKey,
    eventScope: 'POS',
    posEventId: eventId,
    posEventNameSnapshot: String(closure.eventNameSnapshot || closure.posEventNameSnapshot || closure.eventName || eventName || '').trim() || null,
    origen: 'POS',
    origenId: closureId,
    totalDebe,
    totalHaber,
    // Metadata (no rompe nada):
    source: POS_DAILY_CLOSE_SOURCE,
    closureId,
    eventId,
    dateKey,
    version,
    eventDateKey: buildEventDateKey(eventId, dateKey),
    paymentBreakdown: mappedPaymentBreakdown,

    // Compat legacy: mantenemos bloque cortesia (ahora con costoCortesiasTotal)
    cortesia: { cantidad: cortesiaCantidad, costoTotal: costoCortesiasTotal, expenseAccountCode: mappedAccountMap.courtesyExpenseCode || null },
    // Nuevo: costos POS consolidados
    posCosts: {
      costoVentasTotal: mappedCostBreakdown.costoVentasTotal,
      costoCortesiasTotal: mappedCostBreakdown.costoCortesiasTotal,
      costoTotalSalidaInventario: mappedCostBreakdown.costoTotalSalidaInventario,
      cogsAccountCode: null,
      courtesyAccountCode: mappedAccountMap.courtesyExpenseCode || null,
      inventoryAccountCode: null,
      accountMap: mappedAccountMap
    },
    posPettyCash: petty ? {
      ingresosNio: pcIngresos,
      egresosNio: pcEgresos,
      ingresosUsd: n2(petty.ingresosUsd),
      egresosUsd: n2(petty.egresosUsd),
      fxRateUsed: petty.fxRateUsed || null,
      hasUsd: !!petty.hasUsd
    } : null,
    posSnapshot: {
      key: closure.key || null,
      createdAt: closure.createdAt || null,
      meta: closure.meta || null,
      totals: {
        totalGeneral,
        totalMismatch,
        ventaBruta: n2(closure?.totals?.ventaBruta),
        descuentosTotal: n2(closure?.totals?.descuentosTotal),
        ventaNeta: n2(closure?.totals?.ventaNeta ?? closure?.totals?.totalGeneral),
        utilidadBruta: n2(closure?.totals?.utilidadBruta),
        utilidadNetaOperativa: n2(closure?.totals?.utilidadNetaOperativa),
        cortesiaValorReferencia: n2(closure?.totals?.cortesiaValorReferencia),
        devolucionCantidad: Number(closure?.totals?.devolucionCantidad || 0) || 0,
        devolucionValor: n2(closure?.totals?.devolucionValor)
      }
    },
    importedAt: Date.now()
  };

  // Guardas básicas
  if (Math.abs(n2(totalDebe - totalHaber)) > 0.01) {
    throw new Error('Asiento POS desbalanceado (DEBE/HABER).');
  }

  const accountValidation = validatePostableAccountCodesForAutoEntry(lines.map(l => l && l.accountCode), data, 'importar el cierre POS');
  if (!accountValidation.ok) {
    throw new Error(accountValidation.message);
  }

  return { entry, lines };
}

// Construye el reverso del cierre POS previo (sin escribirlo aún). Se escribe de forma atómica desde importPosCloseAtomic().
async function createPosDailyCloseReversal(prevImport, reversingClosure, data) {
  const prevEntryId = Number(prevImport?.journalEntryId || 0);
  if (!prevEntryId) throw new Error('Falta el asiento previo para reversar.');

  const original = await finGet('journalEntries', prevEntryId);
  const originalLines = await finGetLinesForEntryId(prevEntryId);
  if (!original || !originalLines.length) throw new Error('Falta el detalle del asiento previo para reversar.');

  const eventId = (typeof prevImport.eventId === 'number') ? prevImport.eventId : parseInt(String(prevImport.eventId || '').trim(), 10) || 0;
  const dateKey = String(prevImport.dateKey || original.fecha || '').slice(0, 10) || todayStr();
  const eventName = resolvePosCloseEventName(eventId, { eventNameSnapshot: (prevImport.eventNameSnapshot || original.posEventNameSnapshot || '') });
  const closedAtTs = resolvePosCloseClosedAtTs(reversingClosure || null);
  const humanDesc = buildPosCloseHumanDescription('Reverso cierre diario POS', eventName, closedAtTs);

  const prevClosureId = String(prevImport.closureId || '').trim();
  const byClosureId = String(reversingClosure?.closureId || '').trim();
  const prevV = Number(prevImport.version || original.version || 1) || 1;
  const newV = Number(reversingClosure?.version || 1) || 1;

  const revLines = [];
  for (const ln of originalLines) {
    const d = n2(ln.debe);
    const h = n2(ln.haber);
    if (!(d || h)) continue;
    revLines.push({ accountCode: String(ln.accountCode || ''), debe: h, haber: d });
  }

  const totalDebe = n2(revLines.reduce((s, ln) => s + n0(ln.debe), 0));
  const totalHaber = n2(revLines.reduce((s, ln) => s + n0(ln.haber), 0));

  const entry = {
    fecha: dateKey,
    descripcion: humanDesc,
    tipoMovimiento: 'ajuste',
    reference: dateKey,
    eventScope: 'POS',
    posEventId: eventId,
    posEventNameSnapshot: String(prevImport.eventNameSnapshot || original.posEventNameSnapshot || eventName || '').trim() || null,
    origen: 'POS',
    origenId: `REV:${prevClosureId}`,
    totalDebe,
    totalHaber,
    source: POS_DAILY_CLOSE_REVERSAL_SOURCE,
    reversalOfClosureId: prevClosureId,
    reversingClosureId: byClosureId || null,
    eventId,
    dateKey,
    version: prevV,
    eventDateKey: buildEventDateKey(eventId, dateKey),
    importedAt: Date.now()
  };

  // Guardas: cuentas deben existir (si alguien borró cuentas luego de importar)
  const accountValidation = validatePostableAccountCodesForAutoEntry(revLines.map(l => l && l.accountCode), data, 'reversar el cierre POS');
  if (!accountValidation.ok) {
    throw new Error(accountValidation.message);
  }

  if (Math.abs(n2(totalDebe - totalHaber)) > 0.01) {
    throw new Error('Reverso POS desbalanceado (DEBE/HABER).');
  }

  return { entry, lines: revLines };
}

async function importPosDailyClosuresToFinanzas() {
  const btn = document.getElementById('btn-import-pos-closures');
  const msg = document.getElementById('import-pos-closures-msg');
  const setMsg = (t) => { if (msg) msg.textContent = (t || '').toString(); };

  try {
    if (btn) btn.disabled = true;
    setMsg('Importando…');

    await openFinDB();
    await ensureBaseAccounts();

    // Usar datos frescos después de ensureBaseAccounts: evita validar contra un cache viejo.
    const data = await getAllFinData();
    finCachedData = data;

    // POS: cierres disponibles
    const closuresRaw = await getAllPosDailyClosuresSafe();
    const closures = (Array.isArray(closuresRaw) ? closuresRaw : []).filter(Boolean);

    if (!closures.length) {
      setMsg('No hay cierres en POS para importar.');
      return;
    }

    // Cache eventos POS para nombres live
    await refreshPosEventsCache();

    // Índice existente
    const existingImportsArr = await finGetAll('posDailyCloseImports').catch(() => []);
    const importMap = new Map((Array.isArray(existingImportsArr) ? existingImportsArr : []).map(r => [String(r.closureId), r]));

    // Fallback: si alguien importó en una versión vieja sin índice, reconstruir desde journalEntries.
    const entriesArr = await finGetAll('journalEntries').catch(() => []);
    const closureEntryMap = new Map();
    for (const e of (Array.isArray(entriesArr) ? entriesArr : [])) {
      if (!e || String(e.source || '') !== POS_DAILY_CLOSE_SOURCE) continue;
      const cid = String(e.closureId || e.origenId || '').trim();
      if (!cid) continue;
      closureEntryMap.set(cid, e);
    }

    for (const [cid, entry] of closureEntryMap.entries()) {
      if (importMap.has(cid)) continue;
      const eventId = entry.eventId ?? entry.posEventId ?? 0;
      const dateKey = String(entry.dateKey || entry.fecha || '').slice(0, 10);
      const version = Number(entry.version || 1) || 1;
      const rec = {
        closureId: cid,
        eventId: eventId,
        dateKey,
        version,
        eventDateKey: buildEventDateKey(eventId, dateKey),
        journalEntryId: entry.id,
        importedAt: entry.importedAt || Date.now(),
        eventNameSnapshot: entry.posEventNameSnapshot || null,
        reversedAt: entry.reversedAt || null,
        reversedByClosureId: entry.reversedByClosureId || null,
        reversalJournalEntryId: entry.reversalJournalEntryId || null
      };
      try {
        await finPut('posDailyCloseImports', rec);
        importMap.set(cid, rec);
      } catch (err) {}
    }

    // Reversos ya existentes en el Diario: protección anti-duplicado incluso si el registro previo no quedó actualizado.
    const reversalByOriginalClosureId = new Map();
    for (const e of (Array.isArray(entriesArr) ? entriesArr : [])) {
      if (!e || String(e.source || '') !== POS_DAILY_CLOSE_REVERSAL_SOURCE) continue;
      const ocid = String(e.reversalOfClosureId || '').trim();
      if (ocid) reversalByOriginalClosureId.set(ocid, e);
    }


	    // Mapa latest por evento/día + guardas por evento/día/versión (idempotencia)
	    const importedByEventDateVersion = new Map(); // `${eventDateKey}|${version}` -> rec
	    const latestByEventDate = new Map();
	    for (const r of importMap.values()) {
	      const k = String(r.eventDateKey || buildEventDateKey(r.eventId, r.dateKey));
	      if (!k) continue;
	      const ver = Number(r.version || 1) || 1;
	      importedByEventDateVersion.set(`${k}|${ver}`, r);
	      const cur = latestByEventDate.get(k);
	      const cv = Number(cur?.version || 0) || 0;
	      if (!cur || ver > cv) latestByEventDate.set(k, r);
	    }

    // Orden estable: evento/día luego versión ascendente
    closures.sort((a, b) => {
      const ka = buildEventDateKey(a.eventId, a.dateKey);
      const kb = buildEventDateKey(b.eventId, b.dateKey);
      if (ka !== kb) return ka < kb ? -1 : 1;
      const va = Number(a.version || 0) || 0;
      const vb = Number(b.version || 0) || 0;
      if (va !== vb) return va - vb;
      return String(a.closureId || '').localeCompare(String(b.closureId || ''));
    });

	    let imported = 0;
	    let alreadySameVersion = 0; // mismo eventDateKey + misma versión (aunque closureId sea distinto)
	    let existingClosureId = 0;  // mismo closureId
	    let skippedOld = 0;         // existe versión mayor ya importada

    let invalid = 0;
    let failed = 0;
    const invalidDetails = [];
    const failDetails = [];

	    for (const c of closures) {
	      const closureId = String(c.closureId || '').trim();
	      if (!closureId) {
	        invalid++;
	        invalidDetails.push('(sin closureId): cierre inválido');
	        continue;
	      }

	      const chk = validatePosClosureForImport(c);
	      if (!chk.ok) {
	        invalid++;
	        invalidDetails.push(chk.msg);
	        continue;
	      }

	      const eventId = chk.eventId;
	      const dateKey = chk.dateKey;
	      const version = Number(c.version || 1) || 1;
	      const k = buildEventDateKey(eventId, dateKey);
	      const kver = `${k}|${version}`;

	      // Idempotencia fuerte: mismo evento+día+versión NO se importa 2 veces aunque cambie closureId.
	      if (importedByEventDateVersion.has(kver)) {
	        alreadySameVersion++;
	        continue;
	      }

	      if (importMap.has(closureId)) {
	        existingClosureId++;
	        // Asegurar que también quede cubierto por (k|v) para futuros runs.
	        if (!importedByEventDateVersion.has(kver)) {
	          importedByEventDateVersion.set(kver, importMap.get(closureId));
	        }
	        continue;
	      }

	      const prev = latestByEventDate.get(k) || null;
	      const prevV = Number(prev?.version || 0) || 0;

      // Si ya hay una versión mayor importada, este cierre es viejo → no lo metemos.
      if (prev && prevV > version) {
        skippedOld++;
        continue;
      }

      // Etapa 3: orden seguro (atómico)
      // 1) Crear asiento NUEVO (confirmado dentro de la transacción)
      // 2) Solo entonces reversar el anterior (si aplica)
      // 3) Finalmente registrar/import-mark del nuevo

      let revPayload = null;
      let prevUpdate = null;

      if (prev && prevV < version) {
        // Evitar duplicados: si ya existe reverso en el rec o en el Diario, no lo recreamos.
        const prevCid = String(prev.closureId || '').trim();
        const alreadyReversed = !!(prev.reversalJournalEntryId || prev.reversedByClosureId || (reversalByOriginalClosureId && reversalByOriginalClosureId.has(prevCid)));

        if (!alreadyReversed) {
          try {
            revPayload = await createPosDailyCloseReversal(prev, c, data);
            prevUpdate = { ...prev, reversedAt: Date.now(), reversedByClosureId: closureId };
          } catch (err) {
            failed++;
            const msg = (err && err.message) ? String(err.message) : 'No se pudo reversar el cierre anterior';
            failDetails.push(`${closureId}: ${msg}`);
            continue;
          }
        }
      }

      let newPayload = null;
      try {
        newPayload = await createPosDailyCloseEntry(c, data);
      } catch (err) {
        failed++;
        const msg = (err && err.message) ? String(err.message) : 'Error creando asiento';
        failDetails.push(`${closureId}: ${msg}`);
        continue;
      }

      const rec = {
        closureId,
        eventId,
        dateKey,
        version,
        eventDateKey: k,
        journalEntryId: 0,
        importedAt: Date.now(),
        eventNameSnapshot: String(c.eventNameSnapshot || c.eventName || getPosEventNameSnapshotById(eventId, '')) || null,
        reversedAt: null,
        reversedByClosureId: null,
        reversalJournalEntryId: null
      };

      try {
        const res = await importPosCloseAtomic({
          newEntry: newPayload.entry,
          newLines: newPayload.lines,
          newImportRec: rec,
          prevImportUpdate: prevUpdate,
          revEntry: revPayload ? revPayload.entry : null,
          revLines: revPayload ? revPayload.lines : null
        });

        rec.journalEntryId = Number(res?.newEntryId || 0) || 0;

        // Reflejar el update del prev en memoria para evitar reversos duplicados en el mismo run.
        if (prevUpdate && res?.revEntryId) {
          prevUpdate.reversalJournalEntryId = res.revEntryId;
          importMap.set(String(prevUpdate.closureId || ''), prevUpdate);
        }

        importMap.set(closureId, rec);
        latestByEventDate.set(k, rec);
        importedByEventDateVersion.set(kver, rec);
        imported++;
      } catch (err) {
        failed++;
        const raw = (err && err.message) ? String(err.message) : '';
        const prefix = revPayload ? 'Importación abortada (rollback): reverso no completado' : 'Importación abortada (rollback)';
        const msg = raw ? `${prefix} — ${raw}` : prefix;
        failDetails.push(`${closureId}: ${msg}`);
        continue;
      }
    }

    await refreshAllFin();

	    const parts = [`${imported} importados`];
	    if (alreadySameVersion) parts.push(`${alreadySameVersion} ya importado (misma versión)`);
	    if (existingClosureId) parts.push(`${existingClosureId} ya existentes`);
    if (skippedOld) parts.push(`${skippedOld} omitidos (versión vieja)`);
    if (invalid) parts.push(`${invalid} inválidos`);
    if (failed) parts.push(`${failed} fallidos`);
    // Preview compacto de errores (sin inundar la UI)
    const detail = (invalidDetails.length ? invalidDetails : failDetails).slice(0, 2).join(' · ');
    setMsg(parts.join(' · ') + (detail ? ` · ${detail}` : ''));
    if (invalidDetails.length) showToast('Cierre inválido: ' + invalidDetails[0]);
    else if (failDetails.length) showToast('Cierre fallido: ' + failDetails[0]);
    if (imported) showToast(`Cierres POS importados: ${imported}`);
  } catch (err) {
    console.error('Error importando cierres POS', err);
    setMsg('Error importando cierres POS.');
    showToast('Error importando cierres POS');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function setupExportButtons() {
  const btnDiario = document.getElementById('btn-export-diario');
  if (btnDiario) {
    btnDiario.addEventListener('click', (ev) => {
      ev.preventDefault();
      exportDiarioExcel().catch(err => {
        console.error('Error exportando Diario a Excel', err);
        showToast('Error exportando Diario');
      });
    });
  }

  const btnImportClosures = document.getElementById('btn-import-pos-closures');
  if (btnImportClosures) {
    btnImportClosures.addEventListener('click', (ev) => {
      ev.preventDefault();
      importPosDailyClosuresToFinanzas().catch(err => {
        console.error('Error importando cierres POS', err);
        showToast('Error importando cierres POS');
      });
    });
  }

  const btnER = document.getElementById('btn-export-er');
  if (btnER) {
    btnER.addEventListener('click', (ev) => {
      ev.preventDefault();
      exportEstadoResultadosExcel().catch(err => {
        console.error('Error exportando ER a Excel', err);
        alert('Ocurrió un error exportando el Estado de Resultados a Excel.');
      });
    });
  }

  const btnBG = document.getElementById('btn-export-bg');
  if (btnBG) {
    btnBG.addEventListener('click', (ev) => {
      ev.preventDefault();
      exportBalanceGeneralExcel().catch(err => {
        console.error('Error exportando BG a Excel', err);
        alert('Ocurrió un error exportando el Balance General a Excel.');
      });
    });
  }

  const btnFC = document.getElementById('btn-export-fc');
  if (btnFC) {
    btnFC.addEventListener('click', (ev) => {
      ev.preventDefault();
      exportFlujoCajaExcel().catch(err => {
        console.error('Error exportando Flujo de Caja a Excel', err);
        alert('Ocurrió un error exportando el Flujo de Caja a Excel.');
      });
    });
  }
}

async function initFinanzas() {
  try {
    await openFinDB();
    await ensureBaseAccounts();
    await normalizeAccountsCatalog();
    await finEnsureFinancialAccountsBase();

    // Compras (planificación)
    await pcLoadAll();
    fillMonthYearSelects();
    finRenderCurrencyReference();
    setupTabs();
    setupFinancialAccountsUI();
    setupCajaChicaUI();
    setupEstadosSubtabs();
    setupModoERToggle();
    setupAccountingReportsUI();
    setupFilterListeners();
    setupDiarioContableVisualUI();
    setupRecibosUI();
    await rcEnterView(true);
    setupCatalogoUI();
    // Pintado preventivo: en iPad/PWA el usuario debe ver las raíces aunque otra carga tarde o falle.
    finSafeRenderBlock('Catálogo de Cuentas inicial', () => renderCatalogoCuentas({ accounts: finBuildFixedRootAccountRows(), entries: [], lines: [] }));
    setupComprasUI();
    setupComprasPlanUI();
    setupExportButtons();
    await ccLoadSnapshot();
    ccSetFxInputFromSnapshot(true);
    ccRenderCurrency();
    await refreshAllFin();
  } catch (err) {
    console.error('Error inicializando Finanzas A33', err);
    const n = err && err.name ? String(err.name) : '';
    const m = err && err.message ? String(err.message) : '';
    const detalle = (n || m) ? `\n\nDetalle: ${n}${m ? `: ${m}` : ''}` : '';
    alert('No se pudo inicializar el módulo de Finanzas.' + detalle);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFinanzas().catch(err => {
    console.error('Error en initFinanzas', err);
  });
});

window.addEventListener('storage', (ev) => {
  try {
    const key = ev && ev.key ? String(ev.key) : '';
    const expected = (window.A33Currency && window.A33Currency.storageKey) || 'suite_a33_currency_settings_v1';
    if (!key || key === expected) {
      finRenderCurrencyReference();
      if (finCachedData) {
        renderTablero(finCachedData);
        renderEstadoResultados(finCachedData);
        renderBalanceGeneral(finCachedData);
        renderFlujoCaja(finCachedData);
        renderDiarioContableVisual(finCachedData);
        renderDiario(finCachedData);
        renderAccountingReports(finCachedData);
        updateManualMovementCurrencyPreview();
      }
    }
  } catch (_) {}
});
