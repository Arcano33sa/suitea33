// Simple storage using localStorage
const STORAGE_KEY = "arcano33_lotes";
const ARCHIVE_KEY = "arcano33_lotes_archived"; // Histórico (Etapa 5)

let editingId = null;

// Abreviaturas para compactar columnas (UI) sin tocar datos
const PROD_ABBR = {
  Pulso: "P",
  Media: "M",
  Djeba: "D",
  Litro: "L",
  "Galón": "G",
  Galon: "G",
};

// Etapa 2: Totales (RESTANTE) por presentación
const TOTAL_KEYS = ["P", "M", "D", "L", "G"];

function getCanonicalRemainingByKey(lote){
  // Fuente de verdad: lote.eventUsage[eventId].remainingByKey (o equivalente)
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  if (!eid) return null;
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  if (!eu) return null;
  const snap = eu[eid];
  if (!snap || typeof snap !== 'object') return null;
  const rbk = snap.remainingByKey;
  if (!rbk || typeof rbk !== 'object' || Array.isArray(rbk)) return null;
  return rbk;
}

function computeRemainingTotals(visibleLotes){
  const totals = { P: 0, M: 0, D: 0, L: 0, G: 0 };
  if (!Array.isArray(visibleLotes) || !visibleLotes.length) return totals;

  for (const lote of visibleLotes){
    const rbk = getCanonicalRemainingByKey(lote);
    if (!rbk) continue; // si no hay snapshot confiable, no aporta (no inventar)
    for (const k of TOTAL_KEYS){
      const v = Number(rbk[k]);
      if (Number.isFinite(v) && v >= 0) totals[k] += v;
    }
  }
  return totals;
}

function updateTotalsBarUI(totals){
  const bar = $("totals-bar");
  if (!bar) return;

  for (const k of TOTAL_KEYS){
    const el = bar.querySelector(`[data-total-key="${k}"]`);
    if (!el) continue;
    const n = Number(totals && totals[k]);
    const v = Number.isFinite(n) ? n : 0;
    el.textContent = String(v);
    el.classList.toggle('is-zero', v === 0);
  }
}

function abbrProducto(nombre) {
  if (!nombre) return "";
  return PROD_ABBR[nombre] || nombre.trim().charAt(0).toUpperCase();
}

function $(id) {
  return document.getElementById(id);
}

function loadLotes() {
  try {
    const raw = A33Storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.error("Error leyendo localStorage", e);
    return [];
  }
}

function loadArchivedLotes(){
  try {
    const raw = A33Storage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    console.error("Error leyendo histórico", e);
    return [];
  }
}

function saveArchivedLotes(data){
  A33Storage.setItem(ARCHIVE_KEY, JSON.stringify(data));
}

function saveLotes(data) {
  A33Storage.setItem(STORAGE_KEY, JSON.stringify(data));
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

function formatDateTime(value){
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('es-NI');
  } catch {
    return String(value);
  }
}

function buildArchiveSnapshot(lote, deletedAtIso){
  const deletedAt = deletedAtIso || new Date().toISOString();
  const createdAt = lote?.createdAt || (() => {
    const t = getCreatedTimestamp(lote);
    try { return new Date(t || Date.now()).toISOString(); } catch { return ""; }
  })();

  const st = effectiveLoteStatus(lote);
  const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
  const assignedEventId = lote?.assignedEventId != null ? String(lote.assignedEventId).trim() : "";
  const assignedEventName = (lote?.assignedEventName || "").toString().trim();

  // Guardar SOLO el snapshot del evento asignado si existe; si no, no inventar.
  let eventUsageSnap = null;
  if (assignedEventId && lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)){
    const snap = lote.eventUsage[assignedEventId];
    if (snap && typeof snap === 'object'){
      eventUsageSnap = { [assignedEventId]: snap };
    }
  }

  return {
    archiveId: `arch_${Date.now()}_${String(lote?.id || '')}`,
    originalId: lote?.id,
    codigo: (lote?.codigo || "").toString(),
    createdAt,
    deletedAt,
    statusAtDelete: st,
    semaforoAtDelete: sem,
    // "producto/presentación" => aquí guardamos presentaciones (unidades) + volTotal como resumen
    volTotal: lote?.volTotal ?? "",
    pulso: lote?.pulso ?? "0",
    media: lote?.media ?? "0",
    djeba: lote?.djeba ?? "0",
    litro: lote?.litro ?? "0",
    galon: lote?.galon ?? "0",
    assignedEventId: assignedEventId || null,
    assignedEventName: assignedEventName || "",
    eventUsage: eventUsageSnap,
  };
}

function archiveLote(lote, deletedAtIso){
  const snapshot = buildArchiveSnapshot(lote, deletedAtIso);
  const hist = loadArchivedLotes();
  hist.unshift(snapshot);
  saveArchivedLotes(hist);
  return snapshot;
}


// --- Estado/asignaci�n de lotes (compat: lotes viejos = DISPONIBLE)
function normLoteStatus(status){
  const s = (status || "").toString().trim().toUpperCase();
  if (!s) return "";
  if (s === "EN EVENTO") return "EN_EVENTO";
  if (s === "EN_EVENTO") return "EN_EVENTO";
  if (s === "DISPONIBLE") return "DISPONIBLE";
  if (s === "CERRADO") return "CERRADO";
  return s;
}

function effectiveLoteStatus(lote){
  const st = normLoteStatus(lote?.status);
  const assigned = lote?.assignedEventId != null && String(lote.assignedEventId).trim() !== "";
  if (st === "CERRADO") return "CERRADO";
  if (assigned) return "EN_EVENTO";
  if (st === "EN_EVENTO") return "EN_EVENTO";
  return "DISPONIBLE";
}

// Semáforo PARCIAL / VENDIDO (solo EN EVENTO)
// Fuente canónica: lote.eventUsage[eventId].remainingTotal
function getLoteSemaforoState(lote){
  // Conservador: si falta data, PARCIAL.
  const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
  if (!eid) return "PARCIAL";
  const eu = (lote && typeof lote.eventUsage === 'object' && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
  if (!eu) return "PARCIAL";
  const snap = eu[eid];
  if (!snap || typeof snap !== 'object') return "PARCIAL";
  const remainingTotal = Number(snap.remainingTotal);
  if (Number.isFinite(remainingTotal) && remainingTotal === 0) return "VENDIDO";
  return "PARCIAL";
}

function showLoteDetails(lote) {
  const lines = [];
  const st = effectiveLoteStatus(lote);
  lines.push(`Lote: ${lote.codigo || ""}`);
  lines.push(`Estado: ${st}`);

  const evName = (lote.assignedEventName || "").toString().trim();
  if (evName) lines.push(`Evento asignado: ${evName}`);

  if (lote.closedAt) {
    try {
      const d = new Date(lote.closedAt);
      lines.push(`Cerrado: ${Number.isNaN(d.getTime()) ? lote.closedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Cerrado: ${lote.closedAt}`);
    }
  }

  // Reverso de asignación (airbag anti-errores)
  if (lote.reversedAt) {
    try {
      const d = new Date(lote.reversedAt);
      lines.push(`Reversado: ${Number.isNaN(d.getTime()) ? lote.reversedAt : d.toLocaleString('es-NI')}`);
    } catch {
      lines.push(`Reversado: ${lote.reversedAt}`);
    }
    const rr = (lote.reversedReason || '').toString().trim();
    if (rr) lines.push(`Motivo: ${rr}`);
  }

  // Trazabilidad (lote hijo / sobrante)
  const parentId = (lote.parentLotId || "").toString().trim();
  if (parentId) {
    const all = loadLotes();
    const parent = all.find(l => l && String(l.id) === parentId) || null;
    const pcode = parent ? (parent.codigo || parent.name || parent.nombre || parentId) : parentId;
    lines.push(`Sobrante de: ${pcode}`);
  }
  const srcEv = (lote.sourceEventName || lote.sourceEventId || "").toString().trim();
  if (srcEv) lines.push(`Evento origen: ${srcEv}`);

  lines.push("");
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

  // Estado inicial (compatibilidad). Solo para lotes nuevos.
  if (!editingId){
    data.status = "DISPONIBLE";
    data.assignedEventId = null;
    data.assignedEventName = "";
    data.assignedAt = null;
  }

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
    // Etapa 2: siempre mostrar P/M/D/L/G (ceros atenuados por CSS)
    updateTotalsBarUI({ P: 0, M: 0, D: 0, L: 0, G: 0 });
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

  // Etapa 2: Totales (RESTANTE) sobre el listado visible (respetando orden/futuros filtros)
  // Fuente de verdad: lote.eventUsage[eventId].remainingByKey (si falta, ese lote no aporta)
  updateTotalsBarUI(computeRemainingTotals(sorted));

  const byId = new Map(sorted.map((l) => [String(l.id), l]));

  for (const lote of sorted) {
    const tr = document.createElement("tr");

    // Estado y snapshot canónico por evento (para doble línea: Creado + Parcial/restante)
    const st = effectiveLoteStatus(lote);
    const eid = (lote?.assignedEventId != null) ? String(lote.assignedEventId).trim() : "";
    const sem = st === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
    const eu = (lote && typeof lote.eventUsage === "object" && !Array.isArray(lote.eventUsage)) ? lote.eventUsage : null;
    const snap = (eu && eid) ? eu[eid] : null;
    const remainingByKey = (snap && typeof snap === "object" && snap.remainingByKey && typeof snap.remainingByKey === "object") ? snap.remainingByKey : null;
    const showRemainingLine = (st === "EN_EVENTO" && sem === "PARCIAL" && !!remainingByKey);

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

      // idx: 0 Fecha, 1 Código, 2 VolTotal, 3 Pulso, 4 Media, 5 Djeba, 6 Litro, 7 Galón, 8 Caducidad
      if (idx === 1) {
        td.classList.add("lote-codecell");

        const codeText = document.createElement("div");
        codeText.className = "lote-code-text";
        codeText.textContent = value;
        td.appendChild(codeText);

        const line = document.createElement("div");
        line.className = "lote-status-line";

        const stChip = document.createElement("span");
        stChip.className =
          "chip " +
          (st === "DISPONIBLE"
            ? "chip--available"
            : st === "EN_EVENTO"
            ? "chip--in-event"
            : "chip--closed");
        stChip.textContent = st === "EN_EVENTO" ? "EN EVENTO" : st;
        line.appendChild(stChip);

        // Semáforo de consumo por evento (Etapa 3 UI): PARCIAL / VENDIDO
        if (st === "EN_EVENTO") {
          // Cuando hay doble línea de cantidades, forzar que PARCIAL caiga en el renglón 2
          if (showRemainingLine) {
            const br = document.createElement("span");
            br.className = "chip-break";
            br.setAttribute("aria-hidden", "true");
            line.appendChild(br);
          }

          const semChip = document.createElement("span");
          semChip.className = "chip " + (sem === "VENDIDO" ? "chip--sold" : "chip--partial");
          semChip.textContent = sem;
          line.appendChild(semChip);
        }

        // Lote hijo / SOBRANTE (trazabilidad)
        const isChild = !!lote.parentLotId || String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE';
        if (isChild){
          const childChip = document.createElement('span');
          childChip.className = 'chip chip--child';
          childChip.textContent = String(lote.loteType || '').trim().toUpperCase() === 'SOBRANTE' ? 'SOBRANTE' : 'HIJO';
          line.appendChild(childChip);

          const pid = (lote.parentLotId || '').toString().trim();
          if (pid){
            const p = byId.get(pid) || null;
            const pcode = p ? (p.codigo || p.name || p.nombre || pid).toString() : pid;
            const parentChip = document.createElement('span');
            parentChip.className = 'chip chip--parent';
            parentChip.textContent = 'De: ' + pcode;
            parentChip.title = 'De: ' + pcode;
            line.appendChild(parentChip);
          }
        }

        if (st === "EN_EVENTO" || st === "CERRADO") {
          const evName = (lote.assignedEventName || "").toString().trim();
          if (evName) {
            const evChip = document.createElement("span");
            evChip.className = "chip chip--event";
            evChip.textContent = "Evento: " + evName;
            evChip.title = evName;
            line.appendChild(evChip);
          }
        }

        td.appendChild(line);
        tr.appendChild(td);
        return;
      }

      // Columnas de presentaciones: doble línea cuando el lote está PARCIAL y existe snapshot
      if (idx >= 3 && idx <= 7 && showRemainingLine) {
        const k = ["P", "M", "D", "L", "G"][idx - 3];
        const createdSpan = document.createElement("span");
        createdSpan.textContent = String(value ?? "");

        const remVal = (remainingByKey && Object.prototype.hasOwnProperty.call(remainingByKey, k))
          ? remainingByKey[k]
          : 0;
        const remainingSpan = document.createElement("span");
        remainingSpan.className = "qty-remaining";
        remainingSpan.textContent = String(remVal ?? "0");

        const stack = document.createElement("div");
        stack.className = "qty-stack";
        stack.appendChild(createdSpan);
        stack.appendChild(remainingSpan);

        td.appendChild(stack);
      } else {
        td.textContent = value;
      }

      // Compactar visualmente las columnas de productos (Pulso/Media/Djeba/Litro/Galón)
      if (idx >= 3 && idx <= 7) {
        td.classList.add("col-producto-abbr");
      }

      if (idx === 8 && value) {
        // caducidad
        const today = new Date().toISOString().slice(0, 10);
        if (value < today) {
          td.innerHTML = '<span class="badge">Vencido</span>';
        }
      }
      tr.appendChild(td);
    });

    const actionsTd = document.createElement("td");
    actionsTd.className = "actions-cell";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.textContent = "👁";
    viewBtn.title = "Ver";
    viewBtn.setAttribute("aria-label", "Ver");
    viewBtn.className = "btn icon";
    viewBtn.addEventListener("click", () => {
      showLoteDetails(lote);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "✎";
    editBtn.title = "Editar";
    editBtn.setAttribute("aria-label", "Editar");
    editBtn.className = "btn secondary icon";
    editBtn.addEventListener("click", () => {
      populateForm(lote);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "🗑";
    // Guardas de borrado según semáforo (Etapa 4):
    // - PARCIAL: confirmación fuerte (mensaje + validación por código)
    // - VENDIDO: confirmación normal
    const _stForDelete = effectiveLoteStatus(lote);
    const _semForDelete = _stForDelete === "EN_EVENTO" ? getLoteSemaforoState(lote) : "";
    deleteBtn.title = _semForDelete === "PARCIAL" ? "Borrar (confirmación fuerte)" : "Borrar";
    deleteBtn.setAttribute("aria-label", "Borrar");
    deleteBtn.className = "btn danger icon";
    deleteBtn.addEventListener("click", () => {
      const code = (lote.codigo || "").toString().trim();

      // PARCIAL: lote con remanente (o sin evidencia de soldout). Riesgo alto.
      if (_semForDelete === "PARCIAL") {
        const ok = confirm(
          `Este lote aún tiene remanente. No se recomienda borrar.\n\n` +
          `Si estás seguro, toca Aceptar para continuar.`
        );
        if (!ok) return;

        const typed = prompt(
          `Confirmación fuerte: escribe el CÓDIGO del lote para borrar:\n\n${code}`
        );
        if ((typed || "").toString().trim() !== code) {
          alert("Borrado cancelado: el código no coincide.");
          return;
        }
      } else {
        if (!confirm(`¿Borrar el lote ${code}?`)) return;
      }

      // Etapa 5: al borrar, archivar snapshot en Histórico antes de removerlo de activos
      const deletedAtIso = new Date().toISOString();
      try { archiveLote(lote, deletedAtIso); } catch (e){ console.warn('No se pudo archivar lote', e); }

      const current = loadLotes().filter((l) => l.id !== lote.id);
      saveLotes(current);
      if (editingId === lote.id) {
        clearForm();
      }
      renderTable();

      // Si el modal de histórico está abierto, refrescarlo
      if (isHistoryModalOpen()) {
        renderHistoryModal();
      }
    });

    // Wrapper para asegurar que las acciones no hagan overflow y queden en una sola línea
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "acciones";
    actionsWrap.appendChild(viewBtn);
    actionsWrap.appendChild(editBtn);
    actionsWrap.appendChild(deleteBtn);
    actionsTd.appendChild(actionsWrap);
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

// ================================
// Histórico (Etapa 5)
// ================================

function isHistoryModalOpen(){
  const m = $("history-modal");
  return !!(m && m.classList.contains('is-open'));
}

function openHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  renderHistoryModal();

  const inp = $("history-search");
  if (inp) {
    setTimeout(() => inp.focus(), 0);
  }
}

function closeHistoryModal(){
  const modal = $("history-modal");
  if (!modal) return;
  modal.classList.remove('is-open');
  modal.setAttribute('aria-hidden', 'true');
}

function archiveSortTs(a){
  const td = toTimestamp(a?.deletedAt);
  if (Number.isFinite(td)) return td;
  const tc = toTimestamp(a?.createdAt);
  if (Number.isFinite(tc)) return tc;
  // Fallback a ids/otros
  const id = (a?.archiveId || a?.originalId || "").toString();
  const m = id.match(/(\d{10,})/);
  return m ? Number(m[1]) : 0;
}

function makeChip(text, cls){
  const s = document.createElement('span');
  s.className = 'chip ' + (cls || '');
  s.textContent = text;
  return s;
}

function showArchivedDetails(arch){
  if (!arch) return;
  const lines = [];
  lines.push(`Código: ${(arch.codigo || '').toString()}`);
  if (arch.originalId) lines.push(`Lote ID: ${arch.originalId}`);
  if (arch.statusAtDelete) lines.push(`Estado al borrar: ${arch.statusAtDelete}${arch.semaforoAtDelete ? ' · ' + arch.semaforoAtDelete : ''}`);
  if (arch.assignedEventName) lines.push(`Evento: ${arch.assignedEventName}`);
  lines.push(`Creado: ${formatDate(arch.createdAt)}${arch.createdAt ? ' (' + formatDateTime(arch.createdAt) + ')' : ''}`);
  lines.push(`Archivado: ${formatDate(arch.deletedAt)}${arch.deletedAt ? ' (' + formatDateTime(arch.deletedAt) + ')' : ''}`);
  lines.push('');
  lines.push('Presentaciones (unidades):');
  lines.push(`  Pulso 250 ml: ${arch.pulso ?? '0'}`);
  lines.push(`  Media 375 ml: ${arch.media ?? '0'}`);
  lines.push(`  Djeba 750 ml: ${arch.djeba ?? '0'}`);
  lines.push(`  Litro 1000 ml: ${arch.litro ?? '0'}`);
  lines.push(`  Galón 3800 ml: ${arch.galon ?? '0'}`);
  if (arch.volTotal != null && String(arch.volTotal).trim() !== '') {
    lines.push(`\nVolumen total (ml): ${arch.volTotal}`);
  }

  // eventUsage (si existe)
  const eu = arch.eventUsage && typeof arch.eventUsage === 'object' && !Array.isArray(arch.eventUsage) ? arch.eventUsage : null;
  const keys = eu ? Object.keys(eu) : [];
  if (keys.length){
    const k = keys[0];
    const snap = eu[k];
    if (snap && typeof snap === 'object'){
      lines.push('');
      lines.push('Uso por evento (snapshot):');
      if (snap.remainingTotal != null) lines.push(`  RemainingTotal: ${snap.remainingTotal}`);
      if (snap.remainingByProduct) {
        try {
          lines.push(`  RemainingByProduct: ${JSON.stringify(snap.remainingByProduct)}`);
        } catch {}
      }
    }
  }

  alert(lines.join('\n'));
}

function renderHistoryModal(){
  const listEl = $("history-list");
  const metaEl = $("history-meta");
  const inp = $("history-search");
  if (!listEl || !metaEl) return;

  const all = loadArchivedLotes();
  const q = (inp ? inp.value : '').toString().trim().toLowerCase();

  const sorted = [...all].sort((a,b) => archiveSortTs(b) - archiveSortTs(a));
  const filtered = q ? sorted.filter(r => (r.codigo || '').toString().toLowerCase().includes(q)) : sorted;

  metaEl.textContent = q
    ? `Mostrando ${filtered.length} de ${sorted.length} (filtro: "${(inp.value || '').toString().trim()}")`
    : `Total archivados: ${sorted.length}`;

  listEl.innerHTML = '';
  if (!filtered.length){
    const empty = document.createElement('div');
    empty.style.padding = '0.6rem 0.2rem';
    empty.style.color = 'var(--color-text-muted)';
    empty.style.fontSize = '0.82rem';
    empty.textContent = q ? 'Sin resultados.' : 'Aún no hay lotes archivados.';
    listEl.appendChild(empty);
    return;
  }

  for (const arch of filtered){
    const item = document.createElement('div');
    item.className = 'history-item';

    const main = document.createElement('div');
    main.className = 'history-main';

    const code = document.createElement('div');
    code.className = 'history-code';
    code.textContent = (arch.codigo || '').toString();

    const meta = document.createElement('div');
    meta.className = 'history-meta-line';

    // Estado / semáforo
    const st = (arch.statusAtDelete || '').toString().trim().toUpperCase();
    if (st){
      const cls = st === 'DISPONIBLE' ? 'chip--available' : st === 'EN_EVENTO' ? 'chip--in-event' : 'chip--closed';
      meta.appendChild(makeChip(st === 'EN_EVENTO' ? 'EN EVENTO' : st, cls));
    }
    const sem = (arch.semaforoAtDelete || '').toString().trim().toUpperCase();
    if (sem && st === 'EN_EVENTO'){
      meta.appendChild(makeChip(sem, sem === 'VENDIDO' ? 'chip--sold' : 'chip--partial'));
    }

    // Presentaciones (compactas)
    const p = Number(arch.pulso ?? 0);
    const m = Number(arch.media ?? 0);
    const d = Number(arch.djeba ?? 0);
    const l = Number(arch.litro ?? 0);
    const g = Number(arch.galon ?? 0);
    if ([p,m,d,l,g].some(n => Number.isFinite(n) && n > 0)){
      if (p > 0) meta.appendChild(makeChip(`P:${p}`, ''));
      if (m > 0) meta.appendChild(makeChip(`M:${m}`, ''));
      if (d > 0) meta.appendChild(makeChip(`D:${d}`, ''));
      if (l > 0) meta.appendChild(makeChip(`L:${l}`, ''));
      if (g > 0) meta.appendChild(makeChip(`G:${g}`, ''));
    }

    // Fechas
    const dates = document.createElement('span');
    dates.textContent = `Creado ${formatDate(arch.createdAt)} · Archivado ${formatDate(arch.deletedAt)}`;
    meta.appendChild(dates);

    // Evento (si existe)
    const ev = (arch.assignedEventName || '').toString().trim();
    if (ev){
      const evSpan = document.createElement('span');
      evSpan.textContent = `Evento: ${ev}`;
      meta.appendChild(evSpan);
    }

    main.appendChild(code);
    main.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'btn secondary icon';
    viewBtn.title = 'Ver';
    viewBtn.setAttribute('aria-label', 'Ver');
    viewBtn.textContent = '👁';
    viewBtn.addEventListener('click', () => showArchivedDetails(arch));

    actions.appendChild(viewBtn);

    item.appendChild(main);
    item.appendChild(actions);

    listEl.appendChild(item);
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

  // Histórico (Etapa 5)
  const histBtn = $("history-btn");
  if (histBtn) histBtn.addEventListener('click', () => openHistoryModal());

  const histClose = $("history-close-btn");
  if (histClose) histClose.addEventListener('click', () => closeHistoryModal());

  const histModal = $("history-modal");
  if (histModal) {
    histModal.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-modal-close') === '1') {
        closeHistoryModal();
      }
    });
  }

  const histSearch = $("history-search");
  if (histSearch) {
    histSearch.addEventListener('input', () => renderHistoryModal());
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isHistoryModalOpen()) {
      closeHistoryModal();
    }
  });

  $("clear-all-btn").addEventListener("click", () => {
    if (!confirm("¿Borrar todos los lotes registrados?")) return;
    A33Storage.removeItem(STORAGE_KEY);
    clearForm();
    renderTable();
  });

  renderTable();
  registerServiceWorker();
});
