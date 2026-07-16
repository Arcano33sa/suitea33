// Suite A33 — lector defensivo centralizado de snapshots de costo por línea
(function (g) {
  'use strict';

  const EPS = 1e-9;

  function round2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function finite(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function firstNonZero(candidates) {
    let sawZero = false;
    for (const value of candidates) {
      const n = finite(value);
      if (n == null) continue;
      if (Math.abs(n) > EPS) return { found: true, value: round2(n) };
      sawZero = true;
    }
    return sawZero ? { found: true, value: 0 } : { found: false, value: 0 };
  }

  function effectiveQty(line) {
    const row = line && typeof line === 'object' ? line : {};
    const raw = finite(row.qty ?? row.quantity ?? row.cantidad ?? row.units ?? row.unidades);
    if (raw == null) return 0;
    if (row.isReturn === true || row.returned === true || row.devolucion === true) return -Math.abs(raw);
    return raw;
  }

  function directLineCostCandidates(row) {
    const snap = row && row.economicSnapshot && typeof row.economicSnapshot === 'object' ? row.economicSnapshot : {};
    const productSnap = row && row.productSnapshot && typeof row.productSnapshot === 'object' ? row.productSnapshot : {};
    return [
      row && row.lineCost,
      row && row.costTotal,
      row && row.costoTotal,
      row && row.totalCost,
      row && row.costoTotalSnapshot,
      row && row.lineCostSnapshot,
      snap.lineCost,
      snap.costTotal,
      snap.costoTotal,
      snap.totalCost,
      snap.costoTotalSnapshot,
      productSnap.lineCost,
      productSnap.costTotal,
      productSnap.costoTotal,
      productSnap.totalCost
    ];
  }

  function unitCostCandidates(row) {
    const snap = row && row.economicSnapshot && typeof row.economicSnapshot === 'object' ? row.economicSnapshot : {};
    const productSnap = row && row.productSnapshot && typeof row.productSnapshot === 'object' ? row.productSnapshot : {};
    return [
      row && row.costPerUnit,
      row && row.costUnitSnapshot,
      row && row.unitCostSnapshot,
      row && row.costoUnitarioSnapshot,
      row && row.costoUnitario,
      row && row.unitCost,
      row && row.costUnit,
      row && row.cost,
      snap.costPerUnit,
      snap.costUnitSnapshot,
      snap.unitCostSnapshot,
      snap.costoUnitarioSnapshot,
      snap.costoUnitario,
      snap.unitCost,
      productSnap.costPerUnit,
      productSnap.costUnitSnapshot,
      productSnap.unitCostSnapshot,
      productSnap.costoUnitarioSnapshot,
      productSnap.costoUnitario,
      productSnap.unitCost
    ];
  }

  function resolveLineCost(line) {
    const row = line && typeof line === 'object' ? line : {};

    // Un cero placeholder no debe bloquear un costo válido ubicado en otro campo.
    const direct = firstNonZero(directLineCostCandidates(row));
    if (direct.found && Math.abs(direct.value) > EPS) return direct.value;

    const unit = firstNonZero(unitCostCandidates(row));
    const qty = effectiveQty(row);
    if (unit.found && Math.abs(unit.value) > EPS && Number.isFinite(qty)) {
      return round2(unit.value * qty);
    }

    return 0;
  }

  function resolveUnitCost(line) {
    const row = line && typeof line === 'object' ? line : {};
    const unit = firstNonZero(unitCostCandidates(row));
    if (unit.found && Math.abs(unit.value) > EPS) return Math.abs(round2(unit.value));

    const qty = effectiveQty(row);
    if (Math.abs(qty) > EPS) {
      const direct = firstNonZero(directLineCostCandidates(row));
      if (direct.found && Math.abs(direct.value) > EPS) return Math.abs(round2(direct.value / qty));
    }

    return 0;
  }

  function isCourtesy(line) {
    return !!(line && (line.courtesy || line.isCourtesy || line.cortesia));
  }

  function resolveCourtesyValue(line) {
    const row = line && typeof line === 'object' ? line : {};
    const qty = Math.abs(effectiveQty(row));
    const unit = finite(row.unitPrice ?? row.price ?? row.precioUnitario ?? row.precio);
    if (!(qty > 0) || unit == null) return 0;
    const sign = effectiveQty(row) < 0 ? -1 : 1;
    return round2(sign * qty * unit);
  }

  const api = Object.freeze({
    round2,
    effectiveQty,
    resolveLineCost,
    resolveUnitCost,
    resolveCourtesyValue,
    isCourtesy
  });

  g.A33SaleCost = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this));
