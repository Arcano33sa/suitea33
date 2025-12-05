
// --- IndexedDB helpers
const DB_NAME = 'a33-pos';
const DB_VER = 19; // schema estable
let db;

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
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function tx(name, mode='readonly'){ return db.transaction(name, mode).objectStore(name); }
function getAll(name){ return new Promise((res,rej)=>{ const r=tx(name).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
function put(name, val){ return new Promise((res,rej)=>{ const r=tx(name,'readwrite').put(val); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function del(name, key){ 
  return new Promise((resolve, reject)=>{ 
    if (name === 'sales'){
      try{
        const store = tx('sales','readwrite');
        const getReq = store.get(key);
        getReq.onsuccess = ()=>{
          const sale = getReq.result;
          if (sale){
            try{
              applyFinishedFromSalePOS(sale, -1); // revertir efecto de la venta
            }catch(e){
              console.error('Error revertiendo inventario central al eliminar venta', e);
            }
          }
          const delReq = store.delete(key);
          delReq.onsuccess = ()=>resolve();
          delReq.onerror = ()=>reject(delReq.error);
        };
        getReq.onerror = ()=>{
          const delReq = store.delete(key);
          delReq.onsuccess = ()=>resolve();
          delReq.onerror = ()=>reject(delReq.error);
        };
      }catch(e){
        console.error('Error en del(sales,key)', e);
        resolve();
      }
    } else {
      const store = tx(name,'readwrite');
      const r = store.delete(key);
      r.onsuccess = ()=>resolve();
      r.onerror = ()=>reject(r.error);
    }
  });
}
async function setMeta(key, value){ return put('meta', {id:key, value}); }
async function getMeta(key){ const all = await getAll('meta'); const row = all.find(x=>x.id===key); return row ? row.value : null; }

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
    const raw = localStorage.getItem(STORAGE_KEY_INVENTARIO);
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
    localStorage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
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
    const raw = localStorage.getItem(RECETAS_KEY);
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
  {name:'Vaso', price:100, manageStock:false, active:true},
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
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 1800); }

function setOfflineBar(){ const ob=$('#offlineBar'); if (!ob) return; ob.style.display = navigator.onLine?'none':'block'; }
window.addEventListener('online', setOfflineBar);
window.addEventListener('offline', setOfflineBar);

// Enable/disable selling block depending on current event
async function updateSellEnabled(){
  const current = await getMeta('currentEventId');
  const evs = await getAll('events');
  const cur = evs.find(e=>e.id===current);
  const enabled = !!(current && cur && !cur.closedAt);
  const chips = $$('#product-chips .chip');
  chips.forEach(c=> c.classList.toggle('disabled', !enabled));
  $('#no-active-note').style.display = enabled ? 'none' : 'block';
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
  if (!events.length){ for (const ev of DEFAULT_EVENTS) await put('events', {...ev, createdAt:new Date().toISOString()}); }
  const hasKey = (await getAll('meta')).some(m=>m.id==='currentEventId');
  if (!hasKey){
    const evs = await getAll('events');
    if (evs.length) await setMeta('currentEventId', evs[0].id);
  }
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
          <input data-id="${p.id}" class="p-price" type="number" inputmode="decimal" step="0.01" value="${p.price}">
          <label class="flag"><input type="checkbox" class="p-active" data-id="${p.id}" ${p.active===false?'':'checked'}> Activo</label>
          <label class="flag"><input type="checkbox" class="p-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}> Inventario</label>
          <button data-id="${p.id}" class="btn-danger btn-del">Eliminar</button>
        </div>
      </div>
    `;
    wrap.appendChild(row);
  }
  await renderProductChips();
}

// Chips de productos (todos los activos)
async function renderProductChips(){
  const chips = $('#product-chips'); if (!chips) return;
  chips.innerHTML='';
  let list = (await getAll('products')).filter(p=>p.active!==false);

  // Orden con prioridad de Arcano 33
  const priority = ['vaso','pulso','media','djeba','litro','galon','galón','galon 3800','galón 3800'];
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
  const enabled = !!(current && cur && !cur.closedAt);

  const sel = $('#sale-product');
  const selectedId = parseInt((sel && sel.value) ? sel.value : (list[0]?.id || 0), 10);

  for (const p of list){
    const c = document.createElement('button');
    c.className = 'chip';
    if (!enabled) c.classList.add('disabled');
    c.textContent = p.name;
    c.dataset.id = p.id;
    if (p.id === selectedId) c.classList.add('active');
    c.onclick = async()=>{
      if (!enabled) return;
      const prev = parseInt(sel.value||'0',10);
      sel.value = p.id;
      const same = prev === p.id;
      if (same) { $('#sale-qty').value = Math.max(1, parseFloat($('#sale-qty').value||'1')) + 1; }
      else { $('#sale-qty').value = 1; }
      const pr = (await getAll('products')).find(x=>x.id===p.id);
      if (pr) $('#sale-price').value = pr.price;
      $$('.chip').forEach(x=>x.classList.remove('active')); c.classList.add('active');
      await refreshSaleStockLabel();
      recomputeTotal();
    };
    chips.appendChild(c);
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

// Tabs
function setTab(name){
  $$('.tab').forEach(el=> el.style.display='none');
  const target = document.getElementById('tab-'+name);
  if (target) target.style.display='block';
  $$('.tabbar button').forEach(b=>b.classList.remove('active'));
  const btn = document.querySelector(`.tabbar button[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');
  if (name==='resumen') renderSummary();
  if (name==='productos') renderProductos();
  if (name==='eventos') renderEventos();
  if (name==='inventario') renderInventario();
}

// Event UI
async function refreshEventUI(){
  const evs = await getAll('events');
  const sel = $('#sale-event');
  const current = await getMeta('currentEventId');

  sel.innerHTML = '<option value=\"\">— Selecciona evento —</option>';
  for (const ev of evs) {
    const opt = document.createElement('option'); opt.value = ev.id; 
    opt.textContent = ev.name + (ev.closedAt ? ' (cerrado)' : '');
    sel.appendChild(opt);
  }
  if (current) sel.value = current;
  else sel.value = '';

  const status = $('#event-status');
  const cur = evs.find(e=> current && e.id == current);
  if (cur && cur.closedAt) {
    status.style.display='block';
    status.textContent = `Evento cerrado el ${new Date(cur.closedAt).toLocaleString()}. Puedes reabrirlo o crear/activar otro.`;
  } else { status.style.display='none'; }
  $('#btn-reopen-event').style.display = (cur && cur.closedAt) ? 'inline-block' : 'none';

  const invSel = $('#inv-event');
  if (invSel){
    invSel.innerHTML='';
    for (const ev of evs){
      const o = document.createElement('option'); o.value = ev.id; o.textContent = ev.name + (ev.closedAt?' (cerrado)':''); invSel.appendChild(o);
    }
    if (current) invSel.value = current;
    else if (evs.length) invSel.value = evs[0].id;
  }

  await updateSellEnabled();
  await renderProductChips();
}

// Product select + stock label
async function refreshProductSelect(){
  const list = await getAll('products');
  const sel = $('#sale-product');
  if (!sel) return;
  sel.innerHTML = '';
  for (const p of list) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (C${fmt(p.price)})${p.active===false?' [inactivo]':''}`;
    sel.appendChild(opt);
  }
  const first = list[0];
  if (first){ 
    sel.value = first.id; 
    $('#sale-price').value = first.price; 
  }
  await renderProductChips();
  const selId = parseInt(sel.value||'0',10);
  document.querySelectorAll('#product-chips .chip').forEach(x=>{
    if (parseInt(x.dataset.id,10)===selId) x.classList.add('active');
  });
  await refreshSaleStockLabel();
  recomputeTotal();
}

async function refreshSaleStockLabel(){
  const curId = await getMeta('currentEventId');
  const prodId = parseInt($('#sale-product').value||'0',10);
  const products = await getAll('products');
  const p = products.find(pp=>pp.id===prodId);
  if (!p || p.manageStock===false || !curId) { $('#sale-stock').textContent='—'; return; }
  const st = await computeStock(parseInt(curId,10), prodId);
  $('#sale-stock').textContent = st;
}

// Inventory logic
async function getInventoryEntries(eventId){ const all = await getAll('inventory'); return all.filter(i=>i.eventId===eventId); }
async function getInventoryInit(eventId, productId){ const list = (await getInventoryEntries(eventId)).filter(i=>i.productId===productId && i.type==='init'); return list.length ? list.sort((a,b)=> (a.id-b.id))[list.length-1] : null; }
async function setInitialStock(eventId, productId, qty){ let init = await getInventoryInit(eventId, productId); if (init){ init.qty = qty; init.time = new Date().toISOString(); await put('inventory', init); } else { await put('inventory', {eventId, productId, type:'init', qty, notes:'Inicial', time:new Date().toISOString()}); } }
async function addRestock(eventId, productId, qty){ if (qty<=0) throw new Error('Reposición debe ser > 0'); await put('inventory', {eventId, productId, type:'restock', qty, notes:'Reposición', time:new Date().toISOString()}); }
async function addAdjust(eventId, productId, qty, notes){ if (!qty) throw new Error('Ajuste no puede ser 0'); await put('inventory', {eventId, productId, type:'adjust', qty, notes: notes||'Ajuste', time:new Date().toISOString()}); }
async function computeStock(eventId, productId){ const inv = await getInventoryEntries(eventId); const ledger = inv.filter(i=>i.productId===productId).reduce((a,b)=>a+(b.qty||0),0); const sales = (await getAll('sales')).filter(s=>s.eventId===eventId && s.productId===productId).reduce((a,b)=>a+(b.qty||0),0); return ledger - sales; }


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
    const raw = localStorage.getItem('arcano33_lotes');
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
    await addRestock(evId, prod.id, qty);
    total += qty;
  }
  await renderInventario();
  await refreshSaleStockLabel();
  alert('Se agregó inventario desde el lote "' + (lote.codigo || '') + '" al evento seleccionado.');
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
    const tr = document.createElement('tr'); tr.innerHTML = '<td colspan="8">No hay eventos. Crea uno en la pestaña Vender.</td>'; tbody.appendChild(tr); return;
  }

  const prods = await getAll('products');

  for (const p of prods){
    const st = await computeStock(evId, p.id);
    const init = await getInventoryInit(evId, p.id);
    const disabled = (p.manageStock===false) ? 'disabled' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.name}</td>
      <td><input type="checkbox" class="inv-active" data-id="${p.id}" ${p.active===false?'':'checked'}></td>
      <td><input type="checkbox" class="inv-manage" data-id="${p.id}" ${p.manageStock===false?'':'checked'}></td>
      <td><input class="inv-inicial" data-id="${p.id}" type="number" inputmode="numeric" step="1" value="${init?init.qty:0}" ${disabled}></td>
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
  const d = $('#sale-date').value;
  const curId = await getMeta('currentEventId');
  const tbody = $('#tbl-day tbody'); tbody.innerHTML='';
  if (!curId){ $('#day-total').textContent = fmt(0); return; }
  const items = await new Promise((res,rej)=>{ const r=tx('sales').index('by_date').getAll(d); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
  const filtered = items.filter(s=> s.eventId === curId);
  let total = 0;
  filtered.sort((a,b)=>a.id-b.id);
  for (const s of filtered){
    total += s.total;
    const payClass = s.payment==='efectivo'?'pay-ef':(s.payment==='transferencia'?'pay-tr':'pay-cr');
    const payTxt = s.payment==='efectivo'?'Efec':(s.payment==='transferencia'?'Trans':'Cred');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.time||''}</td>
      <td>${s.productName}</td>
      <td>${s.qty}</td>
      <td>${fmt(s.unitPrice)}</td>
      <td>${fmt(s.discount||0)} </td>
      <td>${fmt(s.total)} </td>
      <td><span class="tag ${payClass}">${payTxt}</span></td>
      <td>${s.courtesy?'✓':''}</td>
      <td>${s.isReturn?'✓':''}</td>
      <td>${s.customer||''}</td>
      <td>${s.courtesyTo||''}</td>
      <td><button data-id="${s.id}" title="Eliminar venta" class="btn-danger btn-mini del-sale">Eliminar</button></td>`;
    tbody.appendChild(tr);
  }
  $('#day-total').textContent = fmt(total);
}

// Summary
async function renderSummary(){
  const sales = await getAll('sales');
  const events = await getAll('events');
  let grand=0; const byDay=new Map(); const byProd=new Map(); const byPay=new Map(); const byEvent=new Map();

  for (const s of sales){
    grand += s.total;
    byDay.set(s.date,(byDay.get(s.date)||0)+s.total);
    byProd.set(s.productName,(byProd.get(s.productName)||0)+s.total);
    byPay.set(s.payment||'efectivo',(byPay.get(s.payment||'efectivo')||0)+s.total);
    byEvent.set(s.eventName||'General',(byEvent.get(s.eventName||'General')||0)+s.total);
  }

  for (const ev of events){
    if (ev.archive && ev.archive.totals){
      const t = ev.archive.totals;
      grand += (t.grand||0);
      byEvent.set(ev.name,(byEvent.get(ev.name)||0)+(t.grand||0));
      if (t.byPay){ for (const k of Object.keys(t.byPay)){ byPay.set(k,(byPay.get(k)||0)+(t.byPay[k]||0)); } }
      if (t.byProduct){ for (const k of Object.keys(t.byProduct)){ byProd.set(k,(byProd.get(k)||0)+(t.byProduct[k]||0)); } }
      if (t.byDay){ for (const k of Object.keys(t.byDay)){ byDay.set(k,(byDay.get(k)||0)+(t.byDay[k]||0)); } }
    }
  }

  $('#grand-total').textContent = fmt(grand);

  const tbE=$('#tbl-por-evento tbody'); tbE.innerHTML='';
  [...byEvent.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbE.appendChild(tr); });

  const tbD=$('#tbl-por-dia tbody'); tbD.innerHTML='';
  [...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbD.appendChild(tr); });

  const tbP=$('#tbl-por-prod tbody'); tbP.innerHTML='';
  [...byProd.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbP.appendChild(tr); });

  const tbPay=$('#tbl-por-pago tbody'); tbPay.innerHTML='';
  [...byPay.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbPay.appendChild(tr); });
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
  downloadCSV('inventario_evento.csv', rows);
}

// Eventos UI
async function renderEventos(){
  const filtro = $('#filtro-eventos').value || 'todos';
  const tbody = $('#tbl-eventos tbody');
  tbody.innerHTML = '';
  const events = await getAll('events');
  const sales = await getAll('sales');
  const rows = events.map(ev=>{
    const tot = sales.filter(s=>s.eventId===ev.id).reduce((a,b)=>a+b.total,0);
    return {...ev, _totalCached: tot};
  }).filter(ev=>{
    if (filtro==='abiertos') return !ev.closedAt;
    if (filtro==='cerrados') return !!ev.closedAt;
    return true;
  }).sort((a,b)=>{
    const ad = a.createdAt||''; const bd = b.createdAt||'';
    return (bd>ad) ? 1 : -1;
  });

  for (const ev of rows){
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${ev.name}</td>
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

  $('#ev-title').textContent = `Evento: ${ev.name}`;
  $('#ev-meta').innerHTML = `<div><b>Estado:</b> ${ev.closedAt?'Cerrado':'Abierto'}</div>
  <div><b>Creado:</b> ${ev.createdAt?new Date(ev.createdAt).toLocaleString():'—'}</div>
  <div><b>Cerrado:</b> ${ev.closedAt?new Date(ev.closedAt).toLocaleString():'—'}</div>
  <div><b># Ventas:</b> ${sales.length}</div>`;

  const total = sales.reduce((a,b)=>a+b.total,0);

  // cálculo de costo de producto usando el costo unitario por presentación
  let costoProductos = 0;
  for (const s of sales) {
    const unitCost = getCostoUnitarioProducto(s.productName);
    const absQty = Math.abs(s.qty || 0);
    const qtyParaCosto = s.isReturn ? -absQty : absQty;
    if (unitCost > 0 && qtyParaCosto !== 0) {
      costoProductos += unitCost * qtyParaCosto;
    }
  }
  const utilidadBruta = total - costoProductos;

  const byPay = sales.reduce((m,s)=>{ m[s.payment]=(m[s.payment]||0)+s.total; return m; },{});
  $('#ev-totals').innerHTML = `<div><b>Total vendido:</b> C$ ${fmt(total)}</div>
  <div><b>Costo estimado de producto:</b> C$ ${fmt(costoProductos)}</div>
  <div><b>Utilidad bruta aprox.:</b> C$ ${fmt(utilidadBruta)}</div>
  <div><b>Efectivo:</b> C$ ${fmt(byPay.efectivo||0)}</div>
  <div><b>Transferencia:</b> C$ ${fmt(byPay.transferencia||0)}</div>
  <div><b>Crédito:</b> C$ ${fmt(byPay.credito||0)}</div>`;

  const byDay = Array.from((()=>{ const m = new Map(); for (const s of sales){ m.set(s.date, (m.get(s.date)||0)+s.total); } return m; })().entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const tbd = $('#ev-byday tbody'); tbd.innerHTML=''; byDay.forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbd.appendChild(tr); });

  const byProd = Array.from((()=>{ const m = new Map(); for (const s of sales){ m.set(s.productName, (m.get(s.productName)||0)+s.total); } return m; })().entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  const tbp = $('#ev-byprod tbody'); tbp.innerHTML=''; byProd.forEach(([k,v])=>{ const tr=document.createElement('tr'); tr.innerHTML=`<td>${k}</td><td>${fmt(v)}</td>`; tbp.appendChild(tr); });

  const tb = $('#ev-sales tbody'); tb.innerHTML='';
  sales.sort((a,b)=>a.id-b.id).forEach(s=>{
    const tr=document.createElement('tr'); tr.innerHTML = `<td>${s.id}</td><td>${s.date}</td><td>${s.time||''}</td><td>${s.productName}</td><td>${s.qty}</td><td>${fmt(s.unitPrice)}</td><td>${fmt(s.discount||0)}</td><td>${fmt(s.total)}</td><td>${s.payment}</td><td>${s.courtesy?'✓':''}</td><td>${s.isReturn?'✓':''}</td><td>${s.customer||''}</td><td>${s.courtesyTo||''}</td><td>${s.notes||''}</td>`;
    tb.appendChild(tr);
  });

  showEventView(true);
}

// CSV ventas/corte
async function exportEventSalesCSV(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  const sales = (await getAll('sales')).filter(s=>s.eventId===eventId);
  const rows = [['id','fecha','hora','producto','cant','PU','desc_C$','total','pago','cortesia','devolucion','cliente','cortesia_a','notas']];
  for (const s of sales){
    rows.push([s.id, s.date, s.time||'', s.productName, s.qty, s.unitPrice, (s.discount||0), s.total, (s.payment||''), s.courtesy?1:0, s.isReturn?1:0, s.customer||'', s.courtesyTo||'', s.notes||'']);
  }
  const safeName = (ev?ev.name:'evento').replace(/[^a-z0-9_\- ]/gi,'_');
  downloadCSV(`ventas_${safeName}.csv`, rows);
}
function buildCorteSummaryRows(eName, sales){
  let efectivo=0, trans=0, credito=0, descuentos=0, cortesiasU=0, cortesiasVal=0, devolU=0, devolVal=0, bruto=0;
  for (const s of sales){
    const absQty = Math.abs(s.qty||0);
    const absTotal = Math.abs(s.total||0);
    bruto += (s.courtesy ? (s.unitPrice*absQty) : (absTotal + (s.discount||0)));
    descuentos += (s.discount||0) * (s.isReturn?-1:1);
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
  rows.push(['id','fecha','hora','producto','cant','PU','desc_C$','total','pago','cortesia','devolucion','cliente','cortesia_a','notas']);
  for (const s of sales){
    rows.push([s.id, s.date, s.time||'', s.productName, s.qty, s.unitPrice, (s.discount||0), s.total, (s.payment||''), s.courtesy?1:0, s.isReturn?1:0, s.customer||'', s.courtesyTo||'', s.notes||'']);
  }
  const safeName = ev.name.replace(/[^a-z0-9_\- ]/gi,'_');
  downloadCSV(`corte_${safeName}.csv`, rows);
}

// --- Close / Reopen / Activate / Delete ---
async function closeEvent(eventId){
  const events = await getAll('events');
  const ev = events.find(e=>e.id===eventId);
  if (!ev){ alert('Evento no encontrado'); return; }
  if (ev.closedAt){ alert('Este evento ya está cerrado.'); return; }
  await generateCorteCSV(eventId);
  ev.closedAt = new Date().toISOString();
  await put('events', ev);
  await setMeta('currentEventId', null);
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
  try{
    await openDB();
    await ensureDefaults();   // migra + resiembra
    await refreshEventUI();
    await refreshProductSelect();
    await renderDay();
    await renderSummary();
    await renderProductos();
    await renderEventos();
    await renderInventario();
    await updateSellEnabled();
  }catch(err){ 
    alert('Error inicializando base de datos');
    console.error('INIT ERROR', err);
  }
  setOfflineBar();

  document.querySelector('.tabbar').addEventListener('click', (e)=>{ const b = e.target.closest('button'); if (!b) return; setTab(b.dataset.tab); });

  // Vender tab
  $('#sale-event').addEventListener('change', async()=>{ 
    const val = $('#sale-event').value;
    if (val === '') { await setMeta('currentEventId', null); }
    else { await setMeta('currentEventId', parseInt(val,10)); }
    await refreshEventUI(); 
    await refreshSaleStockLabel(); 
    await renderDay();
  });
  $('#btn-add-event').addEventListener('click', async()=>{ const name = ($('#new-event').value||'').trim(); if (!name) { alert('Escribe un nombre de evento'); return; } const id = await put('events', {name, createdAt:new Date().toISOString()}); await setMeta('currentEventId', id); $('#new-event').value=''; await refreshEventUI(); await renderEventos(); await renderInventario(); await renderDay(); toast('Evento creado'); });
  $('#btn-close-event').addEventListener('click', async()=>{ const id = parseInt($('#sale-event').value||'0',10); const current = await getMeta('currentEventId'); const useId = id || current; if (!useId) return alert('Selecciona un evento'); await closeEvent(parseInt(useId,10)); });
  $('#btn-reopen-event').addEventListener('click', async()=>{ const val = $('#sale-event').value; const id = parseInt(val||'0',10); if (!id) return alert('Selecciona un evento cerrado'); await reopenEvent(id); });

  $('#sale-product').addEventListener('change', async()=>{ const id = parseInt($('#sale-product').value,10); const p = (await getAll('products')).find(x=>x.id===id); if (p) $('#sale-price').value = p.price; document.querySelectorAll('#product-chips .chip').forEach(x=>x.classList.toggle('active', parseInt(x.dataset.id,10)===id)); await refreshSaleStockLabel(); recomputeTotal(); });
  $('#sale-price').addEventListener('input', recomputeTotal);
  $('#sale-qty').addEventListener('input', recomputeTotal);
  $('#sale-discount').addEventListener('input', recomputeTotal);
  $('#sale-courtesy').addEventListener('change', ()=>{ $('#sale-courtesy-to').disabled = !$('#sale-courtesy').checked; recomputeTotal(); });
  $('#sale-return').addEventListener('change', recomputeTotal);
  $('#sale-payment').addEventListener('change', ()=>{ const isCred = $('#sale-payment').value==='credito'; $('#sale-customer').disabled = !isCred; if (!isCred) $('#sale-customer').value=''; });
  $('#sale-date').addEventListener('change', renderDay);
  $('#btn-add').addEventListener('click', addSale);
  $('#btn-add-sticky').addEventListener('click', addSale);
  $('#btn-undo').addEventListener('click', async()=>{ const curId = await getMeta('currentEventId'); if (!curId) return; const d=$('#sale-date').value; const items = await new Promise((res,rej)=>{ const r=tx('sales').index('by_date').getAll(d); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); const filtered = items.filter(s=>s.eventId===curId); if (!filtered.length) return; const last = filtered.sort((a,b)=>a.id-b.id)[filtered.length-1]; await del('sales', last.id); await renderDay(); await renderSummary(); await refreshSaleStockLabel(); await renderInventario(); toast('Venta eliminada'); });
  $('#tbl-day').addEventListener('click', async (e)=>{ const btn = e.target.closest('.del-sale'); if (!btn) return; const id = parseInt(btn.dataset.id,10); if (!confirm('¿Eliminar esta venta?')) return; await del('sales', id); await renderDay(); await renderSummary(); await refreshSaleStockLabel(); await renderInventario(); toast('Venta eliminada'); });

  // Stepper
  $('#qty-minus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) - 1); $('#sale-qty').value = v; recomputeTotal(); });
  $('#qty-plus').addEventListener('click', ()=>{ const v = Math.max(1, parseInt($('#sale-qty').value||'1',10) + 1); $('#sale-qty').value = v; recomputeTotal(); });

  // Productos: agregar + restaurar
  document.getElementById('btn-add-prod').onclick = async()=>{ const name = $('#new-name').value.trim(); const price = parseFloat($('#new-price').value||'0'); if (!name || !(price>0)) return alert('Nombre y precio'); try{ await put('products', {name, price, manageStock:true, active:true}); $('#new-name').value=''; $('#new-price').value=''; await renderProductos(); await refreshProductSelect(); await renderInventario(); toast('Producto agregado'); }catch(err){ alert('No se pudo agregar. ¿Nombre duplicado?'); } };
  document.getElementById('btn-restore-seed').onclick = restoreSeed;

  // Eventos tab actions
  $('#filtro-eventos').addEventListener('change', renderEventos);
  $('#btn-exportar-eventos').addEventListener('click', async()=>{ const events = await getAll('events'); const rows = [['id','evento','estado','creado','cerrado','total']]; for (const ev of events){ rows.push([ ev.id, ev.name, ev.closedAt?'cerrado':'abierto', ev.createdAt||'', ev.closedAt||'', 0 ]); } downloadCSV('eventos.csv', rows); });
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
  $('#sale-total').value = t;
  $('#sticky-total').textContent = t;
}

async function addSale(){
  const curId = await getMeta('currentEventId');
  if (!curId){ alert('Selecciona un evento'); return; }
  const date = $('#sale-date').value;
  const productId = parseInt($('#sale-product').value||'0',10);
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

  const events = await getAll('events');
  const event = events.find(e=>e.id===curId);
  if (!event || event.closedAt){ alert('Este evento está cerrado. Reábrelo o activa otro.'); return; }

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
  await put('sales', {
    date,
    time,
    eventId:curId,
    eventName,
    productId,
    productName,
    unitPrice:price,
    qty:finalQty,
    discount,
    payment,
    courtesy,
    isReturn,
    customer,
    courtesyTo,
    total,
    notes,
    costPerUnit:unitCost,
    lineCost,
    lineProfit
  });

  // limpiar campos para el siguiente registro (incluye NOTAS)
  $('#sale-qty').value=1; 
  $('#sale-discount').value=0; 
  if (payment==='credito') $('#sale-customer').value=''; 
  $('#sale-courtesy-to').value='';
  $('#sale-notes').value=''; // limpiar notas
  $('#sale-total').value = (courtesy?0:price).toFixed(2); 
  $('#sticky-total').textContent = (courtesy?0:price).toFixed(2);

  await renderDay(); await renderSummary(); await refreshSaleStockLabel(); await renderInventario();
  toast('Venta agregada');
}

document.addEventListener('DOMContentLoaded', init);
