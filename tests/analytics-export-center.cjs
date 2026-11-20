'use strict';
// Mantiene los asertos históricos de cálculo en Analítica y realiza las descargas
// en una segunda pestaña del centro real. No reintroduce botones en el módulo.
module.exports = async function useExportCenter(page, context, origin, errors) {
  const target = await context.newPage();
  target.setDefaultTimeout(15000);
  target.on('pageerror',error=>errors.push(error.message));
  await target.goto(origin+'/exportaciones/analitica.html');
  await target.waitForFunction(()=>!document.getElementById('module-export-fields').disabled);
  const locator = page.locator.bind(page);
  const click = page.click.bind(page);
  const waitForEvent = page.waitForEvent.bind(page);
  const exportSelector = selector => /#(?:analytics-export-|btn-export-(?:consolidado|eventos|presentaciones)|btn-cancel-export)/.test(selector);
  const actionSelector = selector => /^#btn-export-(?:consolidado|eventos|presentaciones)$/.test(selector);
  async function sync() {
    const state=await page.evaluate(()=>({
      period:document.getElementById('period-select').value,
      from:document.getElementById('date-from').value,to:document.getElementById('date-to').value,
      group:document.querySelector('#analytics-event-picker [data-group]').value,
      events:Array.from(document.querySelectorAll('#analytics-event-picker [data-options] input:checked'),input=>input.value),
      dormant:document.getElementById('clientes-dormidos-days')?.value
    }));
    await target.evaluate(async state=>{
      await A33AnalyticsExports.refresh();
      const period=document.getElementById('period-select');period.value=state.period;period.dispatchEvent(new Event('change'));
      for(const [id,value] of [['date-from',state.from],['date-to',state.to]]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('change'));}
      const group=document.querySelector('#analytics-event-picker [data-group]');group.value=state.group;group.dispatchEvent(new Event('change'));
      for(const input of document.querySelectorAll('#analytics-event-picker [data-options] input')){input.checked=state.events.includes(input.value);input.dispatchEvent(new Event('change'));}
      const dormant=document.getElementById('clientes-dormidos-days');if(dormant&&state.dormant){dormant.value=state.dormant;dormant.dispatchEvent(new Event('change'));}
    },state);
  }
  page.locator=(selector,...args)=>{
    if(!exportSelector(selector))return locator(selector,...args);
    const result=target.locator(selector,...args);
    if(actionSelector(selector)){
      const original=result.click.bind(result);
      result.click=async(...clickArgs)=>{await sync();return original(...clickArgs);};
    }
    return result;
  };
  page.click=async(selector,...args)=>{
    if(!exportSelector(selector))return click(selector,...args);
    if(actionSelector(selector))await sync();
    return target.click(selector,...args);
  };
  page.waitForEvent=(event,...args)=>event==='download'?target.waitForEvent(event,...args):waitForEvent(event,...args);
  return target;
};
