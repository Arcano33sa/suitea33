const STORAGE_KEY_INVENTARIO = "arcano33_inventario";

const LIQUIDS = [
  { id: "vino",   nombre: "Vino" },
  { id: "vodka",  nombre: "Vodka" },
  { id: "jugo",   nombre: "Jugo" },
  { id: "sirope", nombre: "Sirope" },
  { id: "agua",   nombre: "Agua pura" },
];

const BOTTLES = [
  { id: "pulso", nombre: "Pulso 250 ml" },
  { id: "media", nombre: "Media 375 ml" },
  { id: "djeba", nombre: "Djeba 750 ml" },
  { id: "litro", nombre: "Litro 1000 ml" },
  { id: "galon", nombre: "Galón 3800 ml" },
];

const FINISHED = [
  { id: "pulso", nombre: "Pulso 250 ml (listo)" },
  { id: "media", nombre: "Media 375 ml (lista)" },
  { id: "djeba", nombre: "Djeba 750 ml (lista)" },
  { id: "litro", nombre: "Litro 1000 ml (lista)" },
  { id: "galon", nombre: "Galón 3800 ml (lista)" },
];


function $(id) {
  return document.getElementById(id);
}

function defaultInventario() {
  const inv = {
    liquids: {},
    bottles: {},
    finished: {},
  };
  LIQUIDS.forEach((l) => {
    inv.liquids[l.id] = { stock: 0, max: 0 };
  });
  BOTTLES.forEach((b) => {
    inv.bottles[b.id] = { stock: 0 };
  });
  FINISHED.forEach((p) => {
    inv.finished[p.id] = { stock: 0 };
  });
  return inv;
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

function loadInventario() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INVENTARIO);
    let data = raw ? JSON.parse(raw) : null;
    if (!data || typeof data !== "object") data = defaultInventario();

    if (!data.liquids) data.liquids = {};
    if (!data.bottles) data.bottles = {};
    if (!data.finished) data.finished = {};

    // asegurar todas las claves
    const def = defaultInventario();
    LIQUIDS.forEach((l) => {
      if (!data.liquids[l.id]) data.liquids[l.id] = { stock: 0, max: 0 };
      if (typeof data.liquids[l.id].stock !== "number") {
        data.liquids[l.id].stock = parseNumber(data.liquids[l.id].stock || 0);
      }
      if (typeof data.liquids[l.id].max !== "number") {
        data.liquids[l.id].max = parseNumber(data.liquids[l.id].max || 0);
      }
    });
    BOTTLES.forEach((b) => {
      if (!data.bottles[b.id]) data.bottles[b.id] = { stock: 0 };
      if (typeof data.bottles[b.id].stock !== "number") {
        data.bottles[b.id].stock = parseNumber(data.bottles[b.id].stock || 0);
      }
    });
    FINISHED.forEach((p) => {
      if (!data.finished[p.id]) data.finished[p.id] = { stock: 0 };
      if (typeof data.finished[p.id].stock !== "number") {
        data.finished[p.id].stock = parseNumber(data.finished[p.id].stock || 0);
      }
    });

    return data;
  } catch (e) {
    console.error("Error leyendo inventario", e);
    return defaultInventario();
  }
}

function saveInventario(inv) {
  localStorage.setItem(STORAGE_KEY_INVENTARIO, JSON.stringify(inv));
}

function calcularEstadoLiquido(liq) {
  const stock = parseNumber(liq.stock);
  const max = parseNumber(liq.max);
  if (max <= 0) {
    if (stock <= 0) {
      return { label: "Sin stock", className: "status-neutral" };
    }
    return { label: "Sin máximo definido", className: "status-neutral" };
  }
  const pct = (stock / max) * 100;
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (pct <= 20) {
    return { label: `Bajo (${pct.toFixed(1)}%)`, className: "status-warn" };
  }
  return { label: `OK (${pct.toFixed(1)}%)`, className: "status-ok" };
}

function calcularEstadoBotella(b) {
  const stock = parseNumber(b.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderLiquidos(inv) {
  const tbody = $("inv-liquidos-body");
  tbody.innerHTML = "";
  LIQUIDS.forEach((l) => {
    const info = inv.liquids[l.id] || { stock: 0, max: 0 };
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = l.nombre;
    tr.appendChild(tdNombre);

    const tdStock = document.createElement("td");
    const inputStock = document.createElement("input");
    inputStock.type = "number";
    inputStock.step = "0.01";
    inputStock.min = "0";
    inputStock.value = typeof info.stock === "number" ? info.stock : parseNumber(info.stock);
    inputStock.dataset.id = l.id;
    inputStock.dataset.kind = "liquid-stock";
    tdStock.appendChild(inputStock);
    tr.appendChild(tdStock);

    const tdMax = document.createElement("td");
    const inputMax = document.createElement("input");
    inputMax.type = "number";
    inputMax.step = "0.01";
    inputMax.min = "0";
    inputMax.value = typeof info.max === "number" ? info.max : parseNumber(info.max);
    inputMax.dataset.id = l.id;
    inputMax.dataset.kind = "liquid-max";
    tdMax.appendChild(inputMax);
    tr.appendChild(tdMax);

    const tdPct = document.createElement("td");
    const max = parseNumber(info.max);
    const stock = parseNumber(info.stock);
    const pct = max > 0 ? (stock / max) * 100 : 0;
    tdPct.textContent = max > 0 ? pct.toFixed(1) + " %" : "—";
    tr.appendChild(tdPct);

    const tdEstado = document.createElement("td");
    const estado = calcularEstadoLiquido(info);
    const span = document.createElement("span");
    span.className = "status-chip " + estado.className;
    span.textContent = estado.label;
    tdEstado.appendChild(span);
    tr.appendChild(tdEstado);

    const tdAcciones = document.createElement("td");
    const divAcc = document.createElement("div");
    divAcc.className = "inv-actions";

    const btnEntrada = document.createElement("button");
    btnEntrada.type = "button";
    btnEntrada.textContent = "Entrada";
    btnEntrada.className = "btn-secondary btn-mini";
    btnEntrada.dataset.action = "entrada";
    btnEntrada.dataset.id = l.id;
    btnEntrada.dataset.kind = "liquid";

    const btnSalida = document.createElement("button");
    btnSalida.type = "button";
    btnSalida.textContent = "Salida";
    btnSalida.className = "btn-danger btn-mini";
    btnSalida.dataset.action = "salida";
    btnSalida.dataset.id = l.id;
    btnSalida.dataset.kind = "liquid";

    divAcc.appendChild(btnEntrada);
    divAcc.appendChild(btnSalida);
    tdAcciones.appendChild(divAcc);
    tr.appendChild(tdAcciones);

    tbody.appendChild(tr);
  });
}

function renderBotellas(inv) {
  const tbody = $("inv-botellas-body");
  tbody.innerHTML = "";
  BOTTLES.forEach((bDef) => {
    const info = inv.bottles[bDef.id] || { stock: 0 };
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = bDef.nombre;
    tr.appendChild(tdNombre);

    const tdStock = document.createElement("td");
    const inputStock = document.createElement("input");
    inputStock.type = "number";
    inputStock.step = "1";
    inputStock.min = "0";
    inputStock.value = typeof info.stock === "number" ? info.stock : parseNumber(info.stock);
    inputStock.dataset.id = bDef.id;
    inputStock.dataset.kind = "bottle-stock";
    tdStock.appendChild(inputStock);
    tr.appendChild(tdStock);

    const tdEstado = document.createElement("td");
    const estado = calcularEstadoBotella(info);
    const span = document.createElement("span");
    span.className = "status-chip " + estado.className;
    span.textContent = estado.label;
    tdEstado.appendChild(span);
    tr.appendChild(tdEstado);

    const tdAcciones = document.createElement("td");
    const divAcc = document.createElement("div");
    divAcc.className = "inv-actions";

    const btnEntrada = document.createElement("button");
    btnEntrada.type = "button";
    btnEntrada.textContent = "Entrada";
    btnEntrada.className = "btn-secondary btn-mini";
    btnEntrada.dataset.action = "entrada";
    btnEntrada.dataset.id = bDef.id;
    btnEntrada.dataset.kind = "bottle";

    const btnSalida = document.createElement("button");
    btnSalida.type = "button";
    btnSalida.textContent = "Salida";
    btnSalida.className = "btn-danger btn-mini";
    btnSalida.dataset.action = "salida";
    btnSalida.dataset.id = bDef.id;
    btnSalida.dataset.kind = "bottle";

    divAcc.appendChild(btnEntrada);
    divAcc.appendChild(btnSalida);
    tdAcciones.appendChild(divAcc);
    tr.appendChild(tdAcciones);

    tbody.appendChild(tr);
  });
}

function attachListeners(inv) {
  const liquidosBody = $("inv-liquidos-body");
  const botellasBody = $("inv-botellas-body");

  liquidosBody.addEventListener("change", (e) => {
    const target = e.target;
    if (!target.dataset || !target.dataset.kind) return;
    const id = target.dataset.id;
    const kind = target.dataset.kind;
    if (kind === "liquid-stock") {
      inv.liquids[id].stock = parseNumber(target.value);
    } else if (kind === "liquid-max") {
      inv.liquids[id].max = parseNumber(target.value);
    }
    saveInventario(inv);
    renderLiquidos(inv);
  });

  botellasBody.addEventListener("change", (e) => {
    const target = e.target;
    if (!target.dataset || !target.dataset.kind) return;
    const id = target.dataset.id;
    const kind = target.dataset.kind;
    if (kind === "bottle-stock") {
      inv.bottles[id].stock = parseNumber(target.value);
      saveInventario(inv);
      renderBotellas(inv);
    }
  });

  function handleAccion(e) {
    const target = e.target;
    if (!target.dataset || !target.dataset.action) return;
    const action = target.dataset.action;
    const id = target.dataset.id;
    const kind = target.dataset.kind;

    const etiqueta = kind === "liquid" ? "ml" : "unidades";
    const msg =
      action === "entrada"
        ? `Cantidad de ${etiqueta} para ENTRADA en ${id}:`
        : `Cantidad de ${etiqueta} para SALIDA en ${id}:`;

    const valStr = window.prompt(msg);
    if (valStr == null) return;
    const cantidad = parseNumber(valStr);
    if (cantidad <= 0) return;

    if (kind === "liquid") {
      const item = inv.liquids[id] || { stock: 0, max: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        item.stock = parseNumber(item.stock) - cantidad;
      }
      inv.liquids[id] = item;
      saveInventario(inv);
      renderLiquidos(inv);
    } else if (kind === "bottle") {
      const item = inv.bottles[id] || { stock: 0 };
      if (action === "entrada") {
        item.stock = parseNumber(item.stock) + cantidad;
      } else {
        item.stock = parseNumber(item.stock) - cantidad;
      }
      inv.bottles[id] = item;
      saveInventario(inv);
      renderBotellas(inv);
    }
  }

  liquidosBody.addEventListener("click", handleAccion);
  botellasBody.addEventListener("click", handleAccion);
}

function buildAlertLines(inv) {
  const lines = [];

  // Líquidos en alerta (<=20% del máximo definido)
  LIQUIDS.forEach((l) => {
    const info = inv.liquids[l.id] || { stock: 0, max: 0 };
    const stock = parseNumber(info.stock);
    const max = parseNumber(info.max);
    if (max > 0) {
      const pct = (stock / max) * 100;
      if (pct <= 20) {
        lines.push(`• ${l.nombre}: ${stock.toFixed(0)} ml (${pct.toFixed(1)}% restante)`);
      }
    }
  });

  // Botellas en alerta (<=10 unidades)
  BOTTLES.forEach((b) => {
    const info = inv.bottles[b.id] || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${b.nombre}: ${stock.toFixed(0)} botellas`);
    }
  });

  // Producto terminado en alerta (<=10 unidades)
  FINISHED.forEach((p) => {
    const info = (inv.finished && inv.finished[p.id]) || { stock: 0 };
    const stock = parseNumber(info.stock);
    if (stock <= 10) {
      lines.push(`• ${p.nombre}: ${stock.toFixed(0)} botellas listas`);
    }
  });

  return lines;
}


function calcularEstadoProductoTerminado(item) {
  const stock = parseNumber(item.stock);
  if (stock <= 0) {
    return { label: "Sin stock", className: "status-critical" };
  }
  if (stock <= 10) {
    return { label: `Bajo (${stock} unid.)`, className: "status-warn" };
  }
  return { label: `OK (${stock} unid.)`, className: "status-ok" };
}

function renderProductosTerminados(inv) {
  const tbody = document.getElementById("inv-productos-body");
  if (!tbody) return;
  tbody.innerHTML = "";
  FINISHED.forEach((pDef) => {
    const info = (inv.finished && inv.finished[pDef.id]) || { stock: 0 };
    const stock = parseNumber(info.stock);
    const tr = document.createElement("tr");

    const tdNombre = document.createElement("td");
    tdNombre.textContent = pDef.nombre;
    tr.appendChild(tdNombre);

    const tdStock = document.createElement("td");
    tdStock.textContent = stock.toFixed(0);
    tr.appendChild(tdStock);

    const tdEstado = document.createElement("td");
    const estado = calcularEstadoProductoTerminado(info);
    const span = document.createElement("span");
    span.className = "status-chip " + estado.className;
    span.textContent = estado.label;
    tdEstado.appendChild(span);
    tr.appendChild(tdEstado);

    tbody.appendChild(tr);
  });
}

function checkAndAlert(inv) {
  const lines = buildAlertLines(inv);
  if (lines.length > 0) {
    alert("Alerta de inventario:\n\n" + lines.join("\n"));
  }
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.error("SW error", err));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const inv = loadInventario();
  renderLiquidos(inv);
  renderBotellas(inv);
  renderProductosTerminados(inv);
  attachListeners(inv);
  checkAndAlert(inv);
  registerServiceWorker();
});
