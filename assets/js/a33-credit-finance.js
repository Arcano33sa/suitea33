/* Cobros POS -> Finanzas. Un asiento por pago y confirmación recuperable en POS. */
(function(global){
  'use strict';
  const SOURCE = 'POS_CREDIT_COLLECTION';
  const PULSE_KEY = 'a33_pos_credit_finance_pulse';
  let tail = Promise.resolve();
  const money = value=>Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  const text = value=>String(value ?? '').trim();
  const normalized = value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const code = account=>text(account && (account.code ?? account.codigo ?? account.accountCode));
  const accountName = account=>text(account && (account.nombre || account.name || account.label));
  const faId = account=>text(account && (account.id || account.uniqueKey));
  const isNio = value=>['','NIO','C$','CORDOBA','CÓRDOBA','CORDOBAS','CÓRDOBAS','PRIMARY','BASE'].includes(text(value).toUpperCase());
  function failure(message,errorCode){ const error = new Error(message); error.code = errorCode; return error; }
  function reversed(record){
    const status = text(record && (record.status || record.estado || record.movementStatus)).toUpperCase();
    return !!(record && (record.reversedAt || record.revertedAt || record.voidedAt || record.isReversed || record.reversed || record.voided || ['REVERSED','REVERTED','VOID','VOIDED','ANULADO','ANULADA'].includes(status)));
  }
  function paymentId(payment){
    return text(payment.creditPaymentId || payment.paymentId || payment.idPagoCredito || payment.movementId || payment.cashMovementId || payment.id)
      || JSON.stringify([payment.date || payment.dayKey || '',payment.ts || payment.collectedAt || '',money(payment.amount)]);
  }
  function key(saleId,payment){ return SOURCE + ':' + JSON.stringify(saleId) + ':' + paymentId(payment); }
  function candidates(sales,cashRows){
    const result = [];
    for (const sale of sales){
      if (!sale || sale.id == null) continue;
      const payments = new Map();
      for (const row of cashRows){
        for (const movement of (Array.isArray(row.movements) ? row.movements : [])){
          if (text(movement.creditSaleId ?? movement.ventaCreditoId) !== text(sale.id)) continue;
          const payment = {...movement,creditPaymentId:movement.creditPaymentId || movement.id,
            movementId:movement.id,date:movement.date || movement.dayKey || row.dayKey,
            method:movement.method || 'efectivo',source:'POS_EFECTIVO'};
          payments.set(paymentId(payment),payment);
        }
      }
      for (const payment of (Array.isArray(sale.creditPayments) ? sale.creditPayments : [])){
        if (!payment) continue;
        const previous = payments.get(paymentId(payment));
        payments.set(paymentId(payment),{...previous,...payment,isReversed:reversed(previous) || reversed(payment)});
      }
      for (const payment of payments.values()){
        if (reversed(payment) || !Number.isFinite(money(payment.amount)) || !(money(payment.amount) > 0)) continue;
        result.push({saleId:sale.id,sale,payment,key:key(sale.id,payment)});
      }
    }
    return result;
  }
  async function read(connection,names){
    const present = names.filter(name=>connection.objectStoreNames.contains(name));
    const result = Object.fromEntries(names.map(name=>[name,[]]));
    if (!present.length) return result;
    return await new Promise((resolve,reject)=>{
      const transaction = connection.transaction(present,'readonly');
      for (const name of present){
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = ()=>{ result[name] = request.result || []; };
      }
      transaction.oncomplete = ()=>resolve(result);
      transaction.onabort = ()=>reject(transaction.error || new Error('No se pudieron leer los datos de cobros.'));
      transaction.onerror = ()=>{};
    });
  }
  function postable(account,accounts){
    if (!account || account.active === false || account.isActive === false || account.estado === false || account.isPostable === false || account.postable === false) return false;
    if (account.isRoot || account.root || account.isGrouping || account.grouping || account.agrupadora || account.lockedForPosting || account.noPosting || account.blockPosting || account.postingLocked) return false;
    if (/agrup|group|root|raiz/.test(normalized(account.accountMode || account.mode || account.tipoCuenta))) return false;
    const hasChildren = accounts.some(child=>text(child.parentCode ?? child.parentId ?? child.parent ?? child.padreCodigo) === code(account));
    return !hasChildren || account.isPostable === true;
  }
  function destinations(data,method){
    const type = method === 'efectivo' ? 'caja' : 'banco';
    return data.financialAccounts.filter(item=>{
      if (!item || item.activa === false || item.active === false) return false;
      if (normalized(item.type || item.tipo) !== type || !isNio(item.moneda || item.financialAccountCurrency || 'NIO')) return false;
      const linked = data.accounts.find(account=>code(account) === text(item.cuentaContableCodigo || item.financialAccountAccountingCode));
      return postable(linked,data.accounts) && /activo|asset/.test(normalized(linked.tipo || linked.type || linked.rootType))
        && isNio(linked.currency || linked.moneda || linked.currencyCode || 'NIO')
        && !/usd|us\$|dolar/.test(normalized(accountName(linked)));
    });
  }
  function suggest(options,payment){
    if (payment.financialAccountId) return options.find(item=>faId(item) === text(payment.financialAccountId)) || null;
    const named = options.filter(item=>text(payment.account) && [item.nombreVisible,item.bancoNombreSnapshot,item.financialAccountNameSnapshot]
      .some(name=>name && normalized(name) === normalized(payment.account)));
    if (named.length === 1) return named[0];
    const bank = options.filter(item=>payment.bankId && text(item.bancoId) === text(payment.bankId));
    if (bank.length === 1) return bank[0];
    if ((payment.method || 'efectivo') === 'efectivo'){
      const wanted = payment.source === 'POS_EFECTIVO' || payment.affectsCash ? 'caja_eventos' : 'caja_general';
      const cash = options.filter(item=>item.cajaKey === wanted);
      if (cash.length === 1) return cash[0];
      if (options.some(item=>item.cajaKey)) return null;
    }
    return options.length === 1 ? options[0] : null;
  }
  async function context(finDb,method){
    const data = await read(finDb,['accounts','financialAccounts']);
    return {options:destinations(data,method),data};
  }
  async function stamp(posDb,candidate,patch){
    return await new Promise((resolve,reject)=>{
      const transaction = posDb.transaction(['sales','cashV2'],'readwrite');
      const store = transaction.objectStore('sales');
      let changed = false;
      let result;
      let reason;
      transaction.onabort = ()=>reject(reason || transaction.error || new Error('No se pudo confirmar el cobro en POS.'));
      transaction.onerror = ()=>{};
      transaction.oncomplete = ()=>resolve({changed,payment:result});
      const request = store.get(candidate.saleId);
      request.onsuccess = ()=>{
        const sale = request.result;
        if (!sale){ reason = new Error('La venta del cobro ya no existe.'); transaction.abort(); return; }
        const cash = transaction.objectStore('cashV2').getAll();
        cash.onsuccess = ()=>{
          try{
            const current = candidates([sale],cash.result || []).find(item=>item.key === candidate.key);
            if (!current){ reason = new Error('El cobro ya no está disponible para integrar.'); transaction.abort(); return; }
            if (money(current.payment.amount) !== money(candidate.payment.amount) || text(current.payment.date || current.payment.dayKey) !== text(candidate.payment.date || candidate.payment.dayKey)){
              reason = new Error('El cobro cambió. Revisa sus datos antes de integrarlo.'); transaction.abort(); return;
            }
            const payments = Array.isArray(sale.creditPayments) ? sale.creditPayments.slice() : [];
            const index = payments.findIndex(payment=>payment && key(sale.id,payment) === candidate.key);
            const original = index >= 0 ? payments[index] : current.payment;
            result = {...original,...patch};
            if (index >= 0 && JSON.stringify(result) === JSON.stringify(original)) return;
            result.financeUpdatedAt = Date.now();
            if (index >= 0) payments[index] = result; else payments.push(result);
            store.put({...sale,creditPayments:payments});
            changed = true;
          }catch(error){ reason = error; transaction.abort(); }
        };
      };
    });
  }
  async function post(finDb,candidate,selectedId,confirmDuplicate){
    const payment = candidate.payment;
    const amount = money(payment.amount);
    const date = text(payment.date || payment.dayKey).slice(0,10);
    const parsedDate = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10) !== date) throw failure('El cobro necesita una fecha válida para integrarse a Finanzas.','DATE_REQUIRED');
    if (!isNio(payment.currency || payment.moneda || 'NIO')) throw failure('Este cobro requiere revisar su moneda antes de integrarlo.','CURRENCY_REVIEW');
    if (!finDb.objectStoreNames.contains('financialAccounts')) throw failure('Abre Finanzas y configura las cuentas financieras de caja y banco.','ACCOUNT_REQUIRED');
    const names = ['accounts','financialAccounts','journalEntries','journalLines'];
    return await new Promise((resolve,reject)=>{
      const transaction = finDb.transaction(names,'readwrite');
      const data = {};
      let pending = names.length;
      let result;
      let reason;
      const abort = error=>{ reason = error; transaction.abort(); };
      transaction.oncomplete = ()=>resolve(result);
      transaction.onabort = ()=>reject(reason || transaction.error || new Error('No se pudo guardar el asiento del cobro.'));
      transaction.onerror = ()=>{};
      for (const name of names){
        const request = transaction.objectStore(name).getAll();
        request.onsuccess = ()=>{
          data[name] = request.result || [];
          if (--pending > 0) return;
          try{
            const existing = data.journalEntries.find(entry=>entry.source === SOURCE && entry.creditPaymentKey === candidate.key);
            if (existing){
              const lines = data.journalLines.filter(line=>String(line.entryId ?? line.idEntry) === String(existing.id));
              const debit = money(lines.reduce((sum,line)=>sum + Number(line.debe || 0),0));
              const credit = money(lines.reduce((sum,line)=>sum + Number(line.haber || 0),0));
              if (money(existing.originalAmount) !== amount || text(existing.fecha).slice(0,10) !== date || debit !== amount || credit !== amount || lines.length !== 2) throw failure('El asiento vinculado al cobro necesita revisión.','ENTRY_REVIEW');
              result = existing; return;
            }
            const method = payment.method || 'efectivo';
            if (!['efectivo','transferencia','tarjeta'].includes(method)) throw failure('El medio de pago de este cobro necesita revisión.','METHOD_REVIEW');
            const options = destinations(data,method);
            const destination = selectedId ? options.find(item=>faId(item) === text(selectedId)) : suggest(options,payment);
            if (!destination) throw failure('Selecciona una cuenta financiera de destino en córdobas para este cobro.','ACCOUNT_REQUIRED');
            const creditAccounts = data.accounts.filter(account=>postable(account,data.accounts)
              && /activo|asset/.test(normalized(account.tipo || account.type || account.rootType))
              && (code(account) === '1311' || /clientes|cobrar|receivable/.test(normalized(accountName(account))))
              && !/usd|us\$|dolar/.test(normalized(accountName(account)))
              && isNio(account.currency || account.moneda || account.currencyCode || 'NIO'));
            const receivable = creditAccounts.find(account=>code(account) === '1311') || (creditAccounts.length === 1 ? creditAccounts[0] : null);
            if (!receivable) throw failure('Configura una cuenta activa y posteable de clientes por cobrar C$ en Finanzas.','RECEIVABLE_REQUIRED');
            const destinationCode = text(destination.cuentaContableCodigo || destination.financialAccountAccountingCode);
            if (destinationCode === code(receivable)) throw failure('La cuenta de destino y la cuenta por cobrar deben ser diferentes.','ACCOUNT_REQUIRED');
            const possible = data.journalEntries.find(entry=>{
              if (entry.source === SOURCE || text(entry.fecha || entry.date).slice(0,10) !== date) return false;
              const lines = data.journalLines.filter(line=>String(line.entryId ?? line.idEntry) === String(entry.id));
              return lines.some(line=>text(line.accountCode) === code(receivable) && money(line.haber) === amount)
                && lines.some(line=>text(line.accountCode) === destinationCode && money(line.debe) === amount);
            });
            if (possible && !confirmDuplicate) throw failure('Ya existe un movimiento de la misma fecha, monto y cuentas. Revisa el Diario antes de crear otro asiento para este cobro.','POSSIBLE_DUPLICATE');
            const cash = method === 'efectivo';
            const snapshot = {
              financialAccountId:faId(destination),financialAccountNameSnapshot:text(destination.nombreVisible),
              financialAccountType:cash ? 'caja' : 'banco',financialAccountCurrency:'NIO',financialAccountSymbol:'C$',
              financialAccountAccountingCode:destinationCode,originalCurrency:'NIO',originalAmount:amount,
              baseCurrency:'NIO',baseAmountNio:amount,exchangeRateUsed:null
            };
            const entry = {...snapshot,source:SOURCE,entryType:'pos_credit_collection',origen:'POS',origenId:candidate.key,
              creditPaymentKey:candidate.key,creditPaymentId:paymentId(payment),creditSaleId:candidate.saleId,
              creditCustomerSnapshot:text(payment.customer || candidate.sale.customerName || candidate.sale.customer),
              creditAccountCode:code(receivable),fecha:date,date,reference:text(payment.reference || payment.description),
              descripcion:`Cobro de venta al crédito · ${text(payment.customer || candidate.sale.customerName || candidate.sale.customer)} · Venta #${candidate.sale.seqId || candidate.saleId}`,
              tipoMovimiento:'cobro',paymentMethod:cash ? 'cash' : 'bank',medio:cash ? 'caja' : 'banco',
              eventScope:'POS',posEventId:candidate.sale.eventId,eventId:candidate.sale.eventId,
              posEventNameSnapshot:text(candidate.sale.eventName),totalDebe:amount,totalHaber:amount,
              operationalClass:'CASH_IN',autoLabel:'Cobro de crédito',affectsUtility:false,affectsInventory:false,affectsIncome:false,
              isAutomatic:true,locked:true,createdAt:Date.now()};
            const add = transaction.objectStore('journalEntries').add(entry);
            add.onsuccess = ()=>{
              try{
                entry.id = add.result;
                const debit = {...snapshot,entryId:entry.id,idEntry:entry.id,accountCode:destinationCode,debe:amount,haber:0};
                const credit = {entryId:entry.id,idEntry:entry.id,accountCode:code(receivable),debe:0,haber:amount,
                  originalCurrency:'NIO',originalAmount:amount,baseCurrency:'NIO',baseAmountNio:amount};
                transaction.objectStore('journalLines').add(debit);
                transaction.objectStore('journalLines').add(credit);
                result = entry;
              }catch(error){ abort(error); }
            };
          }catch(error){ abort(error); }
        };
      }
    });
  }
  async function integrateOne(posDb,finDb,candidate,selectedId,confirmDuplicate){
    try{
      if (selectedId && candidate.payment.financeStatus !== 'POSTED'){
        const requested = await stamp(posDb,candidate,{financialAccountId:text(selectedId),financeStatus:'PENDING'});
        candidate = {...candidate,payment:requested.payment};
      }
      const entry = await post(finDb,candidate,selectedId,confirmDuplicate);
      const saved = await stamp(posDb,candidate,{financeStatus:'POSTED',financeEntryId:entry.id,
        financialAccountId:entry.financialAccountId,financialAccountNameSnapshot:entry.financialAccountNameSnapshot,
        financeDestinationCode:entry.financialAccountAccountingCode,financeCreditAccountCode:entry.creditAccountCode,
        financePostedAt:entry.createdAt,financeError:'',financeErrorCode:''});
      return {posted:true,changed:saved.changed,entryId:entry.id,payment:saved.payment};
    }catch(error){
      const saved = await stamp(posDb,candidate,{financeStatus:'PENDING',financeError:error.message,financeErrorCode:error.code || 'RETRY'});
      return {posted:false,changed:saved.changed,error:error.message,errorCode:error.code || 'RETRY',payment:saved.payment};
    }
  }
  function serialized(work){
    const run = ()=>global.navigator?.locks?.request ? global.navigator.locks.request('a33-pos-credit-finance',work) : work();
    const pending = tail.then(run,run);
    tail = pending.catch(()=>{});
    return pending;
  }
  function emit(){
    try{ global.localStorage.setItem(PULSE_KEY,JSON.stringify({ts:Date.now(),token:Math.random()})); }catch(_){ }
    try{ global.dispatchEvent(new CustomEvent('a33:credit-finance-updated')); }catch(_){ }
  }
  async function sync(options){
    return await serialized(async()=>{
      const {posDb,finDb,saleId,paymentKey,financialAccountId,confirmDuplicate} = options;
      const data = await read(posDb,['sales','cashV2','events']);
      const finance = await read(finDb,['journalEntries']);
      const posted = new Set(finance.journalEntries.filter(entry=>entry.source === SOURCE).map(entry=>entry.creditPaymentKey));
      const rows = candidates(data.sales,data.cashV2).filter(item=>(saleId == null || text(item.saleId) === text(saleId))
        && (!paymentKey || item.key === paymentKey));
      const results = [];
      for (const candidate of rows){
        const event = data.events.find(item=>text(item.id) === text(candidate.sale.eventId));
        candidate.sale = {...candidate.sale,eventName:candidate.sale.eventName || event?.name || `Evento #${candidate.sale.eventId}`};
        if (!paymentKey && candidate.payment.financeStatus === 'POSTED' && posted.has(candidate.key)) continue;
        results.push(await integrateOne(posDb,finDb,candidate,financialAccountId,confirmDuplicate));
      }
      if (results.some(result=>result.changed)) emit();
      return {results,posted:results.filter(result=>result.posted).length,pending:results.filter(result=>!result.posted).length};
    });
  }
  global.A33CreditFinance = Object.freeze({SOURCE,PULSE_KEY,key,candidates,context,suggest,sync});
})(window);
