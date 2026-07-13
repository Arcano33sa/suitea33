// A33 Presentations helper (suite-wide)
// Compatibilidad de etiquetas históricas. Nunca crea productos ni sustituye el nombre actual de Catálogos.
(function(){
  'use strict';

  function norm(s){
    return (s||'').toString().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  }

  function normKey(s){
    return norm(s).replace(/\s+/g,'');
  }

  const EXACT_LEGACY = Object.freeze({
    'pulso250ml':'pulso',
    'media375ml':'media',
    'djeba750ml':'djeba',
    'litro1000ml':'litro',
    'galon3720ml':'galon',
    'galon3750ml':'galon',
    'galon3800ml':'galon'
  });

  function presentationIdFromName(name){
    const key = normKey(name);
    return EXACT_LEGACY[key] || null;
  }

  function labelFromId(id){
    if (id === 'pulso') return 'Pulso 250 ml';
    if (id === 'media') return 'Media 375 ml';
    if (id === 'djeba') return 'Djeba 750 ml';
    if (id === 'litro') return 'Litro 1000 ml';
    if (id === 'galon') return 'Galón 3720 ml';
    return String(id || '');
  }

  function canonicalizeProductName(name){
    const raw = String(name || '');
    const id = presentationIdFromName(raw);
    // Solo corrige alias históricos exactos. Nombres libres del catálogo permanecen intactos.
    return id ? labelFromId(id) : raw;
  }

  function canonicalizeText(text){
    let s = String(text || '');
    s = s.replace(/Gal[oó]n\s*3800\s*ml/gi, 'Galón 3720 ml');
    s = s.replace(/Gal[oó]n\s*3750\s*ml/gi, 'Galón 3720 ml');
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
    GALON_ML: 3720
  };
})();
