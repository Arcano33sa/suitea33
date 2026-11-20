/* Compras generales: historial independiente del POS y sin movimientos financieros. */
(function(){
  'use strict';
  const CATALOG_KEY = 'a33_catalogos_gastos_v1';
  const PURCHASES_KEY = 'a33_gastos_v1';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const money = cents => 'C$ ' + (cents / 100).toLocaleString('es-NI',{minimumFractionDigits:2,maximumFractionDigits:2});
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  let catalog = {categories:[],items:[]};
  let draft = [];
  let sequence = 0;
  let saving = false;
  function localDate(){
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }
  function validDate(value){
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
  }
  function loadCatalog(){
    try{
      const raw = localStorage.getItem(CATALOG_KEY);
      const state = raw === null ? {version:1,categories:[],items:[]} : JSON.parse(raw);
      if (state?.version !== 1 || !Array.isArray(state.categories) || !Array.isArray(state.items)) throw new Error('Formato incompatible.');
      if (state.categories.some(row=>!row || typeof row.id!=='string' || typeof row.name!=='string') || state.items.some(row=>!row || typeof row.id!=='string' || typeof row.name!=='string')) throw new Error('Formato incompatible.');
      catalog = state;
      $('catalog-status').textContent = availableItems().length ? '' : 'No hay artículos activos disponibles. Crea o activa artículos y categorías en Catálogos → Gastos.';
    }catch(error){
      catalog = {categories:[],items:[]};
      $('catalog-status').textContent = 'No se pudo leer el catálogo. Revisa Catálogos → Gastos. No se modificaron sus datos.';
    }
  }
  function availableItems(){ return catalog.items.filter(item=>item.active && catalog.categories.some(cat=>cat.id===item.categoryId && cat.active)).sort((a,b)=>a.name.localeCompare(b.name,'es')); }
  function availablePresentations(item){ return item?.presentation === 'both' ? ['unit','box'] : ['unit','box'].includes(item?.presentation) ? [item.presentation] : []; }
  function priceCents(value){
    const input = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(input)) throw new Error('Introduce precios válidos con un máximo de dos decimales.');
    const [whole,fraction=''] = input.split('.');
    const cents = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
    if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('El precio está fuera del rango permitido.');
    return cents;
  }
  function lineCents(line){
    const quantity = Number(line.quantity);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('La cantidad debe ser un entero mayor que cero.');
    const cents = priceCents(line.price) * quantity;
    if (!Number.isSafeInteger(cents)) throw new Error('El importe está fuera del rango permitido.');
    return cents;
  }
  function setReferencePrice(line){
    const item = catalog.items.find(row=>row.id===line.itemId);
    const price = line.presentation==='box' ? item?.boxPrice : item?.unitPrice;
    line.price = price == null ? '' : String(price);
  }
  function renderLines(){
    const items = availableItems();
    $('purchase-lines').innerHTML = draft.map((line,index)=>{
      const item = items.find(row=>row.id===line.itemId);
      const presentations = availablePresentations(item);
      const category = catalog.categories.find(row=>row.id===item?.categoryId);
      return `<div class="line" data-line="${line.id}"><div class="line-fields">
        <label>Artículo ${index+1}<select data-field="itemId" required><option value="">Seleccione artículo…</option>${items.map(row=>`<option value="${escape(row.id)}" ${line.itemId===row.id ? 'selected' : ''}>${escape(row.name)}</option>`).join('')}${line.itemId && !item ? '<option selected value="'+escape(line.itemId)+'">Artículo no disponible</option>' : ''}</select></label>
        <label>Presentación<select data-field="presentation" required ${item ? '' : 'disabled'}><option value="">Seleccione…</option>${presentations.map(value=>`<option value="${value}" ${line.presentation===value ? 'selected' : ''}>${value==='unit' ? 'Unidad' : 'Caja'}</option>`).join('')}</select></label>
        <label>Cantidad<input data-field="quantity" type="number" min="1" step="1" required value="${escape(line.quantity)}"></label>
        <label>Precio por ${line.presentation==='box' ? 'caja' : 'unidad'} (C$)<input data-field="price" type="number" min="0" step="0.01" required value="${escape(line.price)}"></label>
        </div><p class="line-description">${escape(category?.name || '')}${item && line.presentation==='box' ? ' · '+escape(item.unitsPerBox)+' unidades por caja' : ''}</p>
        <div class="line-bottom"><strong data-line-total></strong><button type="button" class="secondary" data-remove="${line.id}" aria-label="Quitar artículo ${index+1}">Quitar</button></div></div>`;
    }).join('');
    updateTotals();
  }
  function updateTotals(){
    let total = 0;
    let valid = true;
    for (const line of draft){
      const el = $('purchase-lines').querySelector(`[data-line="${line.id}"] [data-line-total]`);
      try{ const cents = lineCents(line); total += cents; el.textContent = money(cents); }
      catch(_){ valid = false; el.textContent = 'Importe pendiente'; }
    }
    $('draft-total').textContent = valid && Number.isSafeInteger(total) ? money(total) : 'Pendiente';
  }
  function addLine(){ draft.push({id:++sequence,itemId:'',presentation:'',quantity:'1',price:''}); renderLines(); }
  function readPurchases(){
    const raw = localStorage.getItem(PURCHASES_KEY);
    if (raw === null) return {version:1,purchases:[]};
    const state = JSON.parse(raw);
    const validPurchase = row => {
      if (!row || typeof row.id!=='string' || !validDate(row.date) || row.currency!=='NIO' || !Array.isArray(row.lines) || !row.lines.length || !Number.isSafeInteger(row.totalCents) || row.totalCents<0) return false;
      if (row.lines.some(line=>!line || typeof line.articleId!=='string' || typeof line.articleName!=='string' || typeof line.categoryId!=='string' || typeof line.categoryName!=='string' || !['unit','box'].includes(line.presentation) || !Number.isSafeInteger(line.quantity) || line.quantity<1 || !Number.isSafeInteger(line.unitPriceCents) || line.unitPriceCents<0 || !Number.isSafeInteger(line.totalCents) || line.totalCents!==line.quantity*line.unitPriceCents || (line.presentation==='box' && (!Number.isSafeInteger(line.unitsPerBox) || line.unitsPerBox<1)))) return false;
      return row.lines.reduce((sum,line)=>sum+line.totalCents,0)===row.totalCents;
    };
    if (state?.version!==1 || !Array.isArray(state.purchases) || !state.purchases.every(validPurchase)) throw new Error('El historial tiene un formato incompatible. No se modificaron sus datos.');
    return state;
  }
  function buildPurchase(){
    const date = $('purchase-date').value;
    if (!validDate(date)) throw new Error('Selecciona una fecha válida para la compra.');
    if (!draft.length) throw new Error('Agrega al menos un artículo.');
    const items = availableItems();
    const lines = draft.map(line=>{
      const item = items.find(row=>row.id===line.itemId);
      if (!item) throw new Error('Selecciona artículos y categorías activos. Revisa los artículos no disponibles.');
      if (!availablePresentations(item).includes(line.presentation)) throw new Error('Selecciona una presentación disponible para cada artículo.');
      if (line.presentation==='box' && (!Number.isSafeInteger(item.unitsPerBox) || item.unitsPerBox<1)) throw new Error('Revisa las unidades por caja en Catálogos.');
      const category = catalog.categories.find(row=>row.id===item.categoryId);
      return {articleId:item.id,articleName:item.name,categoryId:category.id,categoryName:category.name,presentation:line.presentation,unitsPerBox:line.presentation==='box' ? item.unitsPerBox : null,quantity:Number(line.quantity),unitPriceCents:priceCents(line.price),totalCents:lineCents(line)};
    });
    const totalCents = lines.reduce((sum,line)=>sum+line.totalCents,0);
    if (!Number.isSafeInteger(totalCents)) throw new Error('El total está fuera del rango permitido.');
    return {id:window.crypto?.randomUUID ? window.crypto.randomUUID() : 'gasto-'+Date.now()+'-'+Math.random().toString(36).slice(2),date,supplier:$('purchase-supplier').value.trim(),reference:$('purchase-reference').value.trim(),note:$('purchase-note').value.trim(),currency:'NIO',lines,totalCents,createdAt:new Date().toISOString()};
  }
  async function savePurchase(event){
    event.preventDefault();
    if (saving) return;
    saving = true; $('save-purchase').disabled = true;
    try{
      loadCatalog();
      const purchase = buildPurchase();
      const persist = ()=>{
        const state = readPurchases();
        if (state.purchases.some(row=>row.id===purchase.id)) throw new Error('La compra ya fue registrada.');
        state.purchases.push(purchase);
        localStorage.setItem(PURCHASES_KEY,JSON.stringify(state));
      };
      if (navigator.locks?.request) await navigator.locks.request(PURCHASES_KEY,persist);
      else persist();
      $('purchase-form').reset(); $('purchase-date').value = localDate(); draft = []; addLine();
      $('purchase-status').textContent = `Compra guardada · ${purchase.date} · ${money(purchase.totalCents)}.`;
      renderHistory();
    }catch(error){ $('purchase-status').textContent = 'No se guardó la compra. ' + error.message; }
    finally{ saving=false; $('save-purchase').disabled=false; }
  }
  function renderHistory(){
    try{
      const from = $('filter-from').value, to = $('filter-to').value;
      if ((from && !validDate(from)) || (to && !validDate(to)) || (from && to && from>to)) throw new Error('Revisa el rango de fechas: Desde debe ser anterior o igual a Hasta.');
      const search = normalize($('filter-search').value.trim());
      const rows = readPurchases().purchases.filter(row=>(!from || row.date>=from) && (!to || row.date<=to) && (!search || normalize([row.supplier,row.reference,row.note,...row.lines.flatMap(line=>[line.articleName,line.categoryName])].join(' ')).includes(search))).sort((a,b)=>b.date.localeCompare(a.date) || String(b.createdAt).localeCompare(String(a.createdAt)));
      const total = rows.reduce((sum,row)=>sum+row.totalCents,0);
      if (!Number.isSafeInteger(total)) throw new Error('El total consultado está fuera del rango permitido.');
      $('history-total').textContent = money(total);
      $('history-count').textContent = `${rows.length} compra(s)`;
      $('history-status').textContent = rows.length ? '' : 'No hay compras para esta consulta.';
      $('purchase-history').innerHTML = rows.map(row=>`<details class="purchase"><summary><strong>${escape(row.date)} · ${money(row.totalCents)}</strong> ${escape(row.supplier || 'Sin proveedor')} · ${row.lines.length} artículo(s)</summary>
        <dl><dt>Referencia</dt><dd>${escape(row.reference || '—')}</dd><dt>Observación</dt><dd>${escape(row.note || '—')}</dd><dt>Registro</dt><dd>${escape(row.id)}</dd></dl>
        <div class="table-wrap" role="region" aria-label="Artículos de la compra" tabindex="0"><table><thead><tr><th>Artículo / categoría</th><th>Presentación</th><th>Cantidad</th><th>Precio</th><th>Total</th></tr></thead><tbody>${row.lines.map(line=>`<tr><td>${escape(line.articleName)}<small>${escape(line.categoryName)}</small></td><td>${line.presentation==='box' ? 'Caja<small>'+escape(line.unitsPerBox)+' unidades</small>' : 'Unidad'}</td><td>${escape(line.quantity)}</td><td>${money(line.unitPriceCents)}</td><td>${money(line.totalCents)}</td></tr>`).join('')}</tbody></table></div></details>`).join('');
    }catch(error){
      $('history-status').textContent = error.message;
      $('history-total').textContent = 'No disponible'; $('history-count').textContent = 'Consulta no disponible'; $('purchase-history').replaceChildren();
    }
  }
  $('purchase-date').value = localDate();
  $('filter-from').value = localDate().slice(0,7)+'-01'; $('filter-to').value = localDate();
  loadCatalog(); addLine(); renderHistory();
  $('add-line').addEventListener('click',()=>{ addLine(); $('purchase-lines').lastElementChild.querySelector('select').focus(); });
  $('purchase-lines').addEventListener('input',event=>{
    const field = event.target.dataset.field;
    if (!['quantity','price'].includes(field)) return;
    const line = draft.find(row=>row.id===Number(event.target.closest('[data-line]').dataset.line));
    line[field] = event.target.value; updateTotals();
  });
  $('purchase-lines').addEventListener('change',event=>{
    const field = event.target.dataset.field;
    if (!['itemId','presentation'].includes(field)) return;
    const line = draft.find(row=>row.id===Number(event.target.closest('[data-line]').dataset.line));
    line[field] = event.target.value;
    if (field==='itemId') line.presentation = availablePresentations(catalog.items.find(row=>row.id===line.itemId))[0] || '';
    setReferencePrice(line); renderLines();
    $('purchase-lines').querySelector(`[data-line="${line.id}"] [data-field="${field}"]`).focus();
  });
  $('purchase-lines').addEventListener('click',event=>{
    const button = event.target.closest('[data-remove]');
    if (!button) return;
    draft = draft.filter(row=>row.id!==Number(button.dataset.remove)); renderLines(); $('add-line').focus();
  });
  $('purchase-form').addEventListener('submit',savePurchase);
  $('filters').addEventListener('submit',event=>{event.preventDefault();renderHistory();});
  $('clear-filters').addEventListener('click',()=>{$('filters').reset();renderHistory();});
  $('refresh-history').addEventListener('click',()=>{loadCatalog();renderLines();renderHistory();});
  window.addEventListener('storage',event=>{if(event.key===CATALOG_KEY){loadCatalog();renderLines();}if(event.key===PURCHASES_KEY)renderHistory();});
  window.addEventListener('pageshow',()=>{loadCatalog();renderLines();renderHistory();});
})();
