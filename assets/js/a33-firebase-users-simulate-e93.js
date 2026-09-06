/* Suite A33 — simulación local del panel administrativo E9.3. */
(function(g){
  'use strict';
  const ROLES = ['admin', 'ventas', 'finanzas', 'consulta'];
  const STATUSES = ['active', 'inactive'];
  function clean(value, max){ return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 180); }
  function normalizeUser(item){ const s=item&&typeof item==='object'?item:{}; return {uid:clean(s.uid||s.id,160),workspaceId:clean(s.workspaceId,80),name:clean(s.name,80),email:clean(s.email,120).toLowerCase(),role:clean(s.role,30),status:clean(s.status,30)}; }
  function activeAdminCount(users){ return users.filter(function(user){ return user.role==='admin'&&user.status==='active'; }).length; }
  function simulate(input, context){
    const request=input&&typeof input==='object'?input:{}; const state=context&&typeof context==='object'?context:{};
    const access=state.access&&typeof state.access==='object'?state.access:{}; const users=(Array.isArray(state.users)?state.users:[]).map(normalizeUser);
    const operation=clean(request.operation,30); const target=normalizeUser(request.user); const existing=target.uid?users.find(function(user){return user.uid===target.uid;}):null; const issues=[];
    if(!access.user||!access.profile||access.role!=='admin'||access.profile.status!=='active'||!access.isAdmin) issues.push('La simulación requiere una sesión Admin activa.');
    if(access.workspaceId!=='arcano33') issues.push('El workspace debe ser arcano33.');
    if(access.managementReady!==false) issues.push('La administración real debe permanecer desactivada.');
    if(!['create','update','toggle','delete'].includes(operation)) issues.push('Operación de simulación no válida.');
    if(target.workspaceId!==access.workspaceId) issues.push('El destino no coincide con el workspace activo.');
    if(operation!=='create'&&(!existing||existing.workspaceId!==access.workspaceId)) issues.push('El usuario simulado no pertenece al workspace.');
    if(operation==='create'||operation==='update'){
      if(target.name.length<2) issues.push('El nombre debe tener al menos 2 caracteres.');
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target.email)) issues.push('El correo no tiene un formato válido.');
      if(!ROLES.includes(target.role)) issues.push('El rol no es válido.');
      if(!STATUSES.includes(target.status)) issues.push('El estado no es válido.');
      if(users.some(function(user){return user.email===target.email&&user.uid!==target.uid;})) issues.push('El correo ya existe en los perfiles visibles.');
    }
    const selfTarget=!!(existing&&access.user&&existing.uid===access.user.uid);
    const removesAdmin=!!(existing&&existing.role==='admin'&&existing.status==='active'&&(operation==='delete'||operation==='toggle'||(operation==='update'&&(target.role!=='admin'||target.status!=='active'))));
    if(selfTarget&&removesAdmin) issues.push('El Admin actual no puede quitarse su propia recuperación.');
    if(removesAdmin&&activeAdminCount(users)<=1) issues.push('La operación dejaría el workspace sin un Admin activo.');
    const proposedTarget=Object.assign({},target,operation==='toggle'&&existing?{status:existing.status==='active'?'inactive':'active'}:{});
    return {stage:'E9.3',simulation:true,readOnly:true,writes:0,callableInvoked:false,operation:operation,workspaceId:String(access.workspaceId||''),target:proposedTarget,existing:!!existing,issueCount:issues.length,issues:issues,approved:issues.length===0};
  }
  function runMatrix(input){
    const source=input&&typeof input==='object'?input:{}; const access=source.access&&typeof source.access==='object'?source.access:{}; const master=normalizeUser(source.master||{});
    const users=[master,{uid:'e93-member',workspaceId:'arcano33',name:'Usuario de prueba',email:'e93@example.invalid',role:'consulta',status:'active'}]; const context={access:access,users:users};
    const cases=[simulate({operation:'create',user:{workspaceId:'arcano33',name:'Nueva prueba',email:'nueva@example.invalid',role:'ventas',status:'active'}},context),simulate({operation:'update',user:Object.assign({},master,{name:'Admin actualizado'})},context),simulate({operation:'toggle',user:users[1]},context),simulate({operation:'delete',user:users[1]},context),simulate({operation:'delete',user:master},context)];
    const expected=[true,true,true,true,false]; const controlsPassed=cases.filter(function(result,index){return result.approved===expected[index]&&result.writes===0&&result.callableInvoked===false;}).length;
    return {stage:'E9.3',simulation:true,readOnly:true,writes:0,caseCount:cases.length,controlsPassed:controlsPassed,cases:cases,completed:controlsPassed===cases.length};
  }
  async function run(){
    if(!g.A33Access||typeof g.A33Access.refresh!=='function'||typeof g.A33Access.listUsers!=='function') throw new Error('No está disponible el acceso canónico.');
    const access=await g.A33Access.refresh(); const users=await g.A33Access.listUsers(); const master=(Array.isArray(users)?users:[]).find(function(user){return user&&user.uid===access.user?.uid;})||access.profile||{};
    return runMatrix({access:access,master:master});
  }
  g.A33UsersSimulationE93=Object.assign({},g.A33UsersSimulationE93||{},{simulate:simulate,runMatrix:runMatrix,run:run});
})(typeof globalThis!=='undefined'?globalThis:window);
