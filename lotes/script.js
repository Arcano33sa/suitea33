// Simple storage using localStorage
const STORAGE_KEY = "arcano33_lotes";

let editingId = null;

function $(id) {
  return document.getElementById(id);
}

function loadLotes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.error("Error leyendo localStorage", e);
    return [];
  }
}

function saveLotes(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function formatDate(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toISOString().slice(0, 10);
  } catch {
    return value;
  }
}

function calculateCaducidad(fechaStr) {
  if (!fechaStr) return "";
  const d = new Date(fechaStr);
  if (Number.isNaN(d.getTime())) return "";
  const year = d.getFullYear();
  const month = d.getMonth();
  const day = d.getDate();

  const cad = new Date(year, month + 2, day);
  return cad.toISOString().slice(0, 10);
}

// Helpers para ordenar (más reciente arriba)
function toTimestamp(value) {
  if (!value) return NaN;
  const d = new Date(value);
  const t = d.getTime();
  return Number.isFinite(t) ? t : NaN;
}

function getCreatedTimestamp(lote) {
  // Preferir createdAt si existe
  const tCreated = toTimestamp(lote?.createdAt);
  if (Number.isFinite(tCreated)) return tCreated;

  // Fallback: id con timestamp (lote_1734567890123)
  if (typeof lote?.id === "string" && lote.id.startsWith("lote_")) {
    const n = Number(lote.id.slice(5));
    if (Number.isFinite(n)) return n;
  }

  // Fallback final: fecha de elaboración
  const tFecha = toTimestamp(lote?.fecha);
  if (Number.isFinite(tFecha)) return tFecha;

  return 0;
}


function showLoteDetails(lote) {
  const lines = [];
  lines.push(`Lote: ${lote.codigo || ""}`);
  lines.push(`Fecha de elaboración: ${formatDate(lote.fecha)}`);
  lines.push(`Fecha de caducidad: ${formatDate(lote.caducidad)}`);
  lines.push("");
  lines.push("Volúmenes (ml):");
  lines.push(`  Total: ${lote.volTotal || "0"}`);
  lines.push(`  Vino: ${lote.volVino || "0"}`);
  lines.push(`  Vodka: ${lote.volVodka || "0"}`);
  lines.push(`  Jugo: ${lote.volJugo || "0"}`);
  lines.push(`  Sirope: ${lote.volSirope || "0"}`);
  lines.push(`  Agua: ${lote.volAgua || "0"}`);
  lines.push("");
  lines.push("Unidades por presentación:");
  lines.push(`  Pulso 250 ml: ${lote.pulso ?? "0"}`);
  lines.push(`  Media 375 ml: ${lote.media ?? "0"}`);
  lines.push(`  Djeba 750 ml: ${lote.djeba ?? "0"}`);
  lines.push(`  Litro 1000 ml: ${lote.litro ?? "0"}`);
  lines.push(`  Galón 3800 ml: ${lote.galon ?? "0"}`);
  if (lote.notas) {
    lines.push("");
    lines.push("Notas:");
    lines.push(lote.notas);
  }
  alert(lines.join("\n"));
}

function clearForm() {
  const form = $("lote-form");
  form.reset();
  // Restaurar valores por defecto numéricos
  ["pulso", "media", "djeba", "litro", "galon"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "0";
  });

  const today = new Date().toISOString().slice(0, 10);
  $("fecha").value = today;
  $("caducidad").value = calculateCaducidad(today);
  editingId = null;
  $("save-btn").textContent = "Guardar lote";
}

function readFormData() {
  const fecha = $("fecha").value;
  const codigo = $("codigo").value.trim();

  if (!fecha || !codigo) {
    alert("Fecha y código de lote son obligatorios.");
    return null;
  }

  const data = {
    id: editingId || `lote_${Date.now()}`,
    fecha: formatDate(fecha),
    codigo,
    caducidad: $("caducidad").value || calculateCaducidad(fecha),

    volTotal: $("volTotal").value || "",
    volVino: $("volVino").value || "",
    volVodka: $("volVodka").value || "",
    volJugo: $("volJugo").value || "",
    volSirope: $("volSirope").value || "",
    volAgua: $("volAgua").value || "",

    pulso: $("pulso").value || "0",
    media: $("media").value || "0",
    djeba: $("djeba").value || "0",
    litro: $("litro").value || "0",
    galon: $("galon").value || "0",

    notas: $("notas").value.trim(),
  };

  // Mantener createdAt estable (no borrarlo al editar). Agregamos updatedAt opcional.
  if (!editingId) {
    data.createdAt = new Date().toISOString();
  } else {
    data.updatedAt = new Date().toISOString();
  }

  return data;
}

function populateForm(lote) {
  $("fecha").value = formatDate(lote.fecha);
  $("codigo").value = lote.codigo || "";
  $("caducidad").value = formatDate(lote.caducidad);

  $("volTotal").value = lote.volTotal || "";
  $("volVino").value = lote.volVino || "";
  $("volVodka").value = lote.volVodka || "";
  $("volJugo").value = lote.volJugo || "";
  $("volSirope").value = lote.volSirope || "";
  $("volAgua").value = lote.volAgua || "";

  $("pulso").value = lote.pulso ?? "0";
  $("media").value = lote.media ?? "0";
  $("djeba").value = lote.djeba ?? "0";
  $("litro").value = lote.litro ?? "0";
  $("galon").value = lote.galon ?? "0";

  $("notas").value = lote.notas || "";

  editingId = lote.id;
  $("save-btn").textContent = "Actualizar lote";
}

function renderTable() {
  const tbody = $("lotes-table").querySelector("tbody");
  tbody.innerHTML = "";
  const lotes = loadLotes();

  if (!lotes.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "No hay lotes registrados todavía.";
    cell.style.textAlign = "center";
    cell.style.padding = "0.8rem";
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  // Ordenar por el registro más reciente arriba.
  // Preferimos createdAt (o el timestamp incrustado en id) y caemos a fecha.
  const sorted = [...lotes].sort((a, b) => {
    const ta = getCreatedTimestamp(a);
    const tb = getCreatedTimestamp(b);
    if (ta !== tb) return tb - ta;

    // Tie-breakers: fecha desc, luego código asc
    const fa = toTimestamp(a?.fecha);
    const fb = toTimestamp(b?.fecha);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
    return (a.codigo || "").localeCompare(b.codigo || "");
  });

  for (const lote of sorted) {
    const tr = document.createElement("tr");

    const fields = [
      formatDate(lote.fecha),
      lote.codigo || "",
      lote.volTotal || "",
      lote.pulso ?? "",
      lote.media ?? "",
      lote.djeba ?? "",
      lote.litro ?? "",
      lote.galon ?? "",
      formatDate(lote.caducidad),
    ];

    fields.forEach((value, idx) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (idx === 8 && value) {
        // caducidad
        const today = new Date().toISOString().slice(0, 10);
        if (value < today) {
          td.innerHTML = `<span class="badge">Vencido</span>`;
        }
      }
      tr.appendChild(td);
    });

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.textContent = "Ver";
    viewBtn.className = "btn";
    viewBtn.addEventListener("click", () => {
      showLoteDetails(lote);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "Editar";
    editBtn.className = "btn secondary";
    editBtn.addEventListener("click", () => {
      populateForm(lote);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "Borrar";
    deleteBtn.className = "btn danger";
    deleteBtn.addEventListener("click", () => {
      if (!confirm(`¿Borrar el lote ${lote.codigo}?`)) return;
      const current = loadLotes().filter((l) => l.id !== lote.id);
      saveLotes(current);
      if (editingId === lote.id) {
        clearForm();
      }
      renderTable();
    });

    actionsTd.appendChild(viewBtn);
    actionsTd.appendChild(editBtn);
    actionsTd.appendChild(deleteBtn);
    tr.appendChild(actionsTd);

    tbody.appendChild(tr);
  }
}

function exportToCSV() {
  const lotes = loadLotes();
  if (!lotes.length) {
    alert("No hay lotes para exportar.");
    return;
  }

  if (typeof XLSX === "undefined") {
    alert("No se pudo generar el archivo de Excel (librería XLSX no cargada). Revisa tu conexión a internet.");
    return;
  }

  const headers = [
    "Fecha",
    "Código",
    "Volumen total",
    "Volumen vino",
    "Volumen vodka",
    "Volumen jugo",
    "Volumen sirope",
    "Volumen agua",
    "Pulso 250 ml",
    "Media 375 ml",
    "Djeba 750 ml",
    "Litro 1000 ml",
    "Galón 3800 ml",
    "Fecha caducidad",
    "Notas",
  ];

  const sorted = [...lotes].sort((a, b) => {
    const ta = getCreatedTimestamp(a);
    const tb = getCreatedTimestamp(b);
    if (ta !== tb) return tb - ta;

    const fa = toTimestamp(a?.fecha);
    const fb = toTimestamp(b?.fecha);
    if (Number.isFinite(fa) && Number.isFinite(fb) && fa !== fb) return fb - fa;
    return (a.codigo || "").localeCompare(b.codigo || "");
  });

  const rows = sorted.map((l) => [
    formatDate(l.fecha),
    l.codigo || "",
    l.volTotal || "",
    l.volVino || "",
    l.volVodka || "",
    l.volJugo || "",
    l.volSirope || "",
    l.volAgua || "",
    l.pulso ?? "",
    l.media ?? "",
    l.djeba ?? "",
    l.litro ?? "",
    l.galon ?? "",
    formatDate(l.caducidad),
    (l.notas || "").replace(/\r?\n/g, " "),
  ]);

  const aoa = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lotes");

  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `arcano33_lotes_${timestamp}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => console.error("SW error", err));
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // Inicializar fecha y caducidad
  const fechaInput = $("fecha");
  const cadInput = $("caducidad");

  const today = new Date().toISOString().slice(0, 10);
  fechaInput.value = today;
  cadInput.value = calculateCaducidad(today);

  fechaInput.addEventListener("change", () => {
    cadInput.value = calculateCaducidad(fechaInput.value);
  });

  $("lote-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const data = readFormData();
    if (!data) return;

    const lotes = loadLotes();
    const index = lotes.findIndex((l) => l.id === data.id);
    if (index >= 0) {
      lotes[index] = { ...lotes[index], ...data };
    } else {
      lotes.push(data);
    }
    saveLotes(lotes);
    renderTable();
    clearForm();
  });

  $("reset-btn").addEventListener("click", () => clearForm());
  $("export-btn").addEventListener("click", () => exportToCSV());

  $("clear-all-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todos los lotes registrados?")) return;
    localStorage.removeItem(STORAGE_KEY);
    clearForm();
    renderTable();
  });

  renderTable();
  registerServiceWorker();
});
