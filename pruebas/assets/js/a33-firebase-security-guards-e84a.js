/* Suite A33 — auditoría local de guardas E8.4A (sin activación). */
(function(g){
  'use strict';

  const PAGES = [
    ['produccion','/calculadora/index.html'], ['lotes','/lotes/index.html'], ['inventario','/inventario/index.html'],
    ['pos','/pos/index.html'], ['analitica','/analitica/index.html'], ['pedidos','/pedidos/index.html'],
    ['finanzas','/finanzas/index.html'], ['catalogos','/catalogos/index.html'], ['agenda','/agenda/index.html'],
    ['centro-mando','/centro-mando/index.html'], ['configuracion','/configuracion/index.html'], ['temporal','/calculadora_temporal/index.html']
  ];
  function validate(input){
    const source = input && typeof input === 'object' ? input : {};
    const preparation = source.preparation && typeof source.preparation === 'object' ? source.preparation : {};
    const pages = Array.isArray(source.pages) ? source.pages : [];
    const guardState = source.guardState && typeof source.guardState === 'object' ? source.guardState : {};
    const missing = pages.filter(function(page){ return !page.guardInstalled || !page.headerMatches; }).map(function(page){ return page.id; });
    const issues = [];
    if (preparation.stage !== 'E8.3' || preparation.readyForE84 !== true) issues.push('E8.3 no está confirmada para instalar guardas.');
    if (pages.length !== PAGES.length) issues.push('No se revisaron las 12 páginas canónicas.');
    if (missing.length) issues.push('Faltan guardas válidas en: ' + missing.join(', ') + '.');
    if (guardState.enforcementEnabled) issues.push('La compuerta se activó durante E8.4A.');
    return {
      stage:'E8.4A', preparationOnly:true, readOnly:true,
      pageCount:pages.length, installedCount:pages.length - missing.length, missing:missing,
      enforcementEnabled:!!guardState.enforcementEnabled, issues:issues, readyForE84B:issues.length === 0
    };
  }
  async function inspectPage(page){
    try{
      const response = await fetch(page[1], { cache:'no-store', credentials:'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      const guardInstalled = /a33-module-guard\.js\?v=4\.20\.98(?:&amp;|&)r=(?:1|2)/.test(html);
      return { id:page[0], path:page[1], guardInstalled:guardInstalled, headerMatches:html.includes('data-a33-module="' + page[0] + '"') };
    }catch(error){
      return { id:page[0], path:page[1], guardInstalled:false, headerMatches:false, error:String(error && error.message || error) };
    }
  }
  async function run(){
    const preparationApi = g.A33SecurityPreparationE83;
    if (!preparationApi || typeof preparationApi.run !== 'function') throw new Error('Primero debe estar disponible E8.3.');
    const preparation = await preparationApi.run();
    const pages = await Promise.all(PAGES.map(inspectPage));
    const guardState = g.A33ModuleGuard && typeof g.A33ModuleGuard.getState === 'function' ? g.A33ModuleGuard.getState() : { enforcementEnabled:false };
    return validate({ preparation:preparation, pages:pages, guardState:guardState });
  }
  g.A33SecurityGuardsE84A = Object.assign({}, g.A33SecurityGuardsE84A || {}, { validate:validate, run:run, pages:function(){ return PAGES.map(function(page){ return page.slice(); }); } });
})(typeof globalThis !== 'undefined' ? globalThis : window);
