import asyncio, json, traceback
from pathlib import Path
from playwright.async_api import async_playwright

URL='http://127.0.0.1:8765/pos/index.html?v=4.20.99&r=34'
OUT=Path('/mnt/data/work_suitea33_lotes_etapa1/suitea33/tests/results')
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    def mark(name, detail=None):
        print('STEP', name, detail if detail is not None else '', flush=True)
    results={"url":URL,"steps":[],"console":[],"page_errors":[]}
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context=await browser.new_context(viewport={"width":1366,"height":900})
        page=await context.new_page()
        page.set_default_timeout(12000)
        page.on('console', lambda msg: results['console'].append({"type":msg.type,"text":msg.text}))
        page.on('pageerror', lambda err: results['page_errors'].append(str(err)))
        page.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
        await page.goto(URL, wait_until='domcontentloaded')
        await page.wait_for_function("typeof openDB === 'function' && typeof importFromLoteToInventory === 'function'")
        await page.wait_for_timeout(1000)
        seed=await page.evaluate("""async()=>{
          await resetPosFreshReadDBPOS();
          const conn = await openDB();
          const names = ['inventory','products','events','meta','sales','reempaques'];
          const transaction = conn.transaction(names, 'readwrite');
          for (const name of names) transaction.objectStore(name).clear();
          transaction.objectStore('products').put({id:1, productId:'prod-p', name:'Pulso 250 ml', receta:true, letra:'P', active:true, manageStock:true, price:120});
          transaction.objectStore('products').put({id:2, productId:'prod-m', name:'Media 375 ml', receta:true, letra:'M', active:true, manageStock:true, price:150});
          transaction.objectStore('events').put({id:1, name:'Evento Prueba Lotes', createdAt:new Date().toISOString(), closedAt:null});
          transaction.objectStore('meta').put({id:'currentEventId', value:1});
          await new Promise((resolve,reject)=>{ transaction.oncomplete=resolve; transaction.onabort=()=>reject(transaction.error||new Error('seed abort')); transaction.onerror=()=>{}; });
          await resetPosFreshReadDBPOS();
          const lot = {
            id:'lot-success', codigo:'LOT-TEST-001', createdAt:new Date().toISOString(), status:'DISPONIBLE', notas:'Prueba real navegador',
            disponibilidadPOS:[
              {productId:'prod-p', Letra:'P', nombreSnapshot:'Pulso 250 ml', cantidadDisponible:4},
              {productId:'prod-m', Letra:'M', nombreSnapshot:'Media 375 ml', cantidadDisponible:3}
            ]
          };
          if (!writeLotesLS_POS([lot])) throw new Error('No se pudo sembrar lote');
          await refreshEventUI();
          setTab('inventario');
          const sel=document.getElementById('inv-event'); sel.value='1';
          const render=await renderInventario();
          return {count:Number(document.getElementById('lotes-count').textContent||0), rows:render.lotesModel.rows.length};
        }""")
        assert seed['count']==0 and seed['rows']==0, seed
        results['steps'].append({"step":"seed","ok":True,"detail":seed})
        mark('seed')

        await page.click('#btn-inv-from-lote')
        await page.wait_for_function("document.getElementById('inv-lote-selector-modal').style.display === 'flex'")
        buttons=page.locator('#inv-lote-selector-table tbody button:not([disabled])')
        assert await buttons.count()==1, await buttons.count()
        await buttons.first.click()
        await page.wait_for_function("document.getElementById('lotes-count').textContent === '1'")
        await page.wait_for_function("readLotesLS_POS().some(x => x && x.id === 'lot-success' && String(x.assignedEventId) === '1')")
        success=await page.evaluate("""async()=>{
          const stores=await readPosStoresFreshPOS(['inventory']);
          const rows=(stores.inventory||[]).filter(x=>x && x.source==='lote' && x.loteId==='lot-success');
          const cargaIds=[...new Set(rows.map(x=>x.loteCargaId))];
          const lot=readLotesLS_POS().find(x=>x.id==='lot-success');
          const model=await renderLotesCargadosEvento(1,{forceRender:true});
          return {
            inventoryCount:rows.length,
            cargaIds,
            types:rows.map(x=>x.type),
            products:rows.map(x=>({productId:x.productId,loteProductId:x.loteProductId,loteLetra:x.loteLetra,qty:x.qty,source:x.source,time:x.time})),
            assignedEventId:lot && lot.assignedEventId,
            assignmentHistory:(lot && lot.assignmentHistory||[]).length,
            modelRows:model.rows.length,
            countText:document.getElementById('lotes-count').textContent,
            visibleRows:document.querySelectorAll('#tbl-lotes-evento tbody tr[data-lote-group-key]').length,
            groupKey:model.rows[0] && model.rows[0].groupKey
          };
        }""")
        assert success['inventoryCount']==2, success
        assert len(success['cargaIds'])==1 and success['cargaIds'][0], success
        assert success['types']==['restock','restock'], success
        assert success['assignedEventId']==1 and success['assignmentHistory']==1, success
        assert success['modelRows']==1 and success['countText']=='1' and success['visibleRows']==1, success
        results['steps'].append({"step":"ui_success_transaction_readback","ok":True,"detail":success})
        mark('ui_success_transaction_readback')

        # Salir y volver
        await page.evaluate("closeModalPOS('inv-lote-selector-modal')")
        await page.click('button[data-tab="venta"]')
        await page.click('button[data-tab="inventario"]')
        await page.wait_for_function("document.getElementById('lotes-count').textContent === '1'")
        results['steps'].append({"step":"leave_and_return","ok":True})
        mark('leave_and_return')

        # Recarga
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function("typeof renderInventario === 'function'")
        await page.wait_for_function("document.getElementById('lotes-count').textContent === '1'", timeout=15000)
        results['steps'].append({"step":"reload_persistence","ok":True})
        mark('reload_persistence')

        # Cerrar y abrir página dentro del mismo perfil
        await page.close()
        page=await context.new_page()
        page.set_default_timeout(12000)
        page.on('console', lambda msg: results['console'].append({"type":msg.type,"text":msg.text}))
        page.on('pageerror', lambda err: results['page_errors'].append(str(err)))
        page.on('dialog', lambda dialog: asyncio.create_task(dialog.accept()))
        await page.goto(URL, wait_until='domcontentloaded')
        await page.wait_for_function("document.getElementById('lotes-count').textContent === '1'", timeout=15000)
        results['steps'].append({"step":"close_open_persistence","ok":True})
        mark('close_open_persistence')

        # Esperar SW y probar offline
        try:
            await page.evaluate("navigator.serviceWorker && navigator.serviceWorker.ready ? navigator.serviceWorker.ready.then(()=>true) : true")
            await page.wait_for_timeout(700)
            await context.set_offline(True)
            await page.reload(wait_until='domcontentloaded', timeout=20000)
            await page.wait_for_function("document.getElementById('lotes-count').textContent === '1'", timeout=15000)
            offline_detail=await page.evaluate("({online:navigator.onLine,count:document.getElementById('lotes-count').textContent})")
            assert offline_detail['online'] is False and offline_detail['count']=='1', offline_detail
            results['steps'].append({"step":"offline_persistence","ok":True,"detail":offline_detail})
            mark('offline_persistence')
        finally:
            await context.set_offline(False)

        # Segunda carga: simular falla real en el segundo put de inventory.
        await page.reload(wait_until='domcontentloaded')
        await page.wait_for_function("typeof importFromLoteToInventory === 'function'")
        failure=await page.evaluate("""async()=>{
          const lots=readLotesLS_POS();
          lots.push({
            id:'lot-fail', codigo:'LOT-FAIL-002', createdAt:new Date().toISOString(), status:'DISPONIBLE', notas:'Prueba abort',
            disponibilidadPOS:[
              {productId:'prod-p', Letra:'P', nombreSnapshot:'Pulso 250 ml', cantidadDisponible:2},
              {productId:'prod-m', Letra:'M', nombreSnapshot:'Media 375 ml', cantidadDisponible:1}
            ]
          });
          if (!writeLotesLS_POS(lots)) throw new Error('No se pudo agregar lote de falla');
          const beforeStores=await readPosStoresFreshPOS(['inventory']);
          const beforeCount=(beforeStores.inventory||[]).length;
          const beforeLoaded=(await renderLotesCargadosEvento(1,{forceRender:true})).rows.length;
          const originalPut=IDBObjectStore.prototype.put;
          let inventoryPuts=0;
          IDBObjectStore.prototype.put=function(value, key){
            if (this && this.name==='inventory'){
              inventoryPuts += 1;
              if (inventoryPuts===2) throw new DOMException('Falla controlada de prueba', 'DataError');
            }
            return arguments.length>1 ? originalPut.call(this,value,key) : originalPut.call(this,value);
          };
          let result;
          try{
            result=await importFromLoteToInventory({evId:1,loteId:'lot-fail',loteCodigo:'LOT-FAIL-002'});
          }finally{
            IDBObjectStore.prototype.put=originalPut;
          }
          await resetPosFreshReadDBPOS();
          const afterStores=await readPosStoresFreshPOS(['inventory']);
          const afterCount=(afterStores.inventory||[]).length;
          const failRows=(afterStores.inventory||[]).filter(x=>x && x.loteId==='lot-fail');
          const lot=readLotesLS_POS().find(x=>x.id==='lot-fail');
          const afterLoaded=(await renderLotesCargadosEvento(1,{forceRender:true})).rows.length;
          return {
            result:{ok:result.ok,reason:result.reason,rolledBack:result.rolledBack},
            inventoryPuts,
            beforeCount,afterCount,failRows:failRows.length,
            assignedEventId:lot && lot.assignedEventId,
            assignmentHistory:(lot && lot.assignmentHistory||[]).length,
            status:lot && lot.status,
            beforeLoaded,afterLoaded,
            countText:document.getElementById('lotes-count').textContent
          };
        }""")
        assert failure['result']['ok'] is False, failure
        assert failure['beforeCount']==failure['afterCount'] and failure['failRows']==0, failure
        assert failure['assignedEventId'] in (None,'') and failure['assignmentHistory']==0 and failure['status']=='DISPONIBLE', failure
        assert failure['beforeLoaded']==failure['afterLoaded']==1 and failure['countText']=='1', failure
        results['steps'].append({"step":"controlled_write_failure_abort","ok":True,"detail":failure})
        mark('controlled_write_failure_abort')

        # Reempaque/adjust no debe aparecer como lote cargado.
        reempaque=await page.evaluate("""async()=>{
          const conn=await openDB();
          const transaction=conn.transaction(['inventory'],'readwrite');
          transaction.objectStore('inventory').put({eventId:1,productId:1,type:'adjust',qty:-1,source:'reempaque',reempaqueRole:'origen',time:new Date().toISOString(),notes:'Prueba regresión'});
          await new Promise((resolve,reject)=>{transaction.oncomplete=resolve;transaction.onabort=()=>reject(transaction.error);transaction.onerror=()=>{};});
          await resetPosFreshReadDBPOS();
          const model=await renderLotesCargadosEvento(1,{forceRender:true});
          return {rows:model.rows.length,count:document.getElementById('lotes-count').textContent};
        }""")
        assert reempaque['rows']==1 and reempaque['count']=='1', reempaque
        results['steps'].append({"step":"reempaque_adjust_excluded","ok":True,"detail":reempaque})
        mark('reempaque_adjust_excluded')

        # Responsive y temas: sin scroll horizontal general; tabla conserva scroll interno.
        responsive=[]
        for width,height,label in [(1366,900,'desktop'),(1024,768,'ipad_landscape'),(768,1024,'ipad_portrait'),(390,844,'mobile')]:
            await page.set_viewport_size({"width":width,"height":height})
            for theme in ('dark','light'):
                detail=await page.evaluate("""async ({theme})=>{
                  document.documentElement.setAttribute('data-theme', theme);
                  closeModalPOS('inv-lote-selector-modal');
                  setTab('inventario');
                  setLotesEventoExpandedPOS(true);
                  await renderLotesCargadosEvento(1,{forceRender:true});
                  const root=document.documentElement;
                  const table=document.querySelector('.lotes-table-scroll');
                  return {
                    viewport:window.innerWidth,
                    rootScrollWidth:root.scrollWidth,
                    bodyScrollWidth:document.body.scrollWidth,
                    tableClientWidth:table ? table.clientWidth : 0,
                    tableScrollWidth:table ? table.scrollWidth : 0,
                    count:document.getElementById('lotes-count').textContent,
                    theme:document.documentElement.getAttribute('data-theme')
                  };
                }""", {"theme":theme})
                assert detail['rootScrollWidth'] <= detail['viewport'] + 1, (label,detail)
                assert detail['tableClientWidth'] > 0 and detail['tableScrollWidth'] >= detail['tableClientWidth'], (label,detail)
                assert detail['count']=='1' and detail['theme']==theme, (label,detail)
                responsive.append({"label":label,"theme":theme,**detail})
        results['steps'].append({"step":"responsive_themes_no_global_overflow","ok":True,"detail":responsive})
        mark('responsive_themes_no_global_overflow')

        # Validaciones finales
        important=[x['text'] for x in results['console'] if '[POS][Lotes]' in x['text']]
        results['important_console']=important
        assert any('transaction.oncomplete confirmado' in x for x in important), important
        assert any('[READBACK] confirmado' in x for x in important), important
        assert any('[RENDER] lote visible' in x for x in important), important
        unexpected=[e for e in results['page_errors'] if 'Falla controlada' not in e]
        results['unexpected_page_errors']=unexpected
        # La falla controlada se captura por el flujo; no debe tumbar la página.
        assert not unexpected, unexpected
        await browser.close()
    results['ok']=True
    (OUT/'a33-pos-lotes-etapa1-browser.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
    print(json.dumps({"ok":True,"steps":results['steps'],"important_console":results['important_console']},ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        print('BROWSER TEST FAILED:',repr(exc))
        traceback.print_exc()
        raise
