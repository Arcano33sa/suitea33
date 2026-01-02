// Finanzas – Suite A33 · Fase 3A + Fase 4.2 + Fase 4.3.1 + Fase 6 (Flujo de Caja)
// Contabilidad básica: diario, tablero, ER, BG
// + Rentabilidad por presentación (lectura POS)
// + Comparativo de eventos (lectura Finanzas)
// + Flujo de Caja (Caja + Banco) por periodo.

const FIN_DB_NAME = 'finanzasDB';
// IMPORTANTE: subir versión cuando se agregan stores/nuevas estructuras.
// v3 agrega el store `suppliers` para Proveedores (sin romper data existente).
const FIN_DB_VERSION = 4;
const CENTRAL_EVENT = 'CENTRAL';

let finDB = null;
let finCachedData = null; // {accounts, accountsMap, entries, lines, linesByEntry}

// POS: lectura de ventas (solo lectura, sin tocar nada del POS)
const POS_DB_NAME = 'a33-pos';
let posDB = null;

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

      // Settings / snapshots (no contable): por ejemplo Caja Chica física.
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
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
    req.onerror = () => reject(req.error);
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
  { code: '6105', nombre: 'Gastos de publicidad y marketing', tipo: 'gasto', systemProtected: true },
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
  const n = Number(v || 0);
  return n.toLocaleString('es-NI', {
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
  return isCentralEventName(ev) ? 'General/Central' : ev;
}

function normalizeEventForPurchases() {
  return CENTRAL_EVENT;
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

const accountsMap = new Map();
  for (const acc of accounts) {
    accountsMap.set(String(acc.code), acc);
  }

  

  const suppliersMap = new Map();
  for (const s of suppliers) {
    suppliersMap.set(Number(s.id), s);
  }
const linesByEntry = new Map();
  for (const ln of lines) {
    const idEntry = ln.idEntry;
    if (!linesByEntry.has(idEntry)) linesByEntry.set(idEntry, []);
    linesByEntry.get(idEntry).push(ln);
  }

  return { accounts, accountsMap, entries, lines, linesByEntry, suppliers, suppliersMap };
}

function buildEventList(entries) {
  const set = new Set();
  for (const e of entries) {
    const name = (e.evento || '').trim();
    if (name) set.add(name);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

function matchEvent(entry, eventFilter) {
  const ev = (entry.evento || '').trim();
  if (!eventFilter || eventFilter === 'ALL') return true;
  if (eventFilter === 'NONE') return !ev;
  return ev === eventFilter;
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
  if (!data) return 0;
  const { entries, linesByEntry } = data;
  const subset = filterEntriesByDateAndEvent(entries || [], filtros)
    .filter(e => String(e?.origen || '').toUpperCase() === 'POS'
      && String(e?.descripcion || '').includes('Cortesía POS'));

  let total = 0;
  for (const e of subset) {
    const lines = linesByEntry.get(e.id) || [];
    for (const ln of lines) {
      if (String(ln.accountCode) !== '6105') continue;
      total += (Number(ln.debe || 0) - Number(ln.haber || 0));
    }
  }
  return total;
}


// Agrupa por evento en un rango de fechas
function calcResultadosByEventInRange(data, desde, hasta) {
  const { accountsMap, entries, linesByEntry } = data;
  const map = new Map(); // key: nombreEvento, value: {ingresos, costos, gastos}

  for (const e of entries) {
    const f = e.fecha || e.date || '';
    if (desde && f < desde) continue;
    if (hasta && f > hasta) continue;

    const eventName = (e.evento || '').trim() || 'Sin evento';
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
  const { entries, linesByEntry } = data;
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
  { id: 'galon', label: 'Galón 3800 ml' }
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

  const { entries, linesByEntry } = data;

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

    const origenRaw = e.origen || 'Interno';
    const origen = (origenRaw === 'Manual') ? 'Interno' : origenRaw;
    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (origenFilter !== 'todos' && origen !== origenFilter) continue;

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
    let totalDebe = 0;
    let totalHaber = 0;
    for (const ln of lines) {
      totalDebe += Number(ln.debe || 0);
      totalHaber += Number(ln.haber || 0);
    }

    const supplierLabel = getSupplierLabelFromEntry(e, data);
    const ref = (e.reference || '').toString().trim();
    const pm = (e.paymentMethod || '').toString().trim();
    const pmLabel = pm === 'bank' ? 'Banco' : (pm === 'cash' ? 'Caja' : (pm ? pm : '—'));

    rows.push([
      e.fecha || e.date || '',
      e.descripcion || '',
      tipo,
      displayEventLabel((e.evento || '').trim()) || '—',
      supplierLabel,
      pmLabel,
      ref,
      origen,
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
      opt.textContent = displayEventLabel(ev) || ev;
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
  const neta = bruta - gastos;

  const corte = end;
  const { caja, banco } = calcCajaBancoUntilDate(data, corte);

  const tabIng = $('#tab-ingresos');
  const tabCos = $('#tab-costos');
  const tabCort = $('#tab-cortesias');
  const tabBru = $('#tab-bruta');
  const tabGas = $('#tab-gastos');
  const tabRes = $('#tab-resultado');
  const tabCaja = $('#tab-caja');
  const tabBanco = $('#tab-banco');

  if (tabIng) tabIng.textContent = `C$ ${fmtCurrency(ingresos)}`;
  if (tabCos) tabCos.textContent = `C$ ${fmtCurrency(costos)}`;
  if (tabCort) tabCort.textContent = `C$ ${fmtCurrency(cortesias)}`;
  if (tabBru) tabBru.textContent = `C$ ${fmtCurrency(bruta)}`;
  if (tabGas) tabGas.textContent = `C$ ${fmtCurrency(gastos)}`;
  if (tabRes) tabRes.textContent = `C$ ${fmtCurrency(neta)}`;
  if (tabCaja) tabCaja.textContent = `C$ ${fmtCurrency(caja)}`;
  if (tabBanco) tabBanco.textContent = `C$ ${fmtCurrency(banco)}`;
}

/* ---------- Render: Diario y Ajustes ---------- */

function renderDiario(data) {
  const tbody = $('#diario-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const tipoFilter = ($('#filtro-tipo')?.value) || 'todos';
  const eventoFilter = ($('#filtro-evento-diario')?.value) || 'ALL';
  const origenFilter = ($('#filtro-origen')?.value) || 'todos';
  const proveedorFilter = (document.getElementById('filtro-proveedor')?.value) || 'todos';

  const { desde: diarioDesde, hasta: diarioHasta } = getDiaryRangeFromUI();

  const { entries, linesByEntry } = data;

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
    const origen = (origenRaw === 'Manual') ? 'Interno' : origenRaw;

    const fechaMov = String(e.fecha || e.date || '').slice(0, 10);
    if ((diarioDesde || diarioHasta) && !fechaMov) continue;
    if (diarioDesde && fechaMov < diarioDesde) continue;
    if (diarioHasta && fechaMov > diarioHasta) continue;

    if (tipoFilter !== 'todos' && tipoMov !== tipoFilter) continue;
    if (!matchEvent(e, eventoFilter)) continue;
    if (origenFilter !== 'todos' && origen !== origenFilter) continue;

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
    let totalDebe = 0;
    let totalHaber = 0;
    for (const ln of lines) {
      totalDebe += Number(ln.debe || 0);
      totalHaber += Number(ln.haber || 0);
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${e.fecha || e.date || ''}</td>
      <td>${e.descripcion || ''}</td>
      <td>${tipoMov}</td>
      <td>${displayEventLabel((e.evento || '').trim()) || '—'}</td>
      <td>${getSupplierLabelFromEntry(e, data)}</td>
      <td>${origen}</td>
      <td class="num">C$ ${fmtCurrency(totalDebe)}</td>
      <td class="num">C$ ${fmtCurrency(totalHaber)}</td>
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
const ref = (entry.reference || '').toString().trim();
const pm = (entry.paymentMethod || '').toString().trim();
const pmLabel = pm === 'bank' ? 'Banco' : (pm === 'cash' ? 'Caja' : (pm ? pm : '—'));
	const origenRaw = entry.origen || 'Interno';
	const origenLabel = (origenRaw === 'Manual') ? 'Interno' : origenRaw;

meta.innerHTML = `
  <p><strong>Fecha:</strong> ${entry.fecha || entry.date || ''}</p>
  <p><strong>Descripción:</strong> ${entry.descripcion || ''}</p>
  <p><strong>Tipo:</strong> ${entry.tipoMovimiento || ''}</p>
  <p><strong>Evento:</strong> ${displayEventLabel((entry.evento || '').trim()) || '—'}</p>
  <p><strong>Proveedor:</strong> ${supplierLabel}</p>
  <p><strong>Pago:</strong> ${pmLabel}</p>
  <p><strong>Referencia:</strong> ${ref || '—'}</p>
	  <p><strong>Origen:</strong> ${origenLabel}</p>
`;

tbody.innerHTML = '';
  const lines = linesByEntry.get(entry.id) || [];
  for (const ln of lines) {
    const acc = accountsMap.get(String(ln.accountCode));
    const nombre = acc
      ? (acc.nombre || acc.name || `Cuenta ${acc.code}`)
      : '';
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
  const evento = ($('#mov-evento')?.value || '').trim();
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
    evento,
    origen: 'Interno',
    origenId: null,
    totalDebe: monto,
    totalHaber: monto
  };

  await openFinDB();
  const entryId = await finAdd('journalEntries', entry);

  const lineDebe = {
    idEntry: entryId,
    accountCode: debeCode,
    debe: monto,
    haber: 0
  };
  const lineHaber = {
    idEntry: entryId,
    accountCode: haberCode,
    debe: 0,
    haber: monto
  };

  await finAdd('journalLines', lineDebe);
  await finAdd('journalLines', lineHaber);

  // Limpia campos clave
  const montoInput = $('#mov-monto');
  const descInput = $('#mov-descripcion');
  const eventoInput = $('#mov-evento');
  if (montoInput) montoInput.value = '';
  if (descInput) descInput.value = '';
  if (eventoInput) eventoInput.value = evento; // suele repetirse por evento

  showToast('Movimiento guardado en el Diario');
  await refreshAllFin();
}

/* ---------- Proveedores (CRUD) ---------- */

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
    tr.innerHTML = `<td colspan="4">Sin proveedores. Crea el primero arriba.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const s of suppliers) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${(s.nombre || '').toString()}</td>
      <td>${(s.telefono || '').toString() || '—'}</td>
      <td>${(s.nota || '').toString() || '—'}</td>
      <td class="fin-actions-cell">
        <button type="button" class="btn-small prov-editar" data-id="${s.id}">Editar</button>
        <button type="button" class="btn-danger prov-borrar" data-id="${s.id}">Eliminar</button>
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
}

async function guardarProveedor() {
  if (!finCachedData) await refreshAllFin();

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
    await finPut('suppliers', { id, nombre, telefono, nota });
    showToast('Proveedor actualizado');
  } else {
    await finAdd('suppliers', { nombre, telefono, nota });
    showToast('Proveedor creado');
  }

  resetProveedorForm();
  await refreshAllFin();
}

async function eliminarProveedor(id) {
  if (!id) return;
  const ok = confirm('¿Eliminar este proveedor? (Las compras históricas se mantienen.)');
  if (!ok) return;

  await openFinDB();
  await finDelete('suppliers', Number(id));
  showToast('Proveedor eliminado');
  await refreshAllFin();
}

function setupProveedoresUI() {
  const btnGuardar = document.getElementById('prov-guardar');
  const btnCancelar = document.getElementById('prov-cancelar');
  const tbody = document.getElementById('proveedores-tbody');

  if (btnGuardar) {
    btnGuardar.addEventListener('click', () => {
      guardarProveedor().catch(err => {
        console.error('Error guardando proveedor', err);
        alert('No se pudo guardar el proveedor.');
      });
    });
  }

  if (btnCancelar) {
    btnCancelar.addEventListener('click', () => {
      resetProveedorForm();
    });
  }

  if (tbody) {
    tbody.addEventListener('click', (e) => {
      const editBtn = e.target.closest('.prov-editar');
      const delBtn = e.target.closest('.prov-borrar');

      if (editBtn && finCachedData) {
        const id = Number(editBtn.dataset.id || '0');
        const s = finCachedData.suppliers.find(x => Number(x.id) === id);
        if (!s) return;

        document.getElementById('prov-id').value = String(s.id);
        document.getElementById('prov-nombre').value = s.nombre || '';
        document.getElementById('prov-telefono').value = s.telefono || '';
        document.getElementById('prov-nota').value = s.nota || '';
        const cancelar = document.getElementById('prov-cancelar');
        if (cancelar) cancelar.classList.remove('hidden');
        return;
      }

      if (delBtn) {
        const id = Number(delBtn.dataset.id || '0');
        eliminarProveedor(id).catch(err => {
          console.error('Error eliminando proveedor', err);
          alert('No se pudo eliminar el proveedor.');
        });
      }
    });
  }
}

/* ---------- Compras pagadas a proveedor (wizard) ---------- */

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
  const montoRaw = document.getElementById('compra-monto')?.value || '0';
  const debeCode = document.getElementById('compra-cuenta-debe')?.value || '';
  const haberCode = document.getElementById('compra-cuenta-haber')?.value || '';
  const desc = (document.getElementById('compra-descripcion')?.value || '').trim();
  const ref = (document.getElementById('compra-referencia')?.value || '').trim();

  const monto = parseFloat(montoRaw.replace(',', '.'));

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
    alert('El monto debe ser mayor que cero.');
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

  const entry = {
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
    reference: ref
  };

  await openFinDB();
  const entryId = await finAdd('journalEntries', entry);

  await finAdd('journalLines', {
    idEntry: entryId,
    accountCode: String(debeCode),
    debe: monto,
    haber: 0
  });
  await finAdd('journalLines', {
    idEntry: entryId,
    accountCode: String(haberCode),
    debe: 0,
    haber: monto
  });

  // Limpieza parcial
  const montoEl = document.getElementById('compra-monto');
  const descEl = document.getElementById('compra-descripcion');
  const refEl = document.getElementById('compra-referencia');
  if (montoEl) montoEl.value = '';
  if (descEl) descEl.value = '';
  if (refEl) refEl.value = '';

  showToast('Compra guardada');
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
    product: '',
    type: 'UNIDADES',
    quantity: '',
    price: ''
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

function pcNormalizeLine(src) {
  const base = pcBuildEmptyLine();
  if (!src || typeof src !== 'object') return base;
  return {
    id: src.id ? String(src.id) : base.id,
    supplierId: src.supplierId == null ? '' : String(src.supplierId),
    supplierName: src.supplierName ? String(src.supplierName) : '',
    product: src.product ? String(src.product) : '',
    type: (String(src.type || '').toUpperCase() === 'CAJAS') ? 'CAJAS' : 'UNIDADES',
    quantity: (src.quantity == null) ? '' : String(src.quantity),
    price: (src.price == null) ? '' : String(src.price)
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
      line.supplierId = selSupplier.value || '';
      if (!line.supplierId) {
        line.supplierName = '';
      } else {
        const sid = Number(line.supplierId);
        const obj = finCachedData && finCachedData.suppliersMap ? finCachedData.suppliersMap.get(sid) : null;
        line.supplierName = obj ? (obj.nombre || '') : (line.supplierName || '');
      }
      pcUpdateComputedUI();
    });
    cSupplier.appendChild(selSupplier);

    // Producto
    const cProd = document.createElement('div');
    cProd.className = 'purchase-cell cell-product';
    const inpProd = document.createElement('input');
    inpProd.type = 'text';
    inpProd.placeholder = 'Producto';
    inpProd.value = line.product || '';
    inpProd.addEventListener('input', () => {
      line.product = inpProd.value;
      pcUpdateComputedUI();
    });
    pcAttachSelectAllOnFocus(inpProd);
    cProd.appendChild(inpProd);

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

    row.appendChild(cSupplier);
    row.appendChild(cProd);
    row.appendChild(cTipo);
    row.appendChild(cQty);
    row.appendChild(cPrice);
    row.appendChild(cTotal);
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

  modal.classList.add('show');
}

function pcCloseHistoryModal() {
  const modal = document.getElementById('ph-modal');
  if (!modal) return;
  modal.classList.remove('show');
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

async function pcResetCurrent() {
  const ok = confirm('Reset: esto limpia la Compra Actual (no afecta el histórico).');
  if (!ok) return;
  pcCurrent = pcBuildEmptyCurrent();
  await pcPersistSetting(PC_CURRENT_KEY, pcCurrent);
  pcRenderCurrent();
  pcSetMsg('Compra actual reseteada');
  showToast('Compra actual reseteada');
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

  const btnReset = document.getElementById('pc-reset');
  if (btnReset) btnReset.addEventListener('click', (e) => { e.preventDefault(); pcResetCurrent(); });

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
  updateEventFilters(data.entries);
  updateSupplierSelects(data);
  fillCuentaSelect(data);
  fillCompraCuentaDebe(data);
  fillCompraCuentaHaber(data);
  renderTablero(data);
  renderDiario(data);
  renderComprasPorProveedor(data);
  renderProveedores(data);
  renderEstadoResultados(data);
  renderBalanceGeneral(data);
  renderRentabilidadPresentacion(data);
  renderComparativoEventos(data);
  renderFlujoCaja(data);

  // Compras (planificación)
  if (typeof pcRenderAll === 'function') pcRenderAll();
}


function setupExportButtons() {
  const btnDiario = document.getElementById('btn-export-diario');
  if (btnDiario) {
    btnDiario.addEventListener('click', (ev) => {
      ev.preventDefault();
      exportDiarioExcel().catch(err => {
        console.error('Error exportando Diario a Excel', err);
        alert('Ocurrió un error exportando el Diario a Excel.');
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

    // Compras (planificación)
    await pcLoadAll();
    fillMonthYearSelects();
    setupTabs();
    setupCajaChicaUI();
    setupEstadosSubtabs();
    setupModoERToggle();
    setupFilterListeners();
    setupProveedoresUI();
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
