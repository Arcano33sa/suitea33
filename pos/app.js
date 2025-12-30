// --- IndexedDB helpers POS
const DB_NAME = 'a33-pos';
const DB_VER = 23; // schema estable (+ banks)
let db;

// --- Finanzas: conexión a finanzasDB para asientos automáticos
const FIN_DB_NAME = 'finanzasDB';
let finDb;
let finanzasBridgeWarned = false;
let finanzasBridgeBlockedWarned = false;
function notifyFinanzasBridge(msg, { force = false } = {}) {
  try {
    if (!force && finanzasBridgeWarned) return;
    finanzasBridgeWarned = true;
    if (typeof toast === 'function') toast(msg);
    else alert(msg);
  } catch (e) {
    console.warn('No se pudo notificar problema POS→Finanzas', e);
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('products')) {
        const os = d.createObjectStore('products', { keyPath: 'id', autoIncrement: true });
        os.createIndex('by_name', 'name', { unique: true });
      }
      if (!d.objectStoreNames.contains('events')) {
        const os2 = d.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
        os2.createIndex('by_name', 'name', { unique: true });
      }
      if (!d.objectStoreNames.contains('sales')) {
        const os3 = d.createObjectStore('sales', { keyPath: 'id', autoIncrement: true });
        os3.createIndex('by_date', 'date', { unique: false });
        os3.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('sales').createIndex('by_date','date'); } catch {}
        try { e.target.transaction.objectStore('sales').createIndex('by_event','eventId'); } catch {}
      }
      if (!d.objectStoreNames.contains('inventory')) {
        const inv = d.createObjectStore('inventory', { keyPath: 'id', autoIncrement: true });
        inv.createIndex('by_event', 'eventId', { unique: false });
      } else {
        try { e.target.transaction.objectStore('inventory').createIndex('by_event','eventId'); } catch {}
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('pettyCash')) {
        d.createObjectStore('pettyCash', { keyPath: 'eventId' });
      }

      // Catálogo de bancos (para transferencias)
      if (!d.objectStoreNames.contains('banks')) {
        const b = d.createObjectStore('banks', { keyPath: 'id', autoIncrement: true });
        try { b.createIndex('by_name', 'name', { unique: false }); } catch {}
        try { b.createIndex('by_active', 'isActive', { unique: false }); } catch {}
      } else {
        try { e.target.transaction.objectStore('banks').createIndex('by_name', 'name'); } catch {}
        try { e.target.transaction.objectStore('banks').createIndex('by_active', 'isActive'); } catch {}
      }
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// --- Finanzas: helpers para abrir finanzasDB y crear/borrar asientos
function openFinanzasDB() {
  return new Promise((resolve, reject) => {
    if (finDb) return resolve(finDb);
    const req = indexedDB.open(FIN_DB_NAME);
    req.onblocked = () => {
      console.warn('Apertura de finanzasDB bloqueada (POS). Cierra otras pestañas con Suite A33/Finanzas abiertas.');
      if (!finanzasBridgeBlockedWarned) {
        finanzasBridgeBlockedWarned = true;
        notifyFinanzasBridge('⚠️ POS no puede conectar con Finanzas porque otra pestaña está bloqueando la base de datos. Cerrá otras pestañas de la Suite y reintentá.', { force: true });
      }
    };
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('accounts')) {
        const accStore = d.createObjectStore('accounts', { keyPath: 'code' });
        accStore.createIndex('type', 'type', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalEntries')) {
        const entriesStore = d.createObjectStore('journalEntries', { keyPath: 'id', autoIncrement: true });
        entriesStore.createIndex('date', 'date', { unique: false });
        entriesStore.createIndex('tipoMovimiento', 'tipoMovimiento', { unique: false });
        entriesStore.createIndex('evento', 'evento', { unique: false });
        entriesStore.createIndex('origen', 'origen', { unique: false });
        entriesStore.createIndex('origenId', 'origenId', { unique: false });
      }
      if (!d.objectStoreNames.contains('journalLines')) {
        const linesStore = d.createObjectStore('journalLines', { keyPath: 'id', autoIncrement: true });
        linesStore.createIndex('entryId', 'entryId', { unique: false });
        linesStore.createIndex('accountCode', 'accountCode', { unique: false });
      }
    };
    req.onsuccess = (e) => {
      finDb = e.target.result;
      // Si Finanzas actualiza el esquema mientras POS está abierto, cerramos para no bloquear el upgrade
      finDb.onversionchange = () => {
        try { finDb.close(); } catch (e) {}
        finDb = null;
        console.warn('finanzasDB cambió de versión mientras POS estaba abierto; se cerró la conexión para permitir el upgrade.');
      };
      console.info(`POS conectado a finanzasDB (versión ${finDb.version})`);
      resolve(finDb);
    };
    req.onerror = () => {
      console.error('Error abriendo finanzasDB desde POS', req.error);
      notifyFinanzasBridge('⚠️ POS no pudo abrir Finanzas para asientos automáticos. Abrí el módulo Finanzas una vez, y si hay otra pestaña abierta, cerrala y reintentá.');
      reject(req.error);
    };
  });
}

async function ensureFinanzasDB() {
  try {
    await openFinanzasDB();
  } catch (e) {
    console.error('No se pudo abrir finanzasDB para asientos automáticos', e);
    notifyFinanzasBridge('⚠️ No se pudo conectar con Finanzas. Las ventas se guardaron, pero el asiento contable no se pudo generar. Revisá consola / versión de la BD y reintentá.');
    throw e;
  }
}

// Mapea forma de pago del POS a cuenta contable
function mapSaleToCuentaCobro(sale) {
  const pay = sale.payment || 'efectivo';
  if (pay === 'efectivo') return '1100';   // Caja
  if (pay === 'transferencia') return '1200'; // Banco
  if (pay === 'credito') return '1300';    // Clientes
  return '1200'; // Otros métodos similares a banco
}

// Crea/actualiza asiento automático en Finanzas por una venta / devolución del POS
async function createJournalEntryForSalePOS(sale) {
  // Crea/actualiza el asiento automático en Finanzas para una venta del POS.
  // Reglas:
  // - Venta normal: ingreso + COGS
  // - Cortesía: SOLO costo (gasto por cortesía), nunca ingreso
  // - Devolución: asiento inverso

  if (!sale) return;

  // Nos aseguramos de tener un ID (origenId) para vincular el asiento
  const saleId = (sale.id != null) ? sale.id : (sale.createdAt != null ? sale.createdAt : null);
  if (saleId == null) {
    console.warn('Venta sin id/createdAt, no se genera asiento automático.');
    return;
  }

  try {
    await ensureFinanzasDB();

    // --- Datos base ---
    const isCourtesy = !!sale.courtesy;
    const isReturn = !!sale.isReturn;
    const amount = round2(Math.abs(Number(sale.total || 0)));

    const qtyAbs = Math.abs(Number(sale.qty || 0)) || 0;

    // Preferimos lineCost si existe (más robusto). Si no, lo calculamos por costo unitario.
    let amountCost = 0;
    const lc = Number(sale.lineCost);
    if (Number.isFinite(lc) && Math.abs(lc) > 0.000001) {
      amountCost = round2(Math.abs(lc));
    } else {
      const unitCostFromSale = (typeof sale.costPerUnit === 'number' && sale.costPerUnit > 0) ? sale.costPerUnit : 0;
      const unitCost = unitCostFromSale > 0 ? unitCostFromSale : getCostoUnitarioProducto(sale.productName);
      amountCost = round2((unitCost > 0 ? unitCost : 0) * qtyAbs);
    }

    // Si no hay nada que registrar, salimos.
    // (Venta sin monto y sin costo no aporta asiento.)
    if (!(amount > 0) && !(amountCost > 0)) return;

    // Selección de cuenta de caja/banco según método de pago
    const payment = (sale.payment || 'efectivo').toString();
    let cashAccount = '1100';
    if (payment === 'transferencia') cashAccount = '1200';
    if (payment === 'credito') cashAccount = '1300';

    // Descripción / tipo
    const prodName = (sale.productName || '').toString();
    const eventName = (sale.eventName || '').toString();
    const courtesyTo = (sale.courtesyTo || '').toString().trim();

    const baseParts = [];
    if (prodName) baseParts.push(prodName);
    if (sale && sale.seqId) baseParts.push('N° ' + sale.seqId);
    if (courtesyTo) baseParts.push('Para: ' + courtesyTo);
    const descripcionBase = baseParts.join(' | ');

    let descripcion = '';
    let tipoMovimiento = '';
    if (isCourtesy) {
      descripcion = 'Cortesía POS' + (descripcionBase ? (' - ' + descripcionBase) : '');
      tipoMovimiento = 'egreso';
    } else if (isReturn) {
      descripcion = 'Devolución POS - ' + (descripcionBase || '');
      tipoMovimiento = 'ajuste';
    } else {
      descripcion = 'Venta POS - ' + (descripcionBase || '');
      tipoMovimiento = 'ingreso';
    }

    const evento = eventName || 'General';

    // Totales del asiento
    let totalsDebe = 0;
    let totalsHaber = 0;

    if (isCourtesy) {
      totalsDebe = amountCost;
      totalsHaber = amountCost;
    } else {
      totalsDebe = amount + amountCost;
      totalsHaber = amount + amountCost;
    }

    // --- Crear o actualizar el journalEntry (mismo origenId) ---
    let entryId = null;
    let existingEntry = null;

    await new Promise((resolve) => {
      const txRead = finDb.transaction(['journalEntries'], 'readonly');
      const store = txRead.objectStore('journalEntries');
      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        existingEntry = all.find(e => e && e.origen === 'POS' && e.origenId === saleId);
      };
      txRead.oncomplete = () => resolve();
      txRead.onerror = () => resolve();
    });

    await new Promise((resolve) => {
      const txWrite = finDb.transaction(['journalEntries'], 'readwrite');
      const storeWrite = txWrite.objectStore('journalEntries');

      if (existingEntry) {
        existingEntry.fecha = sale.date;
        existingEntry.date = sale.date;
        existingEntry.descripcion = descripcion;
        existingEntry.tipoMovimiento = tipoMovimiento;
        existingEntry.evento = evento;
        existingEntry.origen = 'POS';
        existingEntry.origenId = saleId;
        existingEntry.totalDebe = totalsDebe;
        existingEntry.totalHaber = totalsHaber;

        const reqPut = storeWrite.put(existingEntry);
        reqPut.onsuccess = () => { entryId = existingEntry.id; };
      } else {
        const entry = {
          fecha: sale.date,
          date: sale.date,
          descripcion,
          tipoMovimiento,
          evento,
          origen: 'POS',
          origenId: saleId,
          totalDebe: totalsDebe,
          totalHaber: totalsHaber
        };
        const reqAdd = storeWrite.add(entry);
        reqAdd.onsuccess = (ev) => { entryId = ev.target.result; };
      }

      txWrite.oncomplete = () => {
        if (!entryId && existingEntry && existingEntry.id != null) entryId = existingEntry.id;
        resolve();
      };
      txWrite.onerror = () => {
        console.error('Error guardando asiento automático desde POS');
        resolve();
      };
    });

    if (!entryId) {
      console.error('No se pudo determinar entryId para asiento automático POS');
      return;
    }

    // --- Borrar líneas anteriores de este asiento (evita duplicados) ---
    await new Promise((resolve) => {
      const txDel = finDb.transaction(['journalLines'], 'readwrite');
      const storeDel = txDel.objectStore('journalLines');
      const reqLines = storeDel.getAll();
      reqLines.onsuccess = () => {
        const lines = reqLines.result || [];
        lines
          .filter((l) => String(l.entryId) === String(entryId) || String(l.idEntry) === String(entryId))
          .forEach((l) => {
            try { storeDel.delete(l.id); } catch (err) {}
          });
      };
      txDel.oncomplete = () => resolve();
      txDel.onerror = () => resolve();
    });

    // --- Crear nuevas líneas ---
    await new Promise((resolve) => {
      const txLines = finDb.transaction(['journalLines'], 'readwrite');
      const storeLines = txLines.objectStore('journalLines');

      const addLine = (data) => {
        try {
          // Guardamos ambos campos: idEntry (lo que Finanzas espera) y entryId (compatibilidad)
          storeLines.add(Object.assign({ idEntry: entryId, entryId }, data));
        } catch (err) {
          console.error('Error guardando línea contable POS', err);
        }
      };

      if (isCourtesy) {
        // Cortesía: SOLO costo
        //   DEBE: 6105 POS Cortesía
        //   HABER: 1500 Inventario
        if (!isReturn) {
          if (amountCost > 0) {
            addLine({ accountCode: '6105', debe: amountCost, haber: 0 });
            addLine({ accountCode: '1500', debe: 0, haber: amountCost });
          }
        } else {
          // Reverso (por si alguna vez se usa):
          //   DEBE: 1500
          //   HABER: 6105
          if (amountCost > 0) {
            addLine({ accountCode: '1500', debe: amountCost, haber: 0 });
            addLine({ accountCode: '6105', debe: 0, haber: amountCost });
          }
        }

        txLines.oncomplete = () => resolve();
        txLines.onerror = () => resolve();
        return;
      }

      if (!isReturn) {
        // Venta normal:
        // Ingreso:
        //   DEBE: Caja/Banco/Clientes
        //   HABER: 4100 Ingresos
        if (amount > 0) {
          addLine({ accountCode: cashAccount, debe: amount, haber: 0 });
          addLine({ accountCode: '4100', debe: 0, haber: amount });
        }

        // Costo de venta (si hay costo disponible):
        //   DEBE: 5100 Costo de ventas
        //   HABER: 1500 Inventario
        if (amountCost > 0) {
          addLine({ accountCode: '5100', debe: amountCost, haber: 0 });
          addLine({ accountCode: '1500', debe: 0, haber: amountCost });
        }
      } else {
        // Devolución: asiento inverso
        if (amount > 0) {
          addLine({ accountCode: '4100', debe: amount, haber: 0 });
          addLine({ accountCode: cashAccount, debe: 0, haber: amount });
        }

        // Costo inverso:
        if (amountCost > 0) {
          addLine({ accountCode: '1500', debe: amountCost, haber: 0 });
          addLine({ accountCode: '5100', debe: 0, haber: amountCost });
        }
      }

      txLines.oncomplete = () => resolve();
      txLines.onerror = () => resolve();
    });
  } catch (err) {
    console.error('Error general creando/actualizando asiento automático desde POS', err);
  }
}

// Elimina asientos de Finanzas vinculados a una venta del POS (para Undo / eliminar)
async function deleteFinanzasEntriesForSalePOS(saleId) {
  // IMPORTANTE: esta función SIEMPRE debe devolver una Promise
  // para que el POS no se rompa al hacer: Promise.resolve(...).catch(...)
  if (saleId == null || saleId === '' || Number.isNaN(saleId)) return Promise.resolve();

  try {
    await ensureFinanzasDB();
  } catch (e) {
    // Si no se puede abrir finanzasDB, no bloqueamos el borrado de la venta
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    try {
      const txFin = finDb.transaction(['journalEntries', 'journalLines'], 'readwrite');
      const entriesStore = txFin.objectStore('journalEntries');
      const linesStore = txFin.objectStore('journalLines');

      const entriesReq = entriesStore.getAll();
      entriesReq.onsuccess = () => {
        const allEntries = entriesReq.result || [];
        const targets = allEntries.filter(e => e && e.origen === 'POS' && e.origenId === saleId);
        if (!targets.length) {
          // No hay nada que borrar, dejamos que la tx se complete sola
          return;
        }

        const linesReq = linesStore.getAll();
        linesReq.onsuccess = () => {
          const allLines = linesReq.result || [];
          targets.forEach(entry => {
            const relatedLines = allLines.filter(l => String(l.entryId) === String(entry.id) || String(l.idEntry) === String(entry.id));
            relatedLines.forEach(l => {
              try { linesStore.delete(l.id); } catch (err) {
                console.error('Error borrando línea contable POS', err);
              }
            });
            try { entriesStore.delete(entry.id); } catch (err) {
              console.error('Error borrando asiento automático POS', err);
            }
          });
        };
        linesReq.onerror = (e) => {
          console.error('Error leyendo líneas de diario para borrar asientos POS', e.target.error);
        };
      };
      entriesReq.onerror = (e) => {
        console.error('Error leyendo asientos para borrar por venta POS', e.target.error);
      };

      txFin.oncomplete = () => resolve();
      txFin.onerror = (e) => {
        console.error('Error en transacción de borrado de asientos POS', e.target.error);
        reject(e.target.error);
      };
    } catch (err) {
      console.error('Error general al eliminar asientos POS', err);
      resolve();
    }
  });
}


// ------------------------------
// POS → Finanzas: Caja Chica (movimientos manuales)
// ------------------------------
async function ensureFinanzasPettyCashAccounts(preferredIncomeCode){
  try{
    await ensureFinanzasDB();
  }catch(e){
    return;
  }
  return new Promise((resolve)=>{
    try{
      const txa = finDb.transaction(['accounts'], 'readwrite');
      const store = txa.objectStore('accounts');
      const req = store.getAll();
      req.onsuccess = ()=>{
        const all = req.result || [];
        const has = new Set(all.map(a => String(a && a.code || '')));
        const reqAccounts = [
          { code: '1100', nombre: 'Caja general', tipo: 'activo', systemProtected: true },
          { code: '1110', nombre: 'Caja eventos', tipo: 'activo', systemProtected: true },
          { code: '1200', nombre: 'Banco', tipo: 'activo', systemProtected: true },
          { code: '6100', nombre: 'Gastos de eventos – generales', tipo: 'gasto', systemProtected: true },
          { code: '6130', nombre: 'Gastos varios / ajuste caja', tipo: 'gasto', systemProtected: true },
        ];
        // Ingreso/reposición (si hace falta)
        if (preferredIncomeCode === '4200' && !has.has('4200')){
          reqAccounts.push({ code: '4200', nombre: 'Otros ingresos / reposición caja', tipo: 'ingreso', systemProtected: true });
        }
        for (const acc of reqAccounts){
          if (!has.has(String(acc.code))) store.put(acc);
        }
      };
      txa.oncomplete = ()=>resolve();
      txa.onerror = ()=>resolve();
      txa.onabort = ()=>resolve();
    }catch(err){
      resolve();
    }
  });
}

async function resolvePettyCashIncomeAccountCode(){
  try{
    await ensureFinanzasDB();
  }catch(e){
    return '4200';
  }
  return new Promise((resolve)=>{
    let chosen = null;
    try{
      const txa = finDb.transaction(['accounts'], 'readwrite');
      const store = txa.objectStore('accounts');
      const req = store.getAll();
      req.onsuccess = ()=>{
        const all = req.result || [];
        const hasCode = (c)=> all.some(a => a && String(a.code) === c);
        // Preferir 7100 (suele ser "Otros ingresos varios") si existe, sino 4200.
        if (hasCode('7100')) chosen = '7100';
        else if (hasCode('4200')) chosen = '4200';
        else {
          const byName = all.find(a => {
            const name = String(a && (a.nombre || a.name) || '').toLowerCase();
            return name.includes('otros ingresos') || name.includes('reposición') || name.includes('reposicion') || name.includes('aporte') || name.includes('reembolso');
          });
          if (byName && byName.code != null) chosen = String(byName.code);
          else {
            chosen = '4200';
            store.put({ code: '4200', nombre: 'Otros ingresos / reposición caja', tipo: 'ingreso', systemProtected: true });
          }
        }
      };
      txa.oncomplete = ()=>resolve(chosen || '4200');
      txa.onerror = ()=>resolve(chosen || '4200');
      txa.onabort = ()=>resolve(chosen || '4200');
    }catch(err){
      resolve(chosen || '4200');
    }
  });
}

async function postPettyCashMovementToFinanzas(eventId, dayKey, mov){
  if (!eventId || !mov) return;

  const mvDate = String(mov.date || dayKey || '').slice(0,10);
  const stamp = (mov.createdAt != null) ? mov.createdAt : (mov.id != null ? mov.id : Date.now());
  const sourceId = `pc_${eventId}_${mvDate}_${stamp}`;

  // Abrir Finanzas (best-effort)
  try{
    await ensureFinanzasDB();
  }catch(e){
    return;
  }

  // Anti-duplicados (source/sourceId)
  const exists = await new Promise((resolve)=>{
    try{
      const txr = finDb.transaction(['journalEntries'], 'readonly');
      const store = txr.objectStore('journalEntries');
      const req = store.getAll();
      req.onsuccess = ()=>{
        const all = req.result || [];
        const ok = all.some(e => e && (
          (e.source === 'pos_pettycash' && e.sourceId === sourceId) ||
          (e.origen === 'POS' && e.origenId === sourceId) ||
          (e.source === 'pos_pettycash' && e.origenId === sourceId)
        ));
        resolve(ok);
      };
      req.onerror = ()=>resolve(false);
    }catch(err){
      resolve(false);
    }
  });
  if (exists) return;

  // Evento (nombre + fxRate)
  let eventName = 'Evento';
  let fxRate = null;
  try{
    const evs = await getAll('events');
    const ev = (evs || []).find(e => e && e.id === eventId);
    if (ev){
      eventName = (ev.name || ev.nombre || ev.title || ev.eventName || eventName);
      const fx = Number(ev.fxRate);
      if (Number.isFinite(fx) && fx > 0) fxRate = fx;
    }
  }catch(e){}

  // Monto en C$ (Finanzas está en C$)
  const amountOrig = Number(mov.amount) || 0;
  if (!Number.isFinite(amountOrig) || amountOrig <= 0) return;

  let amountNio = amountOrig;
  let fxUsed = null;
  if (mov.currency === 'USD'){
    if (!fxRate){
      notifyFinanzasBridge('⚠️ Movimiento guardado en POS, pero NO se registró en Finanzas: falta Tipo de Cambio del evento para convertir USD a C$.');
      return;
    }
    fxUsed = fxRate;
    amountNio = round2(amountOrig * fxRate);
  }
  amountNio = round2(amountNio);
  if (!Number.isFinite(amountNio) || amountNio <= 0) return;

  const incomeCode = await resolvePettyCashIncomeAccountCode();
  await ensureFinanzasPettyCashAccounts(incomeCode);

  // Mapeo contable DEFAULT fijo
  const cashEvents = '1110';
  const cashGeneral = '1100';
  const bank = '1200';
  const expenseEvents = '6100';
  const adjustExpense = '6130';

  const isTransfer = !!mov.isTransfer || mov.uiType === 'transferencia';
  const isAdjust = !!mov.isAdjust;

  let tipoMovimiento = 'egreso';
  let debeCode = expenseEvents;
  let haberCode = cashEvents;
  let kindTag = 'EGRESO';

  if (isTransfer){
    tipoMovimiento = 'transferencia';
    kindTag = 'TRANSFERENCIA';
    const tk = mov.transferKind || 'to_bank';
    if (tk === 'from_general'){
      debeCode = cashEvents;
      haberCode = cashGeneral;
    } else if (tk === 'to_general'){
      debeCode = cashGeneral;
      haberCode = cashEvents;
    } else {
      debeCode = bank;
      haberCode = cashEvents;
    }
  } else if (isAdjust){
    tipoMovimiento = 'ajuste';
    if (mov.type === 'entrada'){
      kindTag = 'AJUSTE SOBRANTE';
      debeCode = cashEvents;
      haberCode = incomeCode;
    } else {
      kindTag = 'AJUSTE FALTANTE';
      debeCode = adjustExpense;
      haberCode = cashEvents;
    }
  } else if (mov.type === 'entrada'){
    tipoMovimiento = 'ingreso';
    kindTag = 'INGRESO';
    debeCode = cashEvents;
    haberCode = incomeCode;
  } else {
    tipoMovimiento = 'egreso';
    kindTag = 'EGRESO';
    debeCode = expenseEvents;
    haberCode = cashEvents;
  }

  // Memo / descripción
  let desc = String(mov.description || '').trim();
  if (mov.currency === 'USD' && fxUsed){
    desc = `${desc} (USD ${round2(amountOrig)} @ ${round2(fxUsed)} = C$ ${amountNio.toFixed(2)})`;
  }
  const memo = `[POS Caja Chica] ${kindTag} - ${desc || '—'} - ${eventName} - ${mvDate}`;

  // Crear asiento + líneas (doble partida)
  await new Promise((resolve)=>{
    try{
      const txw = finDb.transaction(['journalEntries','journalLines'], 'readwrite');
      const eStore = txw.objectStore('journalEntries');
      const lStore = txw.objectStore('journalLines');

      const entry = {
        fecha: mvDate,
        date: mvDate,
        tipoMovimiento,
        descripcion: memo,
        evento: eventName,
        origen: 'POS',
        origenId: sourceId,
        source: 'pos_pettycash',
        sourceId,
        debeCode,
        haberCode,
        monto: amountNio,
        totalDebe: amountNio,
        totalHaber: amountNio,
        createdAt: Date.now(),
        meta: {
          posEventId: eventId,
          posDay: mvDate,
          posMovement: {
            id: mov.id,
            createdAt: mov.createdAt,
            uiType: mov.uiType,
            type: mov.type,
            isAdjust: !!mov.isAdjust,
            adjustKind: mov.adjustKind || null,
            isTransfer: !!mov.isTransfer,
            transferKind: mov.transferKind || null,
            currency: mov.currency || 'NIO',
            amount: amountOrig,
            fxRateUsed: fxUsed
          }
        }
      };

      const reqAdd = eStore.add(entry);
      reqAdd.onsuccess = (ev)=>{
        const entryId = ev.target.result;
        try{
          lStore.add({ idEntry: entryId, accountCode: debeCode, debe: amountNio, haber: 0 });
          lStore.add({ idEntry: entryId, accountCode: haberCode, debe: 0, haber: amountNio });
        }catch(e){}
      };
      reqAdd.onerror = ()=>{};

      txw.oncomplete = ()=>resolve();
      txw.onerror = ()=>resolve();
      txw.onabort = ()=>resolve();
    }catch(err){
      resolve();
    }
  });

  // Aviso discreto (solo si Finanzas está disponible)
  // notifyFinanzasBridge('Movimiento registrado en Finanzas (Diario)');
}

function tx(name, mode='readonly'){ return db.transaction(name, mode).objectStore(name); }
function getAll(name){ return new Promise((res,rej)=>{ const r=tx(name).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function put(name, val){ return new Promise((res,rej)=>{ const r=tx(name,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(name, key){
  // Borrado robusto (especialmente para 'sales'):
  // - Evita TransactionInactiveError (no dejamos una tx abierta esperando promesas externas)
  // - Nunca "resuelve en silencio" si no pudo borrar
  // - Devuelve { ok:true, warnings:[] } cuando aplica
  return new Promise((resolve, reject) => {
    try{
      if (name !== 'sales'){
        const store = tx(name,'readwrite');
        const r = store.delete(key);
        r.onsuccess = ()=>resolve({ok:true, warnings:[]});
        r.onerror = ()=>reject(r.error);
        return;
      }

      // helpers locales
      const idbGet = (storeName, k) => new Promise((res, rej) => {
        try{
          const st = tx(storeName);
          const r = st.get(k);
          r.onsuccess = ()=>res(r.result);
          r.onerror = ()=>rej(r.error);
        }catch(err){ rej(err); }
      });

      const idbDelete = (storeName, k) => new Promise((res, rej) => {
        try{
          const t = db.transaction([storeName], 'readwrite');
          const st = t.objectStore(storeName);
          try{ st.delete(k); } catch (err){ rej(err); return; }
          t.oncomplete = ()=>res();
          t.onerror = (e)=>rej(t.error || e.target?.error || new Error('Error eliminando registro en ' + storeName));
          t.onabort = (e)=>rej(t.error || e.target?.error || new Error('Transacción abortada eliminando registro en ' + storeName));
        }catch(err){ rej(err); }
      });

      (async ()=>{
        const warnings = [];

        // 1) Traer la venta (fuera de cualquier tx de borrado)
        const sale = await idbGet('sales', key);

        if (!sale){
          // Si no existe, intentamos borrar de todas formas (por si el key es string/number mismatch),
          // y reportamos que ya estaba ausente.
          try{
            await idbDelete('sales', key);
          }catch(err){
            throw err;
          }
          return resolve({ok:true, warnings: ['La venta no se encontró (posible ya estaba eliminada).']});
        }

        // 2) Borrar la venta primero (objetivo principal). Si falla, no hacemos side-effects.
        await idbDelete('sales', key);

        // 2.1) Verificación rápida (mejor error que "parece que borró")
        try{
          const still = await idbGet('sales', key);
          if (still){
            throw new Error('La venta no se pudo eliminar (el registro sigue existiendo).');
          }
        }catch(verErr){
          // Si falla la verificación por lectura, no bloqueamos: solo advertimos.
          console.warn('No se pudo verificar el borrado de la venta', verErr);
        }

        // 3) Side-effects (no bloquean el borrado): revertir inventario central + borrar asientos en Finanzas
        try{
          applyFinishedFromSalePOS(sale, -1);
        }catch(e){
          console.error('Error revertiendo inventario central al eliminar venta', e);
          warnings.push('No se pudo revertir inventario central (la venta sí se eliminó).');
        }

        // Revertir consumo de vasos (FIFO) si esta venta/cortesía fue por vaso
        try{
          await revertCupConsumptionFromSalePOS(sale);
        }catch(e){
          console.error('Error revertiendo vasos al eliminar venta', e);
          warnings.push('No se pudieron revertir vasos de sangría (la venta sí se eliminó).');
        }

        try{
          const saleId = (sale.id != null) ? sale.id : key;
          await Promise.resolve(deleteFinanzasEntriesForSalePOS(saleId));
        }catch(e){
          console.error('Error eliminando asientos contables vinculados a la venta', e);
          warnings.push('No se pudieron eliminar asientos en Finanzas (la venta sí se eliminó).');
        }

        resolve({ok:true, warnings});
      })().catch(err=>{
        console.error('Error en del("sales")', err);
        reject(err);
      });
    }catch(err){
      console.error('Error general en del()', err);
      reject(err);
    }
  });
}


async function setMeta(key, value){ 
  return put('meta', {id:key, value});
}
async function getMeta(key){ 
  const all = await getAll('meta');
  const row = all.find(x=>x.id===key);
  return row ? row.value : null;
}

const LAST_GROUP_KEY = 'a33_pos_lastGroupName';
const HIDDEN_GROUPS_KEY = 'a33_pos_hiddenGroups';

function getLastGroupName() {
  try {
    return A33Storage.getItem(LAST_GROUP_KEY) || '';
  } catch (e) {
    return '';
  }
}

function setLastGroupName(name) {
  try {
    A33Storage.setItem(LAST_GROUP_KEY, name || '');
  } catch (e) {
    console.warn('No se pudo guardar último grupo usado', e);
  }
}

function getHiddenGroups() {
  try {
    const raw = A33Storage.getItem(HIDDEN_GROUPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.warn('No se pudieron leer grupos ocultos', e);
    return [];
  }
}

function setHiddenGroups(list) {
  try {
    const clean = Array.from(new Set((list || []).filter(Boolean)));
    A33Storage.setItem(HIDDEN_GROUPS_KEY, JSON.stringify(clean));
  } catch (e) {
    console.warn('No se pudieron guardar grupos ocultos', e);
  }
}

// --- Caja Chica: helpers y denominaciones
const NIO_DENOMS = [1,5,10,20,50,100,200,500,1000];
const USD_DENOMS = [1,5,10,20,50,100];

function normalizePettySection(section){
  const nio = {};
  const usd = {};

  NIO_DENOMS.forEach(d=>{
    const k = String(d);
    const v = section && section.nio && section.nio[k];
    const num = Number(v);
    nio[k] = (!Number.isFinite(num) || num < 0) ? 0 : num;
  });

  USD_DENOMS.forEach(d=>{
    const k = String(d);
    const v = section && section.usd && section.usd[k];
    const num = Number(v);
    usd[k] = (!Number.isFinite(num) || num < 0) ? 0 : num;
  });

  const totalNio = NIO_DENOMS.reduce((sum,d)=> sum + d * (nio[String(d)]||0), 0);
  const totalUsd = USD_DENOMS.reduce((sum,d)=> sum + d * (usd[String(d)]||0), 0);

  return {
    nio,
    usd,
    totalNio,
    totalUsd,
    savedAt: section && section.savedAt ? section.savedAt : null
  };
}


async function getPettyCash(eventId){
  if (eventId == null) return null;
  if (!db) await openDB();

  return new Promise((resolve)=>{
    try{
      const store = tx('pettyCash','readonly');
      const req = store.get(eventId);
      req.onsuccess = ()=>{
        const pc = coercePettyCashRecord(eventId, req.result);
        resolve(pc);
      };
      req.onerror = ()=>{
        console.warn('Error leyendo pettyCash', req.error);
        resolve(coercePettyCashRecord(eventId, null));
      };
    }catch(err){
      console.error('Error getPettyCash', err);
      resolve(coercePettyCashRecord(eventId, null));
    }
  });
}

function coercePettyCashRecord(eventId, raw){
  const base = { eventId, version: 2, days: {} };
  if (!raw || typeof raw !== 'object') return base;

  // Esquema nuevo
  if (raw.days && typeof raw.days === 'object'){
    const pc = { eventId, version: 2, days: {} };
    for (const k in raw.days){
      if (!raw.days[k]) continue;
      const dayKey = normalizePcDayKey(k, raw.days[k]);
      if (!dayKey) continue;
      const norm = normalizePettyDay(raw.days[k]);
      pc.days[dayKey] = pc.days[dayKey] ? mergePettyDay(pc.days[dayKey], norm) : norm;
    }
    return pc;
  }

  // Esquema legado (una sola caja por evento)
  const legacyInitial = normalizePettySection(raw.initial || null);
  const legacyMovs = Array.isArray(raw.movements) ? raw.movements.slice() : [];
  const legacyFinal = raw.finalCount ? normalizePettySection(raw.finalCount) : null;

  const guessedDay = guessPettyDayKey({ initial: legacyInitial, movements: legacyMovs, finalCount: legacyFinal });
  base.days[guessedDay] = {
    initial: legacyInitial,
    movements: legacyMovs,
    finalCount: legacyFinal
  };

  return base;
}

function normalizePettyDay(day){
  const initial = day && day.initial ? normalizePettySection(day.initial) : normalizePettySection(null);
  const movements = Array.isArray(day && day.movements) ? day.movements.slice() : [];
  const finalCount = (day && day.finalCount) ? normalizePettySection(day.finalCount) : null;

  const fxRaw = (day && day.fxRate != null) ? Number(day.fxRate) : NaN;
  const fxRate = (Number.isFinite(fxRaw) && fxRaw > 0) ? fxRaw : null;

  const closedAt = (day && typeof day.closedAt === 'string' && day.closedAt.trim()) ? day.closedAt : null;

  const arqueoAdjust = normalizeArqueoAdjust(day && day.arqueoAdjust);

  return { initial, movements, finalCount, fxRate, closedAt, arqueoAdjust };
}

function round2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function moneyEquals(a, b){
  return Math.round(Number(a || 0) * 100) === Math.round(Number(b || 0) * 100);
}

function normalizeArqueoAdjust(adj){
  const out = { NIO: null, USD: null };
  const one = (a)=>{
    if (!a || typeof a !== 'object') return null;
    const amt = Number(a.amount);
    if (!Number.isFinite(amt) || Math.abs(amt) < 0.005) return null;

    // Compat: reason -> concept, note -> notes
    const concept = (a.concept != null ? a.concept : (a.reason || '')).toString().trim();
    if (!concept) return null;

    const notes = (a.notes != null ? a.notes : (a.note || '')).toString().trim();
    const createdAt = (typeof a.createdAt === 'string' && a.createdAt.trim()) ? a.createdAt : null;

    return { amount: round2(amt), concept, notes, createdAt };
  };
  out.NIO = one(adj && adj.NIO);
  out.USD = one(adj && adj.USD);
  return out;
}

function safeYMD(s){
  if (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return todayYMD();
}

function guessPettyDayKey(obj){
  const tryIso = (iso)=>{
    if (!iso || typeof iso !== 'string') return null;
    const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
  };
  const f = obj && obj.finalCount && obj.finalCount.savedAt ? tryIso(obj.finalCount.savedAt) : null;
  if (f) return f;
  const i = obj && obj.initial && obj.initial.savedAt ? tryIso(obj.initial.savedAt) : null;
  if (i) return i;
  if (obj && Array.isArray(obj.movements)){
    const mm = obj.movements.find(x => x && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
    if (mm) return mm.date;
  }
  return todayYMD();
}


function normalizePcDayKey(key, dayObj){
  // Preferimos NO convertir llaves inválidas a "hoy" porque eso puede sobrescribir (colisión)
  // y perder datos (ej: arqueoAdjust recién guardado).
  if (typeof key === 'string'){
    const t = key.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;

    // ISO prefix: 2025-12-21T...
    const m = t.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];

    // dd/mm/yyyy o dd-mm-yyyy
    const m2 = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m2){
      const dd = String(m2[1]).padStart(2,'0');
      const mm = String(m2[2]).padStart(2,'0');
      const yy = String(m2[3]).padStart(4,'0');
      const ymd = `${yy}-${mm}-${dd}`;
      if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    }
  }

  // Fallback: intentar adivinar según contenido del día
  const g = guessPettyDayKey(dayObj || {});
  if (typeof g === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g)) return g;

  return null;
}

function mergePettyMovements(a, b){
  const A = Array.isArray(a) ? a : [];
  const B = Array.isArray(b) ? b : [];
  const out = [];
  const seen = new Set();

  const keyOf = (m)=>{
    if (!m || typeof m !== 'object') return '';
    if (m.id != null) return `id:${m.id}`;
    const d = (m.date || '').toString();
    const t = (m.time || '').toString();
    const ty = (m.type || '').toString();
    const cur = (m.currency || '').toString();
    const amt = String(m.amount != null ? m.amount : '');
    const desc = (m.desc || m.description || m.concept || m.reason || '').toString();
    const ca = (m.createdAt || m.ts || '').toString();
    return `${d}|${t}|${ty}|${cur}|${amt}|${desc}|${ca}`.trim();
  };

  const push = (m)=>{
    const k = keyOf(m);
    if (k && seen.has(k)) return;
    if (k) seen.add(k);
    out.push(m);
  };

  A.forEach(push);
  B.forEach(push);
  return out;
}

function mergePettyDay(dayA, dayB){
  const a = normalizePettyDay(dayA || {});
  const b = normalizePettyDay(dayB || {});

  // Initial: preferir el que tenga savedAt
  if (!a.initial?.savedAt && b.initial?.savedAt) a.initial = b.initial;

  // Final: preferir el más reciente si ambos existen
  const aF = a.finalCount?.savedAt ? a.finalCount.savedAt : null;
  const bF = b.finalCount?.savedAt ? b.finalCount.savedAt : null;
  if (!aF && bF) a.finalCount = b.finalCount;
  else if (aF && bF){
    try{
      if (new Date(bF).getTime() > new Date(aF).getTime()) a.finalCount = b.finalCount;
    }catch(e){}
  }

  // fxRate / closedAt: preferir el existente, o el nuevo si el anterior falta
  if (a.fxRate == null && b.fxRate != null) a.fxRate = b.fxRate;
  if (!a.closedAt && b.closedAt) a.closedAt = b.closedAt;

  // Movements: unir y deduplicar
  a.movements = mergePettyMovements(a.movements, b.movements);

  // Ajuste de arqueo: por moneda, preferir el que exista; si existen ambos, preferir el más reciente
  if (!a.arqueoAdjust) a.arqueoAdjust = { NIO: null, USD: null };
  const pickAdj = (x, y)=>{
    if (!x && y) return y;
    if (x && !y) return x;
    if (!x && !y) return null;
    // ambos: preferir el más reciente por createdAt si se puede
    const xc = x.createdAt ? x.createdAt : '';
    const yc = y.createdAt ? y.createdAt : '';
    try{
      if (xc && yc && new Date(yc).getTime() > new Date(xc).getTime()) return y;
    }catch(e){}
    return x;
  };
  const bAdj = b.arqueoAdjust || {};
  a.arqueoAdjust.NIO = pickAdj(a.arqueoAdjust.NIO, bAdj.NIO || null);
  a.arqueoAdjust.USD = pickAdj(a.arqueoAdjust.USD, bAdj.USD || null);

  return a;
}

async function savePettyCash(pc){
  // IMPORTANTE: esta función debe FALLAR si no se pudo persistir en IndexedDB.
  // Antes resolvía “silenciosamente” en error y eso hacía que “Cerrar día” pareciera funcionar,
  // pero al recargar seguía “Día abierto” (closedAt null).
  if (!pc || pc.eventId == null) throw new Error('pettyCash inválido');
  if (!db) await openDB();

  // Normalizar / limpiar para evitar basura y mantener esquema estable
  const cleaned = { eventId: pc.eventId, version: 2, days: {} };

  const days = pc.days && typeof pc.days === 'object' ? pc.days : {};
  for (const k in days){
    const dayKey = normalizePcDayKey(k, days[k]);
    if (!dayKey) continue;
    const norm = normalizePettyDay(days[k]);
    cleaned.days[dayKey] = cleaned.days[dayKey] ? mergePettyDay(cleaned.days[dayKey], norm) : norm;
  }

  const putOnce = () => new Promise((resolve, reject)=>{
    // Resolver SOLO cuando el put confirmó (tx.oncomplete) y fallar ante cualquier error.
    let settled = false;
    const ok = ()=>{ if (settled) return; settled = true; resolve(); };
    const fail = (err)=>{ if (settled) return; settled = true; reject(err); };

    try{
      const tr = db.transaction('pettyCash', 'readwrite');
      const store = tr.objectStore('pettyCash');

      tr.oncomplete = ()=> ok();
      tr.onabort = ()=> fail(tr.error || new Error('Transacción abortada (pettyCash).'));
      tr.onerror = ()=> fail(tr.error || new Error('Error de transacción (pettyCash).'));

      const req = store.put(cleaned);
      req.onerror = ()=> {
        // Rechazo inmediato (sin “swallow errors”).
        console.error('Error guardando pettyCash (put)', req.error);
        try{ tr.abort(); }catch(e){}
        fail(req.error || new Error('Error guardando pettyCash (put).'));
      };
    }catch(err){
      fail(err);
    }
  });

  try{
    await putOnce();
  }catch(err){
    // Si la BD estaba cerrada / en estado inválido, reabrimos y reintentamos una vez.
    const name = (err && err.name) ? err.name : '';
    if (name === 'InvalidStateError' || name === 'TransactionInactiveError'){
      try{
        db = null;
        await openDB();
        await putOnce();
        return;
      }catch(e2){
        throw e2;
      }
    }
    throw err;
  }
}

function ensurePcDay(pc, dayKey){
  if (!pc) return null;
  if (!pc.days || typeof pc.days !== 'object') pc.days = {};
  const dk = safeYMD(dayKey);
  if (!pc.days[dk]){
    pc.days[dk] = {
      initial: normalizePettySection(null),
      movements: [],
      finalCount: null,
      fxRate: null,
      closedAt: null,
      arqueoAdjust: { NIO: null, USD: null }
    };
  } else {
    pc.days[dk] = normalizePettyDay(pc.days[dk]);
    if (!pc.days[dk].arqueoAdjust) pc.days[dk].arqueoAdjust = { NIO: null, USD: null };
  }
  return pc.days[dk];
}

function listPcDayKeys(pc){
  if (!pc || !pc.days || typeof pc.days !== 'object') return [];
  const keys = Object.keys(pc.days).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  keys.sort();
  return keys;
}

function findPrevDayWithFinal(pc, dayKey){
  const dk = safeYMD(dayKey);

  // 1) Ayer literal
  const y = ymdPrev(dk);
  const dy = pc && pc.days ? pc.days[y] : null;
  if (dy && dy.finalCount && dy.finalCount.savedAt) return y;

  // 2) Último día anterior con final
  const keys = listPcDayKeys(pc).filter(k => k < dk);
  for (let i = keys.length - 1; i >= 0; i--){
    const k = keys[i];
    const d = pc.days[k];
    if (d && d.finalCount && d.finalCount.savedAt) return k;
  }
  return null;
}

function hasAnyPettyMovements(pc){
  if (!pc) return false;
  if (pc.days && typeof pc.days === 'object'){
    for (const k in pc.days){
      const d = pc.days[k];
      if (d && Array.isArray(d.movements) && d.movements.length) return true;
    }
    return false;
  }
  return Array.isArray(pc.movements) && pc.movements.length > 0;
}

function hasAnyPettyFinal(pc){
  if (!pc) return false;
  if (pc.days && typeof pc.days === 'object'){
    for (const k in pc.days){
      const d = pc.days[k];
      if (d && d.finalCount && d.finalCount.savedAt) return true;
    }
    return false;
  }
  return !!(pc.finalCount && pc.finalCount.savedAt);
}

function computePettyCashSummary(pc, dayKey, opts){
  const base = {
    nio: { initial:0, entradas:0, salidas:0, ventasEfectivo:0, teorico:0, final:null, diferencia:null },
    usd: { initial:0, entradas:0, salidas:0, teorico:0, final:null, diferencia:null }
  };
  opts = opts || {};
  if (!pc) return base;

  const cashSalesDay = Number(opts.cashSalesNio || 0);
  const cashSalesTotal = Number(opts.cashSalesNioTotal || 0);

  // Fallback legado (por si algún registro viejo se cuela)
  if (!pc.days || typeof pc.days !== 'object'){
    const initial = pc.initial ? normalizePettySection(pc.initial) : normalizePettySection(null);
    const finalCount = pc.finalCount ? normalizePettySection(pc.finalCount) : null;

    const res = {
      nio: { initial: initial.totalNio || 0, entradas: 0, salidas: 0, ventasEfectivo: cashSalesTotal, teorico: 0, final: finalCount ? (finalCount.totalNio || 0) : null, diferencia: null },
      usd: { initial: initial.totalUsd || 0, entradas: 0, salidas: 0, teorico: 0, final: finalCount ? (finalCount.totalUsd || 0) : null, diferencia: null }
    };

    if (Array.isArray(pc.movements)){
      for (const m of pc.movements){
        if (!m || typeof m.amount === 'undefined') continue;
        const amt = Number(m.amount) || 0;
        if (!amt) continue;

        const target = (m.currency === 'NIO') ? res.nio : (m.currency === 'USD') ? res.usd : null;
        if (!target) continue;

        if (m.type === 'entrada') target.entradas += amt;
        else if (m.type === 'salida') target.salidas += amt;
      }
    }

    res.nio.teorico = res.nio.initial + res.nio.entradas - res.nio.salidas + (res.nio.ventasEfectivo || 0);
    res.usd.teorico = res.usd.initial + res.usd.entradas - res.usd.salidas;

    if (res.nio.final != null) res.nio.diferencia = res.nio.final - res.nio.teorico;
    if (res.usd.final != null) res.usd.diferencia = res.usd.final - res.usd.teorico;

    return res;
  }

  // Resumen por día
  if (dayKey){
    const day = ensurePcDay(pc, dayKey);
    const initial = day.initial ? normalizePettySection(day.initial) : normalizePettySection(null);
    const finalCount = day.finalCount ? normalizePettySection(day.finalCount) : null;

    const res = {
      nio: { initial: initial.totalNio || 0, entradas: 0, salidas: 0, ventasEfectivo: cashSalesDay, teorico: 0, final: finalCount ? (finalCount.totalNio || 0) : null, diferencia: null },
      usd: { initial: initial.totalUsd || 0, entradas: 0, salidas: 0, teorico: 0, final: finalCount ? (finalCount.totalUsd || 0) : null, diferencia: null }
    };

    if (Array.isArray(day.movements)){
      for (const m of day.movements){
        if (!m || typeof m.amount === 'undefined') continue;
        const amt = Number(m.amount) || 0;
        if (!amt) continue;

        const target = (m.currency === 'NIO') ? res.nio : (m.currency === 'USD') ? res.usd : null;
        if (!target) continue;

        if (m.type === 'entrada') target.entradas += amt;
        else if (m.type === 'salida') target.salidas += amt;
      }
    }

    res.nio.teorico = res.nio.initial + res.nio.entradas - res.nio.salidas + (res.nio.ventasEfectivo || 0);
    res.usd.teorico = res.usd.initial + res.usd.entradas - res.usd.salidas;

    if (res.nio.final != null) res.nio.diferencia = res.nio.final - res.nio.teorico;
    if (res.usd.final != null) res.usd.diferencia = res.usd.final - res.usd.teorico;

    return res;
  }

  // Resumen del evento: inicial del primer día, movimientos acumulados, final del último día con arqueo
  const keys = listPcDayKeys(pc);
  if (!keys.length) return base;

  // Inicial: primer día con savedAt o el primer día existente
  let firstKey = keys[0];
  for (const k of keys){
    const d = pc.days[k];
    if (d && d.initial && d.initial.savedAt){
      firstKey = k;
      break;
    }
  }
  const firstDay = ensurePcDay(pc, firstKey);
  const initSec = firstDay.initial ? normalizePettySection(firstDay.initial) : normalizePettySection(null);

  // Final: último día con arqueo final guardado
  let lastFinalKey = null;
  for (let i = keys.length - 1; i >= 0; i--){
    const k = keys[i];
    const d = pc.days[k];
    if (d && d.finalCount && d.finalCount.savedAt){
      lastFinalKey = k;
      break;
    }
  }
  const finSec = lastFinalKey ? normalizePettySection(ensurePcDay(pc, lastFinalKey).finalCount) : null;

  let entradasNio = 0, salidasNio = 0, entradasUsd = 0, salidasUsd = 0;
  for (const k of keys){
    const day = ensurePcDay(pc, k);
    if (!Array.isArray(day.movements)) continue;
    for (const m of day.movements){
      const amt = Number(m.amount) || 0;
      if (!amt) continue;
      if (m.currency === 'NIO'){
        if (m.type === 'entrada') entradasNio += amt;
        else if (m.type === 'salida') salidasNio += amt;
      } else if (m.currency === 'USD'){
        if (m.type === 'entrada') entradasUsd += amt;
        else if (m.type === 'salida') salidasUsd += amt;
      }
    }
  }

  const res = {
    nio: { initial: initSec.totalNio || 0, entradas: entradasNio, salidas: salidasNio, ventasEfectivo: cashSalesTotal, teorico: 0, final: finSec ? (finSec.totalNio || 0) : null, diferencia: null },
    usd: { initial: initSec.totalUsd || 0, entradas: entradasUsd, salidas: salidasUsd, teorico: 0, final: finSec ? (finSec.totalUsd || 0) : null, diferencia: null }
  };

  res.nio.teorico = res.nio.initial + res.nio.entradas - res.nio.salidas + (res.nio.ventasEfectivo || 0);
  res.usd.teorico = res.usd.initial + res.usd.entradas - res.usd.salidas;

  if (res.nio.final != null) res.nio.diferencia = res.nio.final - res.nio.teorico;
  if (res.usd.final != null) res.usd.diferencia = res.usd.final - res.usd.teorico;

  return res;
}

function ymdFromDate(dt){
  const y = dt.getFullYear();
  const m = String(dt.getMonth()+1).padStart(2,'0');
  const d = String(dt.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}
function todayYMD(){
  return ymdFromDate(new Date());
}
function dateFromYMD(ymd){
  const parts = (ymd || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(n=>!Number.isFinite(n))) return new Date();
  return new Date(parts[0], parts[1]-1, parts[2]);
}
function ymdPrev(ymd){
  const dt = dateFromYMD(ymd);
  dt.setDate(dt.getDate() - 1);
  return ymdFromDate(dt);
}


// Normalizar nombres
function normName(s){ return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }

const RECETAS_KEY = 'arcano33_recetas_v1';

const STORAGE_KEY_INVENTARIO = 'arcano33_inventario';

function invParseNumberPOS(value){
  const n = parseFloat(String(value).replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}
function invCentralDefaultPOS(){
  return {
    liquids: {},
    bottles: {},
    finished: {
      pulso: { stock: 0 },
      media: { stock: 0 },
      djeba: { stock: 0 },
      litro: { stock: 0 },
      galon: { stock: 0 },
    },
  };
}
function invCentralLoadPOS(){
  try{
    const raw = A33Storage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== 'object') data = invCentralDefaultPOS();
    if (!data.liquids) data.liquids = {};
    if (!data.bottles) data.bottles = {};
    if (!data.finished) data.finished = {};
    ['pulso','media','djeba','litro','galon'].forEach((id)=>{
      if (!data.finished[id]) data.finished[id] = { stock: 0 };
      const info = data.finished[id];
      if (typeof info.stock !== 'number') info.stock = invParseNumberPOS(info.stock||0);
    });
    return data;
  }catch(e){
    console.warn('Error leyendo inventario central', e);
    return invCentralDefaultPOS();
  }
}
function invCentralSavePOS(inv){
  try{
    A33Storage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
  }catch(e){
    console.warn('Error guardando inventario central', e);
  }
}
function mapProductNameToFinishedId(name){
  const n = (name||'').toString().toLowerCase();
  if (n.includes('pulso') && n.includes('250')) return 'pulso';
  if (n.includes('media') && n.includes('375')) return 'media';
  if (n.includes('djeba') && n.includes('750')) return 'djeba';
  if (n.includes('litro') && n.includes('1000')) return 'litro';
  if (n.includes('gal') && (n.includes('3800') || n.includes('galon') || n.includes('galón'))) return 'galon';
  return null;
}
function applyFinishedFromSalePOS(sale, direction){
  try{
    const dir = direction === -1 ? -1 : 1;
    const productName = sale.productName || '';
    const finishedId = mapProductNameToFinishedId(productName);
    if (!finishedId) return;
    const q = typeof sale.qty === 'number' ? sale.qty : parseFloat(sale.qty||'0');
    const qty = Number.isNaN(q) ? 0 : q;
    if (!qty) return;
    const delta = -dir * qty; // dir=+1: registrar venta/devolución; dir=-1: revertir
    const inv = invCentralLoadPOS();
    if (!inv.finished) inv.finished = {};
    if (!inv.finished[finishedId]) inv.finished[finishedId] = { stock: 0 };
    inv.finished[finishedId].stock = invParseNumberPOS(inv.finished[finishedId].stock) + delta;
    invCentralSavePOS(inv);
  }catch(e){
    console.error('Error ajustando inventario central desde venta', e);
  }
}
async function renderCentralFinishedPOS(){
  const tbody = document.querySelector('#tbl-inv-central tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const inv = invCentralLoadPOS();
  const defs = [
    { id:'pulso', label:'Pulso 250 ml' },
    { id:'media', label:'Media 375 ml' },
    { id:'djeba', label:'Djeba 750 ml' },
    { id:'litro', label:'Litro 1000 ml' },
    { id:'galon', label:'Galón 3800 ml' },
  ];
  defs.forEach(d=>{
    const info = (inv.finished && inv.finished[d.id]) || { stock: 0 };
    const stock = invParseNumberPOS(info.stock);
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.label}</td><td>${stock}</td>`;
    tbody.appendChild(tr);
  });
}


function leerCostosPresentacion() {
  try {
    const raw = A33Storage.getItem(RECETAS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.costosPresentacion) {
      return data.costosPresentacion;
    }
    return null;
  } catch (e) {
    console.warn('No se pudieron leer los costos de presentación desde la Calculadora:', e);
    return null;
  }
}

function mapProductNameToPresId(name) {
  const n = normName(name);
  if (!n) return null;
  if (n.includes('pulso')) return 'pulso';
  if (n.includes('media')) return 'media';
  if (n.includes('djeba')) return 'djeba';
  if (n.includes('litro')) return 'litro';
  if (n.includes('galon')) return 'galon';
  if (n.includes('galón')) return 'galon';
  return null;
}

function getCostoUnitarioProducto(productName) {
  const costos = leerCostosPresentacion();
  if (!costos) return 0;
  const presId = mapProductNameToPresId(productName);
  if (!presId) return 0;
  const info = costos[presId];
  if (!info) return 0;
  const val = typeof info.costoUnidad === 'number' ? info.costoUnidad : 0;
  return val > 0 ? val : 0;
}

// Defaults (SKUs Arcano 33)
const SEED = [
  // "Vaso" aquí es una PORCIÓN vendible (Venta por vaso), no un producto del selector.
  {name:'Vaso', price:100, manageStock:false, active:true, internalType:'cup_portion'},
  {name:'Pulso 250ml', price:120, manageStock:true, active:true},
  {name:'Media 375ml', price:150, manageStock:true, active:true},
  {name:'Djeba 750ml', price:300, manageStock:true, active:true},
  {name:'Litro 1000ml', price:330, manageStock:true, active:true},
  {name:'Galón 3800ml', price:900, manageStock:true, active:true},
];
const DEFAULT_EVENTS = [{name:'General'}];

async function seedMissingDefaults(force=false){
  const list = await getAll('products');
  const names = new Set(list.map(p=>normName(p.name)));
  for (const s of SEED){
    const n = normName(s.name);
    if (force || !names.has(n)){
      const existing = list.find(p=>normName(p.name)===n);
      if (existing){
        existing.active = true;
        if (!existing.price || existing.price <= 0) existing.price = s.price;
        if (typeof existing.manageStock === 'undefined') existing.manageStock = s.manageStock;
        if (s.internalType) existing.internalType = s.internalType;
        await put('products', existing);
      } else {
        await put('products', {...s});
      }
    }
  }
}

// UI helpers
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
function fmt(n){ return (n||0).toLocaleString('es-NI', {minimumFractionDigits:2, maximumFractionDigits:2}); }
let toastTimerId = null;
function showToast(msg, type='ok', durationMs=5000){
  const t = document.getElementById('toast');
  if (!t) return;
  // Accesibilidad
  if (!t.hasAttribute('role')) t.setAttribute('role','status');
  if (!t.hasAttribute('aria-live')) t.setAttribute('aria-live','polite');
  if (!t.hasAttribute('aria-atomic')) t.setAttribute('aria-atomic','true');

  const d = Math.max(800, Number(durationMs || 0) || 0);

  // Limpiar timeout previo si hay otro toast en curso
  if (toastTimerId){
    clearTimeout(toastTimerId);
    toastTimerId = null;
  }

  // Reset clases de tipo
  t.classList.remove('ok','error');
  t.classList.add(type === 'error' ? 'error' : 'ok');

  t.textContent = String(msg || '');
  t.style.setProperty('--toast-duration', d + 'ms');

  // Reiniciar animación
  t.classList.remove('show');
  void t.offsetWidth; // force reflow
  t.classList.add('show');

  toastTimerId = setTimeout(()=>{
    t.classList.remove('show');
  }, d);
}

// Compat: toasts rápidos existentes
function toast(msg){ showToast(msg, 'ok', 1800); }

// --- Helpers POS: hora/orden robustos (para listas y export)
function pad2POS(n){
  const v = Math.floor(Math.abs(Number(n) || 0));
  return (v < 10 ? '0' : '') + v;
}

function toHHMMFromDatePOS(d){
  try{
    if (!(d instanceof Date) || isNaN(d.getTime())) return '';
    return pad2POS(d.getHours()) + ':' + pad2POS(d.getMinutes());
  }catch(e){
    return '';
  }
}

function getSaleTimeTextPOS(s){
  if (!s) return '';
  // Campo clásico
  if (typeof s.time === 'string' && s.time.trim()) return s.time.trim();
  // Variantes (por compatibilidad)
  if (typeof s.hora === 'string' && s.hora.trim()) return s.hora.trim();
  if (typeof s.hour === 'string' && s.hour.trim()) return s.hour.trim();

  // Intentar derivar de timestamps comunes
  const cand = (s.createdAt ?? s.ts ?? s.timestamp ?? s.created_at ?? s.createdAtISO ?? s.created_at_iso ?? null);
  let d = null;
  if (typeof cand === 'number' && isFinite(cand) && cand > 0){
    d = new Date(cand);
  } else if (typeof cand === 'string' && cand.trim()){
    const t = Date.parse(cand);
    if (!isNaN(t)) d = new Date(t);
  }
  const hhmm = toHHMMFromDatePOS(d);
  return hhmm || '';
}

function saleSortKeyPOS(s){
  if (!s) return 0;
  // Preferir timestamps si existen
  const cand = (s.createdAt ?? s.ts ?? s.timestamp ?? s.created_at ?? null);
  if (typeof cand === 'number' && isFinite(cand) && cand > 0) return cand;
  if (typeof cand === 'string' && cand.trim()){
    const t = Date.parse(cand);
    if (!isNaN(t)) return t;
  }
  // Fallback a id autoincremental
  const idn = Number(s.id || 0);
  return (Number.isFinite(idn) ? idn : 0);
}

// Descuento total (compatibilidad: ventas antiguas / Extras)
function getSaleDiscountTotalPOS(s){
  if (!s) return 0;
  const d = Number(s.discount);
  if (Number.isFinite(d)) return d;
  const du = Number(s.discountPerUnit);
  if (Number.isFinite(du) && du > 0){
    const q = Math.abs(Number(s.qty || 0));
    return du * q;
  }
  return 0;
}


// --- Consecutivo por evento (N°) para ventas (incluye Extras)
// Nota: mantenemos el `id` real (autoincrement/timestamp) para trazabilidad.
// El consecutivo oficial por evento se guarda en `sale.seqId` y se exporta como "N°".
function isLikelyAutoIdPOS(n){
  return Number.isFinite(n) && n > 0 && n < 1000000000; // ids autoincrement típicos
}

function getSaleExistingSeqCandidatePOS(s){
  const seq = Number(s && s.seqId);
  if (Number.isFinite(seq) && seq > 0) return seq;
  const idn = Number(s && s.id);
  if (isLikelyAutoIdPOS(idn)) return idn;
  return 0;
}

function computeEventSaleSeqBasePOS(sales){
  let base = 0;
  if (!Array.isArray(sales)) return base;
  for (const s of sales){
    const cand = getSaleExistingSeqCandidatePOS(s);
    if (cand > base) base = cand;
  }
  return base;
}

async function backfillSaleSeqIdsForEventPOS(eventId, ev=null, sales=null){
  try{
    const event = ev || await getEventByIdPOS(eventId);
    if (!event) return { updated:0, saleSeq:0 };

    const allSales = sales || (await getAll('sales')).filter(s=>s.eventId===eventId);
    const used = new Set();
    let base = computeEventSaleSeqBasePOS(allSales);

    // Reservar números ya usados
    for (const s of allSales){
      const seq = Number(s && s.seqId);
      if (Number.isFinite(seq) && seq > 0) used.add(seq);
      const idn = Number(s && s.id);
      if (isLikelyAutoIdPOS(idn)) used.add(idn);
    }

    let updated = 0;
    for (const s of allSales){
      const cur = Number(s && s.seqId);
      if (Number.isFinite(cur) && cur > 0) continue;

      const idn = Number(s && s.id);

      // Si el id "parece" autoincrement y no colisiona, usarlo como N°
      if (isLikelyAutoIdPOS(idn) && !used.has(idn)){
        s.seqId = idn;
        used.add(idn);
        if (idn > base) base = idn;
      } else {
        // Si el id es timestamp (muy grande) o colisiona, asignar el siguiente consecutivo
        do { base += 1; } while (used.has(base));
        s.seqId = base;
        used.add(base);
      }

      try{
        await put('sales', s);
        updated++;
      }catch(e){}
    }

    // Actualizar contador del evento (no bajarlo nunca)
    const curSeq = Number(event.saleSeq || 0);
    if (!Number.isFinite(curSeq) || curSeq < base) event.saleSeq = base;

    try{ await put('events', event); }catch(e){}
    return { updated, saleSeq: Number(event.saleSeq||0) };
  }catch(e){
    console.warn('No se pudo backfill de N° por evento', e);
    return { updated:0, saleSeq:0 };
  }
}

async function ensureNewSaleSeqIdPOS(event, saleRecord){
  if (!event || !saleRecord) return;

  // Si el evento no tiene contador, inicializar desde ventas existentes (una sola vez)
  let curSeq = Number(event.saleSeq || 0);
  if (!Number.isFinite(curSeq) || curSeq <= 0){
    const sales = (await getAll('sales')).filter(s=>s.eventId===event.id);
    const hasMissing = sales.some(s => !(Number(s && s.seqId) > 0));
    if (hasMissing){
      const res = await backfillSaleSeqIdsForEventPOS(event.id, event, sales);
      curSeq = Number(res.saleSeq || 0);
    } else {
      curSeq = computeEventSaleSeqBasePOS(sales);
      event.saleSeq = curSeq;
      await put('events', event);
    }
  }

  curSeq = Number(event.saleSeq || curSeq || 0);
  const next = (Number.isFinite(curSeq) ? curSeq : 0) + 1;

  saleRecord.seqId = next;
  event.saleSeq = next;

  await put('events', event);
}

function getSaleSeqDisplayPOS(s){
  const n = Number(s && s.seqId);
  if (Number.isFinite(n) && n > 0) return String(n);
  const idn = Number(s && s.id);
  return (Number.isFinite(idn) ? String(idn) : '');
}

function humanizeError(err){
  if (!err) return 'Error desconocido.';
  if (typeof err === 'string') return err;
  const name = err.name || '';
  const msg = err.message || String(err);

  if (name === 'TransactionInactiveError') return 'La transacción de la base de datos se cerró antes de tiempo. Recarga el POS y vuelve a intentar.';
  if (name === 'QuotaExceededError') return 'El navegador se quedó sin espacio para guardar datos (QuotaExceeded). Libera espacio o prueba otro navegador.';
  if (name === 'InvalidStateError') return 'El navegador no permitió la operación en este estado (InvalidState). Cierra otras pestañas del POS y recarga.';
  if (name === 'NotFoundError') return 'No se encontró el registro/almacén en la base de datos (NotFound).';
  if (name === 'DataError') return 'Dato inválido para la base de datos (DataError).';

  return msg;
}


function setOfflineBar(){ const ob=$('#offlineBar'); if (!ob) return; ob.style.display = navigator.onLine?'none':'block'; }
window.addEventListener('online', setOfflineBar);
window.addEventListener('offline', setOfflineBar);

// Enable/disable selling block depending on current event
// + Candado por Caja Chica: si el día está cerrado, NO se puede vender (UI + guard en lógica)
let __A33_SELL_STATE = { enabled:false, dayKey: todayYMD(), dayClosed:false, pettyEnabled:false, eventId:null };

function getSaleDayKeyPOS(){
  try{
    const v = document.getElementById('sale-date')?.value || '';
    return safeYMD(v);
  }catch(e){
    return todayYMD();
  }
}

function isSellEnabledNowPOS(){
  try{
    if (typeof window.__A33_SELL_ENABLED === 'boolean') return !!window.__A33_SELL_ENABLED;
    if (typeof __A33_SELL_STATE === 'object' && __A33_SELL_STATE) return !!__A33_SELL_STATE.enabled;
    return true;
  }catch(e){ return true; }
}

function showSellDayClosedToastPOS(){
  showToast('Día cerrado. Reabrí el día en Caja Chica para vender.', 'error', 5000);
}

function setSellControlsDisabledPOS(disabled){
  const tab = document.getElementById('tab-venta');
  if (tab) tab.classList.toggle('sell-locked', !!disabled);

  const ids = [
    'sale-product','sale-price','sale-qty','qty-minus','qty-plus','sale-discount',
    'sale-payment','sale-bank','sale-courtesy','sale-return','sale-customer','sale-courtesy-to','sale-notes',
    'btn-add','btn-add-sticky','btn-undo',
    'btn-fraction','cup-fraction-gallons','cup-yield','cup-qty','cup-qty-minus','cup-qty-plus','cup-price','btn-sell-cups','btn-courtesy-cups'
  ];
  for (const id of ids){
    const el = document.getElementById(id);
    if (el) el.disabled = !!disabled;
  }

  // Chips (productos + extras)
  document.querySelectorAll('#product-chips button.chip').forEach(btn=>{
    btn.disabled = !!disabled;
    btn.classList.toggle('disabled', !!disabled);
  });

  // Botones borrar en tabla del día
  document.querySelectorAll('#tbl-day button.del-sale').forEach(btn=>{
    btn.disabled = !!disabled;
  });

  // Bloque Venta por vaso
  const cupBlock = document.getElementById('cup-block');
  if (cupBlock){
    cupBlock.classList.toggle('disabled', !!disabled);
    cupBlock.querySelectorAll('input, button, select, textarea').forEach(el=>{
      el.disabled = !!disabled;
    });
  }
}

function setSellDayClosedBannerPOS(show, dayKey){
  const banner = document.getElementById('sell-day-closed-banner');
  if (!banner) return;
  if (show){
    const t = document.getElementById('sell-day-closed-title');
    if (t) t.textContent = `Día cerrado (${dayKey})`;
    const s = document.getElementById('sell-day-closed-sub');
    if (s) s.textContent = 'Para vender aquí, reabrí el día en Caja Chica.';
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}

async function computeSellDayLockPOS(curEvent, dayKey){
  const dk = safeYMD(dayKey || getSaleDayKeyPOS());
  if (!curEvent || !eventPettyEnabled(curEvent)) return { pettyEnabled:false, dayKey: dk, dayClosed:false, closedAt:null, created:false };

  const pc = await getPettyCash(curEvent.id);
  const existed = !!(pc && pc.days && pc.days[dk]);
  const day = ensurePcDay(pc, dk);

  // Día nuevo abierto: si no existía, lo persistimos como abierto
  if (!existed){
    try{ await savePettyCash(pc); }catch(e){}
  }

  const closedAt = day ? day.closedAt : null;
  return { pettyEnabled:true, dayKey: dk, dayClosed: !!closedAt, closedAt: closedAt || null, created: !existed };
}

async function guardSellDayOpenOrToastPOS(curEvent, dayKey){
  if (!curEvent || !eventPettyEnabled(curEvent)) return true;
  const info = await computeSellDayLockPOS(curEvent, dayKey);
  if (info.dayClosed){
    showSellDayClosedToastPOS();
    try{ await updateSellEnabled(); }catch(e){}
    return false;
  }
  return true;
}

async function updateSellEnabled(){
  const current = await getMeta('currentEventId');
  const evs = await getAll('events');
  const cur = evs.find(e=>e.id===current) || null;

  const hasEvent = !!(current && cur);
  const eventOpen = !!(hasEvent && !cur.closedAt);

  const dayKey = getSaleDayKeyPOS();
  let lockInfo = { pettyEnabled:false, dayKey, dayClosed:false, closedAt:null, created:false };
  if (eventOpen && cur && eventPettyEnabled(cur)) {
    lockInfo = await computeSellDayLockPOS(cur, dayKey);
  }

  const sellEnabled = !!(eventOpen && !(lockInfo.pettyEnabled && lockInfo.dayClosed));

  __A33_SELL_STATE = { enabled: sellEnabled, dayKey: lockInfo.dayKey, dayClosed: lockInfo.dayClosed, pettyEnabled: lockInfo.pettyEnabled, eventId: (current || null) };
  window.__A33_SELL_ENABLED = sellEnabled;

  // Nota "sin evento activo": solo depende del evento (no del día)
  const noActive = document.getElementById('no-active-note');
  if (noActive) noActive.style.display = eventOpen ? 'none' : 'block';

  // Banner: solo cuando el evento está abierto y Caja Chica está ON
  setSellDayClosedBannerPOS(!!(eventOpen && lockInfo.pettyEnabled && lockInfo.dayClosed), lockInfo.dayKey);

  // Candado real de controles
  setSellControlsDisabledPOS(!sellEnabled);

  // Refrescar cup-block labels/stock sin romper nada
  try{ await refreshCupBlock(); }catch(e){}
}

// Ensure defaults
async function ensureDefaults(){
  let products = await getAll('products');
  if (!products.length){
    for (const p of SEED) await put('products', p);
  } else {
    for (const p of products){
      let changed = false;
      if (typeof p.active === 'undefined'){ p.active = true; changed = true; }
      if (typeof p.manageStock === 'undefined'){ p.manageStock = true; changed = true; }
      if (changed) await put('products', p);
    }
  }
  products = await getAll('products');
  if (products.length < 5) await seedMissingDefaults(true);
  else await seedMissingDefaults(false);

  const events = await getAll('events');
  if (!events.length){
    for (const ev of DEFAULT_EVENTS) await put('events', {...ev, pettyEnabled:false, createdAt:new Date().toISOString()});
  } else {
    // Asegurar campo “pettyEnabled” (Caja Chica por evento)
    for (const ev of events){
      if (typeof ev.pettyEnabled === 'undefined'){
        ev.pettyEnabled = false;
        await put('events', ev);
      }
    }
  }
  const hasKey = (await getAll('meta')).some(m=>m.id==='currentEventId');
  if (!hasKey){
    const evs = await getAll('events');
    if (evs.length) await setMeta('currentEventId', evs[0].id);
  }

  // Bancos (catálogo para transferencias)
  await ensureBanksDefaults();
}

// --- Bancos (transferencias)
// Seed base para catálogo de bancos (se pre-carga solo si el store está vacío)
// Nota: mantener nombres en mayúsculas para consistencia visual y de reportes.
const BANKS_SEED = ['BAC', 'BANPRO', 'LAFISE', 'BDF'];

function normBankName(name){
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function getAllBanksSafe(){
  try{ return await getAll('banks'); }catch(e){ return []; }
}

async function ensureBanksDefaults(){
  try{
    let banks = await getAllBanksSafe();
    if (!banks.length){
      const now = new Date().toISOString();
      for (const name of BANKS_SEED){
        await put('banks', { name, isActive: true, createdAt: now });
      }
      banks = await getAllBanksSafe();
    }

    // Migración suave de campos + normalización mínima (sin romper historial)
    for (const b of banks){
      if (!b) continue;
      let changed = false;
      if (typeof b.isActive === 'undefined'){ b.isActive = true; changed = true; }
      if (!b.createdAt){ b.createdAt = new Date().toISOString(); changed = true; }
      // Normalizar solo LAFISE a mayúsculas (para que quede consistente con los otros)
      if (normBankName(b.name) === 'lafise' && String(b.name).trim() !== 'LAFISE'){
        b.name = 'LAFISE';
        changed = true;
      }
      if (changed) await put('banks', b);
    }
  }catch(err){
    console.error('No se pudo inicializar catálogo de bancos', err);
  }
}

function getSaleBankLabel(sale, bankMap){
  if (!sale || (sale.payment || '') !== 'transferencia') return '';
  let name = (sale.bankName || '').trim();
  const bid = sale.bankId;
  if (!name && bid != null && bankMap && bankMap.has(Number(bid))){
    name = String(bankMap.get(Number(bid)) || '').trim();
  }
  return name || 'Sin banco';
}

async function refreshSaleBankSelect(){
  const row = document.getElementById('sale-bank-row');
  const sel = document.getElementById('sale-bank');
  const note = document.getElementById('sale-bank-note');
  if (!row || !sel) return;

  const payment = document.getElementById('sale-payment')?.value || 'efectivo';
  if (payment !== 'transferencia'){
    row.style.display = 'none';
    sel.value = '';
    if (note) note.textContent = '';
    return;
  }

  row.style.display = 'block';
  const banks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
  banks.sort((a,b)=> String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' }));

  // Mantener selección si aún existe
  const prev = sel.value;

  sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Selecciona banco —';
  sel.appendChild(opt0);
  for (const b of banks){
    const o = document.createElement('option');
    o.value = String(b.id);
    o.textContent = b.name;
    sel.appendChild(o);
  }
  if (prev) sel.value = prev;

  if (!banks.length){
    if (note) note.textContent = 'No hay bancos activos. Agregá uno en Productos.';
  } else {
    if (note) note.textContent = '';
  }
}

async function renderBancos(){
  const wrap = document.getElementById('banks-list');
  if (!wrap) return;
  const banks = await getAllBanksSafe();
  if (!banks.length){
    wrap.innerHTML = '<div class="warn">No hay bancos. Agrega al menos uno para usar Transferencias.</div>';
    return;
  }
  const rows = banks.slice().sort((a,b)=>{
    const aa = (a && a.isActive !== false) ? 0 : 1;
    const bb = (b && b.isActive !== false) ? 0 : 1;
    if (aa !== bb) return aa - bb;
    return String(a.name||'').localeCompare(String(b.name||''), 'es-NI', { sensitivity:'base' });
  });

  let html = '<table class="table small"><thead><tr><th>Banco</th><th>Estado</th><th></th></tr></thead><tbody>';
  for (const b of rows){
    const active = b && b.isActive !== false;
    const estado = active ? 'Activo' : 'Inactivo';
    const btnTxt = active ? 'Desactivar' : 'Activar';
    const btnClass = active ? 'btn-warn' : 'btn-ok';
    html += `<tr>
      <td>${escapeHtml(b.name||'')}</td>
      <td>${estado}</td>
      <td><button class="${btnClass} btn-mini btn-toggle-bank" data-id="${b.id}">${btnTxt}</button></td>
    </tr>`;
  }
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function escapeHtml(str){
  return String(str||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

// Productos
async function renderProductos(){
  const list = await getAll('products');
  const wrap = $('#productos-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!list.length){
    const p = document.createElement('div'); p.className = 'warn'; p.textContent = 'No hay productos. Agrega los de Arcano 33 abajo.'; wrap.appendChild(p);
  }
  for (const p of list) {
    const row = document.createElement('div');
    row.className = 'card';
    row.innerHTML = `
      <div class="row">
        <input data-id="${p.id}" class="p-name" value="${p.name}">
        <div class="row">
          <input data-id="${p.id}" class="p-price a33-num" data-a33-default="${p.price}" type="number" inputmode="decimal" step="0.01" value="${p.price}">
          <label class="flag"><input type="checkbox" class="p-active" data-id="${p.id}" ${p.active===false?'':'checked'}> Activo</label>
          <label class="flag"><input type="checkbox" class="p-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}> Inventario</label>
          <button data-id="${p.id}" class="btn-danger btn-del">Eliminar</button>
        </div>
      </div>
    `;
    wrap.appendChild(row);
  }
  await renderProductChips();

  // Bancos (gestión en pestaña Productos)
  await renderBancos();
}

// Productos internos/virtuales del POS que NO deben aparecer en selector ni inventario.
// Nota: "Vaso" aquí representa porciones de sangría (Venta por vaso), no un producto vendible del selector.
async function getHiddenProductIdsPOS(){
  const hidden = new Set();
  try{
    const vaso = await getVasoProductPOS();
    if (vaso && vaso.id != null) hidden.add(vaso.id);
  }catch(e){}
  return hidden;
}

// Chips de productos (todos los activos)
async function renderProductChips(){
  const chips = $('#product-chips'); if (!chips) return;
  chips.innerHTML='';

  const hiddenIds = await getHiddenProductIdsPOS();
  let list = (await getAll('products')).filter(p=>p.active!==false && !hiddenIds.has(p.id));

  // Orden con prioridad de Arcano 33
  const priority = ['pulso','media','djeba','litro','galon','galón','galon 3800','galón 3800'];
  list.sort((a,b)=>{
    const ia = priority.findIndex(x=>normName(a.name).includes(x));
    const ib = priority.findIndex(x=>normName(b.name).includes(x));
    const pa = ia===-1?999:ia; const pb = ib===-1?999:ib;
    if (pa!==pb) return pa-pb;
    return a.name.localeCompare(b.name, 'es');
  });

  const current = await getMeta('currentEventId');
  const evs = await getAll('events');
  const cur = evs.find(e=>e.id===current);
  const enabled = (typeof window.__A33_SELL_ENABLED === 'boolean') ? window.__A33_SELL_ENABLED : !!(current && cur && !cur.closedAt);

  const sel = $('#sale-product');
  const selected = parseSelectedSellItemValue(sel ? sel.value : '');

  // Productos
  for (const p of list){
    const c = document.createElement('button');
    c.className = 'chip';
    c.dataset.kind = 'product';
    c.dataset.id = p.id;
    if (!enabled) c.classList.add('disabled');
    c.textContent = p.name;
    if (selected && selected.kind==='product' && p.id === selected.id) c.classList.add('active');

    c.onclick = async()=>{
      if (!isSellEnabledNowPOS()) return;
      const prev = parseSelectedSellItemValue(sel.value);
      sel.value = String(p.id);
      const same = prev && prev.kind==='product' && prev.id === p.id;
      if (same) { $('#sale-qty').value = Math.max(1, parseFloat($('#sale-qty').value||'1')) + 1; }
      else { $('#sale-qty').value = 1; }
      $('#sale-price').value = p.price;
      updateChipsActiveFromSelectionPOS();
      await refreshSaleStockLabel();
      recomputeTotal();
    };

    chips.appendChild(c);
  }

  // Extras (por evento)
  try{
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false) : [];
    if (extras.length){
      // separador visual simple
      const sep = document.createElement('div');
      sep.className = 'chips-sep';
      sep.textContent = 'Extras';
      chips.appendChild(sep);

      extras.sort((a,b)=> a.name.localeCompare(b.name, 'es'));

      for (const x of extras){
        const c = document.createElement('button');
        c.className = 'chip extra';
        c.dataset.kind = 'extra';
        c.dataset.extraId = x.id;
        if (!enabled) c.classList.add('disabled');
        if (x.stock <= 0) c.classList.add('out');
        c.textContent = x.name;
        if (selected && selected.kind==='extra' && Number(selected.id) === Number(x.id)) c.classList.add('active');

        c.onclick = async()=>{
          if (!isSellEnabledNowPOS()) return;
          const prev = parseSelectedSellItemValue(sel.value);
          sel.value = `extra:${x.id}`;
          const same = prev && prev.kind==='extra' && prev.id === x.id;
          if (same) { $('#sale-qty').value = Math.max(1, parseFloat($('#sale-qty').value||'1')) + 1; }
          else { $('#sale-qty').value = 1; }
          $('#sale-price').value = x.unitPrice;
          updateChipsActiveFromSelectionPOS();
          await refreshSaleStockLabel();
          recomputeTotal();
        };

        chips.appendChild(c);
      }
    }
  }catch(e){
    // no-op
  }

  if (list.length===0){
    const warn = document.createElement('div');
    warn.className = 'warn';
    warn.textContent = 'No hay productos activos. Activa productos en la pestaña Productos o Inventario.';
    chips.appendChild(warn);
  }
}

// Delegación de eventos para Productos
document.addEventListener('change', async (e)=>{
  if (e.target.classList.contains('p-name') || e.target.classList.contains('p-price') || e.target.classList.contains('p-manage') || e.target.classList.contains('p-active')){
    const id = parseInt(e.target.dataset.id||'0',10);
    if (!id) return;
    const all = await getAll('products');
    const cur = all.find(px=>px.id===id); if (!cur) return;
    if (e.target.classList.contains('p-name')) cur.name = e.target.value.trim();
    if (e.target.classList.contains('p-price')) cur.price = parseFloat(e.target.value||'0');
    if (e.target.classList.contains('p-manage')) cur.manageStock = e.target.checked;
    if (e.target.classList.contains('p-active')) cur.active = e.target.checked;
    try{
      await put('products', cur);
      await renderProductos(); 
      await refreshProductSelect(); 
      await renderInventario();
      toast('Producto actualizado');
    }catch(err){
      alert('No se pudo guardar el producto. ¿Nombre duplicado?');
    }
  }
});
document.addEventListener('click', async (e)=>{
  const delBtn = e.target.closest('.btn-del');
  if (delBtn){
    const id = parseInt(delBtn.dataset.id,10);
    if (!confirm('¿Eliminar este producto? Esto no borra ventas pasadas.')) return;
    await del('products', id);
    await renderProductos(); await refreshProductSelect(); await renderInventario();
    toast('Producto eliminado');
  }
});

// Delegación de eventos para Bancos
document.addEventListener('click', async (e)=>{
  const tBtn = e.target.closest('.btn-toggle-bank');
  if (!tBtn) return;
  const id = parseInt(tBtn.dataset.id || '0', 10);
  if (!id) return;

  const banks = await getAllBanksSafe();
  const b = banks.find(x => Number(x.id) === id);
  if (!b) return;
  const currentlyActive = (b.isActive !== false);
  b.isActive = !currentlyActive;
  await put('banks', b);
  await renderBancos();
  await refreshSaleBankSelect();
  toast('Banco actualizado');
});

// Tabs
function setTab(name){
  const tabs = $$('.tab');
  const target = document.getElementById('tab-'+name);
  if (!target) return;

  // Botón activo en tabbar
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabbar button[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');

  // Tab actual visible (fallback robusto)
  let current = null;
  if (window.__A33_ACTIVE_TAB){
    const el = document.getElementById('tab-'+window.__A33_ACTIVE_TAB);
    if (el && el !== target && el.style.display !== 'none' && getComputedStyle(el).display !== 'none'){
      current = el;
    }
  }
  if (!current){
    current = tabs.find(el => el !== target && el.style.display !== 'none' && getComputedStyle(el).display !== 'none') || null;
  }

  // Mostrar target con micro animación (sin reestructurar layout)
  if (current && current !== target){
    target.style.display = 'block';
    target.classList.add('a33-tab-prep');
    void target.offsetHeight; // reflow
    target.classList.remove('a33-tab-prep');

    current.classList.add('a33-tab-out');
    setTimeout(()=>{
      current.style.display = 'none';
      current.classList.remove('a33-tab-out');
    }, 160);
  } else {
    // Primer render / estado inconsistente: asegura solo uno visible
    tabs.forEach(el=> el.style.display='none');
    target.style.display='block';
    target.classList.add('a33-tab-prep');
    requestAnimationFrame(()=> target.classList.remove('a33-tab-prep'));
  }

  window.__A33_ACTIVE_TAB = name;

  // Render específico por pestaña (misma lógica de antes)
  if (name==='resumen') renderSummary();
  if (name==='productos') renderProductos();
  if (name==='eventos') renderEventos();
  if (name==='inventario') renderInventario();
  if (name==='caja') renderCajaChica();
  if (name==='calculadora') onOpenPosCalculatorTab().catch(err=>console.error(err));
  if (name==='checklist') renderChecklistTab().catch(err=>console.error(err));
  if (name==='vender') initVasosPanelPOS().catch(err=>console.error(err));
}

// --- Vasos panel (colapsable persistente)
async function syncVasosPanelKeyPOS(){
  const toggle = document.getElementById('vasosPanelToggle');
  if (!toggle) return 'pos_vasos_panel_open';

  let evId = null;
  try{
    if (window.__A33_SELL_STATE && window.__A33_SELL_STATE.eventId != null){
      evId = parseInt(window.__A33_SELL_STATE.eventId, 10);
    }
  }catch(_){ }

  if (!evId){
    try{
      const cur = await getMeta('currentEventId');
      if (cur != null && cur !== '') evId = parseInt(cur, 10);
    }catch(_){ }
  }

  const key = (evId && Number.isFinite(evId)) ? `pos_vasos_panel_open_${evId}` : 'pos_vasos_panel_open';
  toggle.dataset.storageKey = key;
  return key;
}

function setVasosPanelStatePOS(isOpen, opts){
  const o = (opts || {});
  const save = (o.save !== false);
  const toggle = document.getElementById('vasosPanelToggle');
  const body = document.getElementById('vasosPanelBody');
  if (!toggle || !body) return;

  const open = !!isOpen;
  body.classList.toggle('is-collapsed', !open);
  body.setAttribute('aria-hidden', open ? 'false' : 'true');
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');

  const caret = toggle.querySelector('.vasos-panel-caret');
  if (caret) caret.textContent = open ? '▾' : '▸';
  const stateLbl = toggle.querySelector('.vasos-panel-state');
  if (stateLbl) stateLbl.textContent = open ? 'Ocultar' : 'Mostrar';

  if (save){
    const key = toggle.dataset.storageKey || 'pos_vasos_panel_open';
    try{ localStorage.setItem(key, open ? '1' : '0'); }catch(_){ }
  }
}

async function loadVasosPanelStatePOS(){
  const toggle = document.getElementById('vasosPanelToggle');
  const body = document.getElementById('vasosPanelBody');
  if (!toggle || !body) return;

  const key = await syncVasosPanelKeyPOS();
  let raw = null;
  try{ raw = localStorage.getItem(key); }catch(_){ raw = null; }
  const isOpen = (raw === '1');
  setVasosPanelStatePOS(isOpen, { save:false });
}

function bindVasosPanelOncePOS(){
  // Re-render safe: se enlaza por elemento (no global)
  const toggle = document.getElementById('vasosPanelToggle');
  if (toggle && !toggle.dataset.bound){
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', async ()=>{
      await syncVasosPanelKeyPOS();
      const expanded = (toggle.getAttribute('aria-expanded') === 'true');
      setVasosPanelStatePOS(!expanded, { save:true });
    });
  }

  const closeBtn = document.getElementById('vasosPanelCloseBtn');
  if (closeBtn && !closeBtn.dataset.bound){
    closeBtn.dataset.bound = '1';
    closeBtn.addEventListener('click', async ()=>{
      await syncVasosPanelKeyPOS();
      setVasosPanelStatePOS(false, { save:true });
    });
  }
}

async function initVasosPanelPOS(){
  bindVasosPanelOncePOS();
  await loadVasosPanelStatePOS();
}

// --- Deep-link mínimo (Centro de Mando -> POS)
// Soporta: ?tab=vender | #tab=vender (sin librerías, sin romper navegación existente)
function getTabFromUrlPOS(){
  try{
    const allowed = new Set(['vender','inventario','eventos','caja','resumen','productos','calculadora','checklist']);
    // Querystring
    const qs = new URLSearchParams(window.location.search || '');
    const qTab = (qs.get('tab') || '').trim();
    if (qTab && allowed.has(qTab)) return qTab;

    // Hash: #tab=vender o #vender
    const h = (window.location.hash || '').replace(/^#/, '').trim();
    if (!h) return null;
    if (h.startsWith('tab=')){
      const ht = h.slice(4).trim();
      if (allowed.has(ht)) return ht;
    }
    if (allowed.has(h)) return h;
  }catch(_){ }
  return null;
}

// --- Checklist (POS)
const CHECKLIST_SECTIONS_POS = [
  { key: 'pre', listId: 'chk-pre', addId: 'chk-add-pre' },
  { key: 'evento', listId: 'chk-evento', addId: 'chk-add-evento' },
  { key: 'cierre', listId: 'chk-cierre', addId: 'chk-add-cierre' },
];

function makeChecklistItemIdPOS(){
  try{ return (crypto && crypto.randomUUID) ? crypto.randomUUID() : null; }catch(e){}
  return 'chk_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

function normalizeChecklistTemplatePOS(t){
  const out = (t && typeof t === 'object') ? t : {};
  const normArr = (arr)=>{
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(x=>x && typeof x === 'object')
      .map(x=>({ id: String(x.id || makeChecklistItemIdPOS()), text: String(x.text || '').trim() }))
      .filter(x=>x.text.length>0 || x.id);
  };
  return {
    pre: normArr(out.pre),
    evento: normArr(out.evento),
    cierre: normArr(out.cierre),
  };
}

function ensureChecklistDataPOS(ev, dayKey){
  let changed = false;
  if (!ev || typeof ev !== 'object') return { changed:false, template:{pre:[],evento:[],cierre:[]}, state:{checkedIds:[], notes:''} };

  if (!ev.checklistTemplate || typeof ev.checklistTemplate !== 'object') {
    ev.checklistTemplate = { pre: [], evento: [], cierre: [] };
    changed = true;
  }
  const tpl = normalizeChecklistTemplatePOS(ev.checklistTemplate);
  // Persistir normalización si cambia estructura
  if (JSON.stringify(tpl) !== JSON.stringify(ev.checklistTemplate)) {
    ev.checklistTemplate = tpl;
    changed = true;
  }

  if (!ev.days || typeof ev.days !== 'object') {
    ev.days = {};
    changed = true;
  }
  if (!ev.days[dayKey] || typeof ev.days[dayKey] !== 'object') {
    ev.days[dayKey] = {};
    changed = true;
  }
  if (!ev.days[dayKey].checklistState || typeof ev.days[dayKey].checklistState !== 'object') {
    ev.days[dayKey].checklistState = { checkedIds: [], notes: '' };
    changed = true;
  }
  const st = ev.days[dayKey].checklistState;
  if (!Array.isArray(st.checkedIds)) { st.checkedIds = []; changed = true; }
  if (typeof st.notes !== 'string') { st.notes = String(st.notes || ''); changed = true; }

  // Limpieza: checkedIds solo válidos según template
  const allIds = new Set([
    ...tpl.pre.map(x=>x.id),
    ...tpl.evento.map(x=>x.id),
    ...tpl.cierre.map(x=>x.id),
  ]);
  const filtered = st.checkedIds.map(String).filter(id=>allIds.has(id));
  if (filtered.length !== st.checkedIds.length) {
    st.checkedIds = filtered;
    changed = true;
  }

  return { changed, template: tpl, state: st };
}

function renderChecklistSectionPOS(sectionKey, listEl, items, checkedSet){
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '8px 4px';
    empty.textContent = 'Sin ítems. Usa “+ Agregar ítem”.';
    listEl.appendChild(empty);
    return;
  }

  items.forEach((it, idx)=>{
    const row = document.createElement('div');
    row.className = 'chk-row';
    row.dataset.section = sectionKey;
    row.dataset.id = it.id;
    row.dataset.idx = String(idx);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'chk-box';
    cb.checked = checkedSet.has(it.id);
    cb.dataset.section = sectionKey;
    cb.dataset.id = it.id;

    const txt = document.createElement('input');
    txt.type = 'text';
    txt.className = 'chk-text';
    txt.value = it.text || '';
    txt.placeholder = 'Ítem…';
    txt.dataset.section = sectionKey;
    txt.dataset.id = it.id;

    const actions = document.createElement('div');
    actions.className = 'chk-actions';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn-mini chk-mini chk-up';
    up.textContent = '↑';
    up.disabled = idx === 0;
    up.dataset.section = sectionKey;
    up.dataset.id = it.id;

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn-mini chk-mini chk-down';
    down.textContent = '↓';
    down.disabled = idx === items.length - 1;
    down.dataset.section = sectionKey;
    down.dataset.id = it.id;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn-mini chk-mini chk-del';
    del.textContent = '✕';
    del.dataset.section = sectionKey;
    del.dataset.id = it.id;

    actions.appendChild(up);
    actions.appendChild(down);
    actions.appendChild(del);

    row.appendChild(cb);
    row.appendChild(txt);
    row.appendChild(actions);

    listEl.appendChild(row);
  });
}

async function renderChecklistTab(){
  bindChecklistEventsOncePOS();

  const empty = document.getElementById('checklist-empty');
  const grid = document.getElementById('checklist-grid');
  const sel = document.getElementById('checklist-event');

  const current = await getMeta('currentEventId');
  const currentId = (current === null || current === undefined || current === '') ? null : parseInt(current, 10);

  if (sel) sel.value = currentId ? String(currentId) : '';

  if (!currentId) {
    if (empty) empty.style.display = 'block';
    if (grid) grid.style.display = 'none';
    return;
  }

  const ev = await getEventByIdPOS(currentId);
  if (!ev) {
    if (empty) empty.style.display = 'block';
    if (grid) grid.style.display = 'none';
    return;
  }

  const dayKey = safeYMD(getSaleDayKeyPOS());
  const { changed, template, state } = ensureChecklistDataPOS(ev, dayKey);
  if (changed) {
    try{ await put('events', ev); }catch(e){ console.error('Checklist: no se pudo persistir inicialización', e); }
  }

  if (empty) empty.style.display = 'none';
  if (grid) grid.style.display = 'grid';

  const checkedSet = new Set((state.checkedIds || []).map(String));

  // Render columnas
  for (const sec of CHECKLIST_SECTIONS_POS){
    const listEl = document.getElementById(sec.listId);
    renderChecklistSectionPOS(sec.key, listEl, template[sec.key] || [], checkedSet);
  }

  const notes = document.getElementById('checklist-notes');
  if (notes) notes.value = state.notes || '';
}

function bindChecklistEventsOncePOS(){
  if (window.__A33_CHECKLIST_BOUND) return;
  window.__A33_CHECKLIST_BOUND = true;

  const sel = document.getElementById('checklist-event');
  if (sel){
    sel.addEventListener('change', async ()=>{
      const val = (sel.value || '').trim();
      if (!val) {
        await setMeta('currentEventId', null);
      } else {
        await setMeta('currentEventId', parseInt(val,10));
      }
      await refreshEventUI();
      try{ await refreshSaleStockLabel(); }catch(e){}
      try{ await renderDay(); }catch(e){}
      try{ await renderChecklistTab(); }catch(e){}
      try{ showToast('Evento actualizado en todo el POS.'); }catch(e){}
    });
  }

  const go = document.getElementById('checklist-go-events');
  if (go){
    go.addEventListener('click', ()=> setTab('eventos'));
  }

  // + Agregar ítem (por sección)
  for (const sec of CHECKLIST_SECTIONS_POS){
    // Soporta tanto IDs fijos (recomendado) como botones por clase/data-section (fallback)
    const btn = document.getElementById(sec.addId) || document.querySelector(`#tab-checklist .chk-add[data-section="${sec.key}"]`);
    if (!btn) continue;
    btn.addEventListener('click', async ()=>{
      const current = await getMeta('currentEventId');
      const currentId = current ? parseInt(current,10) : null;
      if (!currentId){
        try{ showToast('Selecciona un evento primero.'); }catch(e){}
        return;
      }
      const dayKey = safeYMD(getSaleDayKeyPOS());
      const ev = await getEventByIdPOS(currentId);
      if (!ev) return;
      const { template } = ensureChecklistDataPOS(ev, dayKey);
      const id = makeChecklistItemIdPOS();
      template[sec.key] = Array.isArray(template[sec.key]) ? template[sec.key] : [];
      template[sec.key].push({ id, text: 'Nuevo ítem' });
      ev.checklistTemplate = template;
      await put('events', ev);
      await renderChecklistTab();
      const input = document.querySelector(`#${sec.listId} .chk-text[data-id="${CSS.escape(id)}"]`);
      if (input){
        input.focus();
        try{ input.select(); }catch(e){}
      }
    });
  }

  // Delegación de acciones dentro del tab
  const tab = document.getElementById('tab-checklist');
  if (tab){
    tab.addEventListener('click', async (e)=>{
      const up = e.target.closest('.chk-up');
      const down = e.target.closest('.chk-down');
      const del = e.target.closest('.chk-del');
      const reset = e.target.closest('#checklist-reset-day');

      if (reset){
        const cur = await getMeta('currentEventId');
        const curId = cur ? parseInt(cur,10) : null;
        if (!curId) return;
        const ok = confirm('¿Reiniciar checks del día? (solo desmarca)');
        if (!ok) return;
        const dayKey = safeYMD(getSaleDayKeyPOS());
        const ev = await getEventByIdPOS(curId);
        if (!ev) return;
        const { state } = ensureChecklistDataPOS(ev, dayKey);
        state.checkedIds = [];
        ev.days[dayKey].checklistState = state;
        await put('events', ev);
        await renderChecklistTab();
        try{ showToast('Checks reiniciados.'); }catch(e){}
        return;
      }

      if (!(up || down || del)) return;
      const btn = up || down || del;
      const sectionKey = btn.dataset.section;
      const id = btn.dataset.id;
      const cur = await getMeta('currentEventId');
      const curId = cur ? parseInt(cur,10) : null;
      if (!curId || !sectionKey || !id) return;

      const dayKey = safeYMD(getSaleDayKeyPOS());
      const ev = await getEventByIdPOS(curId);
      if (!ev) return;
      const { template, state } = ensureChecklistDataPOS(ev, dayKey);

      const arr = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
      const idx = arr.findIndex(x=>String(x.id)===String(id));
      if (idx < 0) return;

      if (del){
        const ok = confirm('¿Eliminar este ítem?');
        if (!ok) return;
        arr.splice(idx,1);
        template[sectionKey] = arr;
        // limpiar del estado del día
        state.checkedIds = (state.checkedIds||[]).map(String).filter(cid=>cid!==String(id));
        ev.checklistTemplate = template;
        ev.days[dayKey].checklistState = state;
        await put('events', ev);
        await renderChecklistTab();
        try{ showToast('Ítem eliminado.'); }catch(e){}
        return;
      }

      const dir = up ? -1 : 1;
      const j = idx + dir;
      if (j < 0 || j >= arr.length) return;
      [arr[idx], arr[j]] = [arr[j], arr[idx]];
      template[sectionKey] = arr;
      ev.checklistTemplate = template;
      await put('events', ev);
      await renderChecklistTab();
    });

    tab.addEventListener('change', async (e)=>{
      const cb = e.target.closest('.chk-box');
      const txt = e.target.closest('.chk-text');
      if (!(cb || txt)) return;
      const cur = await getMeta('currentEventId');
      const curId = cur ? parseInt(cur,10) : null;
      if (!curId) return;
      const dayKey = safeYMD(getSaleDayKeyPOS());
      const ev = await getEventByIdPOS(curId);
      if (!ev) return;
      const { template, state } = ensureChecklistDataPOS(ev, dayKey);

      if (cb){
        const id = cb.dataset.id;
        if (!id) return;
        const set = new Set((state.checkedIds||[]).map(String));
        if (cb.checked) set.add(String(id));
        else set.delete(String(id));
        state.checkedIds = Array.from(set);
        ev.days[dayKey].checklistState = state;
        await put('events', ev);
        return;
      }

      if (txt){
        const id = txt.dataset.id;
        const sectionKey = txt.dataset.section;
        const val = (txt.value || '').trim();
        if (!id || !sectionKey) return;
        const arr = Array.isArray(template[sectionKey]) ? template[sectionKey] : [];
        const it = arr.find(x=>String(x.id)===String(id));
        if (!it) return;
        it.text = val || it.text || 'Ítem';
        template[sectionKey] = arr;
        ev.checklistTemplate = template;
        await put('events', ev);
        return;
      }
    });
  }

  // Notas (debounced)
  const notes = document.getElementById('checklist-notes');
  if (notes){
    let t = null;
    notes.addEventListener('input', ()=>{
      clearTimeout(t);
      t = setTimeout(async ()=>{
        const cur = await getMeta('currentEventId');
        const curId = cur ? parseInt(cur,10) : null;
        if (!curId) return;
        const dayKey = safeYMD(getSaleDayKeyPOS());
        const ev = await getEventByIdPOS(curId);
        if (!ev) return;
        const { state } = ensureChecklistDataPOS(ev, dayKey);
        state.notes = notes.value || '';
        ev.days[dayKey].checklistState = state;
        await put('events', ev);
      }, 350);
    });
  }
}

// Event UI
function refreshGroupSelectFromEvents(evs) {
  const sel = $('#event-group-select');
  if (!sel) return;

  const hidden = new Set(getHiddenGroups());
  const groups = [];

  for (const ev of evs) {
    const g = (ev.groupName || '').trim();
    if (!g) continue;
    if (hidden.has(g)) continue;
    if (!groups.includes(g)) groups.push(g);
  }

  sel.innerHTML = '';

  const optEmpty = document.createElement('option');
  optEmpty.value = '';
  optEmpty.textContent = '— Selecciona grupo —';
  sel.appendChild(optEmpty);

  for (const g of groups) {
    const o = document.createElement('option');
    o.value = g;
    o.textContent = g;
    sel.appendChild(o);
  }

  const optNew = document.createElement('option');
  optNew.value = '__new__';
  optNew.textContent = '+ Crear nuevo grupo';
  sel.appendChild(optNew);

  const last = getLastGroupName();
  if (last && groups.includes(last)) {
    sel.value = last;
  } else {
    sel.value = '';
  }

  const newInput = $('#event-group-new');
  if (newInput) {
    if (sel.value === '__new__') {
      newInput.style.display = 'inline-block';
    } else {
      newInput.style.display = 'none';
      newInput.value = '';
    }
  }
}

async function refreshEventUI(){
  const evs = await getAll('events');
  refreshGroupSelectFromEvents(evs);
  const sel = $('#sale-event');
  const current = await getMeta('currentEventId');

  sel.innerHTML = '<option value="">— Selecciona evento —</option>';
  for (const ev of evs) {
    const opt = document.createElement('option'); opt.value = ev.id; 
    opt.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
  else sel.value = '';

  const status = $('#event-status');
  const cur = evs.find(e=> current && e.id == current);

  // Mantener por defecto el último Evento Maestro (grupo) trabajado.
  // Si el evento activo tiene grupo, lo tomamos como "último" automáticamente.
  try{
    const gCur = (cur && cur.groupName) ? String(cur.groupName).trim() : '';
    if (gCur){
      const hidden = new Set(getHiddenGroups());
      if (!hidden.has(gCur)){
        setLastGroupName(gCur);
        const gs = $('#event-group-select');
        if (gs && Array.from(gs.options).some(o=>o.value===gCur)){
          gs.value = gCur;
        }
      }
    }
  }catch(e){
    console.warn('No se pudo sincronizar grupo desde el evento activo', e);
  }
  if (cur && cur.closedAt) {
    status.style.display='block';
    status.textContent = `Evento cerrado el ${new Date(cur.closedAt).toLocaleString()}. Puedes reabrirlo o crear/activar otro.`;
  } else { status.style.display='none'; }
  $('#btn-reopen-event').style.display = (cur && cur.closedAt) ? 'inline-block' : 'none';

  // Toggle de Caja Chica por evento + refresco de Caja Chica si la pestaña está activa
  try{ await updatePettyToggleUI(cur); }catch(e){}
  try{ await renderCajaChica(); }catch(e){}

  const invSel = $('#inv-event');
  if (invSel){
    invSel.innerHTML='';
    for (const ev of evs){
      const o = document.createElement('option'); o.value = ev.id; o.textContent = ev.name + (ev.closedAt?' (cerrado)':''); invSel.appendChild(o);
    }
    if (current) invSel.value = current;
    else if (evs.length) invSel.value = evs[0].id;
  }

  // Selector de evento en Checklist (usa el mismo evento activo global del POS)
  const chkSel = document.getElementById('checklist-event');
  if (chkSel){
    chkSel.innerHTML = '<option value="">— Selecciona evento —</option>';
    for (const ev of evs){
      const o = document.createElement('option');
      o.value = ev.id;
      o.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
      chkSel.appendChild(o);
    }
    if (current) chkSel.value = current;
    else chkSel.value = '';
  }

  await updateSellEnabled();
  try{ await refreshProductSelect({ keepSelection:true }); }catch(e){ try{ await renderProductChips(); }catch(_){ } }
  try{ await renderExtrasUI(); }catch(e){}
  try{ await renderCajaChica(); }catch(e){}
  try{ await initVasosPanelPOS(); }catch(e){}
}

// --- Caja Chica por evento (toggle + helpers)
async function getEventByIdSafe(eventId){
  const evs = await getAll('events');
  return evs.find(e=>e.id===eventId) || null;
}

function eventPettyEnabled(ev){
  return !!(ev && ev.pettyEnabled);
}

async function setEventPettyEnabled(eventId, enabled){
  const ev = await getEventByIdSafe(eventId);
  if (!ev) return;
  ev.pettyEnabled = !!enabled;
  await put('events', ev);
}

async function eventHasPettyActivity(eventId){
  const pc = await getPettyCash(eventId);
  if (!pc || !pc.days) return false;
  const keys = Object.keys(pc.days);
  for (const k of keys){
    const day = pc.days[k];
    if (!day) continue;
    if (day.closedAt) return true;
    if (hasPettyDayActivity(day)) return true;
  }
  return false;
}

async function updatePettyToggleUI(curEvent){
  const t = document.getElementById('pc-event-toggle');
  const lbl = document.getElementById('pc-event-toggle-text');
  if (!t) return;
  const hasEvent = !!curEvent;
  const isClosed = !!(curEvent && curEvent.closedAt);
  const enabled = hasEvent && !isClosed;
  t.disabled = !enabled;
  t.checked = enabled ? !!curEvent.pettyEnabled : false;
  if (lbl){
    if (!hasEvent) lbl.textContent = '—';
    else if (isClosed) lbl.textContent = 'Evento cerrado';
    else lbl.textContent = t.checked ? 'Activa' : 'Desactivada';
  }
}

async function ensurePettyEnabledForEvent(eventId){
  const ev = await getEventByIdSafe(eventId);
  if (!ev) return false;
  if (eventPettyEnabled(ev)) return true;
  const ok = confirm('¿Deseas activar Caja Chica para este evento?\n\nSi la activas, el cierre del evento podrá exigir cierres diarios de Caja Chica cuando haya ventas en efectivo o movimientos.');
  if (!ok) return false;
  ev.pettyEnabled = true;
  await put('events', ev);
  try{ await updatePettyToggleUI(ev); }catch(e){}
  toast('Caja Chica activada para este evento.');
  return true;
}

async function onTogglePettyForCurrentEvent(){
  const t = document.getElementById('pc-event-toggle');
  if (!t) return;
  const curId = await getMeta('currentEventId');
  const ev = curId ? await getEventByIdSafe(curId) : null;
  if (!ev || ev.closedAt){
    t.checked = false;
    await updatePettyToggleUI(ev);
    return;
  }
  if (t.checked){
    const ok = confirm('¿Confirmas que deseas ACTIVAR Caja Chica para este evento?');
    if (!ok){ t.checked = false; await updatePettyToggleUI(ev); return; }
    ev.pettyEnabled = true;
    await put('events', ev);
    toast('Caja Chica activada.');
    await updatePettyToggleUI(ev);
    try{ await renderCajaChica(); }catch(e){}
  } else {
    const hasActivity = await eventHasPettyActivity(ev.id);
    if (hasActivity){
      alert('No se puede desactivar Caja Chica porque este evento ya tiene registros guardados (movimientos o cierres).');
      t.checked = true;
      await updatePettyToggleUI(ev);
      return;
    }
    ev.pettyEnabled = false;
    await put('events', ev);
    toast('Caja Chica desactivada.');
    await updatePettyToggleUI(ev);
    try{ await renderCajaChica(); }catch(e){}
  }
}

// Product select + stock label
async function refreshProductSelect(opts){
  opts = opts || {};
  const keepSelection = (opts.keepSelection !== false);

  const hiddenIds = await getHiddenProductIdsPOS();
  const all = await getAll('products');
  const list = all.filter(p => !hiddenIds.has(p.id));

  const sel = $('#sale-product');
  if (!sel) return;

  const prevVal = keepSelection ? String(sel.value || '').trim() : '';
  sel.innerHTML = '';

  // Productos
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (C${fmt(p.price)})${p.active===false?' [inactivo]':''}`;
    sel.appendChild(opt);
  }

  // Extras del evento activo
  try{
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false) : [];
    if (ev && extras.length){
      const og = document.createElement('optgroup');
      og.label = 'Extras';
      for (const x of extras){
        const opt = document.createElement('option');
        opt.value = `extra:${x.id}`;
        const flags = [];
        if (x.stock <= 0) flags.push('SIN STOCK');
        else if (x.stock <= x.lowStockAlert) flags.push('BAJO');
        opt.textContent = `${x.name} (C${fmt(x.unitPrice)})${flags.length ? ' ['+flags.join(', ')+']' : ''}`;
        og.appendChild(opt);
      }
      sel.appendChild(og);
    }
  }catch(e){
    console.warn('No se pudieron cargar Extras para el selector', e);
  }

  // Reseleccionar si aplica
  if (keepSelection && prevVal && Array.from(sel.options).some(o => o.value === prevVal)){
    sel.value = prevVal;
  } else {
    const first = sel.querySelector('option');
    if (first) sel.value = first.value;
  }

  await setSalePriceFromSelectionPOS();
  await renderProductChips();
  await refreshSaleStockLabel();
  recomputeTotal();
}

async function refreshSaleStockLabel(){
  const curId = await getMeta('currentEventId');
  const selVal = String($('#sale-product')?.value || '').trim();
  const item = parseSelectedSellItemValue(selVal);

  if (!curId || !item){
    $('#sale-stock').textContent='—';
    return;
  }

  if (item.kind === 'extra'){
    const ev = await getActiveEventPOS();
    const extras = ev ? sanitizeExtrasPOS(ev.extras) : [];
    const x = extras.find(z => Number(z.id) === Number(item.id));
    $('#sale-stock').textContent = x ? String(x.stock) : '—';
    return;
  }

  const prodId = item.id;
  const products = await getAll('products');
  const p = products.find(pp=>pp.id===prodId);
  if (!p || p.manageStock===false) { $('#sale-stock').textContent='—'; return; }
  const st = await computeStock(parseInt(curId,10), prodId);
  $('#sale-stock').textContent = st;
}

// --- Extras por evento (solo POS / por evento activo) ---
let editingExtraIdPOS = null;

function parseSelectedSellItemValue(val){
  const v = String(val || '').trim();
  if (!v) return null;
  if (v.startsWith('extra:')){
    const id = parseInt(v.slice(6), 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    return { kind:'extra', id };
  }
  const id = parseInt(v, 10);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { kind:'product', id };
}

function sanitizeExtrasPOS(raw){
  const arr = Array.isArray(raw) ? raw : [];
  const clean = [];
  for (const x of arr){
    if (!x) continue;
    const id = parseInt(x.id, 10);
    if (!id) continue;
    const name = String(x.name || '').trim();
    if (!name) continue;
    const stock = Number(x.stock || 0);
    const unitCost = Number(x.unitCost || 0);
    const unitPrice = Number(x.unitPrice || 0);
    const lowStockAlert = safeInt(x.lowStockAlert, 5);
    clean.push({
      id,
      name,
      stock: Number.isFinite(stock) ? stock : 0,
      unitCost: Number.isFinite(unitCost) ? unitCost : 0,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : 0,
      lowStockAlert: (lowStockAlert>0?lowStockAlert:5),
      active: (x.active === false) ? false : true,
      createdAt: x.createdAt || null,
      updatedAt: x.updatedAt || null
    });
  }
  return clean;
}

function ensureEventExtraSeqPOS(ev){
  if (!ev) return;
  const extras = sanitizeExtrasPOS(ev.extras);
  let maxId = 0;
  for (const x of extras) maxId = Math.max(maxId, Number(x.id) || 0);
  const cur = safeInt(ev.extraSeq, 0);
  ev.extraSeq = Math.max(cur, maxId);
  ev.extras = extras;
}

async function getActiveEventPOS(){
  const curId = await getMeta('currentEventId');
  if (!curId) return null;
  const evs = await getAll('events');
  const ev = evs.find(e => e.id === curId) || null;
  if (!ev || ev.closedAt) return null;
  ensureEventExtraSeqPOS(ev);
  return ev;
}

async function setSalePriceFromSelectionPOS(){
  const sel = $('#sale-product');
  if (!sel) return;
  const item = parseSelectedSellItemValue(sel.value);
  if (!item) return;
  if (item.kind === 'product'){
    const p = (await getAll('products')).find(x => x.id === item.id);
    if (p) $('#sale-price').value = p.price;
    return;
  }
  const ev = await getActiveEventPOS();
  if (!ev) return;
  const extras = sanitizeExtrasPOS(ev.extras);
  const x = extras.find(z => Number(z.id) === Number(item.id));
  if (x) $('#sale-price').value = x.unitPrice;
}

function updateChipsActiveFromSelectionPOS(){
  const sel = $('#sale-product');
  const item = parseSelectedSellItemValue(sel ? sel.value : '');
  document.querySelectorAll('#product-chips .chip').forEach(btn => {
    const kind = (btn.dataset.kind || 'product');
    let isActive = false;
    if (item){
      if (item.kind === 'product' && kind === 'product'){
        isActive = (parseInt(btn.dataset.id || '0', 10) === item.id);
      }
      if (item.kind === 'extra' && kind === 'extra'){
        isActive = (parseInt(btn.dataset.extraId || '0', 10) === item.id);
      }
    }
    btn.classList.toggle('active', isActive);
  });
}

function resetExtraFormPOS(){
  editingExtraIdPOS = null;
  const name = document.getElementById('extra-name');
  const stock = document.getElementById('extra-stock');
  const cost = document.getElementById('extra-cost');
  const price = document.getElementById('extra-price');
  const low = document.getElementById('extra-low');
  if (name) name.value = '';
  if (stock) stock.value = '';
  if (cost) cost.value = '';
  if (price) price.value = '';
  if (low) low.value = '';
  const btnCancel = document.getElementById('btn-cancel-extra');
  if (btnCancel) btnCancel.style.display = 'none';
}

async function renderExtrasUI(){
  const label = document.getElementById('extras-event-label');
  const note = document.getElementById('extras-disabled-note');
  const listEl = document.getElementById('extras-list');

  const ev = await getActiveEventPOS();
  const enabled = !!ev;

  if (label) label.textContent = enabled ? (ev.name || '—') : '—';
  if (note) note.style.display = enabled ? 'none' : 'block';

  const idsToDisable = ['extra-name','extra-stock','extra-cost','extra-price','extra-low','btn-save-extra'];
  for (const id of idsToDisable){
    const el = document.getElementById(id);
    if (el) el.disabled = !enabled;
  }

  if (!listEl) return;

  if (!enabled){
    listEl.innerHTML = '<div class="muted">Activa un evento para gestionar Extras.</div>';
    resetExtraFormPOS();
    return;
  }

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras).filter(x=>x.active!==false);

  if (!extras.length){
    listEl.innerHTML = '<div class="muted">Aún no hay Extras en este evento.</div>';
    return;
  }

  extras.sort((a,b)=> a.name.localeCompare(b.name));

  const rows = extras.map(x=>{
    const low = (x.stock <= x.lowStockAlert && x.stock > 0);
    const out = (x.stock <= 0);
    const cls = ['extra-row', low?'low':'', out?'out':''].filter(Boolean).join(' ');
    const flags = out ? '<span class="pill danger">SIN STOCK</span>' : (low ? '<span class="pill warn">BAJO</span>' : '');
    return `
      <div class="${cls}" data-id="${x.id}">
        <div class="extra-col extra-name"><strong>${escapeHtml(x.name)}</strong> ${flags}</div>
        <div class="extra-col extra-cost">C$${fmt(x.unitCost)}</div>
        <div class="extra-col extra-price">C$${fmt(x.unitPrice)}</div>
        <div class="extra-col extra-stock"><span class="stockpill ${low?'low':''}"><strong>${x.stock}</strong></span></div>
        <div class="extra-actions">
          <button class="btn-small extra-edit" data-action="edit" data-id="${x.id}">Editar</button>
          <button class="btn-small btn-ok extra-restock" data-action="restock" data-id="${x.id}">Agregar</button>
          <button class="btn-small btn-danger extra-del" data-action="del" data-id="${x.id}">Eliminar</button>
        </div>
      </div>`;
  }).join('');

  listEl.innerHTML = rows;
}

async function onSaveExtraPOS(){
  const ev = await getActiveEventPOS();
  if (!ev){
    alert('Debes activar un evento para crear Extras.');
    return;
  }

  const name = (document.getElementById('extra-name')?.value || '').trim();
  const stock = parseFloat(document.getElementById('extra-stock')?.value || '');
  const unitCost = parseFloat(document.getElementById('extra-cost')?.value || '');
  const unitPrice = parseFloat(document.getElementById('extra-price')?.value || '');
  const lowDefault = safeInt(document.getElementById('extra-low-default')?.value, 5);
  const lowStockAlert = safeInt(document.getElementById('extra-low')?.value, lowDefault);

  if (!name){ alert('Nombre de Extra es obligatorio'); return; }
  if (!Number.isFinite(stock) || stock < 0){ alert('Stock/Cantidad debe ser 0 o mayor'); return; }
  if (!Number.isFinite(unitCost) || unitCost < 0){ alert('Costo unitario es obligatorio (>= 0)'); return; }
  if (!Number.isFinite(unitPrice) || unitPrice <= 0){ alert('Precio unitario es obligatorio (> 0)'); return; }

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras);

  const nowIso = new Date().toISOString();

  if (editingExtraIdPOS){
    const x = extras.find(z => Number(z.id) === Number(editingExtraIdPOS));
    if (!x){
      alert('No se encontró el Extra a editar (posible cambio de evento).');
      resetExtraFormPOS();
      await renderExtrasUI();
      return;
    }
    x.name = name;
    x.stock = stock;
    x.unitCost = unitCost;
    x.unitPrice = unitPrice;
    x.lowStockAlert = (lowStockAlert>0?lowStockAlert:5);
    x.updatedAt = nowIso;
  } else {
    ev.extraSeq = safeInt(ev.extraSeq, 0) + 1;
    const newId = ev.extraSeq;
    extras.push({
      id: newId,
      name,
      stock,
      unitCost,
      unitPrice,
      lowStockAlert: (lowStockAlert>0?lowStockAlert:5),
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  ev.extras = extras;
  await put('events', ev);

  resetExtraFormPOS();
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });
  toast('Extra guardado');
}

async function onExtrasListClickPOS(e){
  const btn = e.target.closest('button');
  if (!btn) return;

  const action = btn.dataset.action;
  const extraId = parseInt(btn.dataset.id || '0', 10);
  if (!extraId) return;

  const ev = await getActiveEventPOS();
  if (!ev) return;

  ensureEventExtraSeqPOS(ev);
  const extras = sanitizeExtrasPOS(ev.extras);
  const x = extras.find(z => Number(z.id) === Number(extraId));
  if (!x) return;

  if (action === 'edit'){
    editingExtraIdPOS = extraId;
    const name = document.getElementById('extra-name');
    const stock = document.getElementById('extra-stock');
    const cost = document.getElementById('extra-cost');
    const price = document.getElementById('extra-price');
    const low = document.getElementById('extra-low');
    if (name) name.value = x.name;
    if (stock) stock.value = x.stock;
    if (cost) cost.value = x.unitCost;
    if (price) price.value = x.unitPrice;
    if (low) low.value = x.lowStockAlert;
    const btnCancel = document.getElementById('btn-cancel-extra');
    if (btnCancel) btnCancel.style.display = 'inline-block';
    return;
  }

  if (action === 'restock'){
    const raw = prompt(`Agregar stock a "${x.name}". Cantidad a sumar:`, '0');
    if (raw == null) return;
    const add = parseFloat(raw);
    if (!Number.isFinite(add) || add <= 0){ alert('Cantidad no válida'); return; }
    x.stock = Number(x.stock || 0) + add;
    x.updatedAt = new Date().toISOString();
    ev.extras = extras;
    await put('events', ev);
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    toast('Stock actualizado');
    return;
  }

  if (action === 'del'){
    const ok = confirm(`Eliminar Extra "${x.name}" del evento. No se borran ventas ya registradas. ¿Continuar?`);
    if (!ok) return;
    ev.extras = extras.filter(z => Number(z.id) !== Number(extraId));
    await put('events', ev);
    resetExtraFormPOS();
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    toast('Extra eliminado');
    return;
  }
}

async function revertExtraStockAfterSaleDeletePOS(sale){
  try{
    if (!sale || !sale.extraId || !sale.eventId) return;
    const evs = await getAll('events');
    const ev = evs.find(e => e.id === sale.eventId) || null;
    if (!ev) return;
    ensureEventExtraSeqPOS(ev);
    const extras = sanitizeExtrasPOS(ev.extras);
    const x = extras.find(z => Number(z.id) === Number(sale.extraId));
    if (!x) return;
    const q = Number(sale.qty || 0);
    x.stock = Number(x.stock || 0) + q;
    x.updatedAt = new Date().toISOString();
    ev.extras = extras;
    await put('events', ev);
    // refrescar UI si este es el evento activo
    const cur = await getMeta('currentEventId');
    if (cur && Number(cur) === Number(ev.id)){
      try{ await renderExtrasUI(); }catch(e){}
      try{ await refreshProductSelect({ keepSelection:true }); }catch(e){}
    }
  }catch(err){
    console.warn('No se pudo revertir stock de Extra al borrar venta', err);
  }
}

// Alias por compatibilidad (evitar regresiones por nombre)
async function revertExtraStockForSaleDeletePOS(sale){
  return revertExtraStockAfterSaleDeletePOS(sale);
}

// Inventory logic
async function getInventoryEntries(eventId){ const all = await getAll('inventory'); return all.filter(i=>i.eventId===eventId); }
async function getInventoryInit(eventId, productId){ const list = (await getInventoryEntries(eventId)).filter(i=>i.productId===productId && i.type==='init'); return list.length ? list.sort((a,b)=> (a.id-b.id))[list.length-1] : null; }
async function setInitialStock(eventId, productId, qty){ let init = await getInventoryInit(eventId, productId); if (init){ init.qty = qty; init.time = new Date().toISOString(); await put('inventory', init); } else { await put('inventory', {eventId, productId, type:'init', qty, notes:'Inicial', time:new Date().toISOString()}); } }
async function addRestock(eventId, productId, qty, extra){
  if (qty<=0) throw new Error('Reposición debe ser > 0');
  const row = {eventId, productId, type:'restock', qty, notes:'Reposición', time:new Date().toISOString()};
  if (extra && typeof extra === 'object') {
    try { Object.assign(row, extra); } catch {}
  }
  await put('inventory', row);
}

async function addAdjust(eventId, productId, qty, notes){ if (!qty) throw new Error('Ajuste no puede ser 0'); await put('inventory', {eventId, productId, type:'adjust', qty, notes: notes||'Ajuste', time:new Date().toISOString()}); }
async function computeStock(eventId, productId){ const inv = await getInventoryEntries(eventId); const ledger = inv.filter(i=>i.productId===productId).reduce((a,b)=>a+(b.qty||0),0); const sales = (await getAll('sales')).filter(s=>s.eventId===eventId && s.productId===productId).reduce((a,b)=>a+(b.qty||0),0); return ledger - sales; }

// --- Venta por vaso (fraccionamiento de galones) ---
const ML_PER_GALON = 3800;

function safeInt(val, def){
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : def;
}

function sanitizeFractionBatches(raw){
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(b=>{
    const y = safeInt(b && b.yieldCupsPerGallon, 22);
    const gallons = safeInt(b && b.gallons, 0);
    const mlPerCup = (b && typeof b.mlPerCup === 'number' && isFinite(b.mlPerCup) && b.mlPerCup > 0)
      ? b.mlPerCup
      : (ML_PER_GALON / Math.max(1, y));
    const cupsCreated = safeInt(b && b.cupsCreated, gallons * y);
    const cupsRemaining = safeInt(b && b.cupsRemaining, cupsCreated);
    return {
      batchId: (b && b.batchId ? String(b.batchId) : '') || ('fb-' + Math.random().toString(36).slice(2)),
      timestamp: (b && b.timestamp ? String(b.timestamp) : new Date().toISOString()),
      gallons,
      yieldCupsPerGallon: y,
      cupsCreated,
      cupsRemaining,
      mlPerCup,
      note: (b && b.note ? String(b.note) : '')
    };
  });
}

function isCupSaleRecord(sale){
  if (!sale) return false;
  if (sale.vaso === true) return true;
  if (Array.isArray(sale.fifoBreakdown) && sale.fifoBreakdown.length) return true;
  return false;
}

async function getEventByIdPOS(eventId){
  const evs = await getAll('events');
  return evs.find(e => e.id === eventId) || null;
}

async function getVasoProductPOS(){
  const prods = await getAll('products');
  // Prioridad: producto marcado como interno para "Venta por vaso"
  return prods.find(p => p && p.internalType === 'cup_portion')
    || prods.find(p => normName(p.name) === 'vaso')
    || null;
}

function fmtMl(value){
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 10) / 10;
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(1);
}

function computeCupStatsFromEvent(ev, allSales){
  const batches = sanitizeFractionBatches(ev && ev.fractionBatches);
  batches.sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''));

  const cupsAvailable = batches.reduce((a,b)=> a + safeInt(b.cupsRemaining, 0), 0);
  const gallonsFractionedTotal = batches.reduce((a,b)=> a + safeInt(b.gallons, 0), 0);
  const cupsCreatedTotal = batches.reduce((a,b)=> a + safeInt(b.cupsCreated, 0), 0);

  let soldPaid = 0;
  let courtesy = 0;

  (allSales || []).forEach(s=>{
    if (!s || !ev || s.eventId !== ev.id) return;
    if (!isCupSaleRecord(s)) return;
    const q = Number(s.qty || 0);
    const qty = Number.isFinite(q) ? q : 0;
    if (s.courtesy || s.isCourtesy) courtesy += Math.abs(qty);
    else soldPaid += Math.abs(qty);
  });

  const remnantMl = batches.reduce((a,b)=> a + (safeInt(b.cupsRemaining, 0) * (Number(b.mlPerCup) || 0)), 0);

  return { batches, cupsAvailable, gallonsFractionedTotal, cupsCreatedTotal, soldPaid, courtesy, remnantMl };
}

async function refreshCupBlock(){
  const evId = await getMeta('currentEventId');
  const block = document.getElementById('cup-block');
  if (!block) return;

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  if (!evId){
    setText('cup-available','0');
    setText('cup-gallons','0');
    setText('cup-created','0');
    setText('cup-sold','0');
    setText('cup-courtesy','0');
    setText('cup-remaining','0');
    setText('cup-remnant','0');
    return;
  }

  const ev = await getEventByIdPOS(evId);
  const allSales = await getAll('sales');
  const stats = computeCupStatsFromEvent(ev, allSales);

  setText('cup-available', String(stats.cupsAvailable));
  setText('cup-gallons', String(stats.gallonsFractionedTotal));
  setText('cup-created', String(stats.cupsCreatedTotal));
  setText('cup-sold', String(stats.soldPaid));
  setText('cup-courtesy', String(stats.courtesy));
  setText('cup-remaining', String(stats.cupsAvailable));
  setText('cup-remnant', fmtMl(stats.remnantMl));

  // Default de precio por vaso (si está vacío o en 0)
  try{
    const inp = document.getElementById('cup-price');
    if (inp){
      const cur = parseFloat(inp.value || '0');
      if (!cur){
        const vasoProd = await getVasoProductPOS();
        if (vasoProd && Number(vasoProd.price) > 0) inp.value = vasoProd.price;
      }
    }
  }catch(e){}
}

async function fractionGallonsToCupsPOS(){
  const evId = await getMeta('currentEventId');
  if (!evId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(evId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  const saleDate = document.getElementById('sale-date')?.value || '';
  // Candado: no permitir fraccionamiento ni operaciones de venta si el día está cerrado
  if (!(await guardSellDayOpenOrToastPOS(ev, saleDate))) return;

  const gallonsToFraction = safeInt(document.getElementById('cup-fraction-gallons')?.value, 0);
  const yieldCupsPerGallon = safeInt(document.getElementById('cup-yield')?.value, 22);

  if (!(gallonsToFraction >= 1)) { alert('Galones a fraccionar debe ser un entero >= 1'); return; }
  if (!(yieldCupsPerGallon >= 1)) { alert('Vasos por galón debe ser un entero >= 1'); return; }

  // Validar inventario de Galón (producto terminado) usando el sistema existente
  const products = await getAll('products');
  const galProd = products.find(p => mapProductNameToFinishedId(p.name) === 'galon') || null;
  if (!galProd){
    alert('No encontré el producto "Galón 3800ml" en Productos. Restaura productos base o créalo.');
    return;
  }

  const stockEvent = await computeStock(evId, galProd.id);
  if (stockEvent < gallonsToFraction){
    alert(`Inventario insuficiente de Galón para este evento. Disponible: ${stockEvent}. Intentas fraccionar: ${gallonsToFraction}.`);
    return;
  }

  // Descontar inventario por evento (ledger) y central (producto terminado)
  try{
    await addAdjust(evId, galProd.id, -gallonsToFraction, `Fraccionado a vasos (${yieldCupsPerGallon} vasos/galón)`);
  }catch(e){
    console.error('No se pudo registrar ajuste de inventario por evento al fraccionar', e);
  }

  try{
    applyFinishedFromSalePOS({ productName: galProd.name, qty: gallonsToFraction }, +1);
  }catch(e){
    console.error('No se pudo actualizar inventario central al fraccionar', e);
  }

  const batchId = 'fb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
  const cupsCreated = gallonsToFraction * yieldCupsPerGallon;
  const mlPerCup = ML_PER_GALON / yieldCupsPerGallon;

  const batches = sanitizeFractionBatches(ev.fractionBatches);
  batches.push({
    batchId,
    timestamp: new Date().toISOString(),
    gallons: gallonsToFraction,
    yieldCupsPerGallon,
    cupsCreated,
    cupsRemaining: cupsCreated,
    mlPerCup,
    note: ''
  });

  ev.fractionBatches = batches;
  await put('events', ev);

  await renderInventario();
  await refreshSaleStockLabel();
  await refreshCupBlock();
  toast(`Fraccionados ${gallonsToFraction} galón(es) a ${yieldCupsPerGallon} vasos/galón → +${cupsCreated} vasos`);
}

function fifoTakeCups(batches, qty){
  let remaining = qty;
  const breakdown = [];
  const ordered = [...batches].sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''));
  for (const b of ordered){
    if (remaining <= 0) break;
    const avail = safeInt(b.cupsRemaining, 0);
    if (avail <= 0) continue;
    const take = Math.min(avail, remaining);
    if (take > 0){
      b.cupsRemaining = avail - take;
      breakdown.push({ batchId: b.batchId, cupsTaken: take, mlPerCup: b.mlPerCup });
      remaining -= take;
    }
  }
  return { ok: remaining === 0, breakdown };
}

async function sellCupsPOS(isCourtesy){
  const evId = await getMeta('currentEventId');
  if (!evId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(evId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  const saleDate = document.getElementById('sale-date')?.value || '';
  // Candado: no permitir fraccionamiento ni operaciones de venta si el día está cerrado
  if (!(await guardSellDayOpenOrToastPOS(ev, saleDate))) return;

  const qty = safeInt(document.getElementById('cup-qty')?.value, 0);
  if (!(qty >= 1)) { alert('Cantidad de vasos debe ser un entero >= 1'); return; }

  const allSales = await getAll('sales');
  const stats = computeCupStatsFromEvent(ev, allSales);
  if (stats.cupsAvailable < qty){
    alert('No hay vasos disponibles. Fraccioná un galón.');
    return;
  }

  const batches = stats.batches; // sanitized
  const taken = fifoTakeCups(batches, qty);
  if (!taken.ok){
    alert('No hay vasos suficientes. Fraccioná un galón.');
    return;
  }

  ev.fractionBatches = batches;
  await put('events', ev);

  const date = document.getElementById('sale-date')?.value || '';
  if (!date){ alert('Selecciona una fecha'); return; }

  // Candado: si Caja Chica está activada y el día está cerrado, NO permitir ventas por vaso
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;

  const payment = document.getElementById('sale-payment')?.value || 'efectivo';
  const customer = (payment === 'credito') ? (document.getElementById('sale-customer')?.value || '').trim() : '';
  if (payment === 'credito' && !customer){ alert('Ingresa el nombre del cliente (crédito)'); return; }

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
  }

  let vasoProd = await getVasoProductPOS();
  // Si alguien borró el producto interno "Vaso", lo recreamos (sin exponerlo en el selector)
  if (!vasoProd){
    try{
      const newId = await put('products', {name:'Vaso', price:100, manageStock:false, active:false, internalType:'cup_portion'});
      vasoProd = {id: newId, price:100, manageStock:false, active:false, internalType:'cup_portion'};
    }catch(e){}
  }
  const productId = vasoProd ? vasoProd.id : 0;

  const unitPrice = isCourtesy ? 0 : parseFloat(document.getElementById('cup-price')?.value || '0');
  if (!isCourtesy && !(unitPrice > 0)){
    alert('Ingresa un precio por vaso (> 0) o usa "Registrar cortesía".');
    return;
  }

  const productName = isCourtesy ? 'Vaso (Cortesía)' : 'Vaso';
  const total = isCourtesy ? 0 : (unitPrice * qty);

  const now = new Date();
  const time = now.toTimeString().slice(0,5);

  // Costo por vaso (COGS): derivado del costo del Galón configurado en Calculadora (Recetas).
  // Usamos el breakdown FIFO (mlPerCup) para estimar el costo exacto por ml servido.
  const costoGallon = getCostoUnitarioProducto('Galón 3800ml') || getCostoUnitarioProducto('Galón') || 0;
  let lineCost = 0;
  if (costoGallon > 0) {
    const costPerMl = costoGallon / ML_PER_GALON;
    let totalMl = 0;
    for (const it of (taken.breakdown || [])) {
      const cupsTaken = Number(it && it.cupsTaken) || 0;
      const mlPerCup = Number(it && it.mlPerCup) || 0;
      if (cupsTaken > 0 && mlPerCup > 0) totalMl += cupsTaken * mlPerCup;
    }
    if (!(totalMl > 0)) {
      // fallback ultra seguro
      totalMl = qty * (ML_PER_GALON / 22);
    }
    lineCost = round2(costPerMl * totalMl);
  }
  const costPerUnit = (qty > 0) ? round2(lineCost / qty) : 0;
  const lineProfit = round2(total - lineCost);

  const saleRecord = {
    date,
    time,
    createdAt: Date.now(),
    eventId: evId,
    eventName: ev.name || 'General',
    productId,
    productName,
    unitPrice,
    qty,
    discount: 0,
    payment,
    bankId: (payment === 'transferencia') ? bankId : null,
    bankName: (payment === 'transferencia') ? bankName : null,
    courtesy: !!isCourtesy,
    isCourtesy: !!isCourtesy,
    isReturn: false,
    customer,
    courtesyTo: isCourtesy ? ((document.getElementById('sale-courtesy-to')?.value || '').trim()) : '',
    total,
    notes: isCourtesy ? 'Cortesía por vaso' : 'Venta por vaso',
    costPerUnit,
    lineCost,
    lineProfit,
    vaso: true,
    fifoBreakdown: taken.breakdown
  };

  try{ await ensureNewSaleSeqIdPOS(ev, saleRecord); }catch(e){ console.warn('No se pudo asignar N° por evento a venta por vaso', e); }

  const saleId = await put('sales', saleRecord);
  saleRecord.id = saleId;

  try{
    await createJournalEntryForSalePOS(saleRecord);
  }catch(e){
    console.error('No se pudo generar asiento contable para venta por vaso', e);
  }

  const qtyInp = document.getElementById('cup-qty');
  if (qtyInp) qtyInp.value = 1;

  await renderDay();
  await renderSummary();
  await refreshSaleStockLabel();
  await renderInventario();
  await refreshCupBlock();
  toast(isCourtesy ? 'Cortesía registrada' : 'Venta por vaso agregada');
}

async function revertCupConsumptionFromSalePOS(sale){
  if (!sale || !isCupSaleRecord(sale)) return;

  const evId = sale.eventId;
  if (!evId) return;

  const ev = await getEventByIdPOS(evId);
  if (!ev) return;

  const batches = sanitizeFractionBatches(ev.fractionBatches);

  const qAbs = Math.abs(Number(sale.qty || 0)) || 0;
  const breakdown = Array.isArray(sale.fifoBreakdown) ? sale.fifoBreakdown : [];

  if (breakdown.length){
    for (const item of breakdown){
      const bid = (item.batchId || '').toString();
      const taken = safeInt(item.cupsTaken, 0);
      if (!bid || !taken) continue;

      const b = batches.find(x => String(x.batchId) === bid);
      if (b){
        b.cupsRemaining = safeInt(b.cupsRemaining, 0) + taken;
      } else {
        const mlPerCup = (typeof item.mlPerCup === 'number' && isFinite(item.mlPerCup) && item.mlPerCup > 0)
          ? item.mlPerCup
          : (ML_PER_GALON / 22);
        const yieldGuess = Math.max(1, Math.round(ML_PER_GALON / mlPerCup));
        batches.push({
          batchId: 'adj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
          timestamp: new Date().toISOString(),
          gallons: 0,
          yieldCupsPerGallon: yieldGuess,
          cupsCreated: 0,
          cupsRemaining: taken,
          mlPerCup,
          note: 'Ajuste por eliminación (batch faltante)'
        });
      }
    }
  } else if (qAbs) {
    const oldest = batches.sort((a,b)=> (a.timestamp||'').localeCompare(b.timestamp||''))[0];
    if (oldest){
      oldest.cupsRemaining = safeInt(oldest.cupsRemaining, 0) + qAbs;
    } else {
      batches.push({
        batchId: 'adj-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7),
        timestamp: new Date().toISOString(),
        gallons: 0,
        yieldCupsPerGallon: 22,
        cupsCreated: 0,
        cupsRemaining: qAbs,
        mlPerCup: ML_PER_GALON / 22,
        note: 'Ajuste por eliminación (sin batches)'
      });
    }
  }

  ev.fractionBatches = batches;
  await put('events', ev);
  await refreshCupBlock();
}


// Importar inventario desde Control de Lotes
async function importFromLoteToInventory(){
  const evSel = $('#inv-event');
  let evId = evSel && evSel.value ? parseInt(evSel.value,10) : null;
  if (!evId){
    alert('Primero selecciona un evento.');
    return;
  }
  let lotes = [];
  try {
    const raw = A33Storage.getItem('arcano33_lotes');
    if (raw) lotes = JSON.parse(raw) || [];
    if (!Array.isArray(lotes)) lotes = [];
  } catch (e) {
    alert('No se pudo leer la información de lotes guardada en el navegador.');
    return;
  }
  if (!lotes.length){
    alert('No hay lotes registrados en el Control de Lotes.');
    return;
  }
  const listaCodigos = lotes
    .map(l => (l.codigo || '').trim())
    .filter(c => c)
    .join(', ');
  const codigo = prompt('Escribe el CÓDIGO del lote que quieres asignar a este evento (códigos disponibles: ' + (listaCodigos || 'ninguno') + '):');
  if (!codigo) return;
  const codigoNorm = (codigo || '').toString().toLowerCase().trim();
  const lote = lotes.find(l => ((l.codigo || '').toString().toLowerCase().trim() === codigoNorm));
  if (!lote){
    alert('No se encontró un lote con ese código.');
    return;
  }
  const stamp = new Date().toISOString();
  const cargaId = 'lc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,7);
  const map = [
    { field: 'pulso', name: 'Pulso 250ml' },
    { field: 'media', name: 'Media 375ml' },
    { field: 'djeba', name: 'Djeba 750ml' },
    { field: 'litro', name: 'Litro 1000ml' },
    { field: 'galon', name: 'Galón 3800ml' }
  ];
  const products = await getAll('products');
  const norm = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  let total = 0;
  for (const m of map){
    const rawQty = (lote[m.field] ?? '0').toString();
    const qty = parseInt(rawQty, 10);
    if (!(qty > 0)) continue;
    const prod = products.find(p => norm(p.name) === norm(m.name));
    if (!prod) continue;
    await addRestock(evId, prod.id, qty, {
      source: 'lote',
      loteCodigo: (lote.codigo || ''),
      loteId: (lote.id != null ? lote.id : null),
      loteCargaId: cargaId,
      time: stamp,
      notes: 'Reposición (lote ' + (lote.codigo || '') + ')'
    });
    total += qty;
  }
  await renderInventario();
  await refreshSaleStockLabel();
  alert('Se agregó inventario desde el lote "' + (lote.codigo || '') + '" al evento seleccionado.');
}


// Lotes cargados en este evento (solo informativo)
async function renderLotesCargadosEvento(eventId){
  const tbody = $('#tbl-lotes-evento tbody');
  const badge = $('#lotes-count');
  if (!tbody) return;

  tbody.innerHTML = '';

  const entries = await getInventoryEntries(eventId);
  const rows = (entries || [])
    .filter(e => e && e.type === 'restock' && (e.loteCodigo || e.source === 'lote'))
    .sort((a,b)=> (b.time||'').localeCompare(a.time||''));

  const prods = await getAll('products');
  const pMap = new Map((prods||[]).map(p => [p.id, p]));

  const norm = s => (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  function presKeyFromName(name){
    const n = norm(name);
    if (!n) return '';
    if (n.includes('pulso') && n.includes('250')) return 'P';
    if (n.includes('media') && n.includes('375')) return 'M';
    if (n.includes('djeba') && n.includes('750')) return 'D';
    if (n.includes('litro') && n.includes('1000')) return 'L';
    if (n.includes('galon') && n.includes('3800')) return 'G';
    // fallback por palabra (por si el nombre no incluye ml)
    if (n.includes('pulso')) return 'P';
    if (n.includes('media')) return 'M';
    if (n.includes('djeba')) return 'D';
    if (n.includes('litro')) return 'L';
    if (n.includes('galon')) return 'G';
    return '';
  }

  // Agrupar: 1 fila por cada "carga" de lote
  const groups = new Map();
  for (const it of rows){
    const loteCodigo = (it.loteCodigo || '').toString().trim();
    const time = (it.time || '').toString();
    const gKey = it.loteCargaId
      ? String(it.loteCargaId)
      : ((loteCodigo || '—') + '|' + (time || ''));
    let g = groups.get(gKey);
    if (!g){
      g = { loteCodigo: loteCodigo || '—', time: time || '', P:0, M:0, D:0, L:0, G:0 };
      groups.set(gKey, g);
    }
    if ((g.loteCodigo === '—' || !g.loteCodigo) && loteCodigo) g.loteCodigo = loteCodigo;
    if (!g.time && time) g.time = time;

    const p = pMap.get(it.productId);
    const key = presKeyFromName(p ? (p.name || '') : '');
    const qty = Number(it.qty) || 0;
    if (key) g[key] = (Number(g[key]) || 0) + qty;
  }

  const out = Array.from(groups.values()).sort((a,b)=> (b.time||'').localeCompare(a.time||''));
  if (badge) badge.textContent = String(out.length || 0);

  if (!out.length){
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="7"><small class="muted">No hay lotes cargados en este evento.</small></td>';
    tbody.appendChild(tr);
    return;
  }

  for (const g of out){
    const dt = g.time ? new Date(g.time).toLocaleString('es-NI') : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml((g.loteCodigo || '—').toString())}</td>
      <td>${escapeHtml(dt || '')}</td>
      <td>${Number(g.P)||0}</td>
      <td>${Number(g.M)||0}</td>
      <td>${Number(g.D)||0}</td>
      <td>${Number(g.L)||0}</td>
      <td>${Number(g.G)||0}</td>
    `;
    tbody.appendChild(tr);
  }
}


// Inventario UI
async function renderInventario(){
  const tbody = $('#tbl-inv tbody');
  if (!tbody) return;
  tbody.innerHTML='';

  const evSel = $('#inv-event');
  let evId = evSel && evSel.value ? parseInt(evSel.value,10) : null;
  if (!evId){
    const evs = await getAll('events');
    if (evs.length) evId = evs[0].id;
    if (evSel && evId) invSel.value = evId;
  }
  if (!evId){
    // Limpia el bloque informativo de lotes para evitar datos viejos
    const ltBody = $('#tbl-lotes-evento tbody');
    const badge = $('#lotes-count');
    if (ltBody) ltBody.innerHTML = '<tr><td colspan="7"><small class="muted">No hay eventos.</small></td></tr>';
    if (badge) badge.textContent = '0';

    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="8">No hay eventos. Crea uno en la pestaña Vender.</td>';
    tbody.appendChild(tr);
    return;
  }

  // Bloque informativo: lotes cargados en este evento
  await renderLotesCargadosEvento(evId);

  const prods = await getAll('products');
  const hiddenIds = await getHiddenProductIdsPOS();
  for (const p of prods){
    if (hiddenIds.has(p.id)) continue;
    const st = await computeStock(evId, p.id);
    const init = await getInventoryInit(evId, p.id);
    const disabled = (p.manageStock===false) ? 'disabled' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td><input type="checkbox" class="inv-active" data-id="${p.id}" ${p.active===false?'':'checked'}></td>
      <td><input type="checkbox" class="inv-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}></td>
      <td><input class="inv-inicial a33-num" data-a33-default="${init?init.qty:0}" data-id="${p.id}" type="number" inputmode="numeric" step="1" value="${init?init.qty:0}" ${disabled}></td>
      <td><input class="inv-repo" data-id="${p.id}" type="number" inputmode="numeric" step="1" placeholder="+" ${disabled}></td>
      <td><input class="inv-ajuste" data-id="${p.id}" type="number" inputmode="numeric" step="1" placeholder="+/-" ${disabled}></td>
      <td><span class="stockpill ${st<=0?'low':''}">${st}</span></td>
      <td class="actions">
        <button class="act-guardar-inicial" data-id="${p.id}" ${disabled}>Guardar inicial</button>
        <button class="act-reponer" data-id="${p.id}" ${disabled}>Reponer</button>
        <button class="act-ajustar" data-id="${p.id}" ${disabled}>Ajustar</button>
      </td>
    `;
    if (p.manageStock===false) tr.classList.add('dim');
    tbody.appendChild(tr);
  }
}

// Inventario: listeners
document.addEventListener('click', async (e)=>{
  if (e.target.classList.contains('act-guardar-inicial')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-inicial').value||'0',10);
    await setInitialStock(evId, pid, isNaN(qty)?0:qty);
    await renderInventario(); await refreshSaleStockLabel();
    toast('Inicial guardado');
  }
  if (e.target.classList.contains('act-reponer')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-repo').value||'0',10);
    if (!(qty>0)) { alert('Ingresa una reposición > 0'); return; }
    await addRestock(evId, pid, qty);
    tr.querySelector('.inv-repo').value='';
    await renderInventario(); await refreshSaleStockLabel();
    toast('Reposición agregada');
  }
  if (e.target.classList.contains('act-ajustar')){
    const pid = parseInt(e.target.dataset.id,10);
    const evId = parseInt($('#inv-event').value||'0',10);
    const tr = e.target.closest('tr');
    const qty = parseInt(tr.querySelector('.inv-ajuste').value||'0',10);
    if (!qty) { alert('Ingresa un ajuste (positivo o negativo)'); return; }
    await addAdjust(evId, pid, qty, 'Ajuste manual');
    tr.querySelector('.inv-ajuste').value='';
    await renderInventario(); await refreshSaleStockLabel();
    toast('Ajuste registrado');
  }
});

document.addEventListener('change', async (e)=>{
  if (e.target.classList.contains('inv-manage') || e.target.classList.contains('inv-active')){
    const id = parseInt(e.target.dataset.id||'0',10);
    const all = await getAll('products');
    const cur = all.find(px=>px.id===id); if (!cur) return;
    if (e.target.classList.contains('inv-manage')) cur.manageStock = e.target.checked;
    if (e.target.classList.contains('inv-active')) cur.active = e.target.checked;
    await put('products', cur);
    await renderInventario(); await renderProductChips(); await refreshProductSelect();
  }
});

// Day list filtered by current event
async function renderDay(){
  try {
    const d = $('#sale-date').value;
    const curId = await getMeta('currentEventId');
    const tbody = $('#tbl-day tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!curId){ 
      $('#day-total').textContent = fmt(0); 
      return; 
    }
    const allSales = await getAll('sales');
    const banks = await getAllBanksSafe();
    const bankMap = new Map();
    for (const b of banks){
      if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
    }
    const filtered = allSales.filter(s => s.eventId === curId && s.date === d);
    let total = 0;
    // Más reciente primero
    filtered.sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a)));
    for (const s of filtered){
      total += Number(s.total || 0);
      const payClass = s.payment==='efectivo'
        ? 'pay-ef'
        : (s.payment==='transferencia' ? 'pay-tr' : 'pay-cr');
      const payTxt = s.payment==='efectivo'
        ? 'Efec'
        : (s.payment==='transferencia' ? (`Transferencia · ${getSaleBankLabel(s, bankMap)}`) : 'Cred');
      const tr = document.createElement('tr');
      const seqTxt = getSaleSeqDisplayPOS(s);
      const timeTxt = getSaleTimeTextPOS(s);
      tr.innerHTML = `<td>${seqTxt ? ('#' + seqTxt + ' · ') : ''}${timeTxt}</td>
        <td>${s.productName}</td>
        <td>${s.qty}</td>
        <td>${fmt(s.unitPrice)}</td>
        <td>${fmt(getSaleDiscountTotalPOS(s))}</td>
        <td>${fmt(s.total)}</td>
        <td><span class="tag ${payClass}">${payTxt}</span></td>
        <td>${s.courtesy?'✓':''}</td>
        <td>${s.isReturn?'✓':''}</td>
        <td>${s.customer||''}</td>
        <td>${s.courtesyTo||''}</td>
        <td><button data-id="${s.id}" title="Eliminar venta" class="btn-danger btn-mini del-sale">Eliminar</button></td>`;
      tbody.appendChild(tr);
    }
    $('#day-total').textContent = fmt(total);
  } catch (e) {
    console.error('Error en renderDay', e);
    const tbody = $('#tbl-day tbody');
    if (tbody) tbody.innerHTML = '';
    $('#day-total').textContent = fmt(0);
  }
}

// Summary (extendido con costo y utilidad)
async function renderSummary(){
  const sales = await getAll('sales');
  const events = await getAll('events');
  const products = await getAll('products');

  const productById = new Map();
  const productByName = new Map();
  for (const p of (products || [])){
    if (!p) continue;
    if (p.id != null) productById.set(Number(p.id), p);
    if (p.name) productByName.set(String(p.name), p);
  }

  const isCourtesySale = (s) => !!(s && (s.courtesy || s.isCourtesy));
  const normalizeCourtesyProductName = (name) => String(name || '—').replace(/\s*\(Cortesía\)\s*$/i, '').trim() || '—';

  const getLineCost = (s) => {
    if (!s) return 0;
    if (typeof s.lineCost === 'number' && Number.isFinite(s.lineCost)) return Number(s.lineCost || 0);
    if (typeof s.costPerUnit === 'number' && Number.isFinite(s.costPerUnit)){
      const qty = Number(s.qty || 0);
      return Number(s.costPerUnit || 0) * qty;
    }
    return 0;
  };

  const getListUnitPrice = (s) => {
    if (!s) return 0;
    const unit = Number(s.unitPrice || 0);
    if (unit > 0) return unit;

    const pid = (s.productId != null) ? Number(s.productId) : null;
    if (pid != null && productById.has(pid)){
      const p = productById.get(pid);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    const n = normalizeCourtesyProductName(s.productName || '');
    if (n && productByName.has(n)){
      const p = productByName.get(n);
      const pr = Number(p && p.price) || 0;
      if (pr > 0) return pr;
    }

    return 0;
  };

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){
    if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
  }

  const transferByBank = new Map();

  // Ventas reales (ingresos)
  let grand = 0;
  let grandCost = 0;
  let grandProfit = 0;

  // Cortesías (impacto real + equivalente informativo)
  let courtesyCost = 0;
  let courtesyQty = 0; // unidades (suma de qty abs)
  let courtesyEquiv = 0;
  let courtesyTx = 0;

  const courtesyByProd = new Map(); // name -> { qty, cost, equiv }

  const byDay = new Map();
  const byProd = new Map();
  const byPay = new Map();
  const byEvent = new Map();

  for (const s of (sales || [])){
    if (!s) continue;

    const total = Number(s.total || 0);
    const courtesy = isCourtesySale(s);

    if (!courtesy){
      grand += total;

      byDay.set(s.date, (byDay.get(s.date) || 0) + total);
      byProd.set(s.productName, (byProd.get(s.productName) || 0) + total);
      byPay.set(s.payment || 'efectivo', (byPay.get(s.payment || 'efectivo') || 0) + total);
      byEvent.set(s.eventName || 'General', (byEvent.get(s.eventName || 'General') || 0) + total);

      // Transferencias por banco
      if ((s.payment || '') === 'transferencia'){
        const label = getSaleBankLabel(s, bankMap);
        const cur = transferByBank.get(label) || { total: 0, count: 0 };
        cur.total += total;
        cur.count += 1;
        transferByBank.set(label, cur);
      }

      // Costo y utilidad aproximada (ventas reales)
      const lineCost = getLineCost(s);
      let lineProfit = 0;
      if (typeof s.lineProfit === 'number' && Number.isFinite(s.lineProfit)) {
        lineProfit = Number(s.lineProfit || 0);
      } else {
        lineProfit = total - lineCost;
      }
      grandCost += lineCost;
      grandProfit += lineProfit;

    } else {
      courtesyTx += 1;

      const qRaw = Number(s.qty || 0);
      const absQty = Math.abs(qRaw);
      const sign = (s.isReturn || qRaw < 0) ? -1 : 1;

      courtesyQty += absQty;

      const lineCost = getLineCost(s);
      courtesyCost += lineCost;

      const listUnit = getListUnitPrice(s);
      const eq = sign * absQty * listUnit;
      courtesyEquiv += eq;

      const pname = normalizeCourtesyProductName(s.productName);
      const prev = courtesyByProd.get(pname) || { qty: 0, cost: 0, equiv: 0 };
      prev.qty += absQty;
      prev.cost += lineCost;
      prev.equiv += eq;
      courtesyByProd.set(pname, prev);
    }
  }

  // Acumular también lo archivado por evento (si existiera)
  for (const ev of (events || [])){
    if (ev.archive && ev.archive.totals){
      const t = ev.archive.totals;

      grand += (t.grand || 0);
      byEvent.set(ev.name, (byEvent.get(ev.name) || 0) + (t.grand || 0));

      if (t.byPay){
        for (const k of Object.keys(t.byPay)){
          byPay.set(k, (byPay.get(k) || 0) + (t.byPay[k] || 0));
        }
      }

      // Por producto: excluir cualquier llave tipo "(Cortesía)"
      if (t.byProduct){
        for (const k of Object.keys(t.byProduct)){
          if (/\(Cortesía\)/i.test(String(k))) continue;
          byProd.set(k, (byProd.get(k) || 0) + (t.byProduct[k] || 0));
        }
      }

      if (t.byDay){
        for (const k of Object.keys(t.byDay)){
          byDay.set(k, (byDay.get(k) || 0) + (t.byDay[k] || 0));
        }
      }

      // Nota: por ahora no tenemos costo/utilidad/cortesías archivados.
    }
  }

  const profitAfterCourtesy = grandProfit - courtesyCost;

  // --- Top KPIs ---
  const grandTotalEl = document.getElementById('grand-total');
  if (grandTotalEl) grandTotalEl.textContent = fmt(grand);

  const costEl = document.getElementById('grand-cost');
  if (costEl) costEl.textContent = fmt(grandCost);

  const profitEl = document.getElementById('grand-profit');
  if (profitEl) profitEl.textContent = fmt(grandProfit);

  const courCostEl = document.getElementById('grand-courtesy-cost');
  if (courCostEl) courCostEl.textContent = fmt(courtesyCost);

  const profitAfterEl = document.getElementById('grand-profit-after-courtesy');
  if (profitAfterEl) profitAfterEl.textContent = fmt(profitAfterCourtesy);

  // Compat: si no existe el bloque superior nuevo, intentamos crearlo sin romper el HTML viejo
  if (!costEl || !profitEl || !courCostEl || !profitAfterEl){
    const totalSpan = document.getElementById('grand-total');
    if (totalSpan){
      const card = totalSpan.closest('.card') || totalSpan.parentElement || document.getElementById('tab-resumen') || document.body;
      let extraBlock = document.getElementById('grand-extra-block');
      if (!extraBlock){
        extraBlock = document.createElement('div');
        extraBlock.id = 'grand-extra-block';
        if (card) card.appendChild(extraBlock);
      }
      extraBlock.innerHTML = `
        <p>Costo estimado de producto: C$ <span id="grand-cost">${fmt(grandCost)}</span></p>
        <p>Utilidad bruta aproximada: C$ <span id="grand-profit">${fmt(grandProfit)}</span></p>
        <p>Cortesías (Costo real): C$ <span id="grand-courtesy-cost">${fmt(courtesyCost)}</span></p>
        <p>Utilidad después de cortesías: C$ <span id="grand-profit-after-courtesy">${fmt(profitAfterCourtesy)}</span></p>
      `;
    }
  }

  // --- Tablas existentes (solo ventas reales) ---
  const tbE = document.querySelector('#tbl-por-evento tbody');
  if (tbE){
    tbE.innerHTML = '';
    [...byEvent.entries()]
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbE.appendChild(tr);
      });
  }

  const tbD = document.querySelector('#tbl-por-dia tbody');
  if (tbD){
    tbD.innerHTML = '';
    // Más reciente primero (YYYY-MM-DD)
    [...byDay.entries()]
      .sort((a,b)=>String(b[0]).localeCompare(String(a[0])))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbD.appendChild(tr);
      });
  }

  const tbP = document.querySelector('#tbl-por-prod tbody');
  if (tbP){
    tbP.innerHTML = '';
    [...byProd.entries()]
      .filter(([k,_v])=> !(/\(Cortesía\)/i.test(String(k))))
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbP.appendChild(tr);
      });
  }

  const tbPay = document.querySelector('#tbl-por-pago tbody');
  if (tbPay){
    tbPay.innerHTML = '';
    [...byPay.entries()]
      .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'))
      .forEach(([k,v])=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${fmt(v)}</td>`;
        tbPay.appendChild(tr);
      });
  }

  // Tabla: Transferencias por banco (Resumen)
  const tbBank = document.querySelector('#tbl-transfer-bank tbody');
  if (tbBank){
    tbBank.innerHTML = '';
    if (transferByBank.size){
      const entries = Array.from(transferByBank.entries())
        .sort((a,b)=> (Number((b[1]||{}).total||0) - Number((a[1]||{}).total||0)));
      for (const [label, obj] of entries){
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${escapeHtml(label)}</td><td>${fmt(Number(obj.total||0))}</td><td>${obj.count||0}</td>`;
        tbBank.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="3" class="muted">(sin transferencias)</td>`;
      tbBank.appendChild(tr);
    }
  }

  // --- Nueva sección: Cortesías ---
  const courTotalCostEl = document.getElementById('courtesy-total-cost');
  if (courTotalCostEl) courTotalCostEl.textContent = fmt(courtesyCost);

  const courTotalQtyEl = document.getElementById('courtesy-total-qty');
  if (courTotalQtyEl) courTotalQtyEl.textContent = String(Math.round(courtesyQty));

  const courTotalEquivEl = document.getElementById('courtesy-total-equiv');
  if (courTotalEquivEl) courTotalEquivEl.textContent = fmt(courtesyEquiv);

  const courTxEl = document.getElementById('courtesy-total-tx');
  if (courTxEl) courTxEl.textContent = String(courtesyTx);

  const tbCour = document.querySelector('#tbl-courtesy-byprod tbody');
  if (tbCour){
    tbCour.innerHTML = '';
    if (courtesyByProd.size){
      const entries = Array.from(courtesyByProd.entries())
        .sort((a,b)=>String(a[0]).localeCompare(String(b[0]),'es-NI'));

      for (const [name, obj] of entries){
        const q = obj ? Number(obj.qty || 0) : 0;
        const c = obj ? Number(obj.cost || 0) : 0;
        const e = obj ? Number(obj.equiv || 0) : 0;

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(name)}</td>
          <td>${Math.round(q)}</td>
          <td>${fmt(c)}</td>
          <td>${fmt(e)}</td>
        `;
        tbCour.appendChild(tr);
      }
    } else {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="4" class="muted">(sin cortesías)</td>`;
      tbCour.appendChild(tr);
    }
  }
}

// CSV helpers
function downloadCSV(name, rows){
  const csv = rows.map(r=>r.map(x=>{
    if (x==null) return '';
    const s = String(x);
    if (/[",\n]/.test(s)) { return '"' + s.replace(/"/g,'""') + '"'; }
    else { return s; }
  }).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),2000);

}

function downloadExcel(filename, sheetName, rows){
  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Hoja1');
  XLSX.writeFile(wb, filename);
}

async function generateInventoryCSV(eventId){
  const prods = await getAll('products');
  const inv = await getInventoryEntries(eventId);
  const sales = await getAll('sales');
  const rows = [['producto','manejar','inicial','reposiciones','ajustes','vendido','stock_actual']];
  for (const p of prods){
    const inits = inv.filter(i=>i.productId===p.id && i.type==='init').reduce((a,b)=>a+(b.qty||0),0);
    const repo = inv.filter(i=>i.productId===p.id && i.type==='restock').reduce((a,b)=>a+(b.qty||0),0);
    const adj = inv.filter(i=>i.productId===p.id && i.type==='adjust').reduce((a,b)=>a+(b.qty||0),0);
    const sold = sales.filter(s=>s.eventId===eventId && s.productId===p.id).reduce((a,b)=>a+(b.qty||0),0);
    const stock = inits + repo + adj - sold;
    rows.push([p.name, p.manageStock!==false?1:0, inits, repo, adj, sold, stock]);
  }
  downloadExcel('inventario_evento.xlsx', 'Inventario', rows);
}

// Eventos UI
async function renderEventos(){
  const filtro = $('#filtro-eventos').value || 'todos';
  const groupSelect = $('#filtro-grupo');
  const tbody = $('#tbl-eventos tbody');
  tbody.innerHTML = '';

  const events = await getAll('events');
  const sales = await getAll('sales');

  // Construir opciones de filtro de grupo
  if (groupSelect){
    const current = groupSelect.value || '';
    const grupos = [];
    let haySinGrupo = false;
    for (const ev of events){
      const g = (ev.groupName || '').trim();
      if (g){
        if (!grupos.includes(g)) grupos.push(g);
      } else {
        haySinGrupo = true;
      }
    }
    grupos.sort((a,b)=>a.localeCompare(b,'es-NI'));
    let opts = '<option value="">Grupos: Todos</option>';
    if (haySinGrupo){
      opts += '<option value="__sin_grupo__">[Sin grupo]</option>';
    }
    for (const g of grupos){
      const esc = g.replace(/"/g,'&quot;');
      opts += `<option value="${esc}">${esc}</option>`;
    }
    groupSelect.innerHTML = opts;
    if (current && Array.from(groupSelect.options).some(o=>o.value===current)){
      groupSelect.value = current;
    }
  }

  const filtroGrupo = groupSelect ? (groupSelect.value || '') : '';

  const rows = events.map(ev=>{
    const tot = sales.filter(s=>s.eventId===ev.id).reduce((a,b)=>a+(b.total||0),0);
    return {...ev, _totalCached: tot};
  }).filter(ev=>{
    if (filtro==='abiertos' && ev.closedAt) return false;
    if (filtro==='cerrados' && !ev.closedAt) return false;

    if (filtroGrupo){
      const g = (ev.groupName || '').trim();
      if (filtroGrupo === '__sin_grupo__'){
        if (g) return false;
      } else {
        if (g !== filtroGrupo) return false;
      }
    }
    return true;
  }).sort((a,b)=>{
    const ad = a.createdAt||''; const bd = b.createdAt||'';
    return (bd>ad) ? 1 : -1;
  });

  for (const ev of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev.name}</td>
      <td>${(ev.groupName||'')}</td>
      <td>${ev.closedAt?'<span class="tag closed">cerrado</span>':'<span class="tag open">abierto</span>'}</td>
      <td>${ev.createdAt?new Date(ev.createdAt).toLocaleString():''}</td>
      <td>${ev.closedAt?new Date(ev.closedAt).toLocaleString():''}</td>
      <td>C$ ${fmt(ev._totalCached)}</td>
      <td class="actions">
        <button class="act-ver" data-id="${ev.id}">VER</button>
        <button class="act-activar" data-id="${ev.id}">Activar</button>
        ${ev.closedAt?'<button class="act-reabrir" data-id="'+ev.id+'">Reabrir</button>':'<button class="act-cerrar" data-id="'+ev.id+'">Cerrar</button>'}
        <button class="act-corte" data-id="${ev.id}">CSV Corte</button>
        <button class="act-ventas" data-id="${ev.id}">CSV Ventas</button>
        <button class="act-inv" data-id="${ev.id}">CSV Inv</button>
        <button class="act-eliminar btn-danger" data-id="${ev.id}">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}
// Modal VER: rellenar
function showEventView(show){ $('#event-view').style.display = show ? 'flex' : 'none'; }
async function openEventView(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev) return;
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  // Asegurar N° consecutivo por evento (persistente) para export
  await backfillSaleSeqIdsForEventPOS(eventId, ev, sales);
  // Asegurar N° consecutivo por evento (persistente) para UI/Export
  await backfillSaleSeqIdsForEventPOS(eventId, ev, sales);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  $('#ev-title').textContent = `Evento: ${ev.name}`;
  $('#ev-meta').innerHTML = `<div><b>Estado:</b> ${ev.closedAt?'Cerrado':'Abierto'}</div>
  <div><b>Creado:</b> ${ev.createdAt?new Date(ev.createdAt).toLocaleString():'—'}</div>
  <div><b>Cerrado:</b> ${ev.closedAt?new Date(ev.closedAt).toLocaleString():'—'}</div>
  <div><b># Ventas:</b> ${sales.length}</div>`;

  const total = sales.reduce((a,b)=> a + (Number(b && b.total) || 0), 0);

  // --- Costos (incluye vasos usando costo del Galón / rendimiento de fraccionamiento) ---
  const fbatches = sanitizeFractionBatches(ev && ev.fractionBatches);
  const batchMap = new Map();
  for (const b of fbatches){
    if (b && b.batchId) batchMap.set(String(b.batchId), b);
  }

  const costPerGallon = getCostoUnitarioProducto('Galón');
  const canEstimateCupCost = costPerGallon > 0;

  function estimateCupCostSigned(s){
    const qRaw = Number(s && s.qty) || 0;
    const absQ = Math.abs(qRaw);
    const sign = (s && (s.isReturn || qRaw < 0)) ? -1 : 1;
    if (!(absQ > 0)) return 0;
    if (!canEstimateCupCost) return 0;

    const breakdown = Array.isArray(s && s.fifoBreakdown) ? s.fifoBreakdown : [];
    if (breakdown.length){
      let costAbs = 0;
      for (const it of breakdown){
        if (!it) continue;
        const take = Math.abs(Number(it.cupsTaken || 0));
        if (!(take > 0)) continue;

        let y = 0;
        const b = it.batchId ? batchMap.get(String(it.batchId)) : null;
        if (b && b.yieldCupsPerGallon) y = safeInt(b.yieldCupsPerGallon, 0);
        if (!(y > 0)){
          const mlpc = Number(it.mlPerCup || (b && b.mlPerCup) || 0);
          if (mlpc > 0) y = Math.round(ML_PER_GALON / mlpc);
        }
        if (!(y > 0)) y = 22;

        costAbs += take * (costPerGallon / Math.max(1, y));
      }
      return sign * costAbs;
    }

    // Sin breakdown (caso raro): usamos el último rendimiento conocido o default 22
    const yFallback = safeInt((fbatches.length ? fbatches[fbatches.length-1].yieldCupsPerGallon : 22), 22);
    return sign * absQ * (costPerGallon / Math.max(1, (yFallback > 0 ? yFallback : 22)));
  }

  let costoProductos = 0;

  // Stats cortesías (para mostrar en VER)
  let cortesiasPresU = 0;
  let cortesiasVasosU = 0;
  let costoCortesiasPres = 0;
  let costoCortesiasVasos = 0;

  for (const s of sales) {
    if (!s) continue;
    const qRaw = Number(s.qty || 0);
    const absQty = Math.abs(qRaw);
    const isReturn = !!s.isReturn || qRaw < 0;
    const qtyParaCosto = isReturn ? -absQty : absQty;

    const isCourtesy = !!(s.courtesy || s.isCourtesy);

    if (isCupSaleRecord(s)){
      // Preferir lineCost si ya existe, si no, estimar por galón/yield.
      const stored = Number(s.lineCost || 0);
      const estimated = estimateCupCostSigned(s);
      const lineCost = (Math.abs(stored) > 1e-9) ? stored : estimated;

      costoProductos += lineCost;

      if (isCourtesy){
        cortesiasVasosU += absQty;
        costoCortesiasVasos += lineCost;
      }
    } else {
      const unitCost = getCostoUnitarioProducto(s.productName);
      if (unitCost > 0 && qtyParaCosto !== 0) {
        const lineCost = unitCost * qtyParaCosto;
        costoProductos += lineCost;

        if (isCourtesy){
          cortesiasPresU += absQty;
          costoCortesiasPres += lineCost;
        }
      } else {
        // Sin costo conocido: igual contar cortesías en unidades
        if (isCourtesy){
          cortesiasPresU += absQty;
        }
      }
    }
  }

  const utilidadBruta = total - costoProductos;

  const byPay = sales.reduce((m,s)=>{ 
    const k = (s && s.payment) ? s.payment : '';
    m[k] = (m[k] || 0) + (Number(s && s.total) || 0); 
    return m; 
  },{});

  const costoCortesiasTotalKnown = costoCortesiasPres + (canEstimateCupCost ? costoCortesiasVasos : 0);

  $('#ev-totals').innerHTML = `<div><b>Total vendido (pagado):</b> C$ ${fmt(total)}</div>
  <div><b>Cortesías presentaciones:</b> ${Math.round(cortesiasPresU)} unid.</div>
  <div><b>Cortesías vasos:</b> ${Math.round(cortesiasVasosU)} vasos</div>
  <div><b>Costo cortesías presentaciones:</b> C$ ${fmt(costoCortesiasPres)}</div>
  <div><b>Costo cortesías vasos:</b> ${canEstimateCupCost ? ('C$ ' + fmt(costoCortesiasVasos)) : 'N/D'}</div>
  <div><b>Costo cortesías total:</b> ${canEstimateCupCost ? ('C$ ' + fmt(costoCortesiasTotalKnown)) : ('C$ ' + fmt(costoCortesiasPres) + ' + N/D')}</div>
  <div><b>Costo estimado de producto:</b> C$ ${fmt(costoProductos)}</div>
  <div><b>Utilidad bruta aprox.:</b> C$ ${fmt(utilidadBruta)}</div>
  <div><b>Efectivo:</b> C$ ${fmt(byPay.efectivo||0)}</div>
  <div><b>Transferencia:</b> C$ ${fmt(byPay.transferencia||0)}</div>
  <div><b>Crédito:</b> C$ ${fmt(byPay.credito||0)}</div>`;

  const byDay = Array.from((()=>{
    const m = new Map();
    for (const s of sales){
      const k = (s && s.date) ? String(s.date) : '';
      if (!k) continue;
      const prev = m.get(k) || 0;
      m.set(k, prev + (Number(s && s.total) || 0));
    }
    return m;
  })().entries()).sort((a,b)=>b[0].localeCompare(a[0]));
  const tbd = $('#ev-byday tbody'); 
  tbd.innerHTML=''; 
  byDay.forEach(([k,v])=>{ 
    const tr=document.createElement('tr'); 
    tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; 
    tbd.appendChild(tr); 
  });

  // Por producto: mostrar Monto (C$) y, si aplica, unidades (para que "Vaso (Cortesía)" no quede en 0)
  const byProd = Array.from((()=>{
    const m = new Map();
    for (const s of sales){
      const k = (s && s.productName) ? String(s.productName) : '—';
      const prev = m.get(k) || { amount: 0, qty: 0 };
      prev.amount += (Number(s && s.total) || 0);
      prev.qty += (Number(s && s.qty) || 0);
      m.set(k, prev);
    }
    return m;
  })().entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const tbp = $('#ev-byprod tbody'); 
  tbp.innerHTML=''; 
  byProd.forEach(([k,obj])=>{
    const amount = obj ? (Number(obj.amount) || 0) : 0;
    const qty = obj ? (Number(obj.qty) || 0) : 0;

    let val = '';
    if (Math.abs(amount) < 1e-9 && Math.abs(qty) > 1e-9){
      val = `${qty} u`;
    } else if (Math.abs(qty) > 1e-9){
      val = `C$ ${fmt(amount)} · ${qty} u`;
    } else {
      val = `C$ ${fmt(amount)}`;
    }

    const tr=document.createElement('tr'); 
    tr.innerHTML=`<td>${escapeHtml(k)}</td><td>${val}</td>`; 
    tbp.appendChild(tr); 
  });

  const tb = $('#ev-sales tbody'); tb.innerHTML='';
  // Más reciente primero
  sales.sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a))).forEach(s=>{
    const payLabel = (s.payment === 'transferencia')
      ? (`Transferencia · ${getSaleBankLabel(s, bankMap)}`)
      : (s.payment || '');
    const tr=document.createElement('tr'); tr.innerHTML = `<td>${getSaleSeqDisplayPOS(s)}</td><td>${s.date}</td><td>${getSaleTimeTextPOS(s)}</td><td>${s.productName}</td><td>${s.qty}</td><td>${fmt(s.unitPrice)}</td><td>${fmt(getSaleDiscountTotalPOS(s))}</td><td>${fmt(s.total)}</td><td>${payLabel}</td><td>${s.courtesy?'✓':''}</td><td>${s.isReturn?'✓':''}</td><td>${s.customer||''}</td><td>${s.courtesyTo||''}</td><td>${s.notes||''}</td>`;
    tb.appendChild(tr);
  });

  showEventView(true);
}

// CSV ventas/corte
async function exportEventSalesCSV(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  const rows = [['N°','id','fecha','hora','producto','cant','PU','desc_C$','total','pago','banco','cortesia','devolucion','cliente','cortesia_a','notas']];
  const ordered = [...sales].sort((a,b)=> (saleSortKeyPOS(b) - saleSortKeyPOS(a)));
  for (const s of ordered){
    const bank = (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '';
    rows.push([ (s.seqId || ''), s.id, s.date, getSaleTimeTextPOS(s), s.productName, s.qty, s.unitPrice, getSaleDiscountTotalPOS(s), s.total, (s.payment||''), bank, s.courtesy?1:0, s.isReturn?1:0, s.customer||'', s.courtesyTo||'', s.notes||'']);
  }
  const safeName = (ev?ev.name:'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  downloadExcel(`ventas_${safeName}.xlsx`, 'Ventas', rows);
}
function buildCorteSummaryRows(eName, sales){
  let efectivo=0, trans=0, credito=0, descuentos=0, cortesiasU=0, cortesiasVal=0, devolU=0, devolVal=0, bruto=0;
  for (const s of sales){
    const absQty = Math.abs(s.qty||0);
    const absTotal = Math.abs(s.total||0);
    const disc = getSaleDiscountTotalPOS(s);
    bruto += (s.courtesy ? (s.unitPrice*absQty) : (absTotal + disc));
    descuentos += disc * (s.isReturn?-1:1);
    if (s.courtesy){ cortesiasU += absQty; cortesiasVal += (s.unitPrice*absQty); }
    if (s.isReturn){ devolU += absQty; devolVal += absTotal; }
    if (s.payment==='efectivo') efectivo += s.total;
    else if (s.payment==='transferencia') trans += s.total;
    else if (s.payment==='credito'){ credito += s.total; }
  }
  const cobrado = efectivo + trans;
  const neto = cobrado;
  return {efectivo, trans, credito, descuentos, cortesiasU, cortesiasVal, devolU, devolVal, bruto, cobrado, neto};
}
async function generateCorteCSV(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }

  // Transferencias por banco
  const transferByBank = new Map();
  for (const s of sales){
    if ((s.payment || '') !== 'transferencia') continue;
    const label = getSaleBankLabel(s, bankMap);
    const cur = transferByBank.get(label) || { total: 0, count: 0 };
    cur.total += Number(s.total || 0);
    cur.count += 1;
    transferByBank.set(label, cur);
  }
  const sum = buildCorteSummaryRows(ev.name, sales);
  const rows = [];
  rows.push(['Corte de evento', ev.name]);
  rows.push(['Generado', new Date().toLocaleString()]);
  rows.push([]);
  rows.push(['Resumen de cobros']);
  rows.push(['Efectivo', sum.efectivo.toFixed(2)]);
  rows.push(['Transferencia', sum.trans.toFixed(2)]);
  rows.push(['Crédito', sum.credito.toFixed(2)]);
  rows.push(['Cobrado (sin crédito)', sum.cobrado.toFixed(2)]);
  if (transferByBank.size){
    rows.push([]);
    rows.push(['Transferencias por banco']);
    rows.push(['Banco','Total C$','Transacciones']);
    const entries = Array.from(transferByBank.entries())
      .sort((a,b)=> (b[1].total || 0) - (a[1].total || 0));
    for (const [label, obj] of entries){
      rows.push([label, (obj.total || 0).toFixed(2), obj.count || 0]);
    }
  }
  rows.push([]);
  rows.push(['Ajustes']);
  rows.push(['Descuentos aplicados (C$)', sum.descuentos.toFixed(2)]);
  rows.push(['Cortesías (unid.)', sum.cortesiasU]);
  rows.push(['Cortesías valor ref. (C$)', sum.cortesiasVal.toFixed(2)]);
  rows.push(['Devoluciones (unid.)', sum.devolU]);
  rows.push(['Devoluciones (C$)', sum.devolVal.toFixed(2)]);
  rows.push([]);
  rows.push(['Ventas brutas ref. (aprox.)', sum.bruto.toFixed(2)]);
  rows.push(['Neto cobrado', sum.neto.toFixed(2)]);
  rows.push([]);
  rows.push(['Detalle de ventas']);
  rows.push(['id','fecha','hora','producto','cant','PU','desc_C$','total','pago','banco','cortesia','devolucion','cliente','cortesia_a','notas']);
  for (const s of sales){
    const bank = (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '';
    rows.push([s.id, s.date, getSaleTimeTextPOS(s), s.productName, s.qty, s.unitPrice, getSaleDiscountTotalPOS(s), s.total, (s.payment||''), bank, s.courtesy?1:0, s.isReturn?1:0, s.customer||'', s.courtesyTo||'', s.notes||'']);
  }
  const safeName = ev.name.replace(/[^a-z0-9_\- ]/gi,'_');
  downloadExcel(`corte_${safeName}.xlsx`, 'Corte', rows);
}

async function exportEventExcel(eventId){
  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }

  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){
    alert('Evento no encontrado');
    return;
  }

  const allSales = await getAll('sales');
  const sales = allSales.filter(s=>s.eventId===eventId);

  // Asegurar N° consecutivo por evento antes de exportar (persistente)
  try{ await backfillSaleSeqIdsForEventPOS(eventId, ev, sales); }catch(e){ console.warn('backfillSaleSeqIdsForEventPOS (export) failed', e); }

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){ if (b && b.id != null) bankMap.set(Number(b.id), b.name || ''); }
  const transferByBank = new Map();
  for (const s of sales){
    if ((s.payment || '') !== 'transferencia') continue;
    const label = getSaleBankLabel(s, bankMap);
    const cur = transferByBank.get(label) || { total: 0, count: 0 };
    cur.total += Number(s.total || 0);
    cur.count += 1;
    transferByBank.set(label, cur);
  }

  const pc = await getPettyCash(eventId);
  const summary = computePettyCashSummary(pc || null);
  const dayKeys = listPcDayKeys(pc);

  // --- Hoja 1: Resumen del evento ---
  const resumenRows = [];
  resumenRows.push(['Evento', ev.name || '']);
  resumenRows.push(['ID', ev.id]);
  resumenRows.push(['Estado', ev.closedAt ? 'Cerrado' : 'Abierto']);
  resumenRows.push(['Creado', ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '']);
  resumenRows.push(['Cerrado', ev.closedAt ? new Date(ev.closedAt).toLocaleString() : '']);
  resumenRows.push([]);

  const totalVentas = sales.reduce((acc,s)=>acc + (s.total || 0), 0);
  resumenRows.push(['Resumen de ventas']);
  resumenRows.push(['Total vendido C$', totalVentas]);

  const byPay = sales.reduce((m,s)=>{
    const pay = s.payment || 'desconocido';
    m[pay] = (m[pay] || 0) + (s.total || 0);
    return m;
  },{});
  resumenRows.push([]);
  resumenRows.push(['Cobros por forma de pago']);
  resumenRows.push(['Efectivo C$', byPay.efectivo || 0]);
  resumenRows.push(['Transferencia C$', byPay.transferencia || 0]);
  resumenRows.push(['Crédito C$', byPay.credito || 0]);

  if (transferByBank.size){
    resumenRows.push([]);
    resumenRows.push(['Transferencias por banco']);
    resumenRows.push(['Banco','Total C$','Transacciones']);
    const entries = Array.from(transferByBank.entries())
      .sort((a,b)=> (b[1].total || 0) - (a[1].total || 0));
    for (const [label, obj] of entries){
      resumenRows.push([label, (obj.total || 0), obj.count || 0]);
    }
  }

  resumenRows.push([]);
  resumenRows.push(['Caja Chica - C$']);
  resumenRows.push(['Saldo inicial C$', summary.nio.initial]);
  resumenRows.push(['Entradas C$', summary.nio.entradas]);
  resumenRows.push(['Salidas C$', summary.nio.salidas]);
  resumenRows.push(['Saldo teórico C$', summary.nio.teorico]);
  resumenRows.push(['Saldo final contado C$', summary.nio.final != null ? summary.nio.final : '—']);
  resumenRows.push(['Diferencia C$', summary.nio.diferencia != null ? summary.nio.diferencia : '—']);

  resumenRows.push([]);
  resumenRows.push(['Caja Chica - US$']);
  resumenRows.push(['Saldo inicial US$', summary.usd.initial]);
  resumenRows.push(['Entradas US$', summary.usd.entradas]);
  resumenRows.push(['Salidas US$', summary.usd.salidas]);
  resumenRows.push(['Saldo teórico US$', summary.usd.teorico]);
  resumenRows.push(['Saldo final contado US$', summary.usd.final != null ? summary.usd.final : '—']);
  resumenRows.push(['Diferencia US$', summary.usd.diferencia != null ? summary.usd.diferencia : '—']);

  const wb = XLSX.utils.book_new();
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen_Evento');

  // --- Hoja 2: CajaChica_Detalle ---
  const detRows = [];

  detRows.push(['Caja Chica - Detalle por día']);
  detRows.push(['Evento', ev.name || '']);
  detRows.push(['ID', ev.id]);
  detRows.push(['Generado', new Date().toLocaleString()]);
  detRows.push([]);

  if (!dayKeys.length){
    detRows.push(['Sin registros de Caja Chica para este evento.']);
  } else {
    for (const dk of dayKeys){
      const day = ensurePcDay(pc, dk);
      const init = day && day.initial ? normalizePettySection(day.initial) : normalizePettySection(null);
      const fin  = day && day.finalCount ? normalizePettySection(day.finalCount) : normalizePettySection(null);
      const movs = (day && Array.isArray(day.movements)) ? day.movements : [];

      detRows.push(['Día', dk]);
      detRows.push([]);

      // Saldo inicial C$
      detRows.push(['Saldo inicial C$']);
      detRows.push(['Denominación','Cantidad','Subtotal C$']);
      for (const d of NIO_DENOMS){
        const qty = init.nio[String(d)] || 0;
        const sub = d * qty;
        detRows.push([d, qty, sub]);
      }
      detRows.push(['', '', '']);
      detRows.push(['Total inicial C$', '', init.totalNio || 0]);

      detRows.push([]);
      // Saldo inicial US$
      detRows.push(['Saldo inicial US$']);
      detRows.push(['Denominación','Cantidad','Subtotal US$']);
      for (const d of USD_DENOMS){
        const qty = init.usd[String(d)] || 0;
        const sub = d * qty;
        detRows.push([d, qty, sub]);
      }
      detRows.push(['', '', '']);
      detRows.push(['Total inicial US$', '', init.totalUsd || 0]);
      detRows.push(['Fecha/hora saldo inicial', init.savedAt || '']);

      detRows.push([]);
      // Movimientos
      detRows.push(['Movimientos']);
      detRows.push(['Tipo','Moneda','Monto','Descripción']);
      if (!movs.length){
        detRows.push(['(sin movimientos)','','','']);
      } else {
        for (const m of movs){
          let tipoText;
          if (m && m.isAdjust){
            const k = m.adjustKind === 'sobrante' ? 'Sobrante' : 'Faltante';
            tipoText = `Ajuste (${k})`;
          } else {
            tipoText = m.type === 'salida' ? 'Egreso' : 'Ingreso';
          }
          const monedaText = m.currency === 'USD' ? 'US$' : 'C$';
          detRows.push([tipoText, monedaText, m.amount || 0, m.description || '']);
        }
      }

      detRows.push([]);
      // Arqueo final C$
      detRows.push(['Arqueo final C$']);
      detRows.push(['Denominación','Cantidad','Subtotal C$']);
      for (const d of NIO_DENOMS){
        const qty = fin.nio[String(d)] || 0;
        const sub = d * qty;
        detRows.push([d, qty, sub]);
      }
      detRows.push(['', '', '']);
      detRows.push(['Total final C$', '', fin.totalNio || 0]);

      detRows.push([]);
      // Arqueo final US$
      detRows.push(['Arqueo final US$']);
      detRows.push(['Denominación','Cantidad','Subtotal US$']);
      for (const d of USD_DENOMS){
        const qty = fin.usd[String(d)] || 0;
        const sub = d * qty;
        detRows.push([d, qty, sub]);
      }
      detRows.push(['', '', '']);
      detRows.push(['Total final US$', '', fin.totalUsd || 0]);
      detRows.push(['Fecha/hora arqueo final', fin.savedAt || '']);

      detRows.push([]);
      // Resumen del día
      const sumDay = computePettyCashSummary(pc, dk);
      detRows.push(['Resumen del día - C$']);
      detRows.push(['Inicial', sumDay.nio.initial, 'Entradas', sumDay.nio.entradas, 'Salidas', sumDay.nio.salidas, 'Teórico', sumDay.nio.teorico, 'Final', sumDay.nio.final != null ? sumDay.nio.final : '', 'Dif', sumDay.nio.diferencia != null ? sumDay.nio.diferencia : '' ]);
      detRows.push(['Resumen del día - US$']);
      detRows.push(['Inicial', sumDay.usd.initial, 'Entradas', sumDay.usd.entradas, 'Salidas', sumDay.usd.salidas, 'Teórico', sumDay.usd.teorico, 'Final', sumDay.usd.final != null ? sumDay.usd.final : '', 'Dif', sumDay.usd.diferencia != null ? sumDay.usd.diferencia : '' ]);

      detRows.push([]);
      // Ajustes (movimientos tipo Ajuste)
      detRows.push(['Ajustes (Movimientos tipo Ajuste)']);
      detRows.push(['Moneda','Tipo','Monto','Descripción','Creado']);
      const adjMovs = (movs || []).filter(m => m && m.isAdjust);
      if (!adjMovs.length){
        detRows.push(['', '(sin ajustes)', '', '', '']);
      } else {
        for (const m of adjMovs){
          const monedaText = m.currency === 'USD' ? 'US$' : 'C$';
          const k = m.adjustKind === 'sobrante' ? 'Sobrante' : 'Faltante';
          detRows.push([monedaText, k, m.amount || 0, m.description || '', m.createdAt || '']);
        }
      }

      detRows.push([]);
      detRows.push(['---']);
      detRows.push([]);
    }
  }

  const wsCaja = XLSX.utils.aoa_to_sheet(detRows);
  XLSX.utils.book_append_sheet(wb, wsCaja, 'CajaChica_Detalle');

  // --- Hoja: CajaChica_Ajustes (movimientos tipo Ajuste) ---
  const adjRows = [];
  adjRows.push(['dia','moneda','AjusteMonto','AjusteConcepto','AjusteNotas','AjusteResumen','creado']);
  if (dayKeys && dayKeys.length){
    for (const dk of dayKeys){
      const day = ensurePcDay(pc, dk);
      const movs = (day && Array.isArray(day.movements)) ? day.movements : [];
      const adjMovs = movs.filter(m => m && m.isAdjust);
      for (const m of adjMovs){
        const monedaText = m.currency === 'USD' ? 'US$' : 'C$';
        const signed = (m.type === 'salida') ? -Math.abs(Number(m.amount || 0)) : Math.abs(Number(m.amount || 0));
        const concept = m.description || '';
        const notes = '';
        const kind = m.adjustKind === 'sobrante' ? 'Sobrante' : 'Faltante';
        const resumen = `Ajuste: ${formatAdjLine(signed, monedaText)} — ${kind}${concept ? (' · ' + concept) : ''}`;
        adjRows.push([dk, monedaText, signed, concept, notes, resumen, m.createdAt || '']);
      }
    }
  }
  if (adjRows.length === 1){
    adjRows.push(['(sin ajustes)','', '', '', '', '', '']);
  }
  const wsAdj = XLSX.utils.aoa_to_sheet(adjRows);
  XLSX.utils.book_append_sheet(wb, wsAdj, 'CajaChica_Ajustes');


  // --- Hoja 3 opcional: Ventas_Detalle ---
  const ventasRows = [];
  ventasRows.push(['N°','id','fecha','hora','producto','cantidad','PU_C$','descuento_C$','total_C$','costo_unit_C$','costo_total_C$','pago','banco','cortesia','devolucion','cliente','cortesia_a','notas']);
  for (const s of sales){
    const qty = Number(s.qty || 0);
    const costUnit = Number.isFinite(Number(s.costPerUnit)) ? Number(s.costPerUnit) : 0;
    const costTotal = Number.isFinite(Number(s.lineCost)) ? Number(s.lineCost) : (costUnit * qty);
    ventasRows.push([
      getSaleSeqDisplayPOS(s),
      s.id,
      s.date || '',
      getSaleTimeTextPOS(s) || '',
      s.productName || '',
      qty || 0,
      s.unitPrice || 0,
      getSaleDiscountTotalPOS(s) || 0,
      s.total || 0,
      costUnit || 0,
      costTotal || 0,
      s.payment || '',
      (s.payment === 'transferencia') ? getSaleBankLabel(s, bankMap) : '',
      s.courtesy ? 1 : 0,
      s.isReturn ? 1 : 0,
      s.customer || '',
      s.courtesyTo || '',
      s.notes || ''
    ]);
  }
  const wsVentas = XLSX.utils.aoa_to_sheet(ventasRows);
  XLSX.utils.book_append_sheet(wb, wsVentas, 'Ventas_Detalle');

  const safeName = (ev.name || 'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  XLSX.writeFile(wb, `evento_${safeName}.xlsx`);
}

// --- Close / Reopen / Activate / Delete ---
async function closeEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento ya está cerrado.'); return; }

  // Ventas en efectivo por día (C$)
  const allSales = await getAll('sales');
  const cashByDay = new Map();
  for (const s of (allSales || [])){
    if (!s || s.eventId !== eventId) continue;
    if ((s.payment || '') !== 'efectivo') continue;
    const dk = (typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date)) ? s.date : null;
    if (!dk) continue;
    const prev = cashByDay.get(dk) || 0;
    cashByDay.set(dk, round2(prev + Number(s.total || 0)));
  }
  const totalCashSales = Array.from(cashByDay.values()).reduce((a,b)=>round2(a+Number(b||0)), 0);

  // Guard (candado) SOLO si Caja Chica está activada en este evento
  if (eventPettyEnabled(ev)){
    try{
      const pc = await getPettyCash(eventId);
      // Días a exigir cierre: días con actividad de Caja Chica o con ventas en efectivo
      const daySet = new Set();
      const pcKeys = listPcDayKeys(pc);
      for (const k of pcKeys){
        const d = pc.days ? pc.days[k] : null;
        if (hasPettyDayActivity(d)) daySet.add(k);
      }
      for (const k of cashByDay.keys()) daySet.add(k);

      if (daySet.size){
        const pending = [];
        const sorted = Array.from(daySet).sort();

        for (const dayKey of sorted){
          const cashSalesNio = cashByDay.get(dayKey) || 0;
          const day = ensurePcDay(pc, dayKey);
          const fx = ev ? Number(ev.fxRate || 0) : null;
          const check = await getPettyCloseCheck(eventId, pc, dayKey, cashSalesNio, fx);

          if (!day.closedAt){
            pending.push({ dayKey, reason: 'Falta cierre del día.' });
            continue;
          }
          // Si por alguna razón hay errores aún estando cerrado, bloquear cierre del evento
          if (check.errors && check.errors.length){
            pending.push({ dayKey, reason: check.errors[0] });
          }
        }

        if (pending.length){
          const lines = pending.slice(0, 25).map(p => `- ${p.dayKey}: ${p.reason}`).join('\n');
          const more = pending.length > 25 ? `\n... y ${pending.length - 25} más.` : '';
          alert(
            'No se puede cerrar el evento porque faltan cierres del día de Caja Chica:\n\n' +
            lines + more +
            '\n\nVe a Caja Chica y realiza “Cierre del día”.'
          );
          return;
        }
      }
    }catch(err){
      console.error('closeEvent guard Caja Chica error', err);
    }
  } else {
    // Si no se activó Caja Chica pero hubo ventas en efectivo, pedir confirmación
    if (totalCashSales > 0){
      const ok = confirm(
        `Este evento tiene ventas en efectivo (C$${fmt(totalCashSales)}), pero Caja Chica está desactivada.\n\n¿Deseas cerrar el evento SIN Caja Chica?`
      );
      if (!ok) return;
    }
  }

  // Corte (Excel). Si falla, permitir cerrar de todas formas.
  try{
    await generateCorteCSV(eventId);
  } catch(err){
    console.error('generateCorteCSV error', err);
    const ok = confirm(
      'No se pudo generar el Corte (Excel) por un error.\n\n¿Cerrar el evento de todas formas?\n(Podrás exportar después desde Eventos: “Exportar (Excel)” o “CSV Corte”.)'
    );
    if (!ok) return;
  }

  ev.closedAt = new Date().toISOString();
  await put('events', ev);
  const curId = await getMeta('currentEventId');
  if (curId === eventId) await setMeta('currentEventId', null);
  await refreshEventUI(); await renderEventos(); await renderDay(); await renderSummary();
  toast('Evento cerrado (sin borrar ventas)');
}

async function reopenEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  ev.closedAt = null;
  await put('events', ev);
  await setMeta('currentEventId', eventId);
  await refreshEventUI(); await renderEventos();
  toast('Evento reabierto');
}

async function activateEvent(eventId){
  await setMeta('currentEventId', eventId);
  await refreshEventUI();
  await renderDay();
  toast('Evento activado');
}

async function deleteEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  const msg = '¿Eliminar evento "'+ev.name+'"? Se borrarán sus ventas e inventario. Esta acción NO se puede deshacer.';
  if (!confirm(msg)) return;
  const t = db.transaction(['sales','events','inventory','meta'],'readwrite');
  await new Promise((res)=>{ const r = t.objectStore('sales').getAll(); r.onsuccess = ()=>{ (r.result||[]).filter(s=>s.eventId===eventId).forEach(s=> t.objectStore('sales').delete(s.id)); res(); }; });
  await new Promise((res)=>{ const r = t.objectStore('inventory').getAll(); r.onsuccess = ()=>{ (r.result||[]).filter(i=>i.eventId===eventId).forEach(i=> t.objectStore('inventory').delete(i.id)); res(); }; });
  t.objectStore('events').delete(eventId);
  const mreq = t.objectStore('meta').get('currentEventId');
  mreq.onsuccess = ()=>{ const cur = mreq.result?.value; if (cur === eventId) t.objectStore('meta').put({id:'currentEventId', value:null}); };
  await new Promise((res,rej)=>{ t.oncomplete=res; t.onerror=()=>rej(t.error); });
  await refreshEventUI(); await renderEventos(); await renderDay(); await renderSummary(); await renderInventario(); await renderProductos();
  toast('Evento eliminado');
}

// Botón Restaurar productos base (A33)
async function restoreSeed(){
  await seedMissingDefaults(true);
  await renderProductos(); await refreshProductSelect(); await renderInventario();
  toast('Productos base restaurados');
}

// Init & bindings
async function init(){
  // Paso 1: abrir base de datos POS
  try{
    await openDB();
  }catch(err){
    alert('No se pudo abrir la base de datos del POS. Revisa permisos de almacenamiento del navegador.');
    console.error('INIT openDB ERROR', err);
    return;
  }

  // Helper para que cada paso falle de forma aislada sin tumbar todo el POS
  const runStep = async (name, fn) => {
    try{
      await fn();
    }catch(err){
      console.error('INIT step error en ' + name, err);
    }
  };

  // Paso 2: defaults y migraciones
  await runStep('ensureDefaults', ensureDefaults);

  // Paso 3: preparar fecha por defecto
  try{
    const dateInput = document.getElementById('sale-date');
    if (dateInput && !dateInput.value){
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth()+1).padStart(2,'0');
      const d = String(now.getDate()).padStart(2,'0');
      dateInput.value = `${y}-${m}-${d}`;
    }
  }catch(err){
    console.error('INIT step error al configurar fecha por defecto', err);
  }

  // Paso 4: refrescar vistas principales
  await runStep('refreshEventUI', refreshEventUI);
  await runStep('refreshProductSelect', refreshProductSelect);
  await runStep('refreshSaleBankSelect', refreshSaleBankSelect);
  await runStep('renderDay', renderDay);
  await runStep('refreshCupBlock', refreshCupBlock);
  await runStep('renderSummary', renderSummary);
  await runStep('renderProductos', renderProductos);
  await runStep('renderEventos', renderEventos);
  await runStep('renderInventario', renderInventario);
  await runStep('renderCajaChica', renderCajaChica);
  await runStep('updateSellEnabled', updateSellEnabled);
  await runStep('initVasosPanel', initVasosPanelPOS);

  // Paso 5: barra offline y eventos de Caja Chica
  try{
    setOfflineBar();
  }catch(err){
    console.error('INIT step error en setOfflineBar', err);
  }

  try{
    bindCajaChicaEvents();
  }catch(err){
    console.error('INIT step error en bindCajaChicaEvents', err);
  }

  // Los listeners de la UI principal se mantienen igual
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) {
    tabbar.addEventListener('click', (e)=>{
      const b = e.target.closest('button');
      if (!b) return;
      const tab = b.dataset.tab;
      if (tab) setTab(tab);
    });
  }

  // Deep-link desde Centro de Mando: abrir pestaña específica si viene en la URL
  try{
    const deepTab = getTabFromUrlPOS();
    if (deepTab) setTab(deepTab);
  }catch(_){ }

  // Vender tab

  $('#sale-event').addEventListener('change', async()=>{ 
    const val = $('#sale-event').value;
    if (val === '') { await setMeta('currentEventId', null); }
    else { await setMeta('currentEventId', parseInt(val,10)); }
    await refreshEventUI(); 
    await refreshSaleStockLabel(); 
    await renderDay();
  });

  // Toggle Caja Chica por evento
  const pcToggle = document.getElementById('pc-event-toggle');
  if (pcToggle){
    pcToggle.addEventListener('change', ()=>{
      onTogglePettyForCurrentEvent().catch(err=>console.error(err));
    });
  }

  const groupSelect = $('#event-group-select');
  const groupNewInput = $('#event-group-new');

  // Helper: recordar el último grupo usado (Evento Maestro)
  function rememberGroup(name){
    const g = (name || '').trim();
    if (g && g !== '__new__'){
      setLastGroupName(g);
    }
  }

  if (groupSelect) {
    groupSelect.addEventListener('change', ()=>{
      const v = (groupSelect.value || '').trim();

      // Persistir selección de grupo para que quede por defecto la próxima vez.
      if (v && v !== '__new__') {
        rememberGroup(v);
      }

      const newInput = $('#event-group-new');
      if (!newInput) return;

      if (v === '__new__') {
        newInput.style.display = 'inline-block';

        // Si el último grupo guardado no está en la lista, úsalo como sugerencia.
        const last = getLastGroupName();
        if (last && !Array.from(groupSelect.options).some(o=>o.value===last)) {
          newInput.value = last;
        }

        newInput.focus();
      } else {
        newInput.style.display = 'none';
        newInput.value = '';
      }
    });
  }

  // Si el usuario escribe un grupo nuevo, también lo recordamos.
  if (groupNewInput) {
    const saveTyped = ()=>{
      const t = (groupNewInput.value || '').trim();
      if (t) setLastGroupName(t);
    };
    groupNewInput.addEventListener('blur', saveTyped);
    groupNewInput.addEventListener('keydown', (ev)=>{
      if (ev.key === 'Enter') {
        ev.preventDefault();
        saveTyped();
      }
    });
  }

  const btnManageGroups = $('#btn-manage-groups');
  if (btnManageGroups) {
    btnManageGroups.addEventListener('click', async ()=>{
      const evs = await getAll('events');
      const hidden = new Set(getHiddenGroups());
      const allGroups = [];
      for (const ev of evs) {
        const g = (ev.groupName || '').trim();
        if (!g) continue;
        if (!allGroups.includes(g)) allGroups.push(g);
      }
      const visible = allGroups.filter(g => !hidden.has(g));
      if (!visible.length) {
        alert('No hay grupos disponibles para gestionar.');
        return;
      }
      const msg = 'Grupos actuales:\n' + visible.map((g,i)=> `${i+1}. ${g}`).join('\n') +
                  '\n\nEscribe el número del grupo que deseas ocultar:';
      const choice = prompt(msg);
      if (!choice) return;
      const idxNum = parseInt(choice, 10);
      if (!idxNum || idxNum < 1 || idxNum > visible.length) {
        alert('Selección no válida');
        return;
      }
      hidden.add(visible[idxNum-1]);
      setHiddenGroups(Array.from(hidden));
      await refreshEventUI();
      alert('Grupo ocultado. Ya no aparecerá para nuevos eventos, pero sigue existiendo en el historial.');
    });
  }
  $('#btn-add-event').addEventListener('click', async()=>{
  const name = ($('#new-event').value || '').trim();
  const groupSelect = $('#event-group-select');
  const groupNew = $('#event-group-new');
  let groupName = '';

  if (groupSelect) {
    const v = groupSelect.value;
    if (v === '__new__') {
      if (groupNew) {
        groupName = (groupNew.value || '').trim();
      }
    } else if (v && v !== '__new__') {
      groupName = v.trim();
    }
  }

  if (!name) {
    alert('Escribe un nombre de evento');
    return;
  }

  const id = await put('events', {name, groupName, pettyEnabled:false, createdAt:new Date().toISOString()});
  await setMeta('currentEventId', id);
  $('#new-event').value = '';

  if (groupNew) {
    groupNew.value = '';
    if (groupSelect && groupSelect.value === '__new__') {
      groupSelect.value = groupName || '';
    }
  }

  if (groupName) {
    setLastGroupName(groupName);
  }

  await refreshEventUI();
  await renderEventos();
  await renderInventario();
  await renderDay();
  toast('Evento creado');
});
  $('#btn-close-event').addEventListener('click', async()=>{ const id = parseInt($('#sale-event').value||'0',10); const current = await getMeta('currentEventId'); const useId = id || current; if (!useId) return alert('Selecciona un evento'); await closeEvent(parseInt(useId,10)); });
  $('#btn-reopen-event').addEventListener('click', async()=>{ const val = $('#sale-event').value; const id = parseInt(val||'0',10); if (!id) return alert('Selecciona un evento cerrado'); await reopenEvent(id); });

  $('#sale-product').addEventListener('change', async()=>{
    await setSalePriceFromSelectionPOS();
    updateChipsActiveFromSelectionPOS();
    await refreshSaleStockLabel();
    recomputeTotal();
  });

  // Extras por evento (Vender tab)
  const btnSaveExtra = document.getElementById('btn-save-extra');
  if (btnSaveExtra){
    btnSaveExtra.addEventListener('click', ()=> onSaveExtraPOS().catch(err=>console.error(err)));
  }
  const btnCancelExtra = document.getElementById('btn-cancel-extra');
  if (btnCancelExtra){
    btnCancelExtra.addEventListener('click', ()=> resetExtraFormPOS());
  }
  const extrasList = document.getElementById('extras-list');
  if (extrasList){
    extrasList.addEventListener('click', (e)=> onExtrasListClickPOS(e).catch(err=>console.error(err)));
  }
  $('#sale-price').addEventListener('input', recomputeTotal);
  $('#sale-qty').addEventListener('input', recomputeTotal);
  $('#sale-discount').addEventListener('input', recomputeTotal);
  $('#sale-courtesy').addEventListener('change', ()=>{ $('#sale-courtesy-to').disabled = !$('#sale-courtesy').checked; recomputeTotal(); });
  $('#sale-return').addEventListener('change', recomputeTotal);
  $('#sale-payment').addEventListener('change', async ()=>{
    const isCred = $('#sale-payment').value==='credito';
    $('#sale-customer').disabled = !isCred;
    if (!isCred) $('#sale-customer').value='';
    await refreshSaleBankSelect();
  });
  $('#sale-date').addEventListener('change', async()=>{
    await renderDay();
    await updateSellEnabled();
    try{ await refreshSaleStockLabel(); }catch(e){}
    try{ if (window.__A33_ACTIVE_TAB === 'checklist') await renderChecklistTab(); }catch(e){}
  });
  const btnGoCaja = document.getElementById('btn-go-caja');
  if (btnGoCaja){
    btnGoCaja.addEventListener('click', ()=>{
      try{
        const dk = getSaleDayKeyPOS();
        const pcDay = document.getElementById('pc-day');
        if (pcDay) pcDay.value = dk;
      }catch(e){}
      setTab('caja');
    });
  }

  $('#btn-add').addEventListener('click', addSale);
  const stickyBtn = $('#btn-add-sticky');
  if (stickyBtn) {
    stickyBtn.addEventListener('click', addSale);
  }

  // Venta por vaso (fraccionamiento de galones)
  const btnFraction = document.getElementById('btn-fraction');
  if (btnFraction) btnFraction.addEventListener('click', fractionGallonsToCupsPOS);

  const btnSellCups = document.getElementById('btn-sell-cups');
  if (btnSellCups) btnSellCups.addEventListener('click', ()=> sellCupsPOS(false));

  const btnCourtesyCups = document.getElementById('btn-courtesy-cups');
  if (btnCourtesyCups) btnCourtesyCups.addEventListener('click', ()=> sellCupsPOS(true));

  // Deshacer última venta del día para el evento activo
  $('#btn-undo').addEventListener('click', async ()=>{
    const curId = await getMeta('currentEventId');
    if (!curId) {
      alert('No hay evento activo.');
      return;
    }
    const d = $('#sale-date').value;

    // Candado: si Caja Chica está activada y el día está cerrado, NO permitir cambios de ventas
    try{
      const ev = await getEventByIdPOS(curId);
      if (!ev || ev.closedAt){ alert('No hay un evento activo válido.'); return; }
      if (!(await guardSellDayOpenOrToastPOS(ev, d))) return;
    }catch(e){}

    const allSales = await getAll('sales');
    const filtered = allSales.filter(s => s.eventId === curId && s.date === d);
    if (!filtered.length) {
      alert('No hay ventas para deshacer en este día.');
      return;
    }
    const last = filtered.sort((a,b)=> a.id - b.id)[filtered.length - 1];
    if (!confirm('¿Eliminar la última venta registrada?')) return;
    const delRes = await del('sales', last.id);
    try{ await revertExtraStockForSaleDeletePOS(last); }catch(e){}
    await renderDay();
    await renderSummary();
    await refreshSaleStockLabel();
    await renderInventario();
    if (delRes && delRes.warnings && delRes.warnings.length){
      alert('Venta eliminada, pero con avisos:\n\n- ' + delRes.warnings.join('\n- '));
    }
    toast('Venta eliminada');
  });

  // Eliminar una venta específica desde la tabla
  $('#tbl-day').addEventListener('click', async (e)=>{
    const btn = e.target.closest('button.del-sale');
    if (!btn) return;

    const rawId = btn.dataset.id;
    const id = Number(rawId);

    if (!Number.isFinite(id)){
      alert('No pude identificar la venta a eliminar (id inválido). Recarga el POS y vuelve a intentar.');
      return;
    }

    const saleToDelete = (await getAll('sales')).find(s=>s.id===id) || null;
    if (!saleToDelete){
      alert('No pude cargar la venta a eliminar. Recarga el POS y vuelve a intentar.');
      return;
    }

    // Candado: si Caja Chica está activada y el día está cerrado, NO permitir cambios de ventas
    try{
      const ev = await getEventByIdPOS(saleToDelete.eventId);
      if (!ev || ev.closedAt){ alert('No hay un evento activo válido.'); return; }
      if (!(await guardSellDayOpenOrToastPOS(ev, saleToDelete.date))) return;
    }catch(e){}

    if (!confirm('¿Eliminar esta venta?')) return;

    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Eliminando…';

    try{
      const delRes = await del('sales', id);
      try{ if (saleToDelete) await revertExtraStockForSaleDeletePOS(saleToDelete); }catch(e){ console.warn('revertExtraStockForSaleDeletePOS (delete) failed', e); }

      // Refrescar UI
      try{
        await renderDay();
        await renderSummary();
        await refreshSaleStockLabel();
        await renderInventario();
      }catch(uiErr){
        console.error('Error refrescando UI después de eliminar venta', uiErr);
      }

      if (delRes && delRes.warnings && delRes.warnings.length){
        alert('Venta eliminada, pero con avisos:\n\n- ' + delRes.warnings.join('\n- '));
      }

      toast('Venta eliminada');
    }catch(err){
      console.error('Error eliminando la venta', err);
      alert('No se pudo eliminar la venta.\n\nDetalle: ' + humanizeError(err));
    }finally{
      btn.disabled = false;
      btn.textContent = prevText || 'Eliminar';
    }
  });
  // Stepper
  $('#qty-minus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) - 1); $('#sale-qty').value = v; recomputeTotal(); });
  $('#qty-plus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) + 1); $('#sale-qty').value = v; recomputeTotal(); });

  // Stepper (Venta por vaso)
  const cupQtyInp = document.getElementById('cup-qty');
  const cupMinus = document.getElementById('cup-qty-minus');
  const cupPlus = document.getElementById('cup-qty-plus');
  if (cupMinus && cupQtyInp) cupMinus.addEventListener('click', ()=>{
    const v = Math.max(1, parseInt(cupQtyInp.value || '1', 10) - 1);
    cupQtyInp.value = v;
  });
  if (cupPlus && cupQtyInp) cupPlus.addEventListener('click', ()=>{
    const v = Math.max(1, parseInt(cupQtyInp.value || '1', 10) + 1);
    cupQtyInp.value = v;
  });

  // Productos: agregar + restaurar
  document.getElementById('btn-add-prod').onclick = async()=>{ const name = $('#new-name').value.trim(); const price = parseFloat($('#new-price').value||'0'); if (!name || !(price>0)) return alert('Nombre y precio'); try{ await put('products', {name, price, manageStock:true, active:true}); $('#new-name').value=''; $('#new-price').value=''; await renderProductos(); await refreshProductSelect(); await renderInventario(); toast('Producto agregado'); }catch(err){ alert('No se pudo agregar. ¿Nombre duplicado?'); } };
  document.getElementById('btn-restore-seed').onclick = restoreSeed;

  // Bancos: agregar desde pestaña Productos
  const addBankBtn = document.getElementById('btn-add-bank');
  if (addBankBtn){
    addBankBtn.onclick = async ()=>{
      const input = document.getElementById('bank-new-name');
      const raw = (input?.value || '').trim();
      if (!raw){ alert('Nombre del banco'); return; }

      const banks = await getAllBanksSafe();
      const key = normBankName(raw);
      const dup = banks.find(b => normBankName(b?.name) === key);
      if (dup){
        if (dup.isActive === false){
          if (confirm('Ese banco ya existe pero está inactivo. ¿Activarlo?')){
            dup.isActive = true;
            await put('banks', dup);
            if (input) input.value = '';
            await renderBancos();
            await refreshSaleBankSelect();
            toast('Banco activado');
          }
          return;
        }
        alert('Ese banco ya existe.');
        return;
      }

      await put('banks', { name: raw, isActive: true, createdAt: new Date().toISOString() });
      if (input) input.value = '';
      await renderBancos();
      await refreshSaleBankSelect();
      toast('Banco agregado');
    };
  }

  
async function exportEventosExcel(){
  const events = await getAll('events');
  const sales = await getAll('sales');
  const rows = [['id','evento','grupo','estado','creado','cerrado','total']];

  for (const ev of events){
    const tot = sales.filter(s=>s.eventId===ev.id).reduce((a,b)=>a+(b.total||0),0);
    const estado = ev.closedAt ? 'Cerrado' : 'Abierto';
    rows.push([
      ev.id,
      ev.name || '',
      ev.groupName || '',
      estado,
      ev.createdAt || '',
      ev.closedAt || '',
      tot.toFixed ? tot.toFixed(2) : tot
    ]);
  }

  downloadExcel('eventos.xlsx', 'Eventos', rows);
}

// Eventos tab actions
  $('#filtro-eventos').addEventListener('change', renderEventos);
  const filtroGrupoEl = document.getElementById('filtro-grupo');
  if (filtroGrupoEl){
    filtroGrupoEl.addEventListener('change', renderEventos);
  }
  const cierreBtn = document.getElementById('btn-cierre-total');
  if (cierreBtn){
    cierreBtn.addEventListener('click', computeCierreTotalGrupo);
  }
  const cierreExcelBtn = document.getElementById('btn-cierre-total-excel');
  if (cierreExcelBtn){
    cierreExcelBtn.addEventListener('click', exportCierreTotalGrupoExcel);
  }
  const cierreCajaBtn = document.getElementById('btn-cierre-caja-grupo');
  if (cierreCajaBtn){
    cierreCajaBtn.addEventListener('click', computeCierreCajaChicaGrupo);
  }
  const cierreCajaExcelBtn = document.getElementById('btn-cierre-caja-excel');
  if (cierreCajaExcelBtn){
    cierreCajaExcelBtn.addEventListener('click', exportCierreCajaChicaGrupoExcel);
  }
  $('#btn-exportar-eventos').addEventListener('click', async()=>{
    await exportEventosExcel();
  });
  $('#btn-exportar-evento-excel').addEventListener('click', async()=>{
    const evId = await getMeta('currentEventId');
    if (!evId){
      alert('Debes activar un evento en la pestaña Vender antes de exportar a Excel.');
      return;
    }
    await exportEventExcel(evId);
  });
  $('#tbl-eventos').addEventListener('click', async(e)=>{ const btn = e.target.closest('button'); if (!btn) return; const id = parseInt(btn.dataset.id,10);
    if (btn.classList.contains('act-ver')) await openEventView(id);
    else if (btn.classList.contains('act-activar')) await activateEvent(id);
    else if (btn.classList.contains('act-reabrir')) await reopenEvent(id);
    else if (btn.classList.contains('act-cerrar')) await closeEvent(id);
    else if (btn.classList.contains('act-corte')) await generateCorteCSV(id);
    else if (btn.classList.contains('act-ventas')) await exportEventSalesCSV(id);
    else if (btn.classList.contains('act-inv')) await generateInventoryCSV(id);
    else if (btn.classList.contains('act-eliminar')) await deleteEvent(id);
    await renderEventos(); await renderSummary();
  });

  // Modal close
  document.getElementById('ev-close').onclick = ()=> showEventView(false);
  document.getElementById('event-view').addEventListener('click', (e)=>{ if (e.target.id==='event-view') showEventView(false); });

  // Inventario tab
  $('#inv-event').addEventListener('change', renderInventario);
  $('#btn-inv-ref').addEventListener('click', renderInventario);
  $('#btn-inv-csv').addEventListener('click', async()=>{ const id = parseInt($('#inv-event').value||'0',10); if (!id) return alert('Selecciona un evento'); await generateInventoryCSV(id); });
  const btnFromLote = document.getElementById('btn-inv-from-lote');
  if (btnFromLote) btnFromLote.addEventListener('click', importFromLoteToInventory);

}

// Totales y ventas
function recomputeTotal(){
  const price = parseFloat($('#sale-price').value||'0');
  const qty = Math.max(0, parseFloat($('#sale-qty').value||'0'));
  const discountPerUnit = Math.max(0, parseFloat($('#sale-discount').value||'0'));
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;

  // Precio efectivo por unidad luego del descuento fijo
  const effectiveUnit = Math.max(0, price - discountPerUnit);
  let total = effectiveUnit * qty;

  if (courtesy) {
    total = 0;
  }
  if (isReturn) {
    total = -total;
  }

  const t = total.toFixed(2);
  const saleTotalInput = $('#sale-total');
  if (saleTotalInput) {
    saleTotalInput.value = t;
  }
  const stickyEl = $('#sticky-total');
  if (stickyEl) {
    stickyEl.textContent = t;
  }
}

async function addSale(){
  const curId = await getMeta('currentEventId');
  if (!curId){ alert('Selecciona un evento'); return; }
  const date = $('#sale-date').value;
  const selVal = String($('#sale-product')?.value || '').trim();
  const parsed = parseSelectedSellItemValue(selVal);
  if (parsed && parsed.kind === 'extra'){
    await addExtraSale(parsed.id);
    return;
  }
  const productId = (parsed && parsed.kind === 'product') ? parsed.id : parseInt(selVal||'0',10);
  const qtyIn = parseFloat($('#sale-qty').value||'0');
  const qty = Math.abs(qtyIn);
  const price = parseFloat($('#sale-price').value||'0');
  const discountPerUnit = Math.max(0, parseFloat($('#sale-discount').value||'0'));
  const payment = $('#sale-payment').value;
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customer = (payment==='credito') ? ($('#sale-customer').value||'').trim() : '';
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';
  if (!date || !productId || !qty) { alert('Completa fecha, producto y cantidad'); return; }
  if (payment==='credito' && !customer){ alert('Ingresa el nombre del cliente (crédito)'); return; }

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
  }

  const events = await getAll('events');
  const event = events.find(e=>e.id===curId);
  if (!event || event.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

  // Candado: si Caja Chica está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(event, date))) return;

  const products = await getAll('products');
  const prod = products.find(p=>p.id===productId);
  const productName = prod ? prod.name : 'N/D';

  if (prod && prod.manageStock!==false && !isReturn){
    const st = await computeStock(curId, productId);
    if (st < qty){
      const go = confirm(`Stock insuficiente de ${productName}: disponible ${st}, intentas vender ${qty}. ¿Continuar de todos modos?`);
      if (!go) return;
    }
  }

  let subtotal = price * qty;
  let discount = discountPerUnit * qty;
  if (courtesy) {
    discount = 0;
  }
  let total = courtesy ? 0 : Math.max(0, subtotal - discount);
  const finalQty = isReturn ? -qty : qty;
  if (isReturn) total = -total;

  const unitCost = getCostoUnitarioProducto(productName);
  const lineCost = unitCost * finalQty;
  const lineProfit = total - lineCost;

  const eventName = event ? event.name : 'General';
  const now = new Date(); const time = now.toTimeString().slice(0,5);

  // Ajustar inventario central de producto terminado
  try{
    applyFinishedFromSalePOS({ productName, qty: finalQty }, +1);
  }catch(e){
    console.error('No se pudo actualizar inventario central desde venta', e);
  }

  const saleRecord = {
    date,
    time,
    createdAt: Date.now(),
    eventId:curId,
    eventName,
    productId,
    productName,
    unitPrice:price,
    qty:finalQty,
    discount,
    payment,
    bankId: (payment === 'transferencia') ? bankId : null,
    bankName: (payment === 'transferencia') ? bankName : null,
    courtesy,
    isReturn,
    customer,
    courtesyTo,
    total,
    notes,
    costPerUnit:unitCost,
    lineCost,
    lineProfit
  };

  try{ await ensureNewSaleSeqIdPOS(event, saleRecord); }catch(e){ console.warn('No se pudo asignar N° por evento a esta venta', e); }

  const saleId = await put('sales', saleRecord);
  saleRecord.id = saleId;

  // Crear/actualizar asiento contable automático en Finanzas
  try {
    await createJournalEntryForSalePOS(saleRecord);
  } catch (err) {
    console.error('No se pudo generar el asiento automático de esta venta', err);
  }

  // limpiar campos para el siguiente registro (incluye NOTAS)
  $('#sale-qty').value=1; 
  $('#sale-discount').value=0; 
  if (payment==='credito') $('#sale-customer').value=''; 
  $('#sale-courtesy-to').value='';
  $('#sale-notes').value=''; // limpiar notas
  const nextTotal = (courtesy?0:price).toFixed(2);
  const saleTotal2 = $('#sale-total');
  if (saleTotal2) {
    saleTotal2.value = nextTotal;
  }
  const sticky2 = $('#sticky-total');
  if (sticky2) {
    sticky2.textContent = nextTotal;
  }

  await renderDay(); await renderSummary(); await refreshSaleStockLabel(); await renderInventario();
  toast('Venta agregada');
}


async function addExtraSale(extraId){
  const curId = await getMeta('currentEventId');
  if (!curId){ alert('Selecciona un evento'); return; }

  const ev = await getEventByIdPOS(curId);
  if (!ev || ev.closedAt){ alert('No hay un evento activo válido'); return; }

  const date = $('#sale-date').value;
  const qtyIn = parseFloat($('#sale-qty').value||'0');
  const qty = Math.abs(qtyIn);
  const discountPerUnit = Math.max(0, parseFloat($('#sale-discount').value||'0'));
  const payment = $('#sale-payment').value;
  const courtesy = $('#sale-courtesy').checked;
  const isReturn = $('#sale-return').checked;
  const customer = (payment==='credito') ? ($('#sale-customer').value||'').trim() : '';
  const courtesyTo = $('#sale-courtesy-to').value || '';
  const notes = $('#sale-notes').value || '';

  if (!date || !qty) { alert('Completa fecha y cantidad'); return; }

  // Candado: si Caja Chica está activada y el día está cerrado, NO permitir ventas
  if (!(await guardSellDayOpenOrToastPOS(ev, date))) return;
  if (payment==='credito' && !customer){ alert('Ingresa el nombre del cliente (crédito)'); return; }

  // Banco (obligatorio si es Transferencia)
  let bankId = null;
  let bankName = '';
  if (payment === 'transferencia'){
    const activeBanks = (await getAllBanksSafe()).filter(b => b && b.isActive !== false);
    if (!activeBanks.length){
      alert('No hay bancos activos. Agregá uno en Productos.');
      return;
    }
    const sel = document.getElementById('sale-bank');
    const raw = sel ? String(sel.value || '').trim() : '';
    const id = parseInt(raw || '0', 10);
    if (!id){
      alert('Selecciona el banco para la transferencia.');
      return;
    }
    const found = activeBanks.find(b => Number(b.id) === id);
    bankId = id;
    bankName = (found && found.name) ? String(found.name) : '';
  }

  const extras = sanitizeExtrasPOS(ev.extras).filter(x=>x && x.active!==false);
  const extra = extras.find(x=>Number(x.id)===Number(extraId));
  if (!extra){
    alert('Extra no encontrado.');
    await renderExtrasUI();
    await refreshProductSelect({ keepSelection:true });
    return;
  }

  const unitPrice = Number(extra.unitPrice)||0;
  const effectiveUnit = Math.max(0, unitPrice - discountPerUnit);
  let total = effectiveUnit * qty;
  if (courtesy) total = 0;
  if (isReturn) total = -total;

  // Descuento total (compatibilidad con UI/exports)
  const discount = courtesy ? 0 : (discountPerUnit * qty);

  const finalQty = isReturn ? -qty : qty;

  // Validar stock (para ventas normales y cortesías)
  if (finalQty > 0) {
    const stockNow = Number(extra.stock)||0;
    if (stockNow < finalQty) {
      const want = confirm(
        'Stock insuficiente para "' + extra.name + '".\n\n' +
        'Stock actual: ' + stockNow + '\n' +
        'Requerido: ' + finalQty + '\n\n' +
        '¿Deseas agregar stock ahora?'
      );
      if (want) {
        const suggest = String(Math.max(0, finalQty - stockNow));
        const rawAdd = prompt('Cantidad a agregar:', suggest);
        const addQty = parseFloat(rawAdd || '0');
        if (addQty > 0) {
          extra.stock = stockNow + addQty;
        }
      }
      if ((Number(extra.stock)||0) < finalQty) {
        alert('Stock insuficiente. Agregá stock y volvé a intentar.');
        await renderExtrasUI();
        await refreshSaleStockLabel();
        return;
      }
    }
  }

  // Descontar / revertir stock
  extra.stock = (Number(extra.stock)||0) - finalQty;
  extra.updatedAt = Date.now();
  ev.extras = extras;
  await put('events', ev);

  // Construir venta (costo congelado)
  const now = new Date();
  const time = now.toTimeString().slice(0,5);

  const costPerUnit = Number(extra.unitCost)||0;
  const lineCost = costPerUnit * finalQty;
  const lineProfit = total - lineCost;

  const saleRecord = {
    id: Date.now(),
    eventId: curId,
    eventName: ev.name,
    date,
    time,
    productId: null,
    productName: extra.name,
    isExtra: true,
    extraId: extra.id,
    qty: finalQty,
    unitPrice,
    discount,
    discountPerUnit,
    total,
    payment,
    bankId,
    bankName,
    customer,
    courtesy,
    courtesyTo,
    notes,
    isReturn,
    createdAt: Date.now(),
    costPerUnit,
    lineCost,
    lineProfit
  };

  try{ await ensureNewSaleSeqIdPOS(ev, saleRecord); }catch(e){ console.warn('ensureNewSaleSeqIdPOS (extra) failed', e); }

  await put('sales', saleRecord);
  await createJournalEntryForSalePOS(saleRecord);

  // Reset mínimos
  $('#sale-qty').value = '1';
  $('#sale-discount').value = '0';
  $('#sale-courtesy').checked = false;
  $('#sale-courtesy-to').disabled = true;
  $('#sale-courtesy-to').value = '';
  $('#sale-notes').value = '';
  $('#sale-return').checked = false;

  await renderDay();
  await renderSummary();
  await renderExtrasUI();
  await refreshProductSelect({ keepSelection:true });

  toast(courtesy ? 'Cortesía de Extra registrada' : 'Venta de Extra registrada');
}

function getSelectedPcDay(){
  const inp = document.getElementById('pc-day');
  const today = todayYMD();
  if (inp && !inp.value) inp.value = today;
  const val = (inp && inp.value) ? inp.value : today;
  return safeYMD(val);
}



// --- Caja Chica: validación de cierre definitivo + ventas en efectivo
async function getCashSalesNioForDay(eventId, dayKey){
  if (!eventId || !dayKey) return 0;
  const allSales = await getAll('sales');
  let sum = 0;
  for (const s of (allSales || [])){
    if (!s || s.eventId !== eventId) continue;
    if ((s.payment || '') !== 'efectivo') continue;
    if ((s.date || '') !== dayKey) continue;
    sum += Number(s.total || 0);
  }
  return round2(sum);
}

function hasPettyDayActivity(day){
  if (!day) return false;
  if (day.initial && day.initial.savedAt) return true;
  if (day.finalCount && day.finalCount.savedAt) return true;
  if (Array.isArray(day.movements) && day.movements.length) return true;
  return false;
}

function hasUsdActivity(day, sum){
  if (!day) return false;
  const eps = 0.005;
  if (sum){
    if (Math.abs(Number(sum.usd.initial || 0)) > eps) return true;
    if (Math.abs(Number(sum.usd.entradas || 0)) > eps) return true;
    if (Math.abs(Number(sum.usd.salidas || 0)) > eps) return true;
    if (sum.usd.final != null && Math.abs(Number(sum.usd.final || 0)) > eps) return true;
  }
  if (Array.isArray(day.movements) && day.movements.some(m => m && m.currency === 'USD' && Math.abs(Number(m.amount || 0)) > eps)) return true;
  return false;
}

function adjustMatches(adj, diff){
  if (!adj) return false;
  return moneyEquals(adj.amount, diff);
}

function diffLabel(diff, sym){
  const v = round2(diff || 0);
  const sign = v > 0 ? '+' : '';
  const txt = `${sign}${fmt(v)}`;
  return sym ? `${sym} ${txt}` : txt;
}

function formatAdjLine(amount, sym){
  const v = round2(amount || 0);
  const sign = v > 0 ? '+' : (v < 0 ? '-' : '');
  const abs = Math.abs(v);
  // ejemplo: "+ C$ 250.00" o "- US$ 10.00"
  return `${sign} ${sym} ${fmt(abs)}`.trim();
}


function diffKind(diff){
  const v = round2(diff || 0);
  if (moneyEquals(v, 0)) return '';
  return v > 0 ? 'Sobrante' : 'Faltante';
}

async function getPettyCloseCheck(eventId, pc, dayKey, cashSalesNio, eventFxRate){
  const errors = [];
  const warnings = [];

  if (!eventId){
    errors.push('No hay evento activo.');
    return { canClose:false, errors, warnings, day:null, sum:null, diffNio:null, diffUsd:null, fxRate:null };
  }

  const pcSafe = pc || (await getPettyCash(eventId));
  const day = ensurePcDay(pcSafe, dayKey);

  const fxRaw = Number(eventFxRate || 0);
  const fxRate = (Number.isFinite(fxRaw) && fxRaw > 0) ? fxRaw : null;

  const sum = computePettyCashSummary(pcSafe, dayKey, { cashSalesNio });

  const diffNio = (sum && sum.nio && sum.nio.diferencia != null) ? Number(sum.nio.diferencia) : null;
  const diffUsd = (sum && sum.usd && sum.usd.diferencia != null) ? Number(sum.usd.diferencia) : null;

  const hasFinal = !!(day && day.finalCount && day.finalCount.savedAt);
  if (!hasFinal) errors.push('Guarda el arqueo final antes de cerrar el día.');

  const usdActive = hasUsdActivity(day, sum);
  if (usdActive && !(fxRate && fxRate > 0)){
    errors.push('Define el tipo de cambio (USD → C$) para este evento.');
  }

  const eps = 0.005;
  if (hasFinal){
    if (diffNio != null && Math.abs(diffNio) > eps){
      const kind = (diffNio > 0) ? 'Sobrante' : 'Faltante';
      errors.push(`Hay diferencia en C$ (${kind} C$ ${fmt(Math.abs(round2(diffNio)))}). Registra movimientos faltantes o un ajuste de caja igual a la diferencia.`);
    }

    // USD: si hay USD activo, también debe cuadrar
    if (usdActive && diffUsd != null && Math.abs(diffUsd) > eps){
      const kind = (diffUsd > 0) ? 'Sobrante' : 'Faltante';
      errors.push(`Hay diferencia en US$ (${kind} US$ ${fmt(Math.abs(round2(diffUsd)))}). Registra movimientos faltantes o un ajuste de caja igual a la diferencia.`);
    }
  }

  const canClose = errors.length === 0;
  return { canClose, errors, warnings, day, sum, diffNio, diffUsd, fxRate };
}

function setPettyCloseUIEmpty(){
  const status = document.getElementById('pc-close-status');
  const blocker = document.getElementById('pc-close-blocker');
  const btnClose = document.getElementById('pc-btn-close-day');
  const btnReopen = document.getElementById('pc-btn-reopen-day');

  if (status) status.textContent = '';
  if (blocker){
    blocker.style.display = 'none';
    blocker.textContent = '';
  }
  if (btnClose) btnClose.disabled = true;
  if (btnReopen){
    btnReopen.style.display = 'none';
    btnReopen.disabled = true;
  }

  // También limpiar UI del tipo de cambio por evento
  const fx = document.getElementById('pc-event-fx-rate');
  if (fx) fx.value = '';
}

function renderPettyCloseUI(check, isHistory){
  const status = document.getElementById('pc-close-status');
  const blocker = document.getElementById('pc-close-blocker');
  const btnClose = document.getElementById('pc-btn-close-day');
  const btnReopen = document.getElementById('pc-btn-reopen-day');

  if (!status || !blocker) return;
  if (!check || !check.day || !check.sum){
    status.textContent = '';
    blocker.style.display = 'none';
    blocker.textContent = '';
    if (btnClose) btnClose.disabled = true;
    if (btnReopen){
      btnReopen.style.display = 'none';
      btnReopen.disabled = true;
    }
    return;
  }

  const day = check.day;
  const sum = check.sum;

  const fxLine = (check.fxRate && check.fxRate > 0) ? (` · T/C: C$ ${fmt(check.fxRate)} por US$ 1`) : '';
  const closedLine = day.closedAt ? ('Día cerrado') : ('Día abierto');

  status.textContent = `${closedLine} · Teórico C$ ${fmt(sum.nio.teorico)} / Final C$ ${fmt(sum.nio.final ?? 0)}${fxLine}`;

  if (check.errors && check.errors.length){
    blocker.style.display = 'block';
    blocker.textContent = 'No se puede cerrar:\n- ' + check.errors.join('\n- ');
  } else {
    blocker.style.display = 'none';
    blocker.textContent = '';
  }

  if (btnClose){
    btnClose.disabled = isHistory || !!day.closedAt || !check.canClose;
  }

  if (btnReopen){
    btnReopen.style.display = (!isHistory && !!day.closedAt) ? 'inline-block' : 'none';
    btnReopen.disabled = isHistory ? true : false;
  }
}

async function onSaveEventFxRate(){
  const fx = document.getElementById('pc-event-fx-rate');

  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }

  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento antes de guardar el T/C.');
    return;
  }

  const evs = await getAll('events');
  const ev = (evs || []).find(e => e && e.id === evId);
  if (!ev){
    alert('No se encontró el evento activo.');
    return;
  }

  const raw = fx ? Number((fx.value || '').toString().replace(',', '.')) : 0;
  const rate = (Number.isFinite(raw) && raw > 0) ? round2(raw) : null;

  ev.fxRate = rate;
  await put('events', ev);

  await renderCajaChica();
  toast('Tipo de cambio guardado');
}

function updatePettyMovementTypeUI(){
  const typeSel = document.getElementById('pc-mov-type');
  const adjustWrap = document.getElementById('pc-adjust-kind-wrap');
  const transferWrap = document.getElementById('pc-transfer-kind-wrap');
  if (!typeSel) return;
  if (adjustWrap) adjustWrap.style.display = (typeSel.value === 'ajuste') ? 'block' : 'none';
  if (transferWrap) transferWrap.style.display = (typeSel.value === 'transferencia') ? 'block' : 'none';
}

async function onClosePettyDay(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento antes de cerrar el día.');
    return;
  }

  if (!(await ensurePettyEnabledForEvent(evId))) return;
  const dayKey = getSelectedPcDay();
  let pc = await getPettyCash(evId);

  // IMPORTANTE:
  // ensurePcDay() normaliza y REEMPLAZA el objeto del día dentro de pc.days.
  // Si guardamos una referencia (day) y luego otra función vuelve a llamar ensurePcDay(pc, dayKey),
  // esa referencia puede quedar “stale” y los cambios (closedAt) NO se persistirán.
  // Por eso, al mutar closedAt, siempre lo hacemos vía ensurePcDay(pc, dayKey) justo antes del save.
  if (ensurePcDay(pc, dayKey).closedAt){
    alert('Este día ya está cerrado.');
    return;
  }

  const cashSales = await getCashSalesNioForDay(evId, dayKey);
  const evs = await getAll('events');
  const ev = (evs || []).find(e => e && e.id === evId);
  const fx = ev ? Number(ev.fxRate || 0) : null;
  const check = await getPettyCloseCheck(evId, pc, dayKey, cashSales, fx);

  if (!check.canClose){
    alert('No se puede cerrar:\n\n- ' + check.errors.join('\n- '));
    await renderCajaChica();
    return;
  }

  const ok = confirm(`¿Cerrar el día ${dayKey}?

Esto bloqueará edición de Caja Chica para este día.`);
  if (!ok) return;

  const stamp = new Date().toISOString();
  // Setear el flag de cierre en el objeto REAL que se va a persistir
  ensurePcDay(pc, dayKey).closedAt = stamp;

  try{
    await savePettyCash(pc);

    // Confirmar persistencia real (anti “falsos positivos”)
    const pcReload = await getPettyCash(evId);
    const persisted = ensurePcDay(pcReload, dayKey).closedAt;
    if (!persisted){
      throw new Error('Persistencia no confirmada: closedAt sigue null.');
    }
    // Refrescar UI desde IDB
    await renderCajaChica();

    try{ await updateSellEnabled(); }catch(e){}
    showToast('Día cerrado', 'ok', 5000);
  }catch(err){
    console.error('onClosePettyDay save/confirm error', err);
    // Revertir en memoria (y NO marcar cerrado en UI)
    try{ ensurePcDay(pc, dayKey).closedAt = null; }catch(e){}
    showToast('No se pudo cerrar el día: ' + humanizeError(err), 'error', 5000);
    await renderCajaChica();
    return;
  }
}

async function onReopenPettyDay(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura).');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId) return;
  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);
  if (!day.closedAt){
    alert('Este día no está cerrado.');
    return;
  }
  const ok = confirm(`¿Reabrir el día ${dayKey}?

Podrás editar Caja Chica y el cierre del día quedará removido.`);
  if (!ok) return;

  const prevStamp = day.closedAt;

  day.closedAt = null;
  try{
    await savePettyCash(pc);

    // Confirmar persistencia real (anti “falsos positivos”)
    const pcReload = await getPettyCash(evId);
    const persisted = ensurePcDay(pcReload, dayKey).closedAt;
    if (persisted){
      throw new Error('Persistencia no confirmada: closedAt sigue con valor.');
    }
  }catch(err){
    console.error('onReopenPettyDay save/confirm error', err);
    // Revertir en memoria (y NO marcar abierto en UI)
    try{ day.closedAt = prevStamp; }catch(e){}
    showToast('No se pudo reabrir el día: ' + humanizeError(err), 'error', 5000);
    await renderCajaChica();
    return;
  }
  await renderCajaChica();

  try{ await updateSellEnabled(); }catch(e){}
  showToast('Día reabierto', 'ok', 5000);
}

// --- Caja Chica: histórico (solo lectura)
let pettyHistoryMode = false;
let pettyHistoryDayKey = null;   // día que se está visualizando
let pettyReturnDayKey = null;    // día objetivo (día operativo que estaba seleccionado antes)

function isPettyHistoryMode(){
  return pettyHistoryMode === true;
}

function getClosedPcDayKeys(pc){
  if (!pc || !pc.days || typeof pc.days !== 'object') return [];
  const keys = listPcDayKeys(pc);
  const closed = keys.filter(k => {
    const d = pc.days[k];
    return !!(d && d.finalCount && d.finalCount.savedAt);
  });

  // Para UI: mostrar más reciente primero
  closed.sort((a,b)=> b.localeCompare(a));
  return closed;
}

function setPettyReadOnly(isReadOnly, allowReopen){
  // Bloqueo robusto por fieldsets (cubre inputs dinámicos y cualquier control nuevo)
  const fsCount = document.getElementById('pc-count-fieldset');
  const fsMov = document.getElementById('pc-mov-fieldset');
  if (fsCount) fsCount.disabled = !!isReadOnly;
  if (fsMov) fsMov.disabled = !!isReadOnly;

  const lockAll = (sel) => {
    document.querySelectorAll(sel).forEach(el => { el.disabled = !!isReadOnly; });
  };

  lockAll('#pc-table-nio input[type="number"], #pc-table-usd input[type="number"], #pc-table-fnio input[type="number"], #pc-table-fusd input[type="number"]');

  [
    'pc-btn-save-initial','pc-btn-clear-initial',
    'pc-btn-save-final','pc-btn-clear-final',
    'pc-mov-type','pc-mov-adjust-kind','pc-mov-transfer-kind','pc-mov-currency','pc-mov-amount','pc-mov-desc','pc-mov-add',
    'pc-btn-close-day','pc-btn-reopen-day'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!isReadOnly;
  });

  // El tipo de cambio se edita dentro de Caja Chica: bloquear en histórico o día cerrado
  const fx = document.getElementById('pc-event-fx-rate');
  const fxBtn = document.getElementById('pc-btn-save-event-fx');
  if (fx) fx.disabled = !!isReadOnly;
  if (fxBtn) fxBtn.disabled = !!isReadOnly;

  if (allowReopen){
    const reopen = document.getElementById('pc-btn-reopen-day');
    if (reopen) reopen.disabled = false;
  }
}

function enterPettyHistoryMode(historyDay){
  const dayInput = document.getElementById('pc-day');
  if (!dayInput) return;

  // Guardar el día objetivo (operativo) solo la primera vez
  if (!pettyHistoryMode){
    pettyReturnDayKey = getSelectedPcDay();
  }

  pettyHistoryDayKey = safeYMD(historyDay);
  pettyHistoryMode = true;

  dayInput.dataset.manual = '1';
  dayInput.value = pettyHistoryDayKey;
  dayInput.disabled = true;
}

function exitPettyHistoryMode(){
  const dayInput = document.getElementById('pc-day');
  const sel = document.getElementById('pc-history-select');
  const backTo = pettyReturnDayKey || todayYMD();

  pettyHistoryMode = false;
  pettyHistoryDayKey = null;
  pettyReturnDayKey = null;

  if (sel) sel.value = '';
  if (dayInput){
    dayInput.disabled = false;
    dayInput.dataset.manual = '1';
    dayInput.value = backTo;
  }

  renderCajaChica();
}

function renderPettyHistoryControls(pc){
  const sel = document.getElementById('pc-history-select');
  const hint = document.getElementById('pc-history-hint');
  const note = document.getElementById('pc-history-note');
  const banner = document.getElementById('pc-history-banner');
  const btnBack = document.getElementById('pc-history-back');
  const btnUse = document.getElementById('pc-history-use');

  if (!sel) return;

  const closed = getClosedPcDayKeys(pc);
  const prevVal = sel.value;
  sel.innerHTML = '<option value="">— Ver un día cerrado —</option>' + closed.map(k=>`<option value="${k}">${k}</option>`).join('');

  if (isPettyHistoryMode() && pettyHistoryDayKey){
    sel.value = pettyHistoryDayKey;
  } else if (prevVal && closed.includes(prevVal)){
    sel.value = prevVal;
  } else {
    sel.value = '';
  }

  if (hint){
    hint.textContent = closed.length ? `Cierres guardados: ${closed.length}` : 'Aún no hay cierres guardados en este evento.';
  }

  if (btnBack) btnBack.style.display = isPettyHistoryMode() ? 'inline-block' : 'none';
  if (btnUse) btnUse.style.display = isPettyHistoryMode() ? 'inline-block' : 'none';

  if (isPettyHistoryMode()){
    const from = pettyHistoryDayKey || '';
    const target = pettyReturnDayKey || '';
    if (banner){
      banner.style.display = 'block';
      banner.textContent = `Vista histórica (solo lectura): ${from}. Día objetivo: ${target}.`;
    }
    if (btnUse){
      btnUse.textContent = target ? `Usar cierre del ${from} como inicio del ${target}` : 'Usar este cierre como inicio';
    }
    if (note){
      note.textContent = 'Nota: en histórico no se puede editar. Usa “Volver al día operativo” para registrar cambios.';
    }
  } else {
    if (banner){
      banner.style.display = 'none';
      banner.textContent = '';
    }
    if (note) note.textContent = '';
  }
}

async function onSelectPettyHistoryDay(){
  const sel = document.getElementById('pc-history-select');
  if (!sel) return;
  const val = sel.value || '';

  if (!val){
    if (isPettyHistoryMode()) exitPettyHistoryMode();
    return;
  }

  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Activa un evento antes de ver el histórico de Caja Chica.');
    sel.value = '';
    return;
  }

  enterPettyHistoryMode(val);
  await renderCajaChica();
}

async function onUseHistoryFinalAsInitial(){
  if (!isPettyHistoryMode() || !pettyHistoryDayKey || !pettyReturnDayKey){
    alert('Selecciona un día cerrado en el histórico primero.');
    return;
  }

  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Activa un evento antes de copiar cierres.');
    return;
  }

  const from = pettyHistoryDayKey;
  const target = pettyReturnDayKey;
  const ok = confirm(`¿Copiar el cierre del ${from} como saldo inicial del ${target}?\n\nEsto reemplazará el saldo inicial actual del ${target}.`);
  if (!ok) return;

  const pc = await getPettyCash(evId);
  const src = ensurePcDay(pc, from);
  if (!src || !src.finalCount || !src.finalCount.savedAt){
    alert('Ese día no tiene arqueo final guardado.');
    return;
  }

  const dest = ensurePcDay(pc, target);
  const fin = normalizePettySection(src.finalCount);
  dest.initial = normalizePettySection({
    nio: { ...fin.nio },
    usd: { ...fin.usd },
    savedAt: new Date().toISOString()
  });

    try{
    await savePettyCash(pc);
  }catch(err){
    console.error('onUseHistoryFinalAsInitial save error', err);
    showToast('No se pudo precargar el saldo inicial', 'error', 5000);
    await renderCajaChica();
    return;
  }
 // Volver al día operativo (objetivo) y renderizar
  const dayInput = document.getElementById('pc-day');
  pettyHistoryMode = false;
  pettyHistoryDayKey = null;
  const backTo = target;
  pettyReturnDayKey = null;

  if (dayInput){
    dayInput.disabled = false;
    dayInput.dataset.manual = '1';
    dayInput.value = backTo;
  }
  const sel = document.getElementById('pc-history-select');
  if (sel) sel.value = '';

  await renderCajaChica();
  toast('Saldo inicial precargado desde un cierre histórico');
}

function setPrevCierreUI(pc, dayKey){
  const btn = document.getElementById('pc-btn-use-prev');
  const note = document.getElementById('pc-prev-note');
  if (!btn || !note) return;

  btn.style.display = 'none';
  note.textContent = '';

  if (!pc || !pc.days) return;

  const day = ensurePcDay(pc, dayKey);
  const hasInit = !!(day && day.initial && day.initial.savedAt);
  const prevKey = findPrevDayWithFinal(pc, dayKey);

  if (!hasInit && prevKey){
    btn.style.display = 'inline-block';
    note.textContent = `Disponible: cierre del ${prevKey}`;
  } else if (hasInit){
    note.textContent = 'Saldo inicial guardado para este día.';
  } else {
    note.textContent = 'No hay un cierre anterior disponible.';
  }
}

async function renderCajaChica(){
  const main = document.getElementById('pc-main');
  const note = document.getElementById('pc-no-event-note');
  const lbl = document.getElementById('pc-event-info');
  const dayInput = document.getElementById('pc-day');

  if (dayInput){
    const today = todayYMD();
    if (dayInput.dataset.manual !== '1'){
      dayInput.value = today;
    }
    if (!dayInput.value) dayInput.value = today;
  }

  if (!main || !note || !lbl) return;

  const evId = await getMeta('currentEventId');
  const evs = await getAll('events');
  const ev = evId ? evs.find(e => e.id === evId) : null;

  if (!evId || !ev){
    lbl.textContent = 'Evento activo: —';
    note.style.display = 'block';
    main.classList.add('disabled');
    updatePettySummaryUI(null, null, null);
    resetPettyInitialInputs();
    resetPettyFinalInputs();
    renderPettyMovements(null, null, true);
    setPrevCierreUI(null, null);
    renderPettyHistoryControls(null);
    setPettyCloseUIEmpty();
    setPettyReadOnly(false, false);

    const movDate = document.getElementById('pc-mov-date');
    if (movDate){
      movDate.value = (dayInput && dayInput.value) ? dayInput.value : todayYMD();
      movDate.disabled = true;
    }
    return;
  }

  // Caja Chica por evento: si está desactivada, no bloquear el evento ni exigir cierres.
  const disabledBanner = document.getElementById('pc-disabled-banner');
  if (!eventPettyEnabled(ev)){
    if (disabledBanner) disabledBanner.style.display = 'block';
    note.style.display = 'none';
    lbl.textContent = 'Evento activo: ' + ev.name + ' · Caja Chica desactivada';
    main.classList.add('disabled');
    updatePettySummaryUI(null, null, null);
    resetPettyInitialInputs();
    resetPettyFinalInputs();
    renderPettyMovements(null, null, true);
    setPrevCierreUI(null, null);
    renderPettyHistoryControls(null);
    setPettyCloseUIEmpty();
    setPettyReadOnly(false, false);

    const movDate = document.getElementById('pc-mov-date');
    if (movDate){
      movDate.value = (dayInput && dayInput.value) ? dayInput.value : todayYMD();
      movDate.disabled = true;
    }
    return;
  }
  if (disabledBanner) disabledBanner.style.display = 'none';

  const dayKey = getSelectedPcDay();
  const hist = isPettyHistoryMode();
  lbl.textContent = 'Evento activo: ' + ev.name + ' · ' + (hist ? ('Histórico: ' + dayKey) : ('Día: ' + dayKey));
  note.style.display = 'none';
  main.classList.remove('disabled');

  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);

  // Mantener el campo de fecha de movimientos sincronizado con el día operativo
  const movDate = document.getElementById('pc-mov-date');
  if (movDate){
    movDate.value = dayKey;
    movDate.disabled = true;
  }

  // Ventas en efectivo (C$) del día (desde POS)
  const cashSalesNio = await getCashSalesNioForDay(evId, dayKey);

  updatePettySummaryUI(pc, dayKey, { cashSalesNio });
  fillPettyInitialFromPc(pc, dayKey);
  fillPettyFinalFromPc(pc, dayKey);

  
  updateCopyInitialButtonState(pc, dayKey, cashSalesNio);

  const readOnlyDay = hist || !!day.closedAt;
  renderPettyMovements(pc, dayKey, readOnlyDay);

  if (!hist){
    setPrevCierreUI(pc, dayKey);
  } else {
    setPrevCierreUI(null, null);
  }

  renderPettyHistoryControls(pc);

  // Cierre del día (candado)
  // Tipo de cambio persistente por evento (fallback: último fxRate legado en Caja Chica)
  let fx = Number(ev.fxRate || 0);
  if (!(Number.isFinite(fx) && fx > 0)) fx = null;
  if (!fx && pc && pc.days){
    const keys = listPcDayKeys(pc).sort((a,b)=> b.localeCompare(a));
    for (const k of keys){
      const d = pc.days[k];
      const legacy = d ? Number(d.fxRate || 0) : 0;
      if (Number.isFinite(legacy) && legacy > 0){ fx = legacy; break; }
    }
    if (fx && !(Number(ev.fxRate||0) > 0)){
      ev.fxRate = fx;
      await put('events', ev);
    }
  }

  const fxInput = document.getElementById('pc-event-fx-rate');
  if (fxInput) fxInput.value = (fx && fx > 0) ? String(fx) : '';

  const check = await getPettyCloseCheck(evId, pc, dayKey, cashSalesNio, fx);
  renderPettyCloseUI(check, hist);

  setPettyReadOnly(readOnlyDay, (!hist && !!day.closedAt));
}

function updatePettySummaryUI(pc, dayKey, opts){
  const sum = computePettyCashSummary(pc || null, dayKey || null, opts || null);

  const setVal = (id, value, allowDash) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (allowDash && (value === null || typeof value === 'undefined')){
      el.textContent = '—';
    } else {
      el.textContent = fmt(Number(value || 0));
    }
  };

  setVal('pc-nio-inicial', sum.nio.initial);
  setVal('pc-nio-entradas', sum.nio.entradas);
  setVal('pc-nio-salidas', sum.nio.salidas);
  setVal('pc-nio-ventas', sum.nio.ventasEfectivo || 0);
  setVal('pc-nio-teorico', sum.nio.teorico);
  setVal('pc-nio-final', sum.nio.final, true);
  setVal('pc-nio-diferencia', sum.nio.diferencia, true);

  setVal('pc-usd-inicial', sum.usd.initial);
  setVal('pc-usd-entradas', sum.usd.entradas);
  setVal('pc-usd-salidas', sum.usd.salidas);
  setVal('pc-usd-teorico', sum.usd.teorico);
  setVal('pc-usd-final', sum.usd.final, true);
  setVal('pc-usd-diferencia', sum.usd.diferencia, true);
}

function resetPettyInitialInputs(){
  if (typeof NIO_DENOMS === 'undefined' || typeof USD_DENOMS === 'undefined') return;

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-nio-q-'+d);
    const s = document.getElementById('pc-nio-sub-'+d);
    if (q) q.value = '0';
    if (s) s.textContent = '0.00';
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-usd-q-'+d);
    const s = document.getElementById('pc-usd-sub-'+d);
    if (q) q.value = '0';
    if (s) s.textContent = '0.00';
  });

  const tn = document.getElementById('pc-nio-total');
  const tu = document.getElementById('pc-usd-total');
  if (tn) tn.textContent = '0.00';
  if (tu) tu.textContent = '0.00';
}

function resetPettyFinalInputs(){
  if (typeof NIO_DENOMS === 'undefined' || typeof USD_DENOMS === 'undefined') return;

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fnio-q-'+d);
    const s = document.getElementById('pc-fnio-sub-'+d);
    if (q) q.value = '0';
    if (s) s.textContent = '0.00';
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fusd-q-'+d);
    const s = document.getElementById('pc-fusd-sub-'+d);
    if (q) q.value = '0';
    if (s) s.textContent = '0.00';
  });

  const tn = document.getElementById('pc-fnio-total');
  const tu = document.getElementById('pc-fusd-total');
  if (tn) tn.textContent = '0.00';
  if (tu) tu.textContent = '0.00';
}

function fillPettyInitialFromPc(pc, dayKey){
  resetPettyInitialInputs();
  if (!pc) return;
  const day = dayKey ? ensurePcDay(pc, dayKey) : null;
  const init = day && day.initial ? normalizePettySection(day.initial) : normalizePettySection(null);

  NIO_DENOMS.forEach(d=>{
    const key = String(d);
    const q = document.getElementById('pc-nio-q-'+d);
    const s = document.getElementById('pc-nio-sub-'+d);
    const qty = init.nio[key] || 0;
    if (q) q.value = String(qty);
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
  });

  USD_DENOMS.forEach(d=>{
    const key = String(d);
    const q = document.getElementById('pc-usd-q-'+d);
    const s = document.getElementById('pc-usd-sub-'+d);
    const qty = init.usd[key] || 0;
    if (q) q.value = String(qty);
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
  });

  const tn = document.getElementById('pc-nio-total');
  const tu = document.getElementById('pc-usd-total');
  if (tn) tn.textContent = fmt(init.totalNio || 0);
  if (tu) tu.textContent = fmt(init.totalUsd || 0);
}

function fillPettyFinalFromPc(pc, dayKey){
  resetPettyFinalInputs();
  if (!pc) return;
  const day = dayKey ? ensurePcDay(pc, dayKey) : null;
  const fin = (day && day.finalCount) ? normalizePettySection(day.finalCount) : normalizePettySection(null);

  NIO_DENOMS.forEach(d=>{
    const key = String(d);
    const q = document.getElementById('pc-fnio-q-'+d);
    const s = document.getElementById('pc-fnio-sub-'+d);
    const qty = fin.nio[key] || 0;
    if (q) q.value = String(qty);
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
  });

  USD_DENOMS.forEach(d=>{
    const key = String(d);
    const q = document.getElementById('pc-fusd-q-'+d);
    const s = document.getElementById('pc-fusd-sub-'+d);
    const qty = fin.usd[key] || 0;
    if (q) q.value = String(qty);
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
  });

  const tn = document.getElementById('pc-fnio-total');
  const tu = document.getElementById('pc-fusd-total');
  if (tn) tn.textContent = fmt(fin.totalNio || 0);
  if (tu) tu.textContent = fmt(fin.totalUsd || 0);
}

function getPettyMovementsNet(day){
  let netNio = 0;
  let netUsd = 0;
  let hasMov = false;

  const movs = (day && Array.isArray(day.movements)) ? day.movements : [];
  for (const m of movs){
    if (!m || typeof m.amount === 'undefined') continue;
    const amt = Number(m.amount) || 0;
    if (!amt) continue;
    hasMov = true;

    const sign = (m.type === 'salida') ? -1 : 1; // entrada = +, salida = -
    if (m.currency === 'USD') netUsd += sign * amt;
    else netNio += sign * amt;
  }

  return { netNio: round2(netNio), netUsd: round2(netUsd), hasMov };
}

function updateCopyInitialButtonState(pc, dayKey, cashSalesNio){
  const btn = document.getElementById('pc-btn-copy-initial');
  if (!btn) return;

  const day = (pc && dayKey) ? ensurePcDay(pc, dayKey) : null;

  // Bloquear en histórico o cuando el día ya está cerrado.
  const isRO = isPettyHistoryMode() || !!(day && day.closedAt);
  if (isRO){
    btn.disabled = true;
    btn.title = isPettyHistoryMode()
      ? 'Vista histórica (solo lectura).'
      : 'Este día está cerrado. Reabre el día para editar.';
    return;
  }

  const cash = Number(cashSalesNio || 0);
  const hasCashSales = Number.isFinite(cash) && cash > 0.005;

  const net = getPettyMovementsNet(day);
  const hasNetMov = (Math.abs(net.netNio) > 0.005) || (Math.abs(net.netUsd) > 0.005);

  if (hasCashSales){
    btn.disabled = true;
    btn.title = 'Copiar Inicial solo aplica para días sin ventas en efectivo.';
    return;
  }

  // Si no hay ventas, permitir. Si hay movimientos netos, permitir pero avisar.
  btn.disabled = false;
  if (hasNetMov){
    btn.title = `Hay movimientos de caja en este día (neto C$ ${fmt(net.netNio)} / neto US$ ${fmt(net.netUsd)}). Copiar Inicial puede no permitir cerrar.`;
  } else {
    btn.title = 'Copia el saldo inicial al arqueo final (ideal para días sin ventas).';
  }
}



function recalcPettyInitialTotalsFromInputs(){
  if (typeof NIO_DENOMS === 'undefined' || typeof USD_DENOMS === 'undefined') return;
  let totalNio = 0;
  let totalUsd = 0;

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-nio-q-'+d);
    const s = document.getElementById('pc-nio-sub-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
    totalNio += sub;
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-usd-q-'+d);
    const s = document.getElementById('pc-usd-sub-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
    totalUsd += sub;
  });

  const tn = document.getElementById('pc-nio-total');
  const tu = document.getElementById('pc-usd-total');
  if (tn) tn.textContent = fmt(totalNio);
  if (tu) tu.textContent = fmt(totalUsd);
}

function recalcPettyFinalTotalsFromInputs(){
  if (typeof NIO_DENOMS === 'undefined' || typeof USD_DENOMS === 'undefined') return;
  let totalNio = 0;
  let totalUsd = 0;

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fnio-q-'+d);
    const s = document.getElementById('pc-fnio-sub-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
    totalNio += sub;
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fusd-q-'+d);
    const s = document.getElementById('pc-fusd-sub-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    const sub = d * qty;
    if (s) s.textContent = fmt(sub);
    totalUsd += sub;
  });

  const tn = document.getElementById('pc-fnio-total');
  const tu = document.getElementById('pc-fusd-total');
  if (tn) tn.textContent = fmt(totalNio);
  if (tu) tu.textContent = fmt(totalUsd);
}

async function onSavePettyInitial(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento en la pestaña Vender antes de guardar Caja Chica.');
    return;
  }

  if (!(await ensurePettyEnabledForEvent(evId))) return;

  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);

  const nio = {};
  const usd = {};

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-nio-q-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    nio[String(d)] = qty;
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-usd-q-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    usd[String(d)] = qty;
  });

  day.initial = normalizePettySection({
    nio,
    usd,
    savedAt: new Date().toISOString()
  });

  try{
  await savePettyCash(pc);
}catch(err){
  console.error('onSavePettyInitial save error', err);
  showToast('No se pudo guardar el saldo inicial', 'error', 5000);
  return;
}

updatePettySummaryUI(pc, dayKey);
  fillPettyInitialFromPc(pc, dayKey);
  setPrevCierreUI(pc, dayKey);
  showToast('Saldo inicial guardado', 'ok', 5000);
}

async function onCopyPettyInitialToFinal(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }

  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento en la pestaña Vender antes de usar “Copiar Inicial”.');
    return;
  }

  if (!(await ensurePettyEnabledForEvent(evId))) return;

  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);

  if (day.closedAt){
    alert('Este día está cerrado. Reabre el día para editar Caja Chica.');
    return;
  }

  // Restricción: solo para día sin ventas en efectivo
  const cashSalesNio = await getCashSalesNioForDay(evId, dayKey);
  if (Number(cashSalesNio || 0) > 0.005){
    alert('Copiar Inicial solo aplica para días sin ventas en efectivo.');
    return;
  }

  // Si hay movimientos netos, avisar: copiar inicial al final podría dejar diferencia y no cerrar.
  const net = getPettyMovementsNet(day);
  const hasNetMov = (Math.abs(net.netNio) > 0.005) || (Math.abs(net.netUsd) > 0.005);
  if (hasNetMov){
    const ok = confirm(
      `Hay movimientos de caja registrados en este día (neto C$ ${fmt(net.netNio)} / neto US$ ${fmt(net.netUsd)}).

` +
      `Copiar Inicial al arqueo final puede dejar diferencia y no permitirá cerrar.

` +
      `¿Deseas continuar?`
    );
    if (!ok) return;
  }

  // Si ya existe arqueo final guardado, confirmar reemplazo
  if (day.finalCount && day.finalCount.savedAt){
    const ok = confirm('Este día ya tiene un arqueo final guardado. ¿Reemplazarlo con el saldo inicial?');
    if (!ok) return;
  }

  const init = day.initial ? normalizePettySection(day.initial) : normalizePettySection(null);

  day.finalCount = normalizePettySection({
    nio: { ...init.nio },
    usd: { ...init.usd },
    savedAt: new Date().toISOString()
  });

    try{
    await savePettyCash(pc);
  }catch(err){
    console.error('onCopyPettyInitialToFinal save error', err);
    showToast('No se pudo guardar el arqueo final', 'error', 5000);
    await renderCajaChica();
    return;
  }

  // Refrescar UI inmediatamente
  fillPettyFinalFromPc(pc, dayKey);
  updatePettySummaryUI(pc, dayKey, { cashSalesNio });
  setPrevCierreUI(pc, dayKey);

  // Refrescar candado de cierre
  const evs = await getAll('events');
  const ev = (evs || []).find(e => e && e.id === evId);
  const fx = ev ? Number(ev.fxRate || 0) : null;
  const check = await getPettyCloseCheck(evId, pc, dayKey, cashSalesNio, fx);
  renderPettyCloseUI(check, false);

  updateCopyInitialButtonState(pc, dayKey, cashSalesNio);
  toast('Arqueo final copiado desde el saldo inicial');
}


async function onSavePettyFinal(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento en la pestaña Vender antes de guardar el arqueo final.');
    return;
  }

  if (!(await ensurePettyEnabledForEvent(evId))) return;

  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);

  const nio = {};
  const usd = {};

  NIO_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fnio-q-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    nio[String(d)] = qty;
  });

  USD_DENOMS.forEach(d=>{
    const q = document.getElementById('pc-fusd-q-'+d);
    const raw = q ? Number(q.value || 0) : 0;
    const qty = (Number.isFinite(raw) && raw > 0) ? raw : 0;
    usd[String(d)] = qty;
  });

  day.finalCount = normalizePettySection({
    nio,
    usd,
    savedAt: new Date().toISOString()
  });

  try{
  await savePettyCash(pc);
}catch(err){
  console.error('onSavePettyFinal save error', err);
  showToast('No se pudo guardar el arqueo final', 'error', 5000);
  return;
}

updatePettySummaryUI(pc, dayKey);
  fillPettyFinalFromPc(pc, dayKey);
  setPrevCierreUI(pc, dayKey);
  showToast('Arqueo final guardado', 'ok', 5000);
}

function renderPettyMovements(pc, dayKey, readOnly){
  const tbody = document.getElementById('pc-mov-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (!pc){
    return;
  }

  const dk = dayKey || getSelectedPcDay();
  const day = ensurePcDay(pc, dk);
  const movs = Array.isArray(day.movements) ? day.movements : [];
  if (!movs.length) return;

  // Más reciente primero
  const ordered = [...movs].sort((a,b)=> (Number(b.id||0) - Number(a.id||0)));
  for (const m of ordered){
    const tr = document.createElement('tr');

    // Identificadores para enfocar/evitar duplicados (arqueo)
    if (m && m.id != null){
      tr.id = 'pc-mov-row-' + String(m.id);
      tr.dataset.pcMovId = String(m.id);
    }

    const tdDate = document.createElement('td');
    tdDate.textContent = m.date || dk;

    const tdType = document.createElement('td');
    // Tipo visible: Ingreso / Egreso / Ajuste
    let typeLabel = (m && m.type === 'salida') ? 'Egreso' : 'Ingreso';
    if (m && m.isAdjust){
      const k = (m.adjustKind === 'sobrante') ? 'Sobrante' : 'Faltante';
      typeLabel = `Ajuste (${k})`;
    }
    if (m && m.isTransfer){
      const tk = m.transferKind || 'to_bank';
      const t = (tk === 'from_general') ? 'De Caja general' : (tk === 'to_general') ? 'A Caja general' : 'A Banco';
      typeLabel = `Transferencia (${t})`;
    }
    tdType.textContent = typeLabel;

    const tdCur = document.createElement('td');
    tdCur.textContent = (m.currency === 'USD') ? 'US$' : 'C$';

    const tdAmt = document.createElement('td');
    tdAmt.textContent = fmt(Number(m.amount || 0));

    const tdDesc = document.createElement('td');
    tdDesc.textContent = m.description || '';

    const tdAct = document.createElement('td');
    if (!readOnly){
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn small danger';
      btn.dataset.movid = String(m.id || '');
      btn.textContent = 'Eliminar';
      btn.addEventListener('click', ()=> onDeletePettyMovement(m.id));
      tdAct.appendChild(btn);
    }

    tr.appendChild(tdDate);
    tr.appendChild(tdType);
    tr.appendChild(tdCur);
    tr.appendChild(tdAmt);
    tr.appendChild(tdDesc);
    tr.appendChild(tdAct);

    tbody.appendChild(tr);
  }
}

async function onAddPettyMovement(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento en la pestaña Vender antes de registrar movimientos de Caja Chica.');
    return;
  }

  if (!(await ensurePettyEnabledForEvent(evId))) return;

  const dayKey = getSelectedPcDay();

  const typeSel = document.getElementById('pc-mov-type');
  const kindSel = document.getElementById('pc-mov-adjust-kind');
  const transferSel = document.getElementById('pc-mov-transfer-kind');
  const curSel  = document.getElementById('pc-mov-currency');
  const amtInput = document.getElementById('pc-mov-amount');
  const descInput = document.getElementById('pc-mov-desc');

  const uiType = typeSel ? typeSel.value : 'entrada';
  const currency = curSel ? curSel.value : 'NIO';
  const rawAmt = amtInput ? Number(amtInput.value || 0) : 0;
  const amount = Number.isFinite(rawAmt) ? rawAmt : 0;
  let description = descInput ? (descInput.value || '').trim() : '';

  if (!amount || amount <= 0){
    alert('Ingresa un monto mayor a cero.');
    return;
  }
  if (currency !== 'NIO' && currency !== 'USD'){
    alert('Moneda inválida.');
    return;
  }

  // Nuevo tipo: Ajuste (se guarda internamente como entrada/salida, con bandera isAdjust)
  let type = uiType;
  let isAdjust = false;
  let adjustKind = null;

  if (uiType === 'ajuste'){
    isAdjust = true;
    adjustKind = kindSel ? kindSel.value : 'faltante';
    if (adjustKind !== 'sobrante') adjustKind = 'faltante';
    type = (adjustKind === 'sobrante') ? 'entrada' : 'salida';

    if (!description){
      description = `Ajuste — ${adjustKind === 'sobrante' ? 'Sobrante' : 'Faltante'}`;
    }
  }

  // Nuevo tipo: Transferencia (se guarda internamente como entrada/salida, con bandera isTransfer)
  let isTransfer = false;
  let transferKind = null;

  if (uiType === 'transferencia'){
    isTransfer = true;
    transferKind = transferSel ? transferSel.value : 'to_bank';
    if (transferKind !== 'to_bank' && transferKind !== 'to_general' && transferKind !== 'from_general') transferKind = 'to_bank';

    // Impacto en Caja Chica (entrada/salida)
    type = (transferKind === 'from_general') ? 'entrada' : 'salida';

    if (!description){
      description = (transferKind === 'to_bank') ? 'Transferencia a banco'
        : (transferKind === 'to_general') ? 'Transferencia a caja general'
        : 'Transferencia desde caja general';
    }
  }

  if (type !== 'entrada' && type !== 'salida'){
    alert('Tipo de movimiento inválido.');
    return;
  }

  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);
  if (!Array.isArray(day.movements)) day.movements = [];

  const newId = day.movements.length ? Math.max(...day.movements.map(m=>m.id||0)) + 1 : 1;

  const mov = {
    id: newId,
    createdAt: Date.now(),
    date: dayKey,
    uiType,
    type,
    currency,
    amount,
    description
  };

  if (isAdjust){
    mov.isAdjust = true;
    mov.adjustKind = adjustKind;
  }

  if (isTransfer){
    mov.isTransfer = true;
    mov.transferKind = transferKind;
  }

  day.movements.push(mov);

  try{
    await savePettyCash(pc);
  }catch(err){
    console.error('onAddPettyMovement save error', err);
    showToast('No se pudo guardar el movimiento', 'error', 5000);
    await renderCajaChica();
    return;
  }

  // Integración mínima: POS Caja Chica → Finanzas (Diario)
  try{
    await postPettyCashMovementToFinanzas(evId, dayKey, mov);
  }catch(e){
    console.warn('Finanzas bridge (pettycash) error', e);
  }

  // Re-render completo para refrescar candado de cierre
  await renderCajaChica();

  if (amtInput) amtInput.value = '0.00';
  if (descInput) descInput.value = '';
  if (typeSel) typeSel.value = 'entrada';
  updatePettyMovementTypeUI();
}

async function onDeletePettyMovement(id){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId) return;

  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const day = ensurePcDay(pc, dayKey);

  if (!Array.isArray(day.movements)) day.movements = [];
  day.movements = day.movements.filter(m => m.id !== id);

  try{
    await savePettyCash(pc);
  }catch(err){
    console.error('onDeletePettyMovement save error', err);
    showToast('No se pudo eliminar el movimiento', 'error', 5000);
    await renderCajaChica();
    return;
  }
  await renderCajaChica();
}


async function onUsePrevCierre(){
  if (isPettyHistoryMode()){
    alert('Estás en Vista histórica (solo lectura). Pulsa “Volver al día operativo” para editar.');
    return;
  }
  const evId = await getMeta('currentEventId');
  if (!evId){
    alert('Debes activar un evento en la pestaña Vender antes de usar el cierre anterior.');
    return;
  }

  const dayKey = getSelectedPcDay();
  const pc = await getPettyCash(evId);
  const prevKey = findPrevDayWithFinal(pc, dayKey);

  if (!prevKey){
    alert('No hay un cierre anterior disponible para precargar.');
    return;
  }

  const prevDay = ensurePcDay(pc, prevKey);
  if (!prevDay || !prevDay.finalCount){
    alert('El día anterior no tiene arqueo final guardado.');
    return;
  }

  const curDay = ensurePcDay(pc, dayKey);

  // Copiar denominaciones del final del día anterior al saldo inicial del día actual
  const fin = normalizePettySection(prevDay.finalCount);
  curDay.initial = normalizePettySection({
    nio: { ...fin.nio },
    usd: { ...fin.usd },
    savedAt: new Date().toISOString()
  });

  try{
    await savePettyCash(pc);
  }catch(err){
    console.error('onUsePrevCierre save error', err);
    showToast('No se pudo precargar el saldo inicial', 'error', 5000);
    await renderCajaChica();
    return;
  }
  updatePettySummaryUI(pc, dayKey);
  fillPettyInitialFromPc(pc, dayKey);
  setPrevCierreUI(pc, dayKey);
  toast('Saldo inicial precargado desde el cierre anterior');
}

function bindCajaChicaEvents(){
  // Activar Caja Chica por evento (si está desactivada)
  const btnActivate = document.getElementById('pc-btn-activate');
  if (btnActivate){
    btnActivate.addEventListener('click', async (e)=>{
      e.preventDefault();
      const evId = await getMeta('currentEventId');
      if (!evId) return;
      const ok = await ensurePettyEnabledForEvent(evId);
      if (ok) await renderCajaChica();
    });
  }

  const inputsInit = document.querySelectorAll('#pc-table-nio input[type="number"], #pc-table-usd input[type="number"]');
  inputsInit.forEach(inp=>{
    inp.addEventListener('input', recalcPettyInitialTotalsFromInputs);
  });

  const inputsFinal = document.querySelectorAll('#pc-table-fnio input[type="number"], #pc-table-fusd input[type="number"]');
  inputsFinal.forEach(inp=>{
    inp.addEventListener('input', recalcPettyFinalTotalsFromInputs);
  });

  const btnSaveInit = document.getElementById('pc-btn-save-initial');
  if (btnSaveInit){
    btnSaveInit.addEventListener('click', (e)=>{
      e.preventDefault();
      onSavePettyInitial();
    });
  }

  const btnClearInit = document.getElementById('pc-btn-clear-initial');
  if (btnClearInit){
    btnClearInit.addEventListener('click', (e)=>{
      e.preventDefault();
      resetPettyInitialInputs();
    });
  }

  const btnSaveFinal = document.getElementById('pc-btn-save-final');
  if (btnSaveFinal){
    btnSaveFinal.addEventListener('click', (e)=>{
      e.preventDefault();
      onSavePettyFinal();
    });
  }

  const btnClearFinal = document.getElementById('pc-btn-clear-final');
  if (btnClearFinal){
    btnClearFinal.addEventListener('click', (e)=>{
      e.preventDefault();
      resetPettyFinalInputs();
    });
  }

  

  // Copiar Inicial → Arqueo final (solo para día sin ventas)
  const btnCopyInitial = document.getElementById('pc-btn-copy-initial');
  if (btnCopyInitial){
    btnCopyInitial.addEventListener('click', (e)=>{
      e.preventDefault();
      onCopyPettyInitialToFinal().catch(err=>console.error(err));
    });
  }

const btnAddMov = document.getElementById('pc-mov-add');
  if (btnAddMov){
    btnAddMov.addEventListener('click', (e)=>{
      e.preventDefault();
      onAddPettyMovement();
    });
  }

  const tbody = document.getElementById('pc-mov-tbody');
  if (tbody){
    tbody.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-movid]');
      if (!btn) return;
      const id = Number(btn.dataset.movid);
      if (!id) return;
      onDeletePettyMovement(id);
    });
  }

  // Día operativo (Caja Chica por día)
  const dayInput = document.getElementById('pc-day');
  if (dayInput){
    dayInput.dataset.manual = '0';
    dayInput.value = todayYMD();
    dayInput.addEventListener('change', ()=>{
      dayInput.dataset.manual = '1';
      renderCajaChica();
    });
  }

  // Precargar saldo inicial desde el cierre anterior
  const btnPrev = document.getElementById('pc-btn-use-prev');
  if (btnPrev){
    btnPrev.addEventListener('click', (e)=>{
      e.preventDefault();
      onUsePrevCierre();
    });
  }

  // Histórico (solo lectura) de cierres por evento
  const histSel = document.getElementById('pc-history-select');
  if (histSel){
    histSel.addEventListener('change', ()=>{
      onSelectPettyHistoryDay().catch(err=>console.error(err));
    });
  }

  const histBack = document.getElementById('pc-history-back');
  if (histBack){
    histBack.addEventListener('click', (e)=>{
      e.preventDefault();
      exitPettyHistoryMode();
    });
  }

  const histUse = document.getElementById('pc-history-use');
  if (histUse){
    histUse.addEventListener('click', (e)=>{
      e.preventDefault();
      onUseHistoryFinalAsInitial().catch(err=>console.error(err));
    });
  }
  // Tipo de movimiento: mostrar/ocultar opciones de Ajuste
  const typeSel = document.getElementById('pc-mov-type');
  if (typeSel){
    typeSel.addEventListener('change', updatePettyMovementTypeUI);
    updatePettyMovementTypeUI();
  }

  // Tipo de cambio (USD → C$) por evento (persistente)
  const btnSaveFx = document.getElementById('pc-btn-save-event-fx');
  if (btnSaveFx){
    btnSaveFx.addEventListener('click', (e)=>{
      e.preventDefault();
      onSaveEventFxRate();
    });
  }

  const btnCloseDay = document.getElementById('pc-btn-close-day');
  if (btnCloseDay){
    btnCloseDay.addEventListener('click', (e)=>{
      e.preventDefault();
      onClosePettyDay();
    });
  }

  const btnReopenDay = document.getElementById('pc-btn-reopen-day');
  if (btnReopenDay){
    btnReopenDay.addEventListener('click', (e)=>{
      e.preventDefault();
      onReopenPettyDay();
    });
  }

}




async function findMissingCajaChicaCierres(selectedEvents, salesGrupo){
  const salesCount = new Map();
  for (const s of (salesGrupo || [])){
    if (!s || s.eventId == null) continue;
    salesCount.set(s.eventId, (salesCount.get(s.eventId) || 0) + 1);
  }

  const missing = [];
  for (const ev of (selectedEvents || [])){
    if (!ev) continue;

    const pc = await getPettyCash(ev.id);
    const hasSales = (salesCount.get(ev.id) || 0) > 0;
    const hasMov = hasAnyPettyMovements(pc);
    const isClosed = !!ev.closedAt;
    const hasFinal = hasAnyPettyFinal(pc);

    // Aviso solo si hubo actividad (ventas o movimientos) o si el evento ya fue cerrado,
    // y aún no existe arqueo final guardado.
    if ((hasSales || hasMov || isClosed) && !hasFinal){
      missing.push({
        id: ev.id,
        name: ev.name || '',
        closedAt: ev.closedAt || '',
        hasSales,
        hasMov
      });
    }
  }
  return missing;
}

async function getCierreTotalGrupoData(){
  const groupSelect = $('#filtro-grupo');
  if (!groupSelect){
    alert('No se encontró el filtro de grupo en la pestaña de eventos.');
    return null;
  }
  const groupVal = groupSelect.value || '';
  if (!groupVal){
    alert('Selecciona un grupo en la lista "Grupos" para generar el cierre total.');
    return null;
  }

  const events = await getAll('events');
  let selectedEvents;
  let groupLabel;
  if (groupVal === '__sin_grupo__'){
    selectedEvents = events.filter(ev => !(ev.groupName || '').trim());
    groupLabel = '[Sin grupo]';
  } else {
    selectedEvents = events.filter(ev => (ev.groupName || '').trim() === groupVal);
    groupLabel = groupVal;
  }
  if (!selectedEvents.length){
    alert('No hay eventos para ese grupo.');
    return null;
  }

  const sales = await getAll('sales');
  const eventIds = new Set(selectedEvents.map(ev=>ev.id));
  const salesGrupo = sales.filter(s => eventIds.has(s.eventId));

  const data = {
    groupValue: groupVal,
    groupLabel,
    eventos: [],
    totalGrupo: 0,
    porPago: {},
    transferByBank: [],
    cortesiasUnid: 0,
    devolUnid: 0,
    devolMonto: 0,
    presentaciones: [],
    pettyWarnings: { missingFinalEvents: [] }
  };

  if (!salesGrupo.length){
    data.eventos = selectedEvents.map(ev => ({
      id: ev.id,
      name: ev.name || '',
      createdAt: ev.createdAt || '',
      closedAt: ev.closedAt || '',
      total: 0
    }));
    data.pettyWarnings.missingFinalEvents = await findMissingCajaChicaCierres(selectedEvents, salesGrupo);
    return data;
  }

  const totalsPorEvento = new Map();
  for (const ev of selectedEvents){
    totalsPorEvento.set(ev.id, 0);
  }

  const presentacionesMap = new Map();

  const banks = await getAllBanksSafe();
  const bankMap = new Map();
  for (const b of banks){
    if (b && b.id != null) bankMap.set(Number(b.id), b.name || '');
  }
  const transferByBankMap = new Map();


  for (const s of salesGrupo){
    const t = s.total || 0;
    const qty = s.qty || 0;
    const pago = s.payment || 'otro';

    data.totalGrupo += t;
    if (!data.porPago[pago]) data.porPago[pago] = 0;
    data.porPago[pago] += t;

    if ((s.payment || '') === 'transferencia'){
      const label = getSaleBankLabel(s, bankMap);
      const cur = transferByBankMap.get(label) || { total: 0, count: 0 };
      cur.total += Number(s.total || 0);
      cur.count += 1;
      transferByBankMap.set(label, cur);
    }

    if (s.courtesy){
      data.cortesiasUnid += Math.abs(qty);
    }
    if (s.isReturn){
      data.devolUnid += Math.abs(qty);
      data.devolMonto += Math.abs(t);
    }

    if (totalsPorEvento.has(s.eventId)){
      totalsPorEvento.set(s.eventId, totalsPorEvento.get(s.eventId) + t);
    }

    if (!s.courtesy && !s.isReturn){
      const nombre = s.productName || 'N/D';
      let acc = presentacionesMap.get(nombre);
      if (!acc) acc = { unidades: 0, monto: 0 };
      acc.unidades += qty;
      acc.monto += t;
      presentacionesMap.set(nombre, acc);
    }
  }

  data.eventos = selectedEvents.map(ev => ({
    id: ev.id,
    name: ev.name || '',
    createdAt: ev.createdAt || '',
    closedAt: ev.closedAt || '',
    total: totalsPorEvento.get(ev.id) || 0
  }));

  data.transferByBank = Array.from(transferByBankMap.entries())
    .map(([bank, obj]) => ({ bank, total: Number(obj.total || 0), count: obj.count || 0 }))
    .sort((a,b)=> (b.total - a.total));

  data.presentaciones = Array.from(presentacionesMap.entries()).map(([name, info]) => ({
    name,
    unidades: info.unidades,
    monto: info.monto
  }));

  data.pettyWarnings.missingFinalEvents = await findMissingCajaChicaCierres(selectedEvents, salesGrupo);

  return data;
}

async function computeCierreTotalGrupo(){
  const data = await getCierreTotalGrupoData();
  if (!data) return;

  const resumenEl = document.getElementById('cierre-total-resumen');
  const presEl = document.getElementById('cierre-total-presentaciones');
  if (!resumenEl || !presEl) return;

  if (!data.eventos.length && !data.totalGrupo && !Object.keys(data.porPago).length){
    resumenEl.innerHTML = '<p class="muted">No hay ventas registradas para este grupo.</p>';
    presEl.innerHTML = '';
    return;
  }

  let html = '';
  html += `<div><strong>Grupo:</strong> ${data.groupLabel}</div>`;
  html += `<div><strong>Eventos incluidos:</strong> ${data.eventos.length}</div>`;

  const missingCaja = (data.pettyWarnings && Array.isArray(data.pettyWarnings.missingFinalEvents)) ? data.pettyWarnings.missingFinalEvents : [];
  if (missingCaja.length){
    const items = missingCaja.map(e=>{
      const flags = [];
      if (e.hasSales) flags.push('ventas');
      if (e.hasMov) flags.push('movimientos');
      if (e.closedAt) flags.push('cerrado');
      const why = flags.length ? ` (${flags.join(', ')})` : '';
      return `<li>${(e.name || ('Evento #' + e.id))}${why}</li>`;
    }).join('');
    html += `<div class="warn"><strong>⚠️ Aviso:</strong> faltan cierres diarios (arqueo final) de Caja Chica en ${missingCaja.length} evento(s) del grupo. Puedes continuar, pero el cierre total quedará sin esa confirmación.<ul>${items}</ul></div>`;
  }

  html += `<div><strong>Ventas totales del grupo:</strong> C$ ${fmt(data.totalGrupo)}</div>`;
  html += '<hr>';
  html += '<div><strong>Por forma de pago:</strong></div>';
  html += '<ul>';

  const ordenPagos = ['efectivo','transferencia','tarjeta','credito'];
  const ya = new Set();
  for (const metodo of ordenPagos){
    if (data.porPago[metodo] != null){
      html += `<li>${metodo}: C$ ${fmt(data.porPago[metodo])}</li>`;
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      html += `<li>${metodo}: C$ ${fmt(data.porPago[metodo])}</li>`;
    }
  }
  html += '</ul>';

  if (data.transferByBank && Array.isArray(data.transferByBank) && data.transferByBank.length){
    html += '<div><strong>Transferencias por banco:</strong></div>';
    html += '<table class="table small"><thead><tr><th>Banco</th><th>Total C$</th><th>#</th></tr></thead><tbody>';
    const entries = data.transferByBank.slice().sort((a,b)=> (Number(b.total||0) - Number(a.total||0)));
    for (const it of entries){
      html += `<tr><td>${it.bank}</td><td>C$ ${fmt(it.total||0)}</td><td>${it.count||0}</td></tr>`;
    }
    html += '</tbody></table>';
  }
  html += `<div><strong>Cortesías (unidades):</strong> ${data.cortesiasUnid}</div>`;
  html += `<div><strong>Devoluciones:</strong> ${data.devolUnid} u. | C$ ${fmt(data.devolMonto)}</div>`;

  resumenEl.innerHTML = html;

  if (!data.presentaciones.length){
    presEl.innerHTML = '<p class="muted">No hay ventas normales (sin cortesías ni devoluciones) en este grupo.</p>';
  } else {
    const rows = data.presentaciones.slice().sort((a,b)=>a.name.localeCompare(b.name,'es-NI'));
    let tabla = '<table class="table small"><thead><tr><th>Presentación</th><th>Unidades vendidas</th><th>Ventas C$</th></tr></thead><tbody>';
    for (const p of rows){
      tabla += `<tr><td>${p.name}</td><td>${p.unidades}</td><td>C$ ${fmt(p.monto)}</td></tr>`;
    }
    tabla += '</tbody></table>';
    presEl.innerHTML = tabla;
  }
}

async function exportCierreTotalGrupoExcel(){
  const data = await getCierreTotalGrupoData();
  if (!data) return;

  const missingCaja = (data.pettyWarnings && Array.isArray(data.pettyWarnings.missingFinalEvents)) ? data.pettyWarnings.missingFinalEvents : [];
  if (missingCaja.length){
    const lines = missingCaja.map(e => `- ${(e.name || ('Evento #' + e.id))}`).join('\n');
    const ok = confirm(`Aviso: faltan cierres diarios (arqueo final) de Caja Chica en ${missingCaja.length} evento(s) del grupo:\n\n${lines}\n\n¿Deseas exportar el Cierre Total de todas formas?`);
    if (!ok) return;
  }


  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }

  const sheets = [];

  // Hoja Resumen
  const resumenRows = [];
  resumenRows.push(['Grupo', data.groupLabel]);
  resumenRows.push(['Eventos incluidos', data.eventos.length]);
  resumenRows.push(['Ventas totales del grupo (C$)', data.totalGrupo]);
  resumenRows.push([]);
  resumenRows.push(['Forma de pago', 'Monto C$']);

  const ordenPagos = ['efectivo','transferencia','tarjeta','credito'];
  const ya = new Set();
  for (const metodo of ordenPagos){
    if (data.porPago[metodo] != null){
      resumenRows.push([metodo, data.porPago[metodo]]);
      ya.add(metodo);
    }
  }
  for (const metodo in data.porPago){
    if (!ya.has(metodo)){
      resumenRows.push([metodo, data.porPago[metodo]]);
    }
  }
  resumenRows.push([]);
  if (data.transferByBank && Array.isArray(data.transferByBank) && data.transferByBank.length){
    resumenRows.push(['Transferencias por banco']);
    resumenRows.push(['Banco','Total C$','Transacciones']);
    const entries = data.transferByBank.slice().sort((a,b)=> (Number(b.total||0) - Number(a.total||0)));
    for (const it of entries){
      resumenRows.push([it.bank, it.total || 0, it.count || 0]);
    }
  }
  resumenRows.push(['Cortesías (unidades)', data.cortesiasUnid]);
  resumenRows.push(['Devoluciones unidades', data.devolUnid]);
  resumenRows.push(['Devoluciones monto C$', data.devolMonto]);
  sheets.push({ name: 'Resumen', rows: resumenRows });

  // Hoja Eventos
  const eventosRows = [];
  eventosRows.push(['id','evento','creado','cerrado','total C$']);
  for (const ev of data.eventos){
    eventosRows.push([
      ev.id,
      ev.name,
      ev.createdAt,
      ev.closedAt,
      ev.total
    ]);
  }
  sheets.push({ name: 'Eventos', rows: eventosRows });

  // Hoja Presentaciones
  const presRows = [];
  presRows.push(['presentacion','unidades vendidas','ventas C$']);
  if (data.presentaciones.length){
    for (const p of data.presentaciones){
      presRows.push([p.name, p.unidades, p.monto]);
    }
  }
  sheets.push({ name: 'Presentaciones', rows: presRows });

  const wb = XLSX.utils.book_new();
  for (const sh of sheets){
    const ws = XLSX.utils.aoa_to_sheet(sh.rows);
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }

  const safeGroup = data.groupLabel.replace(/[\\/:*?\[\]]/g,' ');
  const filename = `cierre_total_${safeGroup || 'grupo'}.xlsx`;
  XLSX.writeFile(wb, filename);
}



async function getCierreCajaChicaGrupoData(){
  const groupSelect = $('#filtro-grupo');
  if (!groupSelect){
    alert('No se encontró el filtro de grupo en la pestaña de eventos.');
    return null;
  }
  const groupVal = groupSelect.value || '';
  if (!groupVal){
    alert('Selecciona un grupo en la lista "Grupos" para generar el cierre de Caja Chica.');
    return null;
  }

  const events = await getAll('events');
  let selectedEvents;
  let groupLabel;
  if (groupVal === '__sin_grupo__'){
    selectedEvents = events.filter(ev => !(ev.groupName || '').trim());
    groupLabel = '[Sin grupo]';
  } else {
    selectedEvents = events.filter(ev => (ev.groupName || '').trim() === groupVal);
    groupLabel = groupVal;
  }
  if (!selectedEvents.length){
    alert('No hay eventos para ese grupo.');
    return null;
  }

  // Obtener Caja Chica por evento
  const pettyList = [];
  for (const ev of selectedEvents){
    const pc = await getPettyCash(ev.id);
    pettyList.push(pc);
  }

  const eventos = [];
  const totalNio = { initial:0, entradas:0, salidas:0, teorico:0, final:0, diferencia:0, tieneFinal:false, tieneDif:false };
  const totalUsd = { initial:0, entradas:0, salidas:0, teorico:0, final:0, diferencia:0, tieneFinal:false, tieneDif:false };

  for (let i = 0; i < selectedEvents.length; i++){
    const ev = selectedEvents[i];
    const pc = pettyList[i];
    const summary = computePettyCashSummary(pc);

    const nio = summary.nio || {};
    const usd = summary.usd || {};

    eventos.push({
      id: ev.id,
      name: ev.name || '',
      createdAt: ev.createdAt || '',
      closedAt: ev.closedAt || '',
      nio,
      usd
    });

    // Acumulados NIO
    totalNio.initial += nio.initial || 0;
    totalNio.entradas += nio.entradas || 0;
    totalNio.salidas += nio.salidas || 0;
    totalNio.teorico += nio.teorico || 0;
    if (nio.final != null){
      totalNio.final += nio.final;
      totalNio.tieneFinal = true;
    }
    if (nio.diferencia != null){
      totalNio.diferencia += nio.diferencia;
      totalNio.tieneDif = true;
    }

    // Acumulados USD
    totalUsd.initial += usd.initial || 0;
    totalUsd.entradas += usd.entradas || 0;
    totalUsd.salidas += usd.salidas || 0;
    totalUsd.teorico += usd.teorico || 0;
    if (usd.final != null){
      totalUsd.final += usd.final;
      totalUsd.tieneFinal = true;
    }
    if (usd.diferencia != null){
      totalUsd.diferencia += usd.diferencia;
      totalUsd.tieneDif = true;
    }
  }

  if (!totalNio.tieneFinal) totalNio.final = null;
  if (!totalNio.tieneDif) totalNio.diferencia = null;
  if (!totalUsd.tieneFinal) totalUsd.final = null;
  if (!totalUsd.tieneDif) totalUsd.diferencia = null;

  return {
    groupLabel,
    eventos,
    nio: totalNio,
    usd: totalUsd
  };
}

async function computeCierreCajaChicaGrupo(){
  const data = await getCierreCajaChicaGrupoData();
  if (!data) return;

  const resumenEl = document.getElementById('cierre-caja-resumen');
  const eventosEl = document.getElementById('cierre-caja-eventos');
  if (!resumenEl || !eventosEl) return;

  if (!data.eventos.length){
    resumenEl.innerHTML = '<p class="muted">No hay datos de Caja Chica para este grupo.</p>';
    eventosEl.innerHTML = '';
    return;
  }

  let html = '';
  html += `<div><strong>Grupo:</strong> ${data.groupLabel}</div>`;
  html += `<div><strong>Eventos incluidos:</strong> ${data.eventos.length}</div>`;
  html += '<hr>';
  html += '<h4>Córdobas (C$)</h4>';
  html += '<ul>';
  html += `<li>Saldo inicial: C$ ${fmt(data.nio.initial)}</li>`;
  html += `<li>Entradas: C$ ${fmt(data.nio.entradas)}</li>`;
  html += `<li>Salidas: C$ ${fmt(data.nio.salidas)}</li>`;
  html += `<li>Saldo teórico: C$ ${fmt(data.nio.teorico)}</li>`;
  if (data.nio.final != null){
    html += `<li>Saldo final contado: C$ ${fmt(data.nio.final)}</li>`;
  }
  if (data.nio.diferencia != null){
    html += `<li>Diferencia: C$ ${fmt(data.nio.diferencia)}</li>`;
  }
  html += '</ul>';

  html += '<h4>Dólares (US$)</h4>';
  html += '<ul>';
  html += `<li>Saldo inicial: US$ ${fmt(data.usd.initial)}</li>`;
  html += `<li>Entradas: US$ ${fmt(data.usd.entradas)}</li>`;
  html += `<li>Salidas: US$ ${fmt(data.usd.salidas)}</li>`;
  html += `<li>Saldo teórico: US$ ${fmt(data.usd.teorico)}</li>`;
  if (data.usd.final != null){
    html += `<li>Saldo final contado: US$ ${fmt(data.usd.final)}</li>`;
  }
  if (data.usd.diferencia != null){
    html += `<li>Diferencia: US$ ${fmt(data.usd.diferencia)}</li>`;
  }
  html += '</ul>';

  resumenEl.innerHTML = html;

  // Tabla por evento
  const rows = data.eventos.slice();
  if (!rows.length){
    eventosEl.innerHTML = '<p class="muted">No hay eventos con Caja Chica registrada en este grupo.</p>';
    return;
  }

  let tabla = '<table class="table small"><thead><tr>';
  tabla += '<th>Evento</th><th>NIO inicial</th><th>NIO entradas</th><th>NIO salidas</th><th>NIO teórico</th><th>NIO final</th><th>NIO diferencia</th>';
  tabla += '<th>USD inicial</th><th>USD entradas</th><th>USD salidas</th><th>USD teórico</th><th>USD final</th><th>USD diferencia</th>';
  tabla += '</tr></thead><tbody>';
  for (const e of rows){
    const n = e.nio || {}; const u = e.usd || {};
    tabla += '<tr>';
    tabla += `<td>${e.name}</td>`;
    tabla += `<td>C$ ${fmt(n.initial || 0)}</td>`;
    tabla += `<td>C$ ${fmt(n.entradas || 0)}</td>`;
    tabla += `<td>C$ ${fmt(n.salidas || 0)}</td>`;
    tabla += `<td>C$ ${fmt(n.teorico || 0)}</td>`;
    tabla += `<td>${n.final != null ? 'C$ '+fmt(n.final) : '—'}</td>`;
    tabla += `<td>${n.diferencia != null ? 'C$ '+fmt(n.diferencia) : '—'}</td>`;
    tabla += `<td>US$ ${fmt(u.initial || 0)}</td>`;
    tabla += `<td>US$ ${fmt(u.entradas || 0)}</td>`;
    tabla += `<td>US$ ${fmt(u.salidas || 0)}</td>`;
    tabla += `<td>US$ ${fmt(u.teorico || 0)}</td>`;
    tabla += `<td>${u.final != null ? 'US$ '+fmt(u.final) : '—'}</td>`;
    tabla += `<td>${u.diferencia != null ? 'US$ '+fmt(u.diferencia) : '—'}</td>`;
    tabla += '</tr>';
  }
  tabla += '</tbody></table>';
  eventosEl.innerHTML = tabla;
}

async function exportCierreCajaChicaGrupoExcel(){
  const data = await getCierreCajaChicaGrupoData();
  if (!data) return;

  if (typeof XLSX === 'undefined'){
    alert('No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.');
    return;
  }

  const sheets = [];

  // Hoja ResumenCajaChica
  const resumenRows = [];
  resumenRows.push(['Grupo', data.groupLabel]);
  resumenRows.push([]);
  resumenRows.push(['Moneda','Saldo inicial','Entradas','Salidas','Saldo teórico','Saldo final','Diferencia']);
  resumenRows.push(['Córdobas (C$)', data.nio.initial, data.nio.entradas, data.nio.salidas, data.nio.teorico, data.nio.final, data.nio.diferencia]);
  resumenRows.push(['Dólares (US$)', data.usd.initial, data.usd.entradas, data.usd.salidas, data.usd.teorico, data.usd.final, data.usd.diferencia]);
  sheets.push({ name: 'ResumenCajaChica', rows: resumenRows });

  // Hoja EventosCajaChica
  const eventosRows = [];
  eventosRows.push(['id','evento','creado','cerrado','NIO inicial','NIO entradas','NIO salidas','NIO teórico','NIO final','NIO diferencia','USD inicial','USD entradas','USD salidas','USD teórico','USD final','USD diferencia']);
  for (const e of data.eventos){
    const n = e.nio || {}; const u = e.usd || {};
    eventosRows.push([
      e.id,
      e.name,
      e.createdAt,
      e.closedAt,
      n.initial || 0,
      n.entradas || 0,
      n.salidas || 0,
      n.teorico || 0,
      n.final != null ? n.final : '',
      n.diferencia != null ? n.diferencia : '',
      u.initial || 0,
      u.entradas || 0,
      u.salidas || 0,
      u.teorico || 0,
      u.final != null ? u.final : '',
      u.diferencia != null ? u.diferencia : ''
    ]);
  }
  sheets.push({ name: 'EventosCajaChica', rows: eventosRows });

  const wb = XLSX.utils.book_new();
  for (const sh of sheets){
    const ws = XLSX.utils.aoa_to_sheet(sh.rows);
    XLSX.utils.book_append_sheet(wb, ws, sh.name);
  }

  const safeGroup = data.groupLabel.replace(/[\/:*?\[\]]/g,' ');
  const filename = `caja_chica_${safeGroup || 'grupo'}.xlsx`;
  XLSX.writeFile(wb, filename);
}


// -----------------------------
// POS · Calculadora (tab) — lógica aislada
// -----------------------------

let __A33_POS_CALC_INIT = false;

function posCalcTrimDec(s){
  const t = String(s || '');
  if (!t.includes('.')) return t || '0';
  return t.replace(/0+$/,'').replace(/\.$/,'') || '0';
}

function posCalcReadNum(el){
  if (!el) return null;
  const raw = String(el.value || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function posCalcRound2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 100) / 100;
}

function posCalcFmt2(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return (Math.round(x * 100) / 100).toFixed(2);
}

// REQUISITO CLAVE: source of truth = Caja Chica (solo lectura)
// Devuelve el tipo de cambio actual usado por Caja Chica para el evento activo.
async function getFxRateFromCajaChica(){
  try{
    const ev = await getActiveEventPOS();
    if (!ev) return null;

    const direct = Number(ev.fxRate || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;

    const pc = await getPettyCash(ev.id);
    const keys = listPcDayKeys(pc).sort((a,b)=> b.localeCompare(a));
    for (const k of keys){
      const day = pc && pc.days ? pc.days[k] : null;
      const legacy = day ? Number(day.fxRate || 0) : 0;
      if (Number.isFinite(legacy) && legacy > 0) return legacy;
    }
    return null;
  }catch(err){
    console.warn('getFxRateFromCajaChica error', err);
    return null;
  }
}

function initPosCalculatorTabOnce(){
  if (__A33_POS_CALC_INIT) return;
  __A33_POS_CALC_INIT = true;

  const els = {
    hist: document.getElementById('calc-history'),
    out: document.getElementById('calc-output'),
    keys: document.getElementById('calc-keys'),
    fxRate: document.getElementById('fx-rate'),
    fxUsd: document.getElementById('fx-usd'),
    fxNio: document.getElementById('fx-nio'),
    fxMeta: document.getElementById('fx-meta'),
    fxStatus: document.getElementById('fx-status'),
    fxRefresh: document.getElementById('fx-refresh'),
    fxClear: document.getElementById('fx-clear')
  };

  const calc = {
    acc: null,
    op: null,
    lastOp: null,
    lastOperand: null,
    newEntry: true,
    display: '0'
  };

  const fx = {
    lock: false,
    lastEdited: 'usd'
  };

  function setHistory(txt){ if (els.hist) els.hist.textContent = txt || ''; }
  function setOutput(txt){ if (els.out) els.out.textContent = (txt == null ? '0' : String(txt)); }

  function setDisplay(txt){
    calc.display = String(txt == null ? '0' : txt);
    setOutput(calc.display);
  }

  function getDisplayNumber(){
    const n = Number(calc.display);
    return Number.isFinite(n) ? n : 0;
  }

  function applyOp(a, b, op){
    if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return (b === 0) ? NaN : (a / b);
    return b;
  }

  function formatResult(n){
    if (!Number.isFinite(n)) return 'Error';
    // Reduce ruido típico de floats sin ponernos poetas.
    const rounded = Math.round(n * 1e12) / 1e12;
    let s = String(rounded);
    if (!s.includes('e')) s = posCalcTrimDec(s);
    return s;
  }

  function pressDigit(d){
    const ch = String(d);
    if (calc.newEntry){
      setDisplay(ch === '.' ? '0.' : ch);
      calc.newEntry = false;
      return;
    }
    if (ch === '.' && calc.display.includes('.')) return;
    if (calc.display === '0' && ch !== '.') setDisplay(ch);
    else setDisplay(calc.display + ch);
  }

  function clearAll(){
    calc.acc = null;
    calc.op = null;
    calc.lastOp = null;
    calc.lastOperand = null;
    calc.newEntry = true;
    setHistory('');
    setDisplay('0');
  }

  function backspace(){
    if (calc.newEntry) return;
    if (calc.display.length <= 1) { setDisplay('0'); calc.newEntry = true; return; }
    setDisplay(calc.display.slice(0, -1));
  }

  function setOp(op){
    // Si el usuario está cambiando de operador sin ingresar el segundo número.
    if (calc.op && calc.newEntry){
      calc.op = op;
      setHistory(posCalcTrimDec(calc.acc) + ' ' + op);
      return;
    }

    const b = getDisplayNumber();
    if (calc.acc == null){
      calc.acc = b;
    } else if (calc.op){
      const r = applyOp(calc.acc, b, calc.op);
      calc.acc = r;
      setDisplay(formatResult(r));
    }
    calc.op = op;
    calc.newEntry = true;
    calc.lastOp = null;
    calc.lastOperand = null;
    setHistory(formatResult(calc.acc) + ' ' + op);
  }

  function equals(){
    let b = getDisplayNumber();
    let op = calc.op;

    // Repetir "=" usa el último operando (comportamiento clásico)
    if (!op && calc.lastOp){
      op = calc.lastOp;
      b = calc.lastOperand;
    }

    if (!op) return;
    if (calc.acc == null) calc.acc = 0;
    const r = applyOp(calc.acc, b, op);
    calc.lastOp = op;
    calc.lastOperand = b;
    calc.op = null;
    calc.acc = r;
    calc.newEntry = true;
    setHistory('');
    setDisplay(formatResult(r));
  }

  function ensureRate(){
    const rate = posCalcReadNum(els.fxRate);
    if (!rate || !(rate > 0)) return null;
    return rate;
  }

  function fxShowStatus(msg){
    if (!els.fxStatus) return;
    if (msg){
      els.fxStatus.style.display = 'block';
      els.fxStatus.textContent = msg;
    } else {
      els.fxStatus.style.display = 'none';
      els.fxStatus.textContent = '';
    }
  }

  function fxUpdateFromUSD(){
    if (fx.lock) return;
    fx.lastEdited = 'usd';
    const rate = ensureRate();
    const usd = posCalcReadNum(els.fxUsd);
    fx.lock = true;
    try{
      if (!rate){
        if (els.fxNio) els.fxNio.value = '';
        fxShowStatus('Ingresa un tipo de cambio válido para convertir.');
      } else {
        fxShowStatus('');
        if (els.fxNio) els.fxNio.value = (usd == null) ? '' : posCalcFmt2(usd * rate);
      }
    } finally {
      fx.lock = false;
    }
  }

  function fxUpdateFromNIO(){
    if (fx.lock) return;
    fx.lastEdited = 'nio';
    const rate = ensureRate();
    const nio = posCalcReadNum(els.fxNio);
    fx.lock = true;
    try{
      if (!rate){
        if (els.fxUsd) els.fxUsd.value = '';
        fxShowStatus('Ingresa un tipo de cambio válido para convertir.');
      } else {
        fxShowStatus('');
        if (els.fxUsd) els.fxUsd.value = (nio == null) ? '' : posCalcFmt2(nio / rate);
      }
    } finally {
      fx.lock = false;
    }
  }

  function fxRecompute(){
    if (fx.lastEdited === 'nio') fxUpdateFromNIO();
    else fxUpdateFromUSD();
  }

  // Bind teclado calculadora (delegación)
  if (els.keys){
    els.keys.addEventListener('click', (e)=>{
      const b = e.target.closest('button');
      if (!b) return;
      const k = b.dataset.k;
      if (!k) return;

      if (/^\d$/.test(k)) return pressDigit(k);
      if (k === '.') return pressDigit('.');
      if (k === 'C') return clearAll();
      if (k === 'back') return backspace();
      if (k === '=') return equals();
      if (k === '+' || k === '-' || k === '*' || k === '/') return setOp(k);
    });
  }

  // Bind conversor FX
  if (els.fxUsd) els.fxUsd.addEventListener('input', fxUpdateFromUSD);
  if (els.fxNio) els.fxNio.addEventListener('input', fxUpdateFromNIO);
  if (els.fxRate) els.fxRate.addEventListener('input', ()=>{ fxShowStatus(''); fxRecompute(); });

  if (els.fxRefresh) els.fxRefresh.addEventListener('click', ()=>{ onOpenPosCalculatorTab().catch(err=>console.error(err)); });
  if (els.fxClear) els.fxClear.addEventListener('click', ()=>{
    if (els.fxUsd) els.fxUsd.value = '';
    if (els.fxNio) els.fxNio.value = '';
    fxShowStatus('');
  });

  document.querySelectorAll('.fx-q').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const usd = Number(btn.dataset.usd || 0);
      if (els.fxUsd) els.fxUsd.value = (usd && usd > 0) ? String(usd) : '';
      fxUpdateFromUSD();
    });
  });

  // Render inicial
  clearAll();
  fxShowStatus('');
}

async function onOpenPosCalculatorTab(){
  initPosCalculatorTabOnce();

  const rateEl = document.getElementById('fx-rate');
  const metaEl = document.getElementById('fx-meta');
  const statusEl = document.getElementById('fx-status');
  if (!rateEl || !metaEl || !statusEl) return;

  const ev = await getActiveEventPOS();
  const rate = await getFxRateFromCajaChica();

  if (ev && rate && rate > 0){
    rateEl.value = String(posCalcRound2(rate));
    rateEl.readOnly = true;
    rateEl.title = 'Tomado de Caja Chica (solo lectura)';
    metaEl.textContent = `Evento activo: ${ev.name} · Tipo de cambio desde Caja Chica`;
    statusEl.style.display = 'none';
    statusEl.textContent = '';
  } else {
    rateEl.readOnly = false;
    rateEl.title = 'Temporal (no se guarda en Caja Chica)';

    if (ev){
      metaEl.textContent = `Evento activo: ${ev.name} · Sin tipo de cambio guardado`;
      statusEl.textContent = 'Caja Chica aún no tiene tipo de cambio. Puedes usar un valor temporal aquí (no se guarda).';
    } else {
      metaEl.textContent = 'Sin evento activo · No se puede leer Caja Chica';
      statusEl.textContent = 'Activa un evento para leer el tipo de cambio de Caja Chica. Mientras tanto, puedes usar un valor temporal aquí (no se guarda).';
    }

    statusEl.style.display = 'block';
  }

  // Recalcular si hay montos escritos.
  try{
    const usdEl = document.getElementById('fx-usd');
    const nioEl = document.getElementById('fx-nio');
    const usd = usdEl ? String(usdEl.value||'').trim() : '';
    const nio = nioEl ? String(nioEl.value||'').trim() : '';
    if (nio && !usd && nioEl) nioEl.dispatchEvent(new Event('input', { bubbles:true }));
    else if (usdEl) usdEl.dispatchEvent(new Event('input', { bubbles:true }));
  }catch(e){ /* no-op */ }
}



document.addEventListener('DOMContentLoaded', init);
