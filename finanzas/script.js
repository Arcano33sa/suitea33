// Finanzas – Suite A33 · Fase 3A + Fase 4.2 + Fase 4.3.1 + Fase 6 (Flujo de Caja)
// Contabilidad básica: diario, tablero, ER, BG
// + Rentabilidad por presentación (lectura POS)
// + Comparativo de eventos (lectura Finanzas)
// + Flujo de Caja (Caja + Banco) por periodo.

const FIN_DB_NAME = 'finanzasDB';
// IMPORTANTE: subir versión cuando se agregan stores/nuevas estructuras.
// v3 agrega el store `suppliers` para Proveedores (sin romper data existente).
const FIN_DB_VERSION = 3;
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
    fillMonthYearSelects();
    setupTabs();
    setupEstadosSubtabs();
    setupModoERToggle();
    setupFilterListeners();
    setupProveedoresUI();
    setupComprasUI();
    setupExportButtons();
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
