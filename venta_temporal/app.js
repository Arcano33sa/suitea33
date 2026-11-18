'use strict';

const money = new Intl.NumberFormat('es-NI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const savedAtFormat = new Intl.DateTimeFormat('es-NI', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Managua'
});
const form = document.getElementById('sale-form');
const catalog = document.getElementById('catalog');
const items = document.getElementById('items');
const preview = document.getElementById('preview');
const historyList = document.getElementById('history');
const historyStatus = document.getElementById('history-status');
const save = document.getElementById('save');
const cancel = document.getElementById('cancel');
const status = document.getElementById('save-status');
const draft = new Map();
let previewTotals;
let saving = false;

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function currency(cents) {
  return 'C$ ' + money.format(cents / 100);
}

function cents(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  const amount = Math.round((number + Number.EPSILON) * 100);
  return number >= 0 && Number.isSafeInteger(amount) ? amount : null;
}

function catalogMoney(product, keys) {
  for (const key of keys) {
    const value = cents(product[key]);
    if (value !== null) return (value / 100).toFixed(2);
  }
  return '';
}

function calculateSale() {
  const rows = [];
  const totals = { price: 0, cost: 0, profit: 0, missedProfit: 0 };
  for (const item of draft.values()) {
    const quantity = Number(item.quantity);
    const unitPrice = cents(item.unitPrice);
    const unitCost = cents(item.unitCost);
    const discount = cents(item.discount === '' ? 0 : item.discount);
    if (!Number.isSafeInteger(quantity) || quantity < 1 ||
        unitPrice === null || unitCost === null || discount === null || discount > unitPrice) return null;

    const netPrice = (unitPrice - discount) * quantity;
    const cost = unitCost * quantity;
    const price = item.courtesy ? 0 : netPrice;
    const profit = price - cost;
    const missedProfit = item.courtesy ? netPrice - cost : 0;
    rows.push({
      productId: item.productId, name: item.name, quantity, unitPrice, unitCost, discount,
      courtesy: item.courtesy, price, cost, profit, missedProfit
    });
    totals.price += price;
    totals.cost += cost;
    totals.profit += profit;
    totals.missedProfit += missedProfit;
    if (![netPrice, cost, ...Object.values(totals)].every(Number.isSafeInteger)) return null;
  }
  return { rows, totals };
}

function renderBreakdown(target, sale) {
  const scroll = element('div', null, 'breakdown-scroll');
  const table = element('table', null, 'breakdown');
  const heading = table.createTHead().insertRow();
  for (const title of ['Producto', 'Precio', 'Costo', 'Utilidad']) {
    const cell = element('th', title);
    cell.scope = 'col';
    heading.append(cell);
  }
  const body = table.createTBody();
  for (const row of sale.rows) {
    const name = row.name + ' × ' + row.quantity + (row.courtesy ? ' · Cortesía' : '');
    addBreakdownRow(body, name, row);
  }
  addBreakdownRow(table.createTFoot(), 'TOTALES', sale.totals);
  scroll.append(table);
  target.replaceChildren(scroll);
  if (sale.rows.some(row => row.courtesy)) {
    target.append(element('p', 'Utilidad no recibida por cortesías: ' + currency(sale.totals.missedProfit)));
  }
}

function addBreakdownRow(section, name, amounts) {
  const row = section.insertRow();
  const label = element('th', name);
  label.scope = 'row';
  row.append(label);
  for (const key of ['price', 'cost', 'profit']) row.insertCell().textContent = currency(amounts[key]);
}

function refreshPreview() {
  const inputsValid = Array.from(items.querySelectorAll('input')).every(input => input.validity.valid);
  previewTotals = inputsValid ? calculateSale() : null;
  save.disabled = saving || !draft.size || !previewTotals;
  cancel.disabled = saving || !draft.size;
  if (previewTotals) renderBreakdown(preview, previewTotals);
  else preview.replaceChildren(element('p', 'Revisá la cantidad, el precio, el costo y el descuento. El descuento debe ser menor o igual al precio.'));
}

function renderItems() {
  items.replaceChildren();
  if (!draft.size) items.append(element('p', 'Agregá productos de Catálogos.'));
  for (const item of draft.values()) {
    const card = element('article', null, 'sale-item');
    const heading = element('div', null, 'item-heading');
    const remove = element('button', 'Quitar', 'btn-outline');
    remove.type = 'button';
    remove.setAttribute('aria-label', 'Quitar ' + item.name);
    remove.addEventListener('click', () => {
      draft.delete(item.productId);
      renderItems();
    });
    heading.append(element('strong', item.name), remove);

    const fields = element('div', null, 'item-fields');
    for (const [key, title, step, min] of [
      ['quantity', 'Cantidad', '1', '1'],
      ['unitPrice', 'Precio (C$)', '0.01', '0'],
      ['unitCost', 'Costo unitario (C$)', '0.01', '0'],
      ['discount', 'Desc./unidad (C$)', '0.01', '0']
    ]) {
      const label = element('label', title);
      const input = element('input');
      input.type = 'number';
      input.inputMode = key === 'quantity' ? 'numeric' : 'decimal';
      input.step = step;
      input.min = min;
      input.required = key !== 'discount';
      input.value = item[key];
      input.setAttribute('aria-label', title + ' de ' + item.name);
      input.addEventListener('input', () => {
        item[key] = input.value;
        refreshPreview();
      });
      label.append(input);
      fields.append(label);
    }

    const courtesyLabel = element('label', null, 'item-courtesy');
    const courtesy = element('input');
    courtesy.type = 'checkbox';
    courtesy.checked = item.courtesy;
    courtesy.setAttribute('aria-label', 'Cortesía de ' + item.name);
    courtesy.addEventListener('change', () => {
      item.courtesy = courtesy.checked;
      refreshPreview();
    });
    courtesyLabel.append(courtesy, 'Cortesía');
    card.append(heading, fields, courtesyLabel);
    items.append(card);
  }
  refreshPreview();
}

async function renderCatalog() {
  const products = await A33Products.readForPOS();
  const entries = products.map(product => ({
    productId: product.productId,
    name: String(product.name || product.nombre || 'Producto').trim(),
    unitPrice: catalogMoney(product, ['price', 'precio', 'unitPrice']),
    unitCost: catalogMoney(product, ['unitCost', 'costoUnitario', 'costPerUnit', 'costo', 'referenceUnitCost', 'costoUnitarioReferencia'])
  }));
  const counts = new Map();
  for (const entry of entries) {
    const key = entry.name.toLocaleLowerCase('es');
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }));
  catalog.replaceChildren();
  if (!entries.length) catalog.textContent = 'No hay productos activos habilitados para POS en Catálogos.';
  for (const entry of entries) {
    const name = counts.get(entry.name.toLocaleLowerCase('es')) > 1
      ? entry.name + ' · ' + entry.productId.slice(-6) : entry.name;
    const card = element('div', null, 'catalog-product');
    const info = element('div');
    const price = entry.unitPrice === '' ? 'Precio pendiente' : currency(cents(entry.unitPrice));
    const cost = entry.unitCost === '' ? 'Costo pendiente' : 'Costo ' + currency(cents(entry.unitCost));
    info.append(element('strong', name), element('small', price + ' · ' + cost));
    const add = element('button', '+', 'btn-outline');
    add.type = 'button';
    add.setAttribute('aria-label', 'Agregar ' + name);
    add.addEventListener('click', () => {
      if (saving) return;
      const existing = draft.get(entry.productId);
      if (existing) existing.quantity = (Number(existing.quantity) || 0) + 1;
      else draft.set(entry.productId, { ...entry, name, quantity: 1, discount: '', courtesy: false });
      status.textContent = '';
      renderItems();
    });
    card.append(info, add);
    catalog.append(card);
  }
}

const historyDb = new Promise((resolve, reject) => {
  const request = indexedDB.open('a33_venta_temporal', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('simulaciones', {
    keyPath: 'number', autoIncrement: true
  });
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
});

async function readHistory() {
  const db = await historyDb;
  return new Promise((resolve, reject) => {
    const request = db.transaction('simulaciones', 'readonly').objectStore('simulaciones').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveSale(sale) {
  const db = await historyDb;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('simulaciones', 'readwrite');
    const request = transaction.objectStore('simulaciones').add({ ...sale, savedAt: Date.now() });
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error || request.error);
  });
}

async function renderHistory() {
  try {
    const records = await readHistory();
    const expanded = new Set(Array.from(historyList.querySelectorAll('details[open]'), row => row.dataset.number));
    const fragment = document.createDocumentFragment();
    for (const sale of records.reverse()) {
      const details = element('details');
      details.dataset.number = sale.number;
      details.open = expanded.has(details.dataset.number);
      details.append(element('summary', '#' + sale.number + ' · ' + savedAtFormat.format(sale.savedAt) +
        ' · Total ' + currency(sale.totals.price) + ' · Utilidad ' + currency(sale.totals.profit)));
      const detail = element('div');
      details.append(detail);
      renderBreakdown(detail, sale);
      fragment.append(details);
    }
    historyList.replaceChildren(fragment);
    historyStatus.textContent = records.length ? '' : 'Todavía no hay ventas simuladas.';
  } catch (error) {
    historyStatus.textContent = 'No se pudo cargar el histórico.';
    console.error(error);
  }
}

cancel.addEventListener('click', () => {
  draft.clear();
  status.textContent = '';
  renderItems();
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving || !previewTotals || !draft.size) return;
  saving = true;
  items.inert = true;
  status.textContent = 'Guardando simulación…';
  refreshPreview();
  try {
    const number = await saveSale(previewTotals);
    draft.clear();
    renderItems();
    status.textContent = 'Simulación #' + number + ' guardada.';
    await renderHistory();
  } catch (error) {
    status.textContent = 'No se pudo guardar la simulación. Podés intentar de nuevo.';
    console.error(error);
  } finally {
    saving = false;
    items.inert = false;
    refreshPreview();
  }
});

renderItems();
renderCatalog().catch(error => {
  catalog.textContent = 'No se pudo consultar Catálogos.';
  console.error(error);
});
renderHistory();
