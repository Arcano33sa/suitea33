// Finanzas – Suite A33 · Fase 3A + Fase 4.2 + Fase 4.3.1 + Fase 6 (Flujo de Caja)
// Contabilidad básica: diario, tablero, ER, BG
// + Rentabilidad por presentación (lectura POS)
// + Comparativo de eventos (lectura Finanzas)
// + Flujo de Caja (Caja + Banco) por periodo.

const FIN_DB_NAME = 'finanzasDB';
// IMPORTANTE: subir versión cuando se agregan stores/nuevas estructuras.
// v3 agrega el store `suppliers` para Proveedores (sin romper data existente).
const FIN_DB_VERSION = 6; // + Recibos (store `receipts`) + Importación cierres diarios POS
const CENTRAL_EVENT = 'CENTRAL';

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
  // 1xxx Activos
  { code: '1100', nombre: 'Caja general', tipo: 'activo', systemProtected: true },
  { code: '1110', nombre: 'Caja eventos', tipo: 'activo', systemProtected: true },
  { code: '1200', nombre: 'Banco', tipo: 'activo', systemProtected: true },
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



// Revisa si una cuenta ya se ha usado en journalLines (para migraciones seguras)
async function finAccountCodeHasLines(code) {
  try {
    await openFinDB();
    return await new Promise((resolve) => {
      const tx = db.transaction(['journalLines'], 'readonly');
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
  const byCode = new Map(existing.map(a => [String(a.code), a]));

  for (const base of BASE_ACCOUNTS) {
    const codeStr = String(base.code);
    const current = byCode.get(codeStr);

    if (!current) {
      // Cuenta no existe → la creamos completa
      await finAdd('accounts', {
        code: codeStr,
        nombre: base.nombre,
        tipo: base.tipo,
        systemProtected: !!base.systemProtected
      });
    } else {
      // Cuenta ya existe → reforzamos campos faltantes
      let changed = false;

      // Si venía de versiones viejas con "name" en lugar de "nombre"
      if (!current.nombre && current.name) {
        current.nombre = current.name;
        changed = true;
      }

      // Si sigue sin nombre, usamos el del catálogo base
      if (!current.nombre) {
        current.nombre = base.nombre;
        changed = true;
      }

      // Tipo contable
      if (!current.tipo) {
        current.tipo = base.tipo;
        changed = true;
      }

      // Protección de sistema
      if (base.systemProtected && !current.systemProtected) {
        current.systemProtected = true;
        changed = true;
      }

      if (changed) {
        await finPut('accounts', current);
      }
    }
  }

  // A33 estándar: 6105 = Cortesías. Si existe con nombre antiguo y no se ha usado, lo renombramos.
  try {
    const acc6105 = await finGet('accounts', '6105');
    if (acc6105 && acc6105.nombre && !/cortes/i.test(String(acc6105.nombre))) {
      const used = await finAccountCodeHasLines('6105');
      if (!used) {
        acc6105.nombre = 'Cortesías (Promoción)';
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

  const criticalCodes = new Set(['1100', '1110', '1200', '4100', '5100', '3300']);
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

  for (const acc of accounts) {
    if (!acc || acc.code === undefined || acc.code === null) continue;

    let changed = false;

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

    // isHidden default false (solo si falta / inválido)
    if (typeof acc.isHidden !== 'boolean') {
      acc.isHidden = false;
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

function ccBuildEmptySnapshot() {
  return {
    version: 1,
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
  const cur = obj.currencies || {};

  (['NIO', 'USD']).forEach(code => {
    const src = cur[code] || {};
    const srcDenoms = Array.isArray(src.denoms) ? src.denoms : [];
    const byId = new Map(srcDenoms.map(d => [String(d && d.id ? d.id : ''), d]));

    out.currencies[code].denoms = (CC_DENOMS[code] || []).map(base => {
      const hit = byId.get(String(base.id));
      const raw = hit ? hit.count : null;
      const n = (raw === '' || raw == null) ? null : Number(raw);
      const count = (Number.isFinite(n) && n >= 0) ? Math.trunc(n) : null;
      return { id: base.id, value: base.value, chip: base.chip || '', count };
    });
    out.currencies[code].total = ccComputeCurrencyTotal(code, out);
  });

  out.updatedAtISO = typeof obj.updatedAtISO === 'string' ? obj.updatedAtISO : '';
  out.updatedAtDisplay = typeof obj.updatedAtDisplay === 'string' ? obj.updatedAtDisplay : '';
  return out;
}

function ccSetMsg(text) {
  const el = document.getElementById('cc-msg');
  if (el) el.textContent = text || '';
}

async function ccLoadSnapshot() {
  const raw = localStorage.getItem(CC_STORAGE_KEY);
  const fromLS = raw ? ccSafeParseJSON(raw) : null;
  if (fromLS) {
    ccSnapshot = ccNormalizeSnapshot(fromLS);
    return ccSnapshot;
  }

  try {
    const rec = await finGet('settings', CC_STORAGE_KEY);
    const data = rec && rec.data ? rec.data : null;
    ccSnapshot = ccNormalizeSnapshot(data);
    try { localStorage.setItem(CC_STORAGE_KEY, JSON.stringify(ccSnapshot)); } catch (_) {}
    return ccSnapshot;
  } catch (err) {
    console.warn('No se pudo leer Caja Chica desde settings', err);
    ccSnapshot = ccBuildEmptySnapshot();
    return ccSnapshot;
  }
}

function ccUpdateTotal() {
  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();
  const cur = ccSnapshot.currencies[ccCurrency];
  cur.total = ccComputeCurrencyTotal(ccCurrency, ccSnapshot);

  const tbody = document.getElementById('cc-tbody');
  if (tbody) {
    const rows = tbody.querySelectorAll('tr');
    rows.forEach((tr, idx) => {
      const denom = cur.denoms[idx];
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
    const tr = document.createElement('tr');

    const tdDen = document.createElement('td');
    tdDen.className = 'cc-denom';
    const main = document.createElement('span');
    main.textContent = `${prefix} ${d.value}`;
    tdDen.appendChild(main);

    if (d.chip) {
      const chip = document.createElement('span');
      chip.className = 'cc-chip';
      chip.textContent = d.chip;
      tdDen.appendChild(chip);
    }

    const tdQty = document.createElement('td');
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
}

async function ccSaveSnapshot() {
  if (!ccSnapshot) ccSnapshot = ccBuildEmptySnapshot();
  ccSnapshot.currencies.NIO.total = ccComputeCurrencyTotal('NIO', ccSnapshot);
  ccSnapshot.currencies.USD.total = ccComputeCurrencyTotal('USD', ccSnapshot);

  const now = new Date();
  ccSnapshot.updatedAtISO = now.toISOString();
  ccSnapshot.updatedAtDisplay = fmtDDMMYYYYHHMM(now);

  try {
    await finPut('settings', { id: CC_STORAGE_KEY, data: ccSnapshot });
  } catch (err) {
    console.warn('No se pudo guardar Caja Chica en settings', err);
  }

  try {
    localStorage.setItem(CC_STORAGE_KEY, JSON.stringify(ccSnapshot));
  } catch (_) {}

  const upd = document.getElementById('cc-updated');
  if (upd) upd.textContent = `Actualizado: ${ccSnapshot.updatedAtDisplay}`;

  showToast('Caja Chica guardada');
  ccSetMsg(`Guardado: ${ccSnapshot.updatedAtDisplay}`);
}

async function ccReset() {
  const ok = confirm('Reset a cero: esto borrara los conteos actuales (solo informativo).');
  if (!ok) return;
  ccSnapshot = ccBuildEmptySnapshot();
  ccRenderCurrency();
  await ccSaveSnapshot();
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
    ccRenderCurrency();
    ccSetMsg('Refrescado');
  });
}

function normStr(s) {
  return (s || '')
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
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

function normStr(v, maxLen = 120) {
  const s = (v == null) ? '' : String(v);
  const out = s.trim();
  return out.length > maxLen ? out.slice(0, maxLen) : out;
}

function normBool01(v) {
  if (v === true) return true;
  if (v === false || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return (s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes');
}

function normalizeProductType(v) {
  const t = normStr(v, 24).toUpperCase();
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

  return {
    id: normStr(obj.id, 80),
    nombre: normStr(obj.nombre, 120),
    tipo: normalizeProductType(obj.tipo),
    precio: normNumNonNeg(obj.precio),
    precioSet,
    unidadesPorCaja: normNumNonNeg(obj.unidadesPorCaja)
  };
}

function normalizeSupplier(raw) {
  const obj = (raw && typeof raw === 'object') ? raw : {};
  const productosRaw = Array.isArray(obj.productos) ? obj.productos : [];
  const productos = productosRaw.map(normalizeSupplierProduct);
  return {
    ...obj,
    id: obj.id,
    nombre: normStr(obj.nombre, 120),
    telefono: normStr(obj.telefono, 80),
    nota: normStr(obj.nota, 220),
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
  const [accounts, entries, lines] = await Promise.all([
    finGetAll('accounts'),
    finGetAll('journalEntries'),
    finGetAll('journalLines')
  ]);

  let suppliers = [];
  try {
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
    journalIntegrity,
    inconsistentEntryIds
  };
}

function buildEventList(entries) {
  const set = new Set();
  for (const e of entries) {
    const name = getDisplayEventLabel(e);
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function matchEvent(entry, eventFilter) {
  const evLabel = getDisplayEventLabel(entry);
  if (!eventFilter || eventFilter === 'ALL') return true;
  if (eventFilter === 'NONE') return !evLabel;
  // Soportar filtros antiguos: CENTRAL/GENERAL
  const f = displayEventLabel(eventFilter);
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


// Total de cortesías provenientes del POS (cuenta 6105) en el rango/evento.
// Nota: usamos origen='POS' y descripcion contiene 'Cortesía POS' para NO mezclar con otros gastos manuales en 6105.
function calcCortesiasPos6105ForFilter(data, filtros) {
  // Cortesías deben detectarse por accountCode + source (NO por texto en descripción)
  const entriesInRange = filterEntriesByDateAndEvent(data?.entries || [], filtros);
  const allowedEntryIds = new Set();

  for (const e of entriesInRange) {
    const src = String(e?.source || '');
    if (src === POS_DAILY_CLOSE_SOURCE || src === POS_DAILY_CLOSE_REVERSAL_SOURCE) {
      const id = Number(e?.id || 0);
      if (id) allowedEntryIds.add(id);
    }
  }

  if (!allowedEntryIds.size) return 0;

  let sum = 0;
  for (const ln of (data?.lines || [])) {
    if (!ln) continue;
    if (!allowedEntryIds.has(Number(ln.idEntry || 0))) continue;
    if (String(ln.accountCode) !== '6105') continue;
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

function calcCajaBancoUntilDate(data, corte) {
  const { entries, linesByEntry, accountsMap } = data;
  const cutoff = corte || todayStr();
  let caja = 0;
  let banco = 0;

  for (const e of entries) {
    const f = e.fecha || e.date || '';
    if (f && f > cutoff) continue;
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      const debe = Number(ln.debe || 0);
      const haber = Number(ln.haber || 0);
      const delta = (debe - haber);
      const code = String(ln.accountCode);

      if (code === '1100' || code === '1110') {
        caja += delta;
      } else if (code === '1200') {
        banco += delta;
      }
    }
  }

  return { caja, banco };
}

/* ---------- Rentabilidad por presentación (lectura POS) ---------- */

const RENTAB_PRESENTACIONES = [
  { id: 'pulso', label: 'Pulso 250 ml' },
  { id: 'media', label: 'Media 375 ml' },
  { id: 'djeba', label: 'Djeba 750 ml' },
  { id: 'litro', label: 'Litro 1000 ml' },
  { id: 'galon', label: 'Galón 3750 ml' }
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
        <td class="num">C$ ${fmtCurrency(ingresos)}</td>
        <td class="num">C$ ${fmtCurrency(costo)}</td>
        <td class="num">C$ ${fmtCurrency(margen)}</td>
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
      <td class="num">C$ ${fmtCurrency(ingresos)}</td>
      <td class="num">C$ ${fmtCurrency(costos)}</td>
      <td class="num">C$ ${fmtCurrency(gastos)}</td>
      <td class="num">C$ ${fmtCurrency(resultado)}</td>
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
    <td class="num">C$ ${fmtCurrency(totalIngresos)}</td>
    <td class="num">C$ ${fmtCurrency(totalCostos)}</td>
    <td class="num">C$ ${fmtCurrency(totalGastos)}</td>
    <td class="num">C$ ${fmtCurrency(totalResultado)}</td>
    <td class="num">${margenTotalPct.toFixed(1)}%</td>
  `;
  tbody.appendChild(trTotal);
}

/* ---------- Flujo de Caja (Caja + Banco) ---------- */

function calcFlujoCaja(data) {
  if (!data) return null;

  const { entries, linesByEntry } = data;

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

  const isCajaBanco = (code) => (code === '1100' || code === '1110' || code === '1200');
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
      <td class="num">C$ ${fmtCurrency(val)}</td>
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
    const origenRaw0 = e.origen || 'Interno';
    const origenBase0 = (origenRaw0 === 'Manual') ? 'Interno' : origenRaw0;
    const isPos0 = (origenBase0 === 'POS');
    const isPosClose0 = isPos0 && isPosDailyCloseEntry(e);
    const origenKey0 = isPos0 ? (isPosClose0 ? 'POS_CIERRES' : 'POS_LEGACY') : origenBase0;

    if (origenFilter !== 'todos') {
      if (origenFilter === 'POS') {
        if (origenBase0 !== 'POS') continue;
      } else if (origenFilter === 'POS_CIERRES') {
        if (origenKey0 !== 'POS_CIERRES') continue;
      } else if (origenFilter === 'POS_LEGACY') {
        if (origenKey0 !== 'POS_LEGACY') continue;
      } else {
        if (origenBase0 !== origenFilter) continue;
      }
    }

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
  rows.push(['Fecha', 'Descripción', 'Tipo', 'Evento', 'Proveedor', 'Pago', 'Referencia', 'Origen', 'Debe total', 'Haber total']);

  for (const e of sorted) {
    const tipo = e.tipoMovimiento || 'otro';
    if (tipoFilter !== 'todos' && tipo !== tipoFilter) continue;

    // Origen (compat con filtros POS_CIERRES / POS_LEGACY)
    const origenRaw = e.origen || 'Interno';
    const origenBase = (origenRaw === 'Manual') ? 'Interno' : origenRaw;
    const isPos = (origenBase === 'POS');
    const isPosClose = isPos && isPosDailyCloseEntry(e);
    const origenKey = isPos ? (isPosClose ? 'POS_CIERRES' : 'POS_LEGACY') : origenBase;
    const origenOut = isPos
      ? (isPosClose ? 'POS — Cierre diario' : 'LEGACY — ventas individuales')
      : origenBase;
    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (origenFilter !== 'todos') {
      if (origenFilter === 'POS') {
        if (origenBase !== 'POS') continue;
      } else if (origenFilter === 'POS_CIERRES') {
        if (origenKey !== 'POS_CIERRES') continue;
      } else if (origenFilter === 'POS_LEGACY') {
        if (origenKey !== 'POS_LEGACY') continue;
      } else {
        if (origenBase !== origenFilter) continue;
      }
    }

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

    rows.push([
      e.fecha || e.date || '',
      e.descripcion || '',
      tipo,
      evLabel || '—',
      supplierLabel,
      pmLabel,
      ref,
      origenOut,
      Number(totalDebe.toFixed(2)),
      Number(totalHaber.toFixed(2))
    ]);
  }

  if (rows.length <= 1) {
    showToast('No hay movimientos para exportar con los filtros actuales.');
    return;
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Diario');
  const filename = `finanzas_diario_${todayStr()}.xlsx`;
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
  rows.push(['Concepto', 'Monto C$']);
  rows.push(['Ingresos (4xxx)', num(ingresos)]);
  rows.push(['Costos de venta (5xxx)', num(costos)]);
  rows.push(['Gastos de operación (6xxx)', num(gastos)]);
  rows.push(['Utilidad bruta', num(bruta)]);
  rows.push(['Utilidad neta', num(neta)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EstadoResultados');
  const filename = `finanzas_ER_${todayStr()}.xlsx`;
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
  rows.push(['Grupo', 'Monto C$']);
  rows.push(['Activos (1xxx)', num(activos)]);
  rows.push(['Pasivos (2xxx)', num(pasivos)]);
  rows.push(['Patrimonio (3xxx)', num(patrimonio)]);
  rows.push(['Activos – Pasivos – Patrimonio', num(cuadre)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BalanceGeneral');
  const filename = `finanzas_BG_${todayStr()}.xlsx`;
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
  rows.push(['Concepto', 'Monto C$']);
  rows.push(['Saldo inicial Caja + Banco', num(r.saldoInicial)]);
  rows.push(['Flujo neto de operación (cobros - pagos)', num(r.netOp)]);
  rows.push(['Flujo neto aportes / retiros del dueño', num(r.netOwner)]);
  rows.push(['Otros movimientos de caja', num(r.otros)]);
  rows.push(['Saldo final Caja + Banco', num(r.saldoFinal)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FlujoCaja');
  const filename = `finanzas_FC_${todayStr()}.xlsx`;
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

function updateEventFilters(entries) {
  const eventos = buildEventList(entries);
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
      opt.value = ev;
      opt.textContent = ev;
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
    for (const s of suppliers) {
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
    // Cuentas ocultas: no deben aparecer en selects para movimientos nuevos.
    if (acc && acc.isHidden === true) continue;

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

/* ---------- Render: Tablero ---------- */

function renderTablero(data) {
  const mesSel = $('#tab-mes');
  const anioSel = $('#tab-anio');
  const eventoSel = $('#tab-evento');
  if (!mesSel || !anioSel || !eventoSel) return;

  const mes = mesSel.value || pad2(new Date().getMonth() + 1);
  const anio = anioSel.value || String(new Date().getFullYear());
  const { start, end } = monthRange(Number(anio), Number(mes));
  const eventFilter = eventoSel.value || 'ALL';

  const { ingresos, costos, gastos } = calcResultadosForFilter(data, {
    desde: start,
    hasta: end,
    evento: eventFilter
  });

  const cortesias = calcCortesiasPos6105ForFilter(data, {
    desde: start,
    hasta: end,
    evento: eventFilter
  });

  const bruta = ingresos - costos;
  const postCortesias = bruta - cortesias;
  const neta = bruta - gastos;

  const corte = end;
  const { caja, banco } = calcCajaBancoUntilDate(data, corte);

  const tabIng = $('#tab-ingresos');
  const tabCos = $('#tab-costos');
  const tabCort = $('#tab-cortesias');
  const tabBru = $('#tab-bruta');
  const tabPost = $('#tab-post-cortesias');
  const tabGas = $('#tab-gastos');
  const tabRes = $('#tab-resultado');
  const tabCaja = $('#tab-caja');
  const tabBanco = $('#tab-banco');

  if (tabIng) tabIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
  if (tabCos) tabCos.textContent = `C$ ${fmtCurrency(costos)}`;
  if (tabCort) tabCort.textContent = `C$ ${fmtCurrency(cortesias)}`;
  if (tabBru) tabBru.textContent = `C$ ${fmtCurrency(bruta)}`;
  if (tabPost) tabPost.textContent = `C$ ${fmtCurrency(postCortesias)}`;
  if (tabGas) tabGas.textContent = `C$ ${fmtCurrency(gastos)}`;
  if (tabRes) tabRes.textContent = `C$ ${fmtCurrency(neta)}`;
  if (tabCaja) tabCaja.textContent = `C$ ${fmtCurrency(caja)}`;
  if (tabBanco) tabBanco.textContent = `C$ ${fmtCurrency(banco)}`;
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
  const stdCodes = new Set(['1100', '1110', '1200', '1300', '1900']);

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

  for (const e of sorted) {
    const tipoMov = e.tipoMovimiento || '';
    const origenRaw = e.origen || 'Interno';
    const origenBase = (origenRaw === 'Manual') ? 'Interno' : origenRaw;

    // POS: distinguir cierres diarios vs históricos legacy (ventas individuales)
    const isPos = (origenBase === 'POS');
    const isPosClose = isPos && isPosDailyCloseEntry(e);
    const origenKey = isPos ? (isPosClose ? 'POS_CIERRES' : 'POS_LEGACY') : origenBase;
    const origenLabel = isPos ? (isPosClose ? 'POS — Cierre diario' : 'LEGACY — ventas individuales') : origenBase;
    const origenCell = isPos ? makePill(origenLabel, isPosClose ? 'gold' : 'muted') : escapeHtml(origenLabel);

    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (tipoFilter !== 'todos' && tipoMov !== tipoFilter) continue;
    if (!matchEvent(e, eventoFilter)) continue;
    if (origenFilter !== 'todos') {
      if (origenFilter === 'POS') {
        if (origenBase !== 'POS') continue;
      } else if (origenFilter === 'POS_CIERRES') {
        if (origenKey !== 'POS_CIERRES') continue;
      } else if (origenFilter === 'POS_LEGACY') {
        if (origenKey !== 'POS_LEGACY') continue;
      } else {
        if (origenBase !== origenFilter) continue;
      }
    }


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
        const pill = mm ? (' ' + makePill(`Cierre con diferencia: C$ ${fmtCurrency(mm)}`, 'red')) : '';
        return base + incPill + pill;
      })()}</td>
      <td>${escapeHtml(tipoMov)}</td>
      <td>${evCell || '—'}</td>
      <td>${escapeHtml(getSupplierLabelFromEntry(e, data))}</td>
      <td>${origenCell}</td>
      <td class="num">C$ ${fmtCurrency(displayDebe)}</td>
      <td class="num">C$ ${fmtCurrency(displayHaber)}</td>
      <td><button type="button" class="btn-link ver-detalle" data-id="${e.id}">Ver detalle</button></td>
    `;
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
        <p><strong>COGS (5100):</strong> C$ ${fmtCurrency(cv)}</p>
        <p><strong>Cortesías (6105):</strong> C$ ${fmtCurrency(cc)}</p>
        <p><strong>Salida de inventario (1500):</strong> C$ ${fmtCurrency(inv || (cv + cc))}</p>
      `;
    }
  }

    const mm = getPosCloseMismatchAmount(entry);
    if (mm) mismatchLine = `<p>${makePill(`Cierre con diferencia: C$ ${fmtCurrency(mm)}`, 'red')}</p>`;
  const origenRaw = entry.origen || 'Interno';
  const origenLabel = (origenRaw === 'Manual') ? 'Interno' : origenRaw;

  const lines = linesByEntry.get(entry.id) || [];
  const isInconsistent = lines.length === 0;
  const inconsLine = isInconsistent ? `<p>${makePill('Inconsistente: asiento sin líneas', 'red')} <span class="fin-muted">No se borró nada. Esto suele pasar por cortes/crash antiguos durante guardado.</span></p>` : '';

  const isPurchase = (entry && entry.entryType === 'purchase');
  const editCompraBtn = isPurchase
    ? `<p><button type="button" class="btn btn-small btn-edit-compra" data-entry-id="${entry.id}">Editar en Compras</button></p>`
    : '';

  meta.innerHTML = `
    <p><strong>Fecha:</strong> ${escapeHtml(entry.fecha || entry.date || '')}</p>
    <p><strong>Descripción:</strong> ${escapeHtml(uiTextFIN(getDisplayDescription(entry) || ''))}</p>
    <p><strong>Tipo:</strong> ${escapeHtml(entry.tipoMovimiento || '')}</p>
    <p><strong>Evento:</strong> ${escapeHtml(evLabel) || '—'}</p>
    <p><strong>Proveedor:</strong> ${escapeHtml(supplierLabel)}</p>
    <p><strong>Pago:</strong> ${escapeHtml(pmLabel)}</p>
    <p><strong>Referencia:</strong> ${ref ? escapeHtml(ref) : '—'}</p>
    ${editCompraBtn}
    ${closureLine}
    ${costsLine}
    ${mismatchLine}
    ${inconsLine}
    <p><strong>Origen:</strong> ${escapeHtml(origenLabel)}</p>
  `;

tbody.innerHTML = '';
  for (const ln of lines) {
    const nombre = getAccountDisplayNameByCode(ln.accountCode, accountsMap, ln);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ln.accountCode}</td>
      <td>${nombre}</td>
      <td class="num">C$ ${fmtCurrency(ln.debe || 0)}</td>
      <td class="num">C$ ${fmtCurrency(ln.haber || 0)}</td>
    `;
    tbody.appendChild(tr);
  }

  modal.classList.add('open');
}

function closeDetalleModal() {
  const modal = $('#detalle-modal');
  if (modal) modal.classList.remove('open');
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

  if (elIng) elIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
  if (elCos) elCos.textContent = `C$ ${fmtCurrency(costos)}`;
  if (elGas) elGas.textContent = `C$ ${fmtCurrency(gastos)}`;
  if (elBruta) elBruta.textContent = `C$ ${fmtCurrency(bruta)}`;
  if (elNeta) elNeta.textContent = `C$ ${fmtCurrency(neta)}`;
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

  if (elA) elA.textContent = `C$ ${fmtCurrency(activos)}`;
  if (elP) elP.textContent = `C$ ${fmtCurrency(pasivos)}`;
  if (elPt) elPt.textContent = `C$ ${fmtCurrency(patrimonio)}`;
  if (elC) elC.textContent = `C$ ${fmtCurrency(cuadre)}`;
}

/* ---------- Guardar movimiento manual ---------- */

async function guardarMovimientoManual() {
  if (!finCachedData) {
    await refreshAllFin();
  }

  const fecha = $('#mov-fecha')?.value || todayStr();
  const tipo = $('#mov-tipo')?.value || 'ingreso';
  const medio = $('#mov-medio')?.value || 'caja';
  const montoRaw = $('#mov-monto')?.value || '0';
  const cuentaCode = $('#mov-cuenta')?.value || '';

  const eventoSel = ($('#mov-evento-sel')?.value || 'CENTRAL').toString();
  let eventScope = 'CENTRAL';
  let posEventId = null;
  let posEventNameSnapshot = null;

  if (eventoSel.startsWith('POS:')) {
    const id = parseInt(eventoSel.slice(4), 10);
    if (id) {
      eventScope = 'POS';
      posEventId = id;
      // Snapshot: nombre actual (si existe). Sirve si luego renombraron o si POS no está accesible.
      posEventNameSnapshot = getPosEventNameLiveById(id) || (Array.isArray(posActiveEvents) ? (posActiveEvents.find(e => e.id === id)?.name || null) : null);
    }
  }

  const reference = ($('#mov-evento')?.value || '').trim();
  const descripcion = ($('#mov-descripcion')?.value || '').trim();

  const monto = parseFloat(montoRaw.replace(',', '.'));

  if (!fecha) {
    alert('Ingresa la fecha del movimiento.');
    return;
  }
  if (!cuentaCode) {
    alert('Selecciona la cuenta principal.');
    return;
  }
  if (!(monto > 0)) {
    alert('El monto debe ser mayor que cero.');
    return;
  }

  const cajaCode = medio === 'banco' ? '1200' : '1100';
  let debeCode;
  let haberCode;

  if (tipo === 'ingreso') {
    // DEBE: Caja/Banco · HABER: cuenta ingreso
    debeCode = cajaCode;
    haberCode = cuentaCode;
  } else if (tipo === 'egreso') {
    // DEBE: cuenta gasto/costo · HABER: Caja/Banco
    debeCode = cuentaCode;
    haberCode = cajaCode;
  } else {
    // Ajuste simple: cuenta seleccionada contra Caja/Banco (asumimos aumento en la cuenta)
    debeCode = cuentaCode;
    haberCode = cajaCode;
  }

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
    totalDebe: monto,
    totalHaber: monto
  };

  // Guardado atómico: o se guarda TODO (asiento + líneas) o no se guarda NADA.
  let entryId;
  try {
    entryId = await createJournalEntryWithLinesAtomic(entry, [
      { accountCode: String(debeCode), debe: monto, haber: 0 },
      { accountCode: String(haberCode), debe: 0, haber: monto }
    ]);
  } catch (err) {
    console.error('Error en guardado atómico del movimiento', err);
    alert('No se pudo guardar el movimiento (guardado atómico falló).');
    return;
  }


  // Limpia campos clave
  const montoInput = $('#mov-monto');
  const descInput = $('#mov-descripcion');
  const eventoInput = $('#mov-evento');
  if (montoInput) montoInput.value = '';
  if (descInput) descInput.value = '';
  if (eventoInput) eventoInput.value = reference; // puede repetirse por factura / referencia

  showToast('Movimiento guardado en el Diario');
  await refreshAllFin();
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
        <span class="prov-prod-modal-val" title="C$ ${escapeHtml(fmtCurrency(precio))}">C$ ${escapeHtml(fmtCurrency(precio))}</span>
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
          <span>Precio: C$ ${escapeHtml(fmtCurrency(p.precio))}</span>
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
  const lastEntryId = entries.length ? Number(entries[entries.length - 1].id || 0) : 0;
  const lastLineId = lines.length ? Number(lines[lines.length - 1].id || 0) : 0;
  return `e${entries.length}-le${lastEntryId}-l${lines.length}-ll${lastLineId}`;
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

  // Recalcular
  const lines = (data && Array.isArray(data.lines)) ? data.lines : [];
  const counts = {};
  for (const ln of lines) {
    const code = String(ln.accountCode || '').trim();
    if (!code) continue;
    counts[code] = (counts[code] || 0) + 1;
  }

  catUsageCache = { rev, countsObj: counts, updatedAt: new Date().toISOString() };
  catWriteUsageCache(rev, counts);
  return { rev, countsObj: counts };
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


function renderCatalogoCuentas(data) {
  const tbody = document.getElementById('cat-tbody');
  if (!tbody) return;

  const accounts = (data && Array.isArray(data.accounts)) ? [...data.accounts] : [];
  const q = normText(catQuery || '').trim();

  const { countsObj } = catGetUsageCounts(data);

  // Orden por código asc
  accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  const filtered = q
    ? accounts.filter(a => {
        const code = String(a.code || '');
        const name = String(a.nombre || a.name || '');
        return normText(code).includes(q) || normText(name).includes(q);
      })
    : accounts;

  tbody.innerHTML = '';

  if (!filtered.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="7">Sin resultados.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const acc of filtered) {
    const code = String(acc.code);
    const name = (acc.nombre || acc.name || '').toString();
    const rootType = String(acc.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase();
    const isHidden = !!acc.isHidden;
    const isProtected = !!acc.systemProtected;
    const usedCount = Number(countsObj?.[code] || 0);
    const isUsed = usedCount > 0;

    const estadoPill = isHidden ? catMakePill('Oculta', 'red') : catMakePill('Activa', 'green');
    const protPill = isProtected ? catMakePill('Sí', 'gold') : catMakePill('No', 'muted');
    const usedPill = isUsed ? catMakePill(`Sí (${usedCount})`, 'green') : catMakePill('No', 'muted');
    const typePill = catMakePill(rootType, 'muted');

    const tr = document.createElement('tr');

    const editDisabled = isProtected;
    const hideDisabled = isProtected;

    const hideLabel = isHidden ? 'Mostrar' : 'Ocultar';
    const hideClass = isHidden ? 'btn-small' : 'btn-danger';

    tr.innerHTML = `
      <td>${code}</td>
      <td>${escapeHtml(name) || '—'}</td>
      <td>${typePill}</td>
      <td>${estadoPill}</td>
      <td>${protPill}</td>
      <td>${usedPill}</td>
      <td class="fin-actions-cell">
        <button type="button" class="btn-small cat-edit" data-code="${code}" ${editDisabled ? 'disabled title="Cuenta protegida por sistema"' : ''}>Editar</button>
        <button type="button" class="${hideClass} cat-toggle" data-code="${code}" ${hideDisabled ? 'disabled title="Cuenta protegida por sistema"' : ''}>${hideLabel}</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
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

  const accounts = (data && Array.isArray(data.accounts)) ? [...data.accounts] : [];
  const { countsObj } = catGetUsageCounts(data || { entries: [], lines: [] });

  // Orden por código asc
  accounts.sort((a, b) => String(a.code).localeCompare(String(b.code)));

  // Hoja: Cuentas
  const rows = [[
    'Código',
    'Nombre',
    'Raíz/Tipo',
    'Estado (Activa/Oculta)',
    'Protegida (Sí/No)',
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
    const isHidden = !!acc.isHidden;
    const isProtected = !!acc.systemProtected;
    const usedCount = Number(countsObj?.[code] || 0);
    const isUsed = usedCount > 0;

    total += 1;
    if (isHidden) ocultas += 1; else activas += 1;
    byRoot[rootType] = (byRoot[rootType] || 0) + 1;

    rows.push([
      code,
      name,
      rootType,
      isHidden ? 'Oculta' : 'Activa',
      isProtected ? 'Sí' : 'No',
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
    ['Ocultas', ocultas],
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
  const sel = document.getElementById('cat-root');
  if (!sel) return;
  sel.innerHTML = '';
  for (const rt of ROOT_TYPES) {
    const opt = document.createElement('option');
    opt.value = rt;
    opt.textContent = rt;
    sel.appendChild(opt);
  }
}

function setCatModalMode(mode, acc = null) {
  const modeEl = document.getElementById('cat-mode');
  const editCodeEl = document.getElementById('cat-edit-code');
  const codeEl = document.getElementById('cat-code');
  const nameEl = document.getElementById('cat-name');
  const rootEl = document.getElementById('cat-root');
  const titleEl = document.getElementById('cat-modal-title');
  const subEl = document.getElementById('cat-modal-sub');

  if (!modeEl || !editCodeEl || !codeEl || !nameEl || !rootEl) return;

  setCatFormMessage('');
  catAutoRootType = true;

  if (mode === 'edit' && acc) {
    const code = String(acc.code);
    modeEl.value = 'edit';
    editCodeEl.value = code;
    codeEl.value = code;
    codeEl.disabled = true;
    nameEl.value = (acc.nombre || acc.name || '').toString();
    const rt = String(acc.rootType || inferRootTypeFromCode(code) || 'OTROS').toUpperCase();
    rootEl.value = ROOT_TYPES.includes(rt) ? rt : 'OTROS';
    if (titleEl) titleEl.textContent = 'Editar cuenta';
    if (subEl) subEl.textContent = `Código bloqueado: ${code}`;
  } else {
    modeEl.value = 'new';
    editCodeEl.value = '';
    codeEl.value = '';
    codeEl.disabled = false;
    nameEl.value = '';
    rootEl.value = 'INGRESOS';
    if (titleEl) titleEl.textContent = 'Nueva cuenta';
    if (subEl) subEl.textContent = 'Tip: escribe el código y te sugerimos el rootType.';
  }
}

async function saveCatAccount() {
  if (!finCachedData) await refreshAllFin();

  const mode = document.getElementById('cat-mode')?.value || 'new';
  const editCode = document.getElementById('cat-edit-code')?.value || '';

  const codeEl = document.getElementById('cat-code');
  const nameEl = document.getElementById('cat-name');
  const rootEl = document.getElementById('cat-root');

  const codeRaw = String(codeEl?.value || '').trim();
  const name = String(nameEl?.value || '').trim();
  const rootType = String(rootEl?.value || '').toUpperCase();

  if (!name) {
    setCatFormMessage('El nombre es obligatorio.', true);
    return;
  }
  if (!isValidRootType(rootType)) {
    setCatFormMessage('Selecciona un rootType válido.', true);
    return;
  }

  await openFinDB();

  if (mode === 'edit') {
    const code = String(editCode || codeRaw).trim();
    const existing = finCachedData.accountsMap.get(code) || await finGet('accounts', code);
    if (!existing) {
      setCatFormMessage('No se encontró la cuenta a editar.', true);
      return;
    }
    if (existing.systemProtected) {
      setCatFormMessage('Cuenta protegida por sistema. No se puede editar.', true);
      return;
    }

    existing.nombre = name;
    existing.name = name;
    existing.rootType = rootType;
    existing.updatedAtISO = new Date().toISOString();
    await finPut('accounts', existing);
    showToast('Cuenta actualizada');
    closeCatModal();
    await refreshAllFin();
    return;
  }

  // new
  if (!/^\d{4}$/.test(codeRaw)) {
    setCatFormMessage('El código debe tener 4 dígitos (ej: 4101).', true);
    return;
  }
  if (finCachedData.accountsMap.has(codeRaw)) {
    setCatFormMessage('Ese código ya existe. Usa otro.', true);
    return;
  }
  const already = await finGet('accounts', codeRaw);
  if (already) {
    setCatFormMessage('Ese código ya existe. Usa otro.', true);
    return;
  }

  const now = new Date().toISOString();
  const newAcc = {
    code: codeRaw,
    nombre: name,
    name,
    tipo: inferTipoForNewAccount(codeRaw),
    rootType,
    isHidden: false,
    systemProtected: false,
    createdAtISO: now,
    updatedAtISO: now
  };

  await finAdd('accounts', newAcc);
  showToast('Cuenta creada');
  closeCatModal();
  await refreshAllFin();
}

async function toggleCatAccount(code) {
  if (!finCachedData) await refreshAllFin();
  const acc = finCachedData.accountsMap.get(String(code));
  if (!acc) return;
  if (acc.systemProtected) {
    showToast('Cuenta protegida: no se puede ocultar');
    return;
  }
  acc.isHidden = !acc.isHidden;
  acc.updatedAtISO = new Date().toISOString();
  await openFinDB();
  await finPut('accounts', acc);
  showToast(acc.isHidden ? 'Cuenta oculta' : 'Cuenta visible');
  await refreshAllFin();
}

function setupCatalogoUI() {
  populateCatRootSelect();

  const search = document.getElementById('cat-search');
  const btnNew = document.getElementById('cat-new');
  const btnRefresh = document.getElementById('cat-refresh');
  const btnExport = document.getElementById('cat-export');
  const tbody = document.getElementById('cat-tbody');

  const modal = document.getElementById('cat-modal');
  const closeBtn = document.getElementById('cat-modal-close');
  const cancelBtn = document.getElementById('cat-cancel');
  const saveBtn = document.getElementById('cat-save');

  const codeEl = document.getElementById('cat-code');
  const rootEl = document.getElementById('cat-root');

  if (search) {
    search.addEventListener('input', (e) => {
      catQuery = e.target.value || '';
      renderCatalogoCuentas(finCachedData || { accounts: [] });
    });
  }

  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      refreshAllFin().catch(err => {
        console.error('Error refrescando Finanzas', err);
        alert('No se pudo actualizar Finanzas.');
      });
    });
  }

  if (btnNew) {
    btnNew.addEventListener('click', () => {
      setCatModalMode('new');
      openCatModal();
      setTimeout(() => document.getElementById('cat-code')?.focus(), 0);
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
      const edit = e.target.closest('.cat-edit');
      const tog = e.target.closest('.cat-toggle');

      if (edit && !edit.disabled) {
        const code = String(edit.dataset.code || '');
        const acc = finCachedData?.accountsMap.get(code);
        if (!acc) return;
        setCatModalMode('edit', acc);
        openCatModal();
        setTimeout(() => document.getElementById('cat-name')?.focus(), 0);
        return;
      }

      if (tog && !tog.disabled) {
        const code = String(tog.dataset.code || '');
        toggleCatAccount(code).catch(err => {
          console.error('Error ocultando/mostrando cuenta', err);
          alert('No se pudo actualizar la cuenta.');
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

  if (rootEl) {
    rootEl.addEventListener('change', () => {
      catAutoRootType = false;
    });
  }

  if (codeEl) {
    codeEl.addEventListener('input', () => {
      // Solo dígitos, máximo 4
      const cleaned = String(codeEl.value || '').replace(/\D+/g, '').slice(0, 4);
      if (codeEl.value !== cleaned) codeEl.value = cleaned;
      if (catAutoRootType && cleaned.length === 4 && rootEl) {
        const inferred = inferRootTypeFromCode(cleaned) || 'OTROS';
        if (ROOT_TYPES.includes(inferred)) rootEl.value = inferred;
      }
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
  totalEl.value = `C$ ${fmtCurrency(total)}`;
  compraMaybeSyncMonto(total);
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
  try { document.getElementById('compra-descripcion').value = ''; } catch (_) {}
  try { document.getElementById('compra-referencia').value = ''; } catch (_) {}
  try { document.getElementById('compra-monto').value = ''; } catch (_) {}
  try { document.getElementById('compra-producto').value = ''; } catch (_) {}
  try { if (finCachedData) { fillCompraCuentaDebe(finCachedData); fillCompraCuentaHaber(finCachedData); } } catch (_) {}
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
  const amount = n2(entry.totalDebe != null ? entry.totalDebe : (entry.total || 0));
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

  // Producto (live o snapshot)
  const pid = String(entry.productoId || entry.supplierProductId || '').trim();
  if (sid && pid) {
    compraMissingProductSnapshot = {
      supplierId: sid,
      id: pid,
      nombre: entry.supplierProductName || null,
      tipo: entry.tipo || entry.supplierProductType || null,
      precioRef: (entry.supplierProductPriceRef != null) ? entry.supplierProductPriceRef : null
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
      precioSet: (snap.precioRef != null)
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
  hint.textContent = hasPriceRef
    ? `Tipo: ${tipoLabel} · Precio ref: C$ ${fmtCurrency(precio)}`
    : `Tipo: ${tipoLabel} · Precio ref: —`;
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
    // Cuentas ocultas: no deben aparecer en selects para movimientos nuevos.
    if (acc && acc.isHidden === true) continue;

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
    // Cuentas ocultas: no deben aparecer en selects para movimientos nuevos.
    if (acc && acc.isHidden === true) continue;

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

  const defaultCode = (pm === 'bank') ? '1200' : '1100';
  if (Array.from(sel.options).some(o => o.value === defaultCode)) {
    sel.value = defaultCode;
  } else if (sel.options.length > 1) {
    sel.selectedIndex = 1;
  }
}

async function guardarCompraProveedor() {
  if (!finCachedData) await refreshAllFin();

  const supplierIdStr = document.getElementById('compra-proveedor')?.value || '';
  const fecha = document.getElementById('compra-fecha')?.value || todayStr();
  const tipoCompra = document.getElementById('compra-tipo')?.value || 'inventory';
  const pm = document.getElementById('compra-medio')?.value || 'cash';
  const montoRaw = document.getElementById('compra-monto')?.value || '';
  const debeCode = document.getElementById('compra-cuenta-debe')?.value || '';
  const haberCode = document.getElementById('compra-cuenta-haber')?.value || '';
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
  if (!haberCode) {
    alert('Selecciona la cuenta HABER.');
    return;
  }

  // Producto asistido (opcional) + snapshot robusto (si luego se borra del proveedor)
  const productId = String(document.getElementById('compra-producto')?.value || '').trim();
  let productSnapshot = null;
  if (productId) {
    try {
      const p = compraGetSelectedProduct(finCachedData);
      if (p) {
        const hasPriceRef = compraProductHasPriceRef(p);
        productSnapshot = {
          id: String(p.id || ''),
          nombre: String(p.nombre || ''),
          tipo: String((p.tipo || 'UNIDADES')).toUpperCase(),
          precio: hasPriceRef ? normNumNonNeg(p.precio) : null,
          precioSet: hasPriceRef
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

  // Si el producto no existe en catálogo pero sí está seleccionado, guardar snapshot para no crashear al reabrir.
  if (productId && !productSnapshot) {
    compraMissingProductSnapshot = {
      supplierId,
      id: productId,
      nombre: desc || null,
      tipo: tipoSnapUI || null,
      precioRef: null
    };
  } else if (productSnapshot) {
    compraMissingProductSnapshot = {
      supplierId,
      id: productSnapshot.id,
      nombre: productSnapshot.nombre,
      tipo: productSnapshot.tipo,
      precioRef: productSnapshot.precio
    };
  }

  const isEdit = (compraEditingEntryId != null);
  const existing = (isEdit && finCachedData && Array.isArray(finCachedData.entries))
    ? (finCachedData.entries.find(e => Number(e.id) === Number(compraEditingEntryId)) || null)
    : null;

  const entryBase = existing ? { ...existing } : {};

  const entry = {
    ...entryBase,
    ...(isEdit ? { id: Number(compraEditingEntryId) } : null),
    fecha,
    descripcion: desc || `Compra a proveedor: ${supplierName}`,
    tipoMovimiento: 'egreso',
    evento: normalizeEventForPurchases(),
    origen: 'Interno',
    origenId: null,
    totalDebe: monto,
    totalHaber: monto,

    // Metadata compras
    entryType: 'purchase',
    purchaseKind: tipoCompra,
    supplierId,
    supplierName,
    paymentMethod: pm,
    reference: ref,

    // Producto asistido (opcional) - snapshot para robustez (si luego se borra del proveedor)
    supplierProductId: productSnapshot ? productSnapshot.id : (productId || null),
    supplierProductName: productSnapshot ? productSnapshot.nombre : ((prodOptLabel || null) || (entryBase.supplierProductName || null)),
    supplierProductType: productSnapshot ? productSnapshot.tipo : (tipoSnap || entryBase.tipo || entryBase.supplierProductType || null),
    supplierProductPriceRef: productSnapshot ? productSnapshot.precio : (entryBase.supplierProductPriceRef || null),

    // Etapa 2: campos persistidos del flujo Cantidad/PrecioUnit/Total (compatibles con registros viejos)
    productoId: productId || null,
    tipo: tipoSnap || entryBase.tipo || entryBase.supplierProductType || null,
    precioUnit,
    cantidad,
    total
  };
  // Guardado atómico: o se guarda TODO (asiento + líneas) o no se guarda NADA.
  try {
    const lines = [
      { accountCode: String(debeCode), debe: monto, haber: 0 },
      { accountCode: String(haberCode), debe: 0, haber: monto }
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
      map.set(key, { supplierId: key, supplier: name, count: 0, total: 0, cash: 0, bank: 0 });
    }
    const b = map.get(key);
    const amt = Number(e.totalDebe || e.totalHaber || 0);
    b.count += 1;
    b.total += amt;

    const pm = (e.paymentMethod || '').toString().trim();
    if (pm === 'bank') b.bank += amt;
    else b.cash += amt;
  }

  const rows = Array.from(map.values()).sort((a, b) => a.supplier.localeCompare(b.supplier, 'es'));

  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.supplier}</td>
      <td class="num">${r.count}</td>
      <td class="num">C$ ${fmtCurrency(r.total)}</td>
      <td class="num">C$ ${fmtCurrency(r.cash)}</td>
      <td class="num">C$ ${fmtCurrency(r.bank)}</td>
    `;
    tbody.appendChild(tr);
  }

  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  const cntAll = rows.reduce((s, r) => s + r.count, 0);
  if (ayuda) {
    ayuda.textContent = `Periodo: ${periodo.desde} → ${periodo.hasta} · Compras: ${cntAll} · Total: C$ ${fmtCurrency(totalAll)}`;
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
    const onMonto = () => { try { compraSetMontoAuto(false); } catch (_) {} };
    montoEl.addEventListener('input', onMonto);
  }

  // Change handlers for accounts
  const tipoSel = document.getElementById('compra-tipo');
  const pmSel = document.getElementById('compra-medio');
  if (tipoSel) tipoSel.addEventListener('change', () => {
    if (finCachedData) fillCompraCuentaDebe(finCachedData);
  });
  if (pmSel) pmSel.addEventListener('change', () => {
    if (finCachedData) fillCompraCuentaHaber(finCachedData);
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
  return {
    id: src.id ? String(src.id) : base.id,
    supplierId: src.supplierId == null ? '' : String(src.supplierId),
    supplierName: src.supplierName ? String(src.supplierName) : '',
    productId: src.productId == null ? '' : String(src.productId),
    product: src.product ? String(src.product) : '',
    type: (String(src.type || '').toUpperCase() === 'CAJAS') ? 'CAJAS' : 'UNIDADES',
    quantity: (src.quantity == null) ? '' : String(src.quantity),
    price: (src.price == null) ? '' : String(src.price),
    purchased: pcNormBool(src.purchased)
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

  if (elProv) elProv.textContent = `C$ ${fmtCurrency(totals.proveedores)}`;
  if (elVar) elVar.textContent = `C$ ${fmtCurrency(totals.varias)}`;
  if (elGen) elGen.textContent = `C$ ${fmtCurrency(totals.general)}`;

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
        tdT.textContent = `C$ ${fmtCurrency(r.total)}`;
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

  const suppliers = (finCachedData && Array.isArray(finCachedData.suppliers)) ? [...finCachedData.suppliers] : [];
  suppliers.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));

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

    // Si venía texto sin productId y coincide por nombre, lo enlazamos para que el select quede consistente.
    if (hasCatalog && !line.productId && (line.product || '').trim()) {
      const m = pcFindProductInCatalogByName(catalog, line.product);
      if (m && m.id) line.productId = String(m.id);
    }

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
          pcUpdateComputedUI();
          return;
        }

        const pid = String(v);
        const p = catalog.find(x => String(x && x.id) === pid) || null;
        line.productId = pid;

        if (p) {
          line.product = (p.nombre || '').toString();
          const tipo = String(p.tipo || '').toUpperCase();
          line.type = (tipo === 'CAJAS') ? 'CAJAS' : 'UNIDADES';
          line.price = String(Math.round(normNumNonNeg(p.precio) * 100) / 100);

          // Autofill UI (sin pelearse: solo ocurre al seleccionar).
          try { if (selTipo) selTipo.value = line.type; } catch (_) {}
          try { if (inpPrice) inpPrice.value = line.price; } catch (_) {}
          try { totalEl.textContent = `C$ ${fmtCurrency(pcGetLineTotal(line))}`; } catch (_) {}
        } else {
          // No existe en catálogo: mantenemos texto actual y evitamos crash.
          line.product = (line.product || '').toString();
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
      pcUpdateComputedUI();
    });
    cTipo.appendChild(selTipo);

    // Total cell (needs to exist before input handlers)
    const cTotal = document.createElement('div');
    cTotal.className = 'purchase-cell cell-total';
    const totalEl = document.createElement('div');
    totalEl.className = 'purchase-total-cell';
    totalEl.textContent = `C$ ${fmtCurrency(pcGetLineTotal(line))}`;
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
      totalEl.textContent = `C$ ${fmtCurrency(pcGetLineTotal(line))}`;
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
      totalEl.textContent = `C$ ${fmtCurrency(pcGetLineTotal(line))}`;
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
      tdT.textContent = `C$ ${fmtCurrency(rec.totals && rec.totals.general)}`;

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
  if (tProv) tProv.textContent = `C$ ${fmtCurrency(rec.totals && rec.totals.proveedores)}`;
  if (tVar) tVar.textContent = `C$ ${fmtCurrency(rec.totals && rec.totals.varias)}`;
  if (tGen) tGen.textContent = `C$ ${fmtCurrency(rec.totals && rec.totals.general)}`;

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
      'PROVEEDOR', 'PRODUCTO', 'TIPO', 'CANTIDAD', 'PRECIO', 'TOTAL'
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
    const rows = [['PRODUCTO', 'CANTIDAD TOTAL', 'TOTAL']];
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
  XLSX.writeFile(wb, filename);
  showToast('Histórico exportado a Excel');
}

let pcAutoSaveChain = Promise.resolve();

async function pcAutoSaveDraftSilent() {
  if (!pcCurrent) return;
  const now = new Date();
  pcCurrent.updatedAtISO = now.toISOString();
  pcCurrent.updatedAtDisplay = fmtDDMMYYYYHHMM(now);
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
  const rec = {
    id: pcNewId('p'),
    notes: snapshotNotes,
    sections: pcDeepClone(pcCurrent.sections || { proveedores: [], varias: [] }),
    totals: pcComputeTotalsFromSections(pcCurrent.sections || { proveedores: [], varias: [] }),
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
    } : { subtotal: 0, discountTotal: 0, total: 0 }
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

function rcFmtMoney(v){ return `C$ ${fmtCurrency(v)}`; }

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

    const st = String(r.status || 'DRAFT');
    const canEdit = st === 'DRAFT';
    const canVoid = st === 'ISSUED';
    const canReemit = (st === 'ISSUED' || st === 'VOID');
    const canPrint = (st === 'ISSUED' || st === 'VOID');

    tr.innerHTML = `
      <td>${escapeHTML(num)}</td>
      <td>${escapeHTML(fecha)}</td>
      <td><span class="fin-cell-text fin-clamp-2">${escapeHTML(cli)}</span></td>
      <td>${rcPayPill(r.paymentType)}</td>
      <td class="num">${rcFmtMoney(total)}</td>
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

  const idsDisable = ['rec-client','rec-date','rec-bank','rec-ref'];
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

  if (id) id.value = rcCurrent.receiptId;
  if (cli) cli.value = rcCurrent.clientName || '';
  // No fabricar fecha para recibos viejos sin dateISO.
  if (date) date.value = rcCurrent.dateISO || '';
  if (bank) bank.value = rcCurrent.paymentBank || '';
  if (ref) ref.value = rcCurrent.paymentRef || '';

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

  rcCurrent.clientName = clientName;

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
  const ids = ['rec-client','rec-date','rec-bank','rec-ref'];
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
        <td class="num pcol">${rcFmtMoneyPrint(ln.unitPrice || 0)}</td>
        <td class="num dcol">${discCell}</td>
        <td class="num tcol">${rcFmtMoneyPrint(ln.lineTotal || 0)}</td>
      </tr>
    `;
  }).join('');

  const sub = receipt.totals?.subtotal ?? 0;
  const disc = receipt.totals?.discountTotal ?? 0;
  const tot = receipt.totals?.total ?? 0;

  const discTotalDisp = (rcSafeNum(disc) === 0) ? '' : rcFmtMoneyPrint(disc);

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
      <div class="row"><div><strong>SUBTOTAL</strong></div><div>${rcFmtMoneyPrint(sub)}</div></div>
      <div class="row"><div><strong>DESCUENTO</strong></div><div>${discTotalDisp}</div></div>
      <div class="row"><div><strong>TOTAL</strong></div><div><strong>${rcFmtMoneyPrint(tot)}</strong></div></div>
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
  if (bank) bank.addEventListener('input', () => { if (rcCurrent && rcEditorMode === 'edit') { rcCurrent.paymentBank = bank.value; rcUpdateEditorMeta(); } });
  if (ref) ref.addEventListener('input', () => { if (rcCurrent && rcEditorMode === 'edit') { rcCurrent.paymentRef = ref.value; rcUpdateEditorMeta(); } });

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


/* ---------- Tabs y eventos UI ---------- */



function setActiveFinView(view) {
  const buttons = document.querySelectorAll('.fin-tab-btn');
  let target = null;

  buttons.forEach(btn => {
    if (btn.dataset.view === view) {
      target = btn;
    }
  });

  // Si no se encuentra una vista válida, usar la primera como fallback
  if (!target && buttons.length > 0) {
    target = buttons[0];
    view = target.dataset.view;
  }

  buttons.forEach(btn => {
    btn.classList.toggle('active', btn === target);
  });

  document.querySelectorAll('.fin-view').forEach(sec => {
    sec.classList.toggle('active', sec.id === `view-${view}`);
  });
}

function setupTabs() {
  const buttons = document.querySelectorAll('.fin-tab-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      setActiveFinView(view);
      if (view === 'recibos') { rcEnterView(true).catch(() => {}); }
      // Actualizar hash para que si el usuario regresa, mantenga la pestaña
      if (view) {
        window.location.hash = `tab=${view}`;
      }
    });
  });

  // Vista inicial según hash de la URL (#tab=tablero, #tab=diario, #tab=estados)
  let initialView = 'tablero';
  if (window.location.hash && window.location.hash.startsWith('#tab=')) {
    const v = window.location.hash.slice(5).trim();
    if (v) {
      initialView = v;
    }
  }

  setActiveFinView(initialView);

  if (initialView === 'recibos') { rcEnterView(true).catch(() => {}); }
}function setupEstadosSubtabs() {
  const btns = document.querySelectorAll('.fin-subtab-btn');
  btns.forEach(btn => {
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
  ['tab-mes', 'tab-anio', 'tab-evento'].forEach(id => {
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
    });
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

async function refreshAllFin() {
  finCachedData = await getAllFinData();
  const data = finCachedData;

  // Evento (POS): refrescar lista de eventos activos para dropdown y resolución live por ID.
  await refreshPosEventsCache();
  populateMovimientoEventoSelect();
  updateEventFilters(data.entries);
  updateSupplierSelects(data);
  fillCuentaSelect(data);
  fillCompraCuentaDebe(data);
  fillCompraCuentaHaber(data);
  renderTablero(data);
  renderDiario(data);
  renderComprasPorProveedor(data);
  renderProveedores(data);
  // Proveedores: si veníamos editando, restaurar modo edición y UI de productos.
  provApplyEditStateFromCache();
  // Proveedores: si el modal de productos está abierto, mantenerlo coherente (ediciones/borrados).
  provSyncOpenProductsModal();
  renderCatalogoCuentas(data);
  renderEstadoResultados(data);
  renderBalanceGeneral(data);
  renderRentabilidadPresentacion(data);
  renderComparativoEventos(data);
  renderFlujoCaja(data);

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
        stL.add({ ...ln, idEntry: entryId });
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
          stL.add({ ...ln, idEntry: id });
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

  const lines = [];
  if (efectivo > 0) lines.push({ accountCode: '1110', debe: efectivo, haber: 0 });
  if (transferencia > 0) lines.push({ accountCode: '1200', debe: transferencia, haber: 0 });
  if (credito > 0) lines.push({ accountCode: '1300', debe: credito, haber: 0 });
  if (otros > 0) lines.push({ accountCode: '1900', debe: otros, haber: 0 });

  // Ventas pagadas
  lines.push({ accountCode: '4100', debe: 0, haber: total });

  // Costos consolidados (balanceado)
  // DEBE 5100 por costoVentasTotal
  // DEBE 6105 por costoCortesiasTotal
  // HABER 1500 por la suma
  const cogsAccountCode = '5100';
  const courtesyExpenseCode = '6105';
  const inventoryAccountCode = '1500';

  if (costoVentasTotal > 0) lines.push({ accountCode: cogsAccountCode, debe: costoVentasTotal, haber: 0 });
  if (costoCortesiasTotal > 0) lines.push({ accountCode: courtesyExpenseCode, debe: costoCortesiasTotal, haber: 0 });
  if (costoTotalSalidaInventario > 0) lines.push({ accountCode: inventoryAccountCode, debe: 0, haber: costoTotalSalidaInventario });

  // Caja Chica consolidada (Etapa 2): se importa como parte del mismo POS_DAILY_CLOSE
  // Egresos: Gastos (DEBE) vs Caja eventos (HABER)
  // Ingresos: Caja eventos (DEBE) vs Otros ingresos (HABER)
  const petty = closure?.totals?.pettyCash || null;
  const pcEgresos = n2(petty?.egresosNio);
  const pcIngresos = n2(petty?.ingresosNio);
  if (pcEgresos > 0) {
    lines.push({ accountCode: '6100', debe: pcEgresos, haber: 0 });
    lines.push({ accountCode: '1110', debe: 0, haber: pcEgresos });
  }
  if (pcIngresos > 0) {
    lines.push({ accountCode: '1110', debe: pcIngresos, haber: 0 });
    lines.push({ accountCode: '7100', debe: 0, haber: pcIngresos });
  }

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
    paymentBreakdown: { efectivo, transferencia, credito, otros, extras },

    // Compat legacy: mantenemos bloque cortesia (ahora con costoCortesiasTotal)
    cortesia: { cantidad: cortesiaCantidad, costoTotal: costoCortesiasTotal, expenseAccountCode: '6105' },
    // Nuevo: costos POS consolidados
    posCosts: {
      costoVentasTotal,
      costoCortesiasTotal,
      costoTotalSalidaInventario,
      cogsAccountCode: '5100',
      courtesyAccountCode: '6105',
      inventoryAccountCode: '1500'
    },
    posPettyCash: petty ? {
      ingresosNio: pcIngresos,
      egresosNio: pcEgresos,
      ingresosUsd: n2(petty.ingresosUsd),
      egresosUsd: n2(petty.egresosUsd),
      fxRateUsed: petty.fxRateUsed || null,
      hasUsd: !!petty.hasUsd
    } : null,
    posSnapshot: { key: closure.key || null, createdAt: closure.createdAt || null, meta: closure.meta || null, totals: { totalGeneral, totalMismatch } },
    importedAt: Date.now()
  };

  // Guardas básicas
  if (Math.abs(n2(totalDebe - totalHaber)) > 0.01) {
    throw new Error('Asiento POS desbalanceado (DEBE/HABER).');
  }

  const accountsMap = data?.accountsMap || null;
  const missing = getMissingAccountCodes(lines.map(l => l && l.accountCode), accountsMap);
  if (missing.length) {
    throw new Error(`Falta ${missing.length === 1 ? `la cuenta ${missing[0]}` : `las cuentas ${missing.join(', ')}`} para importar el cierre.`);
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
  const accountsMap = data?.accountsMap || null;
  const missing = getMissingAccountCodes(revLines.map(l => l && l.accountCode), accountsMap);
  if (missing.length) {
    throw new Error(`Falta ${missing.length === 1 ? `la cuenta ${missing[0]}` : `las cuentas ${missing.join(', ')}`} para reversar.`);
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

    if (!finCachedData) await refreshAllFin();
    const data = finCachedData || (await getAllFinData());

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

    // Compras (planificación)
    await pcLoadAll();
    fillMonthYearSelects();
    setupTabs();
    setupCajaChicaUI();
    setupEstadosSubtabs();
    setupModoERToggle();
    setupFilterListeners();    setupProveedoresUI();
    setupRecibosUI();
    await rcEnterView(true);
    setupCatalogoUI();
    setupComprasUI();
    setupComprasPlanUI();
    setupExportButtons();
    await ccLoadSnapshot();
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
