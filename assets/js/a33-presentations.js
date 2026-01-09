// A33 Presentations helper (suite-wide)
// Canonicaliza nombres/IDs de presentaciones para compatibilidad legacy (Galón 3800 -> 3750)
(function(){
  'use strict';

  function norm(s){
    return (s||'')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'')
      .toLowerCase()
      .trim();
  }

  // Normalizador para comparar nombres (ignora espacios)
  function normKey(s){
    return norm(s).replace(/\s+/g,'');
  }

  function presentationIdFromName(name){
    const n = norm(name);
    if (!n) return null;
    if (n.includes('pulso')) return 'pulso';
    if (n.includes('media')) return 'media';
    if (n.includes('djeba')) return 'djeba';
    if (n.includes('litro')) return 'litro';
    if (n.includes('gal')) return 'galon';
    return null;
  }

  function labelFromId(id){
    if (id === 'pulso') return 'Pulso 250 ml';
    if (id === 'media') return 'Media 375 ml';
    if (id === 'djeba') return 'Djeba 750 ml';
    if (id === 'litro') return 'Litro 1000 ml';
    if (id === 'galon') return 'Galón 3750 ml';
    return String(id || '');
  }

  function canonicalizeProductName(name){
    const pid = presentationIdFromName(name);
    if (!pid) return String(name || '');
    return labelFromId(pid);
  }

  function canonicalizeText(text){
    let s = String(text || '');
    // Reemplazos específicos del galón (no tocar números sueltos)
    s = s.replace(/Gal[oó]n\s*3800\s*ml/gi, 'Galón 3750 ml');
    s = s.replace(/Gal[oó]n\s*3800ml/gi, 'Galón 3750 ml');
    s = s.replace(/Gal[oó]n\s*3750ml/gi, 'Galón 3750 ml');
    // Normalizar doble espacios
    s = s.replace(/\s{2,}/g, ' ');
    return s;
  }

  window.A33Presentations = {
    norm,
    normKey,
    presentationIdFromName,
    labelFromId,
    canonicalizeProductName,
    canonicalizeText,
    GALON_ML: 3750
  };
})();
