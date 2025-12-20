const STORAGE_KEY_PEDIDOS = "arcano33_pedidos";
let editingId = null;

function $(id) {
  return document.getElementById(id);
}

function loadPedidos() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PEDIDOS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("Error leyendo pedidos", e);
    return [];
  }
}

function savePedidos(list) {
  localStorage.setItem(STORAGE_KEY_PEDIDOS, JSON.stringify(list));
}

function formatDate(d) {
  if (!d) return "";
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return d;
    return date.toISOString().slice(0, 10);
  } catch {
    return d;
  }
}

function generateCodigo(fechaStr) {
  const base = fechaStr && fechaStr.length >= 10 ? fechaStr.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fechaCompact = base.replace(/-/g, "");
  const pedidos = loadPedidos().filter(p => p.codigo && p.codigo.includes(fechaCompact));
  const next = (pedidos.length + 1).toString().padStart(3, "0");
  return `P-${fechaCompact}-${next}`;
}

function parseNumber(value) {
  const n = parseFloat(String(value).replace(",", "."));
  return Number.isNaN(n) ? 0 : n;
}

function calcularTotalesDesdeFormulario() {
  const lineas = [
    { cant: $("pulsoCant").value, precio: $("pulsoPrecio").value, desc: $("pulsoDesc").value },
    { cant: $("mediaCant").value, precio: $("mediaPrecio").value, desc: $("mediaDesc").value },
    { cant: $("djebaCant").value, precio: $("djebaPrecio").value, desc: $("djebaDesc").value },
    { cant: $("litroCant").value, precio: $("litroPrecio").value, desc: $("litroDesc").value },
    { cant: $("galonCant").value, precio: $("galonPrecio").value, desc: $("galonDesc").value },
  ];

  let subtotal = 0;
  let descuentoTotal = 0;

  lineas.forEach((l) => {
    const cant = parseNumber(l.cant);
    const precio = parseNumber(l.precio);
    const desc = parseNumber(l.desc);
    const bruto = cant * precio;
    subtotal += bruto;
    descuentoTotal += desc;
  });

  const envio = parseNumber($("envio").value);
  const totalPagar = subtotal - descuentoTotal + envio;
  const montoPagado = parseNumber($("montoPagado").value);
  const saldoPendiente = totalPagar - montoPagado;

  $("subtotal").value = subtotal.toFixed(2);
  $("descuentoTotal").value = descuentoTotal.toFixed(2);
  $("totalPagar").value = totalPagar.toFixed(2);
  $("saldoPendiente").value = saldoPendiente.toFixed(2);

  return {
    subtotal,
    descuentoTotal,
    envio,
    totalPagar,
    montoPagado,
    saldoPendiente,
  };
}

function clearForm() {
  $("pedido-form").reset();

  // restaurar valores por defecto numéricos
  const defaults = {
    pulsoCant: "0",
    pulsoPrecio: "120",
    pulsoDesc: "0",
    mediaCant: "0",
    mediaPrecio: "150",
    mediaDesc: "0",
    djebaCant: "0",
    djebaPrecio: "300",
    djebaDesc: "0",
    litroCant: "0",
    litroPrecio: "330",
    litroDesc: "0",
    galonCant: "0",
    galonPrecio: "800",
    galonDesc: "0",
    envio: "0",
    montoPagado: "0",
  };

  Object.entries(defaults).forEach(([id, val]) => {
    const el = $(id);
    if (el) el.value = val;
  });

  $("subtotal").value = "";
  $("descuentoTotal").value = "";
  $("totalPagar").value = "";
  $("saldoPendiente").value = "";
  $("entregado").checked = false;
  editingId = null;

  // fecha de creación por defecto hoy
  const hoy = new Date().toISOString().slice(0, 10);
  $("fechaCreacion").value = hoy;
  if (!$("fechaEntrega").value) $("fechaEntrega").value = hoy;
  $("codigoPedido").value = generateCodigo(hoy);
  $("save-btn").textContent = "Guardar pedido";
}

function populateForm(pedido) {
  $("fechaCreacion").value = formatDate(pedido.fechaCreacion);
  $("fechaEntrega").value = formatDate(pedido.fechaEntrega);
  $("codigoPedido").value = pedido.codigo || "";
  $("prioridad").value = pedido.prioridad || "normal";

  $("clienteNombre").value = pedido.clienteNombre || "";
  $("clienteTipo").value = pedido.clienteTipo || "individual";
  $("clienteTelefono").value = pedido.clienteTelefono || "";
  $("clienteDireccion").value = pedido.clienteDireccion || "";
  $("clienteReferencia").value = pedido.clienteReferencia || "";

  $("pulsoCant").value = pedido.pulsoCant ?? "0";
  $("pulsoPrecio").value = pedido.pulsoPrecio ?? "120";
  $("pulsoDesc").value = pedido.pulsoDesc ?? "0";

  $("mediaCant").value = pedido.mediaCant ?? "0";
  $("mediaPrecio").value = pedido.mediaPrecio ?? "150";
  $("mediaDesc").value = pedido.mediaDesc ?? "0";

  $("djebaCant").value = pedido.djebaCant ?? "0";
  $("djebaPrecio").value = pedido.djebaPrecio ?? "300";
  $("djebaDesc").value = pedido.djebaDesc ?? "0";

  $("litroCant").value = pedido.litroCant ?? "0";
  $("litroPrecio").value = pedido.litroPrecio ?? "330";
  $("litroDesc").value = pedido.litroDesc ?? "0";

  $("galonCant").value = pedido.galonCant ?? "0";
  $("galonPrecio").value = pedido.galonPrecio ?? "800";
  $("galonDesc").value = pedido.galonDesc ?? "0";

  $("envio").value = pedido.envio ?? "0";
  $("subtotal").value = typeof pedido.subtotal === "number" ? pedido.subtotal.toFixed(2) : "";
  $("descuentoTotal").value = typeof pedido.descuentoTotal === "number" ? pedido.descuentoTotal.toFixed(2) : "";
  $("totalPagar").value = typeof pedido.totalPagar === "number" ? pedido.totalPagar.toFixed(2) : "";
  $("metodoPago").value = pedido.metodoPago || "efectivo";
  $("estadoPago").value = pedido.estadoPago || "pagado";
  $("montoPagado").value = pedido.montoPagado != null ? pedido.montoPagado : "0";
  $("saldoPendiente").value = typeof pedido.saldoPendiente === "number" ? pedido.saldoPendiente.toFixed(2) : "";

  $("lotesRelacionados").value = pedido.lotesRelacionados || "";
  $("entregado").checked = !!pedido.entregado;

  editingId = pedido.id;
  $("save-btn").textContent = "Actualizar pedido";
}

function renderTable() {
  const tbody = $("pedidos-table").querySelector("tbody");
  tbody.innerHTML = "";
  const pedidos = loadPedidos().sort((a, b) => {
    if (!a.fechaCreacion || !b.fechaCreacion) return 0;
    return a.fechaCreacion.localeCompare(b.fechaCreacion);
  });

  if (pedidos.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No hay pedidos registrados.";
    td.style.textAlign = "center";
    td.style.color = "#c0c0c0";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  pedidos.forEach((p) => {
    const tr = document.createElement("tr");

    const fechaTd = document.createElement("td");
    fechaTd.textContent = formatDate(p.fechaCreacion);
    tr.appendChild(fechaTd);

    const codigoTd = document.createElement("td");
    codigoTd.textContent = p.codigo || "";
    tr.appendChild(codigoTd);

    const clienteTd = document.createElement("td");
    clienteTd.textContent = p.clienteNombre || "";
    tr.appendChild(clienteTd);

    const entregaTd = document.createElement("td");
    entregaTd.textContent = formatDate(p.fechaEntrega);
    tr.appendChild(entregaTd);

    const totalTd = document.createElement("td");
    const total = typeof p.totalPagar === "number" ? p.totalPagar : 0;
    totalTd.textContent = total.toFixed(2);
    tr.appendChild(totalTd);

    const entregadoTd = document.createElement("td");
    entregadoTd.textContent = p.entregado ? "Sí" : "No";
    tr.appendChild(entregadoTd);

    const accionesTd = document.createElement("td");
    accionesTd.style.whiteSpace = "nowrap";

    const verBtn = document.createElement("button");
    verBtn.textContent = "Ver";
    verBtn.className = "btn-secondary";
    verBtn.type = "button";
    verBtn.addEventListener("click", () => verPedido(p.id));

    const calBtn = document.createElement("button");
    calBtn.textContent = "Calendario";
    calBtn.className = "btn-secondary";
    calBtn.type = "button";
    calBtn.style.marginLeft = "0.25rem";
    calBtn.addEventListener("click", () => exportPedidoToCalendar(p.id));

    const editarBtn = document.createElement("button");
    editarBtn.textContent = "Editar";
    editarBtn.className = "btn-primary";
    editarBtn.type = "button";
    editarBtn.style.marginLeft = "0.25rem";
    editarBtn.addEventListener("click", () => editPedido(p.id));

    const borrarBtn = document.createElement("button");
    borrarBtn.textContent = "Borrar";
    borrarBtn.className = "btn-danger";
    borrarBtn.type = "button";
    borrarBtn.style.marginLeft = "0.25rem";
    borrarBtn.addEventListener("click", () => deletePedido(p.id));

    accionesTd.appendChild(verBtn);
    accionesTd.appendChild(calBtn);
    accionesTd.appendChild(editarBtn);
    accionesTd.appendChild(borrarBtn);
    tr.appendChild(accionesTd);

    tbody.appendChild(tr);
  });
}

function verPedido(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => x.id === id);
  if (!p) return;

  const lines = [];

  lines.push(`Código: ${p.codigo || ""}`);
  lines.push(`Fecha creación: ${formatDate(p.fechaCreacion)}`);
  lines.push(`Fecha entrega: ${formatDate(p.fechaEntrega)}`);
  lines.push(`Prioridad: ${p.prioridad || "normal"}`);
  lines.push("");
  lines.push("Cliente:");
  lines.push(`  Nombre / negocio: ${p.clienteNombre || ""}`);
  lines.push(`  Tipo: ${p.clienteTipo || ""}`);
  lines.push(`  Teléfono: ${p.clienteTelefono || ""}`);
  lines.push(`  Dirección: ${p.clienteDireccion || ""}`);
  if (p.clienteReferencia) {
    lines.push(`  Referencia: ${p.clienteReferencia}`);
  }
  lines.push("");
  lines.push("Detalle por presentación:");
  lines.push(`  Pulso: cant ${p.pulsoCant || 0}, precio ${p.pulsoPrecio || 0}, desc ${p.pulsoDesc || 0}`);
  lines.push(`  Media: cant ${p.mediaCant || 0}, precio ${p.mediaPrecio || 0}, desc ${p.mediaDesc || 0}`);
  lines.push(`  Djeba: cant ${p.djebaCant || 0}, precio ${p.djebaPrecio || 0}, desc ${p.djebaDesc || 0}`);
  lines.push(`  Litro: cant ${p.litroCant || 0}, precio ${p.litroPrecio || 0}, desc ${p.litroDesc || 0}`);
  lines.push(`  Galón: cant ${p.galonCant || 0}, precio ${p.galonPrecio || 0}, desc ${p.galonDesc || 0}`);
  lines.push("");
  lines.push(`Subtotal: C$ ${typeof p.subtotal === "number" ? p.subtotal.toFixed(2) : "0.00"}`);
  lines.push(`Descuento total: C$ ${typeof p.descuentoTotal === "number" ? p.descuentoTotal.toFixed(2) : "0.00"}`);
  lines.push(`Envío: C$ ${typeof p.envio === "number" ? p.envio.toFixed(2) : "0.00"}`);
  lines.push(`Total a pagar: C$ ${typeof p.totalPagar === "number" ? p.totalPagar.toFixed(2) : "0.00"}`);
  lines.push("");
  lines.push("Pago:");
  lines.push(`  Método: ${p.metodoPago || ""}`);
  lines.push(`  Estado: ${p.estadoPago || ""}`);
  lines.push(`  Monto pagado: C$ ${typeof p.montoPagado === "number" ? p.montoPagado.toFixed(2) : "0.00"}`);
  lines.push(`  Saldo pendiente: C$ ${typeof p.saldoPendiente === "number" ? p.saldoPendiente.toFixed(2) : "0.00"}`);
  lines.push("");
  if (p.lotesRelacionados) {
    lines.push(`Lotes relacionados: ${p.lotesRelacionados}`);
  }
  lines.push(`Entregado: ${p.entregado ? "Sí" : "No"}`);

  alert(lines.join("\n"));
}

function editPedido(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => x.id === id);
  if (!p) return;
  populateForm(p);
}

function deletePedido(id) {
  if (!confirm("¿Borrar este pedido?")) return;
  const pedidos = loadPedidos().filter((p) => p.id !== id);
  savePedidos(pedidos);
  renderTable();
  clearForm();
}


function createICSEventFromPedido(p) {
  const fechaEntrega = p.fechaEntrega || p.fechaCreacion;
  if (!fechaEntrega) return null;
  const parts = String(fechaEntrega).slice(0, 10).split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  const startDate = y + m.padStart(2, "0") + d.padStart(2, "0");

  const dateObj = new Date(Date.UTC(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10) + 1));
  const endY = dateObj.getUTCFullYear();
  const endM = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const endD = String(dateObj.getUTCDate()).padStart(2, "0");
  const endDate = `${endY}${endM}${endD}`;

  const nowIso = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const summaryBase = `Entrega pedido Arcano 33`;
  const summary = (p.clienteNombre ? `${summaryBase} - ${p.clienteNombre}` : summaryBase).substring(0, 120);

  const location = (p.clienteDireccion || "").replace(/\r?\n/g, ", ").substring(0, 200);

  const descLines = [];
  descLines.push(`Código: ${p.codigo || ""}`);
  descLines.push(`Cliente: ${p.clienteNombre || ""}`);
  if (p.clienteTelefono) descLines.push(`Teléfono: ${p.clienteTelefono}`);
  if (p.clienteTipo) descLines.push(`Tipo: ${p.clienteTipo}`);
  if (p.clienteDireccion) descLines.push(`Dirección: ${p.clienteDireccion.replace(/\r?\n/g, " ")}`);
  if (p.lotesRelacionados) descLines.push(`Lotes: ${p.lotesRelacionados.replace(/\r?\n/g, " ")}`);
  const total = typeof p.totalPagar === "number" ? p.totalPagar.toFixed(2) : "";
  if (total) descLines.push(`Total a cobrar: C$ ${total}`);
  const descRaw = descLines.join("\n");

  function icsEscape(str) {
    return String(str || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  const description = icsEscape(descRaw);
  const uid = `${p.id || ("pedido-" + startDate)}@arcano33`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Arcano 33//Pedidos//ES",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${nowIso}`,
    `SUMMARY:${icsEscape(summary)}`,
  ];
  if (location) {
    lines.push(`LOCATION:${icsEscape(location)}`);
  }
  lines.push(
    `DESCRIPTION:${description}`,
    `DTSTART;VALUE=DATE:${startDate}`,
    `DTEND;VALUE=DATE:${endDate}`,
    "END:VEVENT",
    "END:VCALENDAR"
  );
  return lines.join("\r\n");
}

function exportPedidoToCalendar(id) {
  const pedidos = loadPedidos();
  const p = pedidos.find((x) => x.id === id);
  if (!p) return;

  const ics = createICSEventFromPedido(p);
  if (!ics) {
    alert("No se pudo generar el evento de calendario. Revisá que el pedido tenga fecha de entrega.");
    return;
  }

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const fecha = (p.fechaEntrega || p.fechaCreacion || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const safeCodigo = String(p.codigo || "pedido")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
  a.href = url;
  a.download = `pedido_${safeCodigo}_${fecha}.ics`;

  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

function exportToCSV() {
  const pedidos = loadPedidos();
  if (pedidos.length === 0) {
    alert("No hay pedidos para exportar.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.");
    return;
  }

  const headers = [
    "Fecha creación",
    "Fecha entrega",
    "Código",
    "Cliente",
    "Tipo cliente",
    "Teléfono",
    "Dirección",
    "Referencia",
    "Pulso - Cantidad",
    "Pulso - Precio",
    "Pulso - Descuento",
    "Media - Cantidad",
    "Media - Precio",
    "Media - Descuento",
    "Djeba - Cantidad",
    "Djeba - Precio",
    "Djeba - Descuento",
    "Litro - Cantidad",
    "Litro - Precio",
    "Litro - Descuento",
    "Galón - Cantidad",
    "Galón - Precio",
    "Galón - Descuento",
    "Subtotal presentaciones",
    "Descuento total",
    "Envío",
    "Total a pagar",
    "Método pago",
    "Estado pago",
    "Monto pagado",
    "Saldo pendiente",
    "Lotes relacionados",
    "Entregado",
  ];

  const numOrEmpty = (v) => (typeof v === "number" ? Number(v.toFixed(2)) : "");

  const rows = pedidos.map((p) => [
    formatDate(p.fechaCreacion),
    formatDate(p.fechaEntrega),
    p.codigo || "",
    p.clienteNombre || "",
    p.clienteTipo || "",
    p.clienteTelefono || "",
    p.clienteDireccion || "",
    (p.clienteReferencia || "").replace(/\r?\n/g, " "),
    p.pulsoCant ?? 0,
    p.pulsoPrecio ?? 0,
    p.pulsoDesc ?? 0,
    p.mediaCant ?? 0,
    p.mediaPrecio ?? 0,
    p.mediaDesc ?? 0,
    p.djebaCant ?? 0,
    p.djebaPrecio ?? 0,
    p.djebaDesc ?? 0,
    p.litroCant ?? 0,
    p.litroPrecio ?? 0,
    p.litroDesc ?? 0,
    p.galonCant ?? 0,
    p.galonPrecio ?? 0,
    p.galonDesc ?? 0,
    numOrEmpty(p.subtotalPresentaciones),
    numOrEmpty(p.descuentoTotal),
    numOrEmpty(p.envio),
    numOrEmpty(p.totalPagar),
    p.metodoPago || "",
    p.estadoPago || "",
    numOrEmpty(p.montoPagado),
    numOrEmpty(p.saldoPendiente),
    (p.lotesRelacionados || "").replace(/\r?\n/g, " "),
    p.entregado ? "Sí" : "No",
  ]);

  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Pedidos");

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `arcano33_pedidos_${timestamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}

document.addEventListener("DOMContentLoaded", () => {
  clearForm();

  $("pedido-form").addEventListener("submit", (e) => {
    e.preventDefault();

    // calcular totales antes de guardar
    const totales = calcularTotalesDesdeFormulario();

    const pedido = {
      id: editingId || Date.now(),
      fechaCreacion: $("fechaCreacion").value || new Date().toISOString().slice(0, 10),
      fechaEntrega: $("fechaEntrega").value || $("fechaCreacion").value,
      codigo: $("codigoPedido").value || generateCodigo($("fechaCreacion").value),
      prioridad: $("prioridad").value,

      clienteNombre: $("clienteNombre").value.trim(),
      clienteTipo: $("clienteTipo").value,
      clienteTelefono: $("clienteTelefono").value.trim(),
      clienteDireccion: $("clienteDireccion").value.trim(),
      clienteReferencia: $("clienteReferencia").value.trim(),

      pulsoCant: parseNumber($("pulsoCant").value),
      pulsoPrecio: parseNumber($("pulsoPrecio").value),
      pulsoDesc: parseNumber($("pulsoDesc").value),

      mediaCant: parseNumber($("mediaCant").value),
      mediaPrecio: parseNumber($("mediaPrecio").value),
      mediaDesc: parseNumber($("mediaDesc").value),

      djebaCant: parseNumber($("djebaCant").value),
      djebaPrecio: parseNumber($("djebaPrecio").value),
      djebaDesc: parseNumber($("djebaDesc").value),

      litroCant: parseNumber($("litroCant").value),
      litroPrecio: parseNumber($("litroPrecio").value),
      litroDesc: parseNumber($("litroDesc").value),

      galonCant: parseNumber($("galonCant").value),
      galonPrecio: parseNumber($("galonPrecio").value),
      galonDesc: parseNumber($("galonDesc").value),

      subtotal: totales.subtotal,
      descuentoTotal: totales.descuentoTotal,
      envio: totales.envio,
      totalPagar: totales.totalPagar,
      metodoPago: $("metodoPago").value,
      estadoPago: $("estadoPago").value,
      montoPagado: totales.montoPagado,
      saldoPendiente: totales.saldoPendiente,

      lotesRelacionados: $("lotesRelacionados").value.trim(),
      entregado: $("entregado").checked,
    };

    const pedidos = loadPedidos();
    const idx = pedidos.findIndex((p) => p.id === pedido.id);
    if (idx >= 0) {
      pedidos[idx] = pedido;
    } else {
      pedidos.push(pedido);
    }
    savePedidos(pedidos);
    renderTable();
    clearForm();
    alert("Pedido guardado correctamente.");
  });

  $("reset-btn").addEventListener("click", () => clearForm());
  $("export-btn").addEventListener("click", () => exportToCSV());
  $("clear-all-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todos los pedidos registrados?")) return;
    localStorage.removeItem(STORAGE_KEY_PEDIDOS);
    renderTable();
    clearForm();
  });
  $("calc-totals-btn").addEventListener("click", () => calcularTotalesDesdeFormulario());

  renderTable();
  registerServiceWorker();
});
