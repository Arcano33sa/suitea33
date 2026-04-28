
    // --- Home libre de acceso ---
    function hideBootSplash(){}

    function showApp(){
      const shell = document.getElementById('app-shell');
      if (shell) shell.style.display = 'block';
    }

    async function initHomeUi(){
      showApp();
    }

    // --- Respaldo local (Exportar / Importar) ---
    const BACKUP_APP_NAME = 'Suite A33';
    const SUITE_LS_PREFIXES = ['arcano33_', 'a33_', 'suite_a33_']; 

    function isSuiteLocalStorageKey(key){
      if (!key) return false;
      return SUITE_LS_PREFIXES.some(p => key.startsWith(p));
    }

    function isSuiteDbName(name){
      if (!name) return false;
      if (name === 'finanzasDB') return true;
      const n = String(name).toLowerCase();
      return n.includes('a33') || n.includes('arcano') || n.includes('finanzas');
    }

    function isRetiredGateStorageKey(key){
      try{
        if (window.A33Storage && typeof A33Storage.isRetiredGateKey === 'function'){
          return !!A33Storage.isRetiredGateKey(key);
        }
      }catch(_){ }
      const s = String(key || '').toLowerCase().trim();
      if (!s) return false;
      const retiredTags = [
        ['au','th'],
        ['log','in'],
        ['un','lock'],
        ['ses','sion'],
        ['pro','file'],
        ['per','fil'],
        ['last','url'],
        ['p','in'],
        ['ac','ceso'],
        ['ac','cess']
      ].map(parts => parts.join(''));
      const exact = new Set([
        ['suite_a33_', ['au','th'].join(''), '_v1'].join(''),
        ['suite_a33_', ['pro','file'].join(''), '_v1'].join(''),
        ['suite_a33_', ['ses','sion'].join(''), '_v1'].join(''),
        ['suite_a33_', ['p','in'].join('')].join(''),
        ['suite_a33_exec_', ['un','lock'].join(''), '_v1'].join(''),
        ['suite_a33_last_url_v1'].join('')
      ]);
      if (exact.has(s)) return true;
      const prefixed = SUITE_LS_PREFIXES.some(p => s.startsWith(String(p || '').toLowerCase()));
      if (!prefixed) return false;
      return retiredTags.some(tag => {
        if (!tag) return false;
        if (tag === 'lasturl') return /(?:^|[_-])last[_-]?url(?:[_-]|$)/.test(s);
        const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
        return rx.test(s);
      });
    }

    function isRetiredGateDbName(name){
      try{
        if (window.A33Storage && typeof A33Storage.isRetiredGateDbName === 'function'){
          return !!A33Storage.isRetiredGateDbName(name);
        }
      }catch(_){ }
      const s = String(name || '').toLowerCase().trim();
      if (!s) return false;
      const looksSuite = s.includes('a33') || s.includes('arcano') || s.includes('suite');
      if (!looksSuite) return false;
      const retiredTags = [
        ['au','th'],
        ['log','in'],
        ['un','lock'],
        ['ses','sion'],
        ['pro','file'],
        ['p','in'],
        ['ac','ceso'],
        ['ac','cess']
      ].map(parts => parts.join(''));
      return retiredTags.some(tag => {
        const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
        return rx.test(s);
      });
    }

    function isRetiredGateStoreName(name){
      const s = String(name || '').toLowerCase().trim();
      if (!s) return false;
      const retiredTags = [
        ['au','th'],
        ['log','in'],
        ['un','lock'],
        ['ses','sion'],
        ['pro','file'],
        ['p','in'],
        ['ac','ceso'],
        ['ac','cess']
      ].map(parts => parts.join(''));
      return retiredTags.some(tag => {
        const rx = new RegExp('(?:^|[_-])' + tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[_-]|$)');
        return rx.test(s);
      });
    }

    function sanitizeSuiteLocalStorageMap(mapLike){
      const src = (mapLike && typeof mapLike === 'object') ? mapLike : {};
      const out = {};
      for (const [k, v] of Object.entries(src)){
        if (!isSuiteLocalStorageKey(k)) continue;
        if (isRetiredGateStorageKey(k)) continue;
        out[k] = v;
      }
      return out;
    }

    function sanitizeIndexedDbPayload(indexedMap, dbSchemas, dbVersions){
      const src = (indexedMap && typeof indexedMap === 'object') ? indexedMap : {};
      const cleanData = {};
      const cleanSchemas = {};
      const cleanVersions = {};
      for (const [dbName, stores] of Object.entries(src)){
        if (!isSuiteDbName(dbName)) continue;
        if (isRetiredGateDbName(dbName)) continue;

        const safeStores = {};
        const storeEntries = (stores && typeof stores === 'object') ? Object.entries(stores) : [];
        for (const [storeName, records] of storeEntries){
          if (isRetiredGateStoreName(storeName)) continue;
          safeStores[storeName] = Array.isArray(records) ? records : [];
        }
        cleanData[dbName] = safeStores;

        const srcSchemaDb = (dbSchemas && typeof dbSchemas === 'object' && dbSchemas[dbName] && typeof dbSchemas[dbName] === 'object')
          ? dbSchemas[dbName]
          : {};
        const safeSchemaDb = {};
        for (const [storeName, schema] of Object.entries(srcSchemaDb)){
          if (isRetiredGateStoreName(storeName)) continue;
          safeSchemaDb[storeName] = schema;
        }
        cleanSchemas[dbName] = safeSchemaDb;

        if (dbVersions && Object.prototype.hasOwnProperty.call(dbVersions, dbName)){
          cleanVersions[dbName] = dbVersions[dbName];
        }
      }
      return { data: cleanData, schemas: cleanSchemas, versions: cleanVersions };
    }

    function sanitizeBackupObject(obj){
      const src = (obj && typeof obj === 'object') ? obj : {};
      const meta = (src.meta && typeof src.meta === 'object') ? src.meta : {};
      const data = (src.data && typeof src.data === 'object') ? src.data : {};
      const cleanIndexed = sanitizeIndexedDbPayload(data.indexedDB || {}, meta.dbSchemas || {}, meta.dbVersions || {});
      return {
        meta: {
          ...meta,
          dbSchemas: cleanIndexed.schemas,
          dbVersions: cleanIndexed.versions
        },
        data: {
          indexedDB: cleanIndexed.data,
          localStorage: sanitizeSuiteLocalStorageMap(data.localStorage || {})
        }
      };
    }

    function escapeHtml(str){
      return String(str ?? '')
        .replaceAll('&','&amp;')
        .replaceAll('<','&lt;')
        .replaceAll('>','&gt;')
        .replaceAll('"','&quot;')
        .replaceAll("'","&#039;");
    }

    function formatBytes(bytes){
      const b = Number(bytes || 0);
      if (!Number.isFinite(b) || b <= 0) return '0 B';
      const units = ['B','KB','MB','GB'];
      let v = b;
      let i = 0;
      while (v >= 1024 && i < units.length - 1){
        v = v / 1024;
        i++;
      }
      return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
    }

    function reqToPromise(req){
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB request error'));
      });
    }

    function txDone(tx){
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(true);
        tx.onabort = () => reject(tx.error || new Error('Transacción abortada'));
        tx.onerror = () => reject(tx.error || new Error('Error en transacción'));
      });
    }

    async function safeListIndexedDBDatabases(){
      if (indexedDB.databases){
        try{
          const list = await indexedDB.databases();
          if (Array.isArray(list)) return list.filter(d => d && d.name);
        }catch(e){}
      }
      // Fallback (navegadores sin indexedDB.databases)
      return [
        { name: 'a33-pos' },
        { name: 'finanzasDB' }
      ];
    }

    function openExistingDB(dbName){
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName);
        // Si no existe, esto intentaría crearlo: abortamos para NO mutar el navegador al solo "leer"
        req.onupgradeneeded = (e) => {
          try{ e.target.transaction.abort(); }catch(_){}
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error(`No se pudo abrir la base de datos: ${dbName}`));
      });
    }

    async function getAllFromStore(store){
      if (store.getAll){
        return await reqToPromise(store.getAll());
      }
      // Fallback cursor
      return await new Promise((resolve, reject) => {
        const out = [];
        const req = store.openCursor();
        req.onerror = () => reject(req.error || new Error('Error leyendo cursor'));
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor){
            out.push(cursor.value);
            cursor.continue();
          } else {
            resolve(out);
          }
        };
      });
    }

    async function snapshotDatabase(dbName){
      const db = await openExistingDB(dbName);
      const snapshot = {
        name: dbName,
        version: db.version,
        stores: {}
      };

      const storeNames = Array.from(db.objectStoreNames || []);
      for (const storeName of storeNames){
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);

        const schema = {
          keyPath: store.keyPath ?? null,
          autoIncrement: !!store.autoIncrement,
          indices: []
        };

        try{
          const indexNames = Array.from(store.indexNames || []);
          for (const idxName of indexNames){
            const idx = store.index(idxName);
            schema.indices.push({
              name: idxName,
              keyPath: idx.keyPath ?? null,
              unique: !!idx.unique,
              multiEntry: !!idx.multiEntry
            });
          }
        }catch(_){}

        const records = await getAllFromStore(store);
        await txDone(tx);

        snapshot.stores[storeName] = {
          count: Array.isArray(records) ? records.length : 0,
          schema,
          records: Array.isArray(records) ? records : []
        };
      }

      try{ db.close(); }catch(_){}
      return snapshot;
    }

    function getSuiteLocalStorageSnapshot(){
      const out = {};
      const keys = [];
      const allKeys = A33Storage.keys({ scope: 'local' });
      for (const k of allKeys){
        if (!k) continue;
        if (!isSuiteLocalStorageKey(k)) continue;
        if (isRetiredGateStorageKey(k)) continue;
        keys.push(k);
        out[k] = A33Storage.getItem(k);
      }
      keys.sort();
      return { data: out, keys, count: keys.length };
    }

    function buildSummaryHtmlFromSnapshot({ dbSnapshots, lsKeys, exportedAt, estimatedBytes, warnings, appName }){
      const totalDbRecords = dbSnapshots.reduce((acc, d) => {
        const stores = Object.values(d.stores || {});
        return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
      }, 0);

      const dbHtml = dbSnapshots.length
        ? dbSnapshots.map(d => {
            const stores = Object.entries(d.stores || {});
            const storeLines = stores.length
              ? `<ul>${stores.map(([sn, s]) => `<li><b>${escapeHtml(sn)}</b>: ${Number(s.count)||0}</li>`).join('')}</ul>`
              : `<div class="muted">Sin stores detectados.</div>`;
            return `
              <div style="margin-top:0.35rem;">
                <div><b>${escapeHtml(d.name)}</b> <span class="muted">(versión ${escapeHtml(d.version)})</span></div>
                ${storeLines}
              </div>
            `;
          }).join('')
        : `<div class="muted">No se detectaron bases de datos de la Suite en este navegador.</div>`;

      const warnHtml = (warnings && warnings.length)
        ? `<div class="badge-warn">⚠️ ${escapeHtml(warnings.join(' · '))}</div>`
        : '';

      const lsDetails = lsKeys && lsKeys.length
        ? `<details><summary>Ver keys (${lsKeys.length})</summary><ul>${lsKeys.map(k => `<li>${escapeHtml(k)}</li>`).join('')}</ul></details>`
        : `<div class="muted">0 keys</div>`;

      const exportedAtPretty = exportedAt ? new Date(exportedAt).toLocaleString() : '';

      return `
        <div>
          <div class="kv">
            <div class="k">App</div><div class="v">${escapeHtml(appName || BACKUP_APP_NAME)}</div>
            <div class="k">Fecha</div><div class="v">${escapeHtml(exportedAtPretty)}</div>
            <div class="k">Registros</div><div class="v">${totalDbRecords}</div>
            <div class="k">Keys localStorage</div><div class="v">${lsKeys ? lsKeys.length : 0}</div>
            <div class="k">Tamaño aprox.</div><div class="v">${escapeHtml(formatBytes(estimatedBytes || 0))}</div>
          </div>

          ${warnHtml}

          <hr>

          <div><b>IndexedDB</b></div>
          ${dbHtml}

          <hr>

          <div><b>localStorage (Suite)</b></div>
          ${lsDetails}

          <div class="small-note">Nota: este respaldo es local (no sincroniza). Al importar, se reemplaza TODO lo de este navegador.</div>
        </div>
      `;
    }

    const CONFIG_USERS_ROLES_STORAGE_KEY = 'a33_configuracion_usuarios_roles_ui_v1';
    const CONFIG_USERS_ROLES_STORAGE_VERSION = 2;
    const CONFIG_ROLE_OPTIONS = ['ADMIN', 'MIEMBRO'];
    const CONFIG_USER_STATUS_OPTIONS = ['Activo', 'Invitado', 'Pendiente'];
    const CONFIG_USERS_ROLES_SEED = [
      {
        id: 'usr_admin_001',
        name: 'Administrador General',
        email: 'admin@arcano33.local',
        role: 'ADMIN',
        status: 'Activo',
        scope: 'Suite completa',
        notes: 'Perfil visual para administración general. No concede seguridad real en esta etapa.',
        lastSeen: 'Hoy · 08:15'
      },
      {
        id: 'usr_member_002',
        name: 'Operación Eventos',
        email: 'eventos@arcano33.local',
        role: 'MIEMBRO',
        status: 'Activo',
        scope: 'POS y Agenda',
        notes: 'Perfil pensado para flujo de ventas y eventos.',
        lastSeen: 'Hoy · 06:40'
      },
      {
        id: 'usr_member_003',
        name: 'Inventario Central',
        email: 'inventario@arcano33.local',
        role: 'MIEMBRO',
        status: 'Invitado',
        scope: 'Inventario y Lotes',
        notes: 'Perfil listo para futuras asignaciones de módulos.',
        lastSeen: 'Aún sin acceso'
      }
    ];
    let configurationUsersRolesUI = null;

    function cloneUsersRolesSeed(){
      return CONFIG_USERS_ROLES_SEED.map((user) => ({ ...user }));
    }

    function getUsersRolesNowIso(){
      return new Date().toISOString();
    }

    function normalizeUsersRolesEmail(email = ''){
      return String(email || '').trim().toLowerCase();
    }

    function buildUsersRolesState({ users = [], panel = 'overview', selectedId = null, lastUpdatedAt, source = 'local' } = {}){
      const safeUsers = Array.isArray(users) ? users : [];
      const safeSelectedId = safeUsers.some(user => user.id === selectedId) ? selectedId : (safeUsers[0]?.id || null);
      const safePanel = ['overview', 'add', 'edit', 'assign-role', 'delete'].includes(panel) ? panel : 'overview';
      return {
        version: CONFIG_USERS_ROLES_STORAGE_VERSION,
        users: safeUsers,
        panel: safePanel,
        selectedId: safeSelectedId,
        lastUpdatedAt: lastUpdatedAt || getUsersRolesNowIso(),
        source: source || 'local'
      };
    }

    function createDefaultUsersRolesUI(){
      return buildUsersRolesState({
        users: cloneUsersRolesSeed(),
        panel: 'overview',
        selectedId: 'usr_admin_001',
        source: 'seed'
      });
    }

    function createEmptyUsersRolesUI(){
      return buildUsersRolesState({
        users: [],
        panel: 'add',
        selectedId: null,
        source: 'local'
      });
    }

    function sanitizeUsersRolesUser(raw = {}, fallbackId = ''){
      const role = CONFIG_ROLE_OPTIONS.includes(raw.role) ? raw.role : 'MIEMBRO';
      const status = CONFIG_USER_STATUS_OPTIONS.includes(raw.status) ? raw.status : 'Pendiente';
      return {
        id: String(raw.id || fallbackId || `usr_${Date.now()}`),
        name: String(raw.name || '').trim() || 'Usuario sin nombre',
        email: normalizeUsersRolesEmail(raw.email || 'sin-correo@arcano33.local') || 'sin-correo@arcano33.local',
        role,
        status,
        scope: String(raw.scope || '').trim() || 'Sin definir',
        notes: String(raw.notes || '').trim(),
        lastSeen: String(raw.lastSeen || '').trim() || 'Aún sin acceso'
      };
    }

    function generateUsersRolesUserId(){
      return `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function formatUsersRolesTimestamp(iso){
      if (!iso) return 'Sin cambios registrados';
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return 'Sin cambios registrados';
      return date.toLocaleString();
    }

    function getUsersRolesStorageMeta(users = [], lastUpdatedAt = '', source = 'local'){
      const total = users.length;
      const adminCount = users.filter(user => user.role === 'ADMIN').length;
      const memberCount = users.filter(user => user.role === 'MIEMBRO').length;
      return {
        total,
        adminCount,
        memberCount,
        lastUpdatedLabel: formatUsersRolesTimestamp(lastUpdatedAt),
        sourceLabel: source === 'seed' ? 'Ejemplo inicial' : 'Persistencia local activa'
      };
    }

    function loadUsersRolesUI(){
      try{
        const raw = A33Storage.getItem(CONFIG_USERS_ROLES_STORAGE_KEY);
        if (!raw) return createDefaultUsersRolesUI();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.users)) return createDefaultUsersRolesUI();
        const users = parsed.users.map((user, index) => sanitizeUsersRolesUser(user, `usr_recovered_${index + 1}`));
        return buildUsersRolesState({
          users,
          selectedId: parsed.selectedId,
          panel: parsed.panel,
          lastUpdatedAt: parsed.lastUpdatedAt,
          source: parsed.source || 'local'
        });
      }catch(_){
        return createDefaultUsersRolesUI();
      }
    }

    function persistUsersRolesUI(){
      if (!configurationUsersRolesUI) return;
      try{
        const state = buildUsersRolesState(configurationUsersRolesUI);
        configurationUsersRolesUI = state;
        A33Storage.setItem(CONFIG_USERS_ROLES_STORAGE_KEY, JSON.stringify(state));
      }catch(_){ }
    }

    function getUsersRolesUI(){
      if (!configurationUsersRolesUI){
        configurationUsersRolesUI = loadUsersRolesUI();
      }
      if (!configurationUsersRolesUI || !Array.isArray(configurationUsersRolesUI.users)){
        configurationUsersRolesUI = createDefaultUsersRolesUI();
      }
      configurationUsersRolesUI = buildUsersRolesState(configurationUsersRolesUI);
      return configurationUsersRolesUI;
    }

    function setUsersRolesUI(patch = {}){
      const current = getUsersRolesUI();
      configurationUsersRolesUI = buildUsersRolesState({
        ...current,
        ...patch,
        users: Array.isArray(patch.users) ? patch.users : current.users,
        lastUpdatedAt: patch.lastUpdatedAt || getUsersRolesNowIso(),
        source: patch.source || 'local'
      });
      persistUsersRolesUI();
      return configurationUsersRolesUI;
    }

    function getSelectedUsersRolesUser(){
      const state = getUsersRolesUI();
      return state.users.find((user) => user.id === state.selectedId) || null;
    }

    function validateUsersRolesPayload(payload, users = [], mode = 'add', currentUserId = ''){
      const name = String(payload?.name || '').trim();
      const email = normalizeUsersRolesEmail(payload?.email || '');
      if (!name) return 'Escribe un nombre para este usuario.';
      if (!email) return 'Escribe un correo para este usuario.';
      if (!email.includes('@') || email.startsWith('@') || email.endsWith('@')) return 'El correo no tiene un formato válido.';
      const duplicate = users.find((user) => normalizeUsersRolesEmail(user.email) === email && (mode === 'add' || user.id !== currentUserId));
      if (duplicate) return 'Ya existe un usuario local con ese correo.';
      return '';
    }

    function buildUsersRolesSummaryCards(users = [], lastUpdatedAt = '', source = 'local'){
      const meta = getUsersRolesStorageMeta(users, lastUpdatedAt, source);
      return `
        <div class="roles-summary-grid">
          <article class="roles-summary-card">
            <span class="roles-summary-value">${meta.total}</span>
            <span class="roles-summary-label">Usuarios locales</span>
          </article>
          <article class="roles-summary-card">
            <span class="roles-summary-value">${meta.adminCount}</span>
            <span class="roles-summary-label">Rol ADMIN</span>
          </article>
          <article class="roles-summary-card">
            <span class="roles-summary-value">${meta.memberCount}</span>
            <span class="roles-summary-label">Rol MIEMBRO</span>
          </article>
          <article class="roles-summary-card">
            <span class="roles-summary-value">Local</span>
            <span class="roles-summary-label">Persistencia</span>
            <span class="roles-summary-note">${escapeHtml(meta.sourceLabel)} · ${escapeHtml(meta.lastUpdatedLabel)}</span>
          </article>
        </div>
      `;
    }

    function buildUsersRolesList(users = [], selectedId = ''){
      if (!users.length){
        return `
          <div class="roles-empty">
            <b>No hay usuarios locales todavía.</b>
            <div class="roles-inline-note">Ya puedes empezar limpio: crea el primero o restaura el ejemplo visual cuando te convenga.</div>
            <div class="config-section-actions" style="margin-top:0.75rem;">
              <button type="button" class="config-inline-btn" data-ur-panel="add">Crear primer usuario</button>
              <button type="button" class="config-inline-btn secondary" data-ur-reset-demo="1">Restaurar ejemplo</button>
            </div>
          </div>
        `;
      }
      return `
        <div class="users-list">
          ${users.map((user) => {
            const roleClass = (user.role || '').toLowerCase();
            const isActive = user.id === selectedId;
            return `
              <article class="user-card${isActive ? ' active' : ''}">
                <div class="user-card-top">
                  <div class="user-identity">
                    <h4>${escapeHtml(user.name)}</h4>
                    <span>${escapeHtml(user.email)}</span>
                  </div>
                  <div class="user-badges">
                    <span class="user-role-badge ${escapeHtml(roleClass)}">${escapeHtml(user.role)}</span>
                    <span class="user-status-pill">${escapeHtml(user.status)}</span>
                  </div>
                </div>
                <div class="user-card-grid">
                  <div class="user-meta">
                    <span class="user-meta-label">Alcance UX</span>
                    <span class="user-meta-value">${escapeHtml(user.scope)}</span>
                  </div>
                  <div class="user-meta">
                    <span class="user-meta-label">Último acceso visible</span>
                    <span class="user-meta-value">${escapeHtml(user.lastSeen)}</span>
                  </div>
                  <div class="user-meta">
                    <span class="user-meta-label">Notas</span>
                    <span class="user-meta-value">${escapeHtml(user.notes || 'Sin notas')}</span>
                  </div>
                  <div class="user-meta">
                    <span class="user-meta-label">Flujo disponible</span>
                    <span class="user-meta-value">Agregar · Editar · Borrar · Asignar rol</span>
                  </div>
                </div>
                <div class="user-card-actions">
                  <button type="button" class="config-inline-btn secondary" data-ur-panel="overview" data-ur-user-id="${escapeHtml(user.id)}">Ver ficha</button>
                  <button type="button" class="config-inline-btn secondary" data-ur-panel="edit" data-ur-user-id="${escapeHtml(user.id)}">Editar</button>
                  <button type="button" class="config-inline-btn secondary" data-ur-panel="assign-role" data-ur-user-id="${escapeHtml(user.id)}">Asignar rol</button>
                  <button type="button" class="config-inline-btn secondary" data-ur-panel="delete" data-ur-user-id="${escapeHtml(user.id)}">Borrar</button>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      `;
    }

    function buildUsersRolesWorkbench(){
      const state = getUsersRolesUI();
      const selectedUser = getSelectedUsersRolesUser();
      const selectedName = selectedUser ? escapeHtml(selectedUser.name) : 'usuario';
      const selectedRole = selectedUser ? escapeHtml(selectedUser.role) : 'MIEMBRO';
      if (state.panel === 'add'){
        return `
          <section class="roles-workbench-card">
            <div class="roles-workbench-header">
              <div>
                <div class="config-section-kicker">CRUD provisional</div>
                <h4>Agregar usuario</h4>
              </div>
              <div class="config-chip">UI local</div>
            </div>
            <p class="roles-workbench-copy">Alta provisional/local para amarrar el flujo antes de Firebase. Se guarda en este navegador y nada más.</p>
            <form class="roles-form-grid" data-ur-form="add">
              <div class="roles-form-grid two">
                <div class="roles-field">
                  <label for="ur-add-name">Nombre</label>
                  <input id="ur-add-name" name="name" type="text" placeholder="Nombre del usuario" required>
                </div>
                <div class="roles-field">
                  <label for="ur-add-email">Correo</label>
                  <input id="ur-add-email" name="email" type="email" placeholder="correo@arcano33.local" required>
                </div>
              </div>
              <div class="roles-form-grid two">
                <div class="roles-field">
                  <label for="ur-add-role">Rol inicial</label>
                  <select id="ur-add-role" name="role">
                    ${CONFIG_ROLE_OPTIONS.map(role => `<option value="${role}">${role}</option>`).join('')}
                  </select>
                </div>
                <div class="roles-field">
                  <label for="ur-add-status">Estado visual</label>
                  <select id="ur-add-status" name="status">
                    ${CONFIG_USER_STATUS_OPTIONS.map(status => `<option value="${status}">${status}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="roles-field">
                <label for="ur-add-scope">Alcance UX</label>
                <input id="ur-add-scope" name="scope" type="text" placeholder="Ej. POS, Agenda o Suite completa">
              </div>
              <div class="roles-field">
                <label for="ur-add-notes">Notas</label>
                <textarea id="ur-add-notes" name="notes" placeholder="Notas visibles para esta base local"></textarea>
              </div>
              <div class="config-section-actions">
                <button type="submit" class="config-inline-btn">Guardar usuario</button>
                <button type="button" class="config-inline-btn secondary" data-ur-panel="overview">Cancelar</button>
              </div>
            </form>
          </section>
        `;
      }
      if (state.panel === 'edit' && selectedUser){
        return `
          <section class="roles-workbench-card">
            <div class="roles-workbench-header">
              <div>
                <div class="config-section-kicker">CRUD provisional</div>
                <h4>Editar usuario</h4>
              </div>
              <div class="config-chip">${selectedRole}</div>
            </div>
            <p class="roles-workbench-copy">Edición local para ${selectedName}. Cambia ficha, rol visible y estado sin fingir permisos reales.</p>
            <form class="roles-form-grid" data-ur-form="edit" data-ur-user-id="${escapeHtml(selectedUser.id)}">
              <div class="roles-form-grid two">
                <div class="roles-field">
                  <label for="ur-edit-name">Nombre</label>
                  <input id="ur-edit-name" name="name" type="text" value="${escapeHtml(selectedUser.name)}" required>
                </div>
                <div class="roles-field">
                  <label for="ur-edit-email">Correo</label>
                  <input id="ur-edit-email" name="email" type="email" value="${escapeHtml(selectedUser.email)}" required>
                </div>
              </div>
              <div class="roles-form-grid two">
                <div class="roles-field">
                  <label for="ur-edit-role">Rol visible</label>
                  <select id="ur-edit-role" name="role">
                    ${CONFIG_ROLE_OPTIONS.map(role => `<option value="${role}" ${selectedUser.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                  </select>
                </div>
                <div class="roles-field">
                  <label for="ur-edit-status">Estado visual</label>
                  <select id="ur-edit-status" name="status">
                    ${CONFIG_USER_STATUS_OPTIONS.map(status => `<option value="${status}" ${selectedUser.status === status ? 'selected' : ''}>${status}</option>`).join('')}
                  </select>
                </div>
              </div>
              <div class="roles-field">
                <label for="ur-edit-scope">Alcance UX</label>
                <input id="ur-edit-scope" name="scope" type="text" value="${escapeHtml(selectedUser.scope)}">
              </div>
              <div class="roles-field">
                <label for="ur-edit-notes">Notas</label>
                <textarea id="ur-edit-notes" name="notes">${escapeHtml(selectedUser.notes || '')}</textarea>
              </div>
              <div class="config-section-actions">
                <button type="submit" class="config-inline-btn">Guardar cambios</button>
                <button type="button" class="config-inline-btn secondary" data-ur-panel="overview" data-ur-user-id="${escapeHtml(selectedUser.id)}">Cancelar</button>
              </div>
            </form>
          </section>
        `;
      }
      if (state.panel === 'assign-role' && selectedUser){
        return `
          <section class="roles-workbench-card">
            <div class="roles-workbench-header">
              <div>
                <div class="config-section-kicker">CRUD provisional</div>
                <h4>Asignar rol</h4>
              </div>
              <div class="config-chip">${selectedName}</div>
            </div>
            <p class="roles-workbench-copy">Asignación visible para ADMIN y MIEMBRO antes del backend real. Aquí mandan la UX y el modelo, no la seguridad.</p>
            <form class="roles-form-grid" data-ur-form="assign-role" data-ur-user-id="${escapeHtml(selectedUser.id)}">
              <div class="roles-radio-list">
                ${CONFIG_ROLE_OPTIONS.map((role) => `
                  <label class="roles-radio-card">
                    <input type="radio" name="role" value="${role}" ${selectedUser.role === role ? 'checked' : ''}>
                    <div class="roles-radio-copy">
                      <b>${role}</b>
                      <span>${role === 'ADMIN' ? 'Perfil para administración visible de la suite y futuros controles.' : 'Perfil base para operación diaria sin fingir permisos finos todavía.'}</span>
                    </div>
                  </label>
                `).join('')}
              </div>
              <div class="roles-field">
                <label for="ur-role-scope">Alcance UX</label>
                <input id="ur-role-scope" name="scope" type="text" value="${escapeHtml(selectedUser.scope)}">
              </div>
              <div class="config-section-actions">
                <button type="submit" class="config-inline-btn">Guardar rol</button>
                <button type="button" class="config-inline-btn secondary" data-ur-panel="overview" data-ur-user-id="${escapeHtml(selectedUser.id)}">Cancelar</button>
              </div>
            </form>
          </section>
        `;
      }
      if (state.panel === 'delete' && selectedUser){
        return `
          <section class="roles-workbench-card">
            <div class="roles-workbench-header">
              <div>
                <div class="config-section-kicker">CRUD provisional</div>
                <h4>Borrar usuario</h4>
              </div>
              <div class="badge-warn" style="margin-top:0;">Acción local</div>
            </div>
            <p class="roles-workbench-copy">Confirmación clara para ${selectedName}. En esta etapa solo limpia la base local del navegador actual.</p>
            <ul class="roles-help-list">
              <li><b>Correo:</b> ${escapeHtml(selectedUser.email)}</li>
              <li><b>Rol visible:</b> ${selectedRole}</li>
              <li><b>Alcance UX:</b> ${escapeHtml(selectedUser.scope)}</li>
            </ul>
            <div class="config-section-actions">
              <button type="button" class="config-inline-btn" data-ur-confirm-delete="${escapeHtml(selectedUser.id)}">Confirmar borrado</button>
              <button type="button" class="config-inline-btn secondary" data-ur-panel="overview" data-ur-user-id="${escapeHtml(selectedUser.id)}">Cancelar</button>
            </div>
          </section>
        `;
      }
      return `
        <section class="roles-workbench-card">
          <div class="roles-workbench-header">
            <div>
              <div class="config-section-kicker">Vista activa</div>
              <h4>CRUD provisional/local de Usuarios y Roles</h4>
            </div>
            <div class="config-chip">Persistencia local</div>
          </div>
          <p class="roles-workbench-copy">La experiencia ya no es maqueta: agrega, edita, borra y reasigna rol en local para dejar listo el salto a Firebase.</p>
          ${selectedUser ? `
            <div class="user-card-grid">
              <div class="user-meta">
                <span class="user-meta-label">Usuario seleccionado</span>
                <span class="user-meta-value">${selectedName}</span>
              </div>
              <div class="user-meta">
                <span class="user-meta-label">Rol visible</span>
                <span class="user-meta-value">${selectedRole}</span>
              </div>
              <div class="user-meta">
                <span class="user-meta-label">Estado visual</span>
                <span class="user-meta-value">${escapeHtml(selectedUser.status)}</span>
              </div>
              <div class="user-meta">
                <span class="user-meta-label">Último acceso visible</span>
                <span class="user-meta-value">${escapeHtml(selectedUser.lastSeen)}</span>
              </div>
            </div>
          ` : `
            <div class="roles-empty">
              No hay un usuario seleccionado todavía. Nada roto: puedes crear el primero o restaurar el ejemplo visual.
            </div>
          `}
          <div class="config-section-actions">
            <button type="button" class="config-inline-btn" data-ur-panel="add">Agregar usuario</button>
            ${selectedUser ? `<button type="button" class="config-inline-btn secondary" data-ur-panel="edit" data-ur-user-id="${escapeHtml(selectedUser.id)}">Editar seleccionado</button>` : ''}
            ${selectedUser ? `<button type="button" class="config-inline-btn secondary" data-ur-panel="assign-role" data-ur-user-id="${escapeHtml(selectedUser.id)}">Asignar rol</button>` : ''}
            ${!selectedUser ? `<button type="button" class="config-inline-btn secondary" data-ur-reset-demo="1">Restaurar ejemplo</button>` : ''}
          </div>
          <ul class="roles-help-list">
            <li>Roles visibles desde ya: <b>ADMIN</b> y <b>MIEMBRO</b>.</li>
            <li>Todo se guarda localmente en este navegador dentro de la arquitectura actual de la Suite.</li>
            <li>La próxima conexión real podrá reemplazar la fuente local sin rediseñar esta experiencia.</li>
          </ul>
          <div class="roles-inline-note">Pista útil: también puedes dejar la base completamente vacía y volver a construirla desde cero.</div>
        </section>
      `;
    }

    function buildUsersRolesSectionHtml(){
      const state = getUsersRolesUI();
      const meta = getUsersRolesStorageMeta(state.users, state.lastUpdatedAt, state.source);
      return `
        <div class="config-panel-header">
          <div>
            <div class="config-section-kicker">CRUD provisional/local</div>
            <h3 class="config-panel-title" id="config-panel-title">Usuarios y Roles</h3>
          </div>
          <div class="config-chip">Base local · puente a Firebase</div>
        </div>
        <p class="config-panel-copy">Ahora sí queda amarrado el modelo base: catálogo local, roles ADMIN/MIEMBRO, persistencia del navegador y flujo completo de alta, edición, borrado y cambio de rol antes del salto real a Firebase.</p>
        <div class="roles-banner">
          <div class="roles-banner-copy">
            <strong>Importante:</strong>
            <span>Esto sigue sin autenticar ni bloquear módulos. Es CRUD local provisional para probar UX y estructura, ahora ya acompañado por una base Firebase técnica separada.</span>
          </div>
          <div class="badge-warn" style="margin-top:0;">Sin Firebase/Auth todavía</div>
        </div>
        ${buildUsersRolesSummaryCards(state.users, state.lastUpdatedAt, state.source)}
        <div class="roles-shell">
          <div class="roles-column">
            <div class="roles-toolbar">
              <div class="roles-toolbar-copy">
                <b>Catálogo local de usuarios</b>
                <span>Persistencia provisional activa para probar el flujo completo antes del backend real.</span>
              </div>
              <div class="roles-toolbar-actions">
                <button type="button" class="config-inline-btn" data-ur-panel="add">Agregar usuario</button>
                <button type="button" class="config-inline-btn secondary" data-ur-reset-demo="1">Restaurar ejemplo</button>
              </div>
              <div class="roles-toolbar-meta">Última edición local: ${escapeHtml(meta.lastUpdatedLabel)}</div>
            </div>
            ${buildUsersRolesList(state.users, state.selectedId)}
          </div>
          <div class="roles-workbench">
            ${buildUsersRolesWorkbench()}
          </div>
        </div>
      `;
    }

    function rerenderUsersRolesSection(onExport, onImport){
      renderConfigurationModule({
        sectionId: 'usuarios-roles',
        onExport,
        onImport
      });
    }

    function handleUsersRolesPanelChange(panel = 'overview', userId = '', onExport, onImport){
      const state = getUsersRolesUI();
      const nextSelectedId = userId || state.selectedId || state.users[0]?.id || null;
      const nextPanel = (!state.users.length && panel !== 'add') ? 'overview' : panel;
      setUsersRolesUI({ panel: nextPanel, selectedId: nextSelectedId });
      rerenderUsersRolesSection(onExport, onImport);
    }

    function readUsersRolesFormPayload(form){
      const fd = new FormData(form);
      return sanitizeUsersRolesUser({
        id: form.dataset.urUserId || '',
        name: fd.get('name'),
        email: fd.get('email'),
        role: fd.get('role'),
        status: fd.get('status'),
        scope: fd.get('scope'),
        notes: fd.get('notes')
      }, form.dataset.urUserId || '');
    }

    function getFirebaseBaseStatusSnapshot(){
      try{
        if (window.A33Firebase && typeof window.A33Firebase.getStatusSync === 'function'){
          return window.A33Firebase.getStatusSync();
        }
      }catch(_){ }
      return {
        code: 'placeholder',
        label: 'Pendiente de configuración',
        message: 'La base de Firebase todavía no está disponible.',
        configSourceLabel: 'Placeholder seguro',
        hasRealConfig: false,
        missingKeys: ['apiKey', 'authDomain', 'projectId', 'appId'],
        services: { appPrepared:false, authPrepared:false, firestorePrepared:false },
        sdk: { version:'12.11.0', loaded:false },
        runtime: { currentHost: window.location.hostname || '(sin host)', currentOrigin: window.location.origin || '(sin origin)' },
        warnings: [],
        error: null,
        checkedAt: new Date().toISOString(),
        projectId: '',
        authDomain: ''
      };
    }

    function getFirebaseStatusBadge(status){
      const code = String(status?.code || 'placeholder');
      if (code === 'ready') return 'Base operativa';
      if (code === 'ready-to-init') return 'Lista para inicializar';
      if (code === 'loading') return 'Inicializando';
      if (code === 'error') return 'Diagnóstico con error';
      return 'Placeholder seguro';
    }

    function getFirebaseStatusMeta(status){
      const services = status?.services || {};
      const readyCount = [services.appPrepared, services.authPrepared, services.firestorePrepared].filter(Boolean).length;
      return {
        sourceLabel: status?.configSourceLabel || 'Placeholder seguro',
        sdkLabel: (status?.sdk?.loaded ? 'Cargado' : 'Pendiente') + ' · v' + escapeHtml(status?.sdk?.version || '12.11.0'),
        servicesLabel: readyCount ? `${readyCount}/3` : '0/3',
        hostLabel: status?.runtime?.currentHost || '(sin host)'
      };
    }

    function buildFirebaseStatusCards(status){
      const meta = getFirebaseStatusMeta(status);
      return `
        <div class="firebase-status-grid">
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(status?.hasRealConfig ? 'Real' : 'Pendiente')}</span>
            <span class="firebase-status-label">Config</span>
            <span class="firebase-status-note">${escapeHtml(meta.sourceLabel)}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(status?.sdk?.loaded ? 'Activa' : 'En espera')}</span>
            <span class="firebase-status-label">SDK</span>
            <span class="firebase-status-note">${escapeHtml(meta.sdkLabel)}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(meta.servicesLabel)}</span>
            <span class="firebase-status-label">Servicios preparados</span>
            <span class="firebase-status-note">App · Auth · Firestore</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(meta.hostLabel)}</span>
            <span class="firebase-status-label">Host actual</span>
            <span class="firebase-status-note">${escapeHtml(formatUsersRolesTimestamp(status?.checkedAt || ''))}</span>
          </article>
        </div>
      `;
    }

    function buildFirebaseDiagList(items = [], emptyText = 'Sin observaciones por ahora.'){
      if (!Array.isArray(items) || !items.length){
        return `<ul><li>${escapeHtml(emptyText)}</li></ul>`;
      }
      return `<ul>${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    }

    function getAuthAccessStatusSnapshot(){
      try{
        if (window.A33Auth && typeof window.A33Auth.getStatusSync === 'function'){
          return window.A33Auth.getStatusSync();
        }
      }catch(_){ }
      const firebase = getFirebaseBaseStatusSnapshot();
      return {
        code: firebase?.hasRealConfig ? 'signed-out' : 'needs-config',
        label: firebase?.hasRealConfig ? 'Sin sesión' : 'Config pendiente',
        message: firebase?.hasRealConfig
          ? 'No hay una sesión activa en este navegador.'
          : 'Completa la configuración de Firebase para activar el acceso real.',
        isAuthenticated: false,
        isBusy: false,
        authReady: !!firebase?.services?.authPrepared,
        persistence: 'LOCAL',
        user: null,
        error: firebase?.error || null,
        checkedAt: firebase?.checkedAt || new Date().toISOString(),
        firebase: {
          code: firebase?.code || 'placeholder',
          label: firebase?.label || 'Pendiente de configuración',
          message: firebase?.message || '',
          hasRealConfig: !!firebase?.hasRealConfig,
          warnings: Array.isArray(firebase?.warnings) ? firebase.warnings.slice() : [],
          checkedAt: firebase?.checkedAt || new Date().toISOString(),
          error: firebase?.error || null,
          projectId: firebase?.projectId || '',
          authDomain: firebase?.authDomain || ''
        }
      };
    }


    function getAuthInlineStatusClass(status){
      const code = String(status?.code || '').trim().toLowerCase();
      if ((status && status.error) || code === 'error' || code === 'firebase-error' || code === 'firebase-missing') return 'error';
      if (code === 'authenticated' || code === 'ready') return 'success';
      if (code === 'signing-in' || code === 'signing-out' || code === 'awaiting-context' || code === 'syncing' || code === 'boot-needed' || code === 'needs-config') return 'pending';
      return '';
    }

    function getAuthAccessBadge(status){
      const code = String(status?.code || 'signed-out');
      if (code === 'authenticated') return 'Sesión activa';
      if (code === 'signing-in') return 'Entrando…';
      if (code === 'signing-out') return 'Cerrando…';
      if (code === 'needs-config') return 'Config pendiente';
      if (code === 'firebase-error' || code === 'error') return 'Revisar acceso';
      return 'Sin sesión';
    }


    function getWorkspaceContextStatusSnapshot(){
      try{
        if (window.A33Workspace && typeof window.A33Workspace.getStatusSync === 'function'){
          return window.A33Workspace.getStatusSync();
        }
      }catch(_){ }
      const auth = getAuthAccessStatusSnapshot();
      return {
        code: auth?.isAuthenticated ? 'awaiting-context' : (auth?.code || 'signed-out'),
        label: auth?.isAuthenticated ? 'Contexto pendiente' : (auth?.label || 'Sin sesión'),
        message: auth?.isAuthenticated
          ? 'La sesión existe, pero el contexto real de usuario y espacio todavía no está validado.'
          : (auth?.message || 'No hay una sesión activa en este navegador.'),
        isBusy: false,
        isAuthenticated: !!auth?.isAuthenticated,
        hasContext: false,
        user: auth?.user || null,
        profile: null,
        workspace: null,
        membership: null,
        role: '',
        currentWorkspaceId: '',
        error: auth?.error || null,
        checkedAt: auth?.checkedAt || new Date().toISOString(),
        created: { user:false, workspace:false, membership:false }
      };
    }

    function getWorkspaceContextBadge(status){
      const code = String(status?.code || 'signed-out');
      if (code === 'ready') return 'Contexto listo';
      if (code === 'syncing' || code === 'awaiting-context') return 'Preparando';
      if (code === 'needs-config') return 'Config pendiente';
      if (code === 'firebase-error' || code === 'error') return 'Revisar contexto';
      if (code === 'signed-out') return 'Sin sesión';
      return 'En espera';
    }

    function buildWorkspaceContextStatusCards(status){
      const workspaceName = status?.workspace?.name || 'Pendiente';
      const role = status?.membership?.role || status?.role || '—';
      const memberState = status?.membership?.status || (status?.hasContext ? 'Activo' : 'Pendiente');
      return `
        <div class="firebase-status-grid">
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(status?.profile?.email || status?.user?.email || 'Pendiente')}</span>
            <span class="firebase-status-label">Usuario real</span>
            <span class="firebase-status-note">${escapeHtml(status?.profile?.uidShort || status?.user?.uidShort || 'Sin UID')}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(workspaceName)}</span>
            <span class="firebase-status-label">Espacio</span>
            <span class="firebase-status-note">${escapeHtml(status?.workspace?.id || status?.currentWorkspaceId || 'Sin ID')}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(role)}</span>
            <span class="firebase-status-label">Rol actual</span>
            <span class="firebase-status-note">ADMIN · MIEMBRO</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(memberState)}</span>
            <span class="firebase-status-label">Vínculo</span>
            <span class="firebase-status-note">${escapeHtml(formatUsersRolesTimestamp(status?.checkedAt || ''))}</span>
          </article>
        </div>
      `;
    }

    function buildWorkspaceContextDocList(status){
      return `
        <ul>
          <li><span class="firebase-inline-code">users/${escapeHtml(status?.profile?.uid || status?.user?.uid || '{uid}')}</span> → perfil real del usuario.</li>
          <li><span class="firebase-inline-code">workspaces/${escapeHtml(status?.workspace?.id || status?.currentWorkspaceId || '{workspaceId}')}</span> → espacio compartido base.</li>
          <li><span class="firebase-inline-code">workspaces/${escapeHtml(status?.workspace?.id || status?.currentWorkspaceId || '{workspaceId}')}/members/${escapeHtml(status?.profile?.uid || status?.user?.uid || '{uid}')}</span> → vínculo usuario ↔ espacio con rol.</li>
        </ul>
      `;
    }

    function buildWorkspaceContextSectionHtml(){
      const status = getWorkspaceContextStatusSnapshot();
      const authStatus = getAuthAccessStatusSnapshot();
      const badge = getWorkspaceContextBadge(status);
      const statusClass = getAuthInlineStatusClass({ code: status?.code === 'ready' ? 'authenticated' : status?.code, error: status?.error || null });
      const summaryItems = [];
      if (status?.profile?.email || status?.user?.email) summaryItems.push(`Usuario: ${status?.profile?.email || status?.user?.email}`);
      if (status?.workspace?.name || status?.workspace?.id) summaryItems.push(`Espacio: ${status?.workspace?.name || status?.workspace?.id}`);
      if (status?.membership?.role || status?.role) summaryItems.push(`Rol: ${status?.membership?.role || status?.role}`);
      if (!summaryItems.length) summaryItems.push('Todavía no hay contexto real montado en Firestore para esta sesión.');
      const createdFlags = [];
      if (status?.created?.user) createdFlags.push('usuario');
      if (status?.created?.workspace) createdFlags.push('espacio');
      if (status?.created?.membership) createdFlags.push('vínculo');

      const actionCard = authStatus?.isAuthenticated ? `
        <article class="firebase-diag-card">
          <div class="config-card-top">
            <h4>Acciones</h4>
            <div class="config-chip">Firestore</div>
          </div>
          <p class="roles-inline-note">Esta etapa no administra miembros todavía. Aquí solo se amarra el contexto real mínimo para que la Suite tenga pertenencia y base de crecimiento.</p>
          <div class="config-card-actions" style="margin-top:0.9rem;">
            <button type="button" class="config-inline-btn" data-workspace-action="ensure">Preparar / reparar contexto</button>
            <button type="button" class="config-inline-btn secondary" data-workspace-action="refresh">Refrescar contexto</button>
          </div>
          <ul class="config-list">
            <li>Si el usuario entra por primera vez, se crea su espacio base.</li>
            <li>El primer vínculo queda como <span class="firebase-inline-code">ADMIN</span>.</li>
            <li>La estructura ya queda lista para sumar miembros reales después.</li>
          </ul>
        </article>
      ` : `
        <article class="firebase-diag-card">
          <div class="config-card-top">
            <h4>Primero inicia sesión</h4>
            <div class="config-chip">Paso previo</div>
          </div>
          <p class="roles-inline-note">Sin sesión no hay UID real que vincular. Primero entra con Firebase Auth y luego la Suite arma el contexto automáticamente.</p>
          <div class="config-card-actions" style="margin-top:0.9rem;">
            <button type="button" class="config-inline-btn" data-workspace-open-access="1">Ir a Acceso</button>
          </div>
        </article>
      `;

      return `
        <div class="config-panel-header">
          <div>
            <div class="config-section-kicker">Contexto real mínimo</div>
            <h3 class="config-panel-title" id="config-panel-title">Espacio compartido</h3>
          </div>
          <div class="config-chip">${escapeHtml(badge)}</div>
        </div>
        <p class="config-panel-copy">Aquí la Suite deja de ser solo login: cada sesión válida pasa a tener usuario real, espacio de trabajo y vínculo real dentro de Firestore, sin meter aún invitaciones completas ni permisos finos por módulo.</p>
        <div class="firebase-banner">
          <div class="firebase-banner-copy">
            <strong>Estado actual</strong>
            <span>${escapeHtml(status?.message || 'Sin diagnóstico del contexto todavía.')}</span>
          </div>
          <div class="badge-warn" style="margin-top:0;">${escapeHtml(status?.hasContext ? 'Contexto real montado' : 'Base mínima en preparación')}</div>
        </div>
        ${buildWorkspaceContextStatusCards(status)}
        <div class="firebase-diag-grid">
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Contexto detectado</h4>
              <div class="config-chip">Usuario + espacio</div>
            </div>
            ${buildFirebaseDiagList(summaryItems, 'Todavía no hay contexto real detectado.')}
            <div class="auth-inline-status ${escapeHtml(statusClass)}">${escapeHtml(status?.error?.message || (createdFlags.length ? `Se creó: ${createdFlags.join(', ')}.` : (status?.message || 'Sin novedades.')))}</div>
          </article>
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Estructura mínima</h4>
              <div class="config-chip">Firestore</div>
            </div>
            ${buildWorkspaceContextDocList(status)}
            <div class="small-note">Modelo simple: perfil del usuario, espacio compartido y membresía por subcolección.</div>
          </article>
        </div>
        <div class="firebase-diag-grid">
          ${actionCard}
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Lo que resuelve Etapa 8</h4>
              <div class="config-chip">Sin barroco</div>
            </div>
            <ul>
              <li>Existe un usuario real persistido en <span class="firebase-inline-code">Firestore</span>.</li>
              <li>Existe un espacio de trabajo real con identidad propia.</li>
              <li>Existe el vínculo <span class="firebase-inline-code">usuario ↔ espacio</span> con rol base.</li>
              <li>La base queda lista para miembros reales y administración posterior.</li>
            </ul>
          </article>
        </div>
      `;
    }

    async function refreshWorkspaceContextSection({ onExport, onImport, forceEnsure = false } = {}){
      try{
        if (window.A33Workspace && typeof window.A33Workspace.refresh === 'function'){
          await window.A33Workspace.refresh({ forceEnsure: !!forceEnsure });
        }
      }catch(_){
        showToast('No se pudo refrescar el contexto real.');
      }
      renderHomeAccessStrip();
      renderConfigurationModule({
        sectionId: 'workspace-context',
        onExport,
        onImport
      });
    }

    function getFirebaseRuntimeConfigForForm(){
      try{
        if (window.A33FirebaseConfig && typeof window.A33FirebaseConfig.describeConfig === 'function'){
          const desc = window.A33FirebaseConfig.describeConfig();
          const config = { ...(desc?.config || {}) };
          const normalizeField = (key) => {
            const value = String(config?.[key] || '').trim();
            if (window.A33FirebaseConfig && typeof window.A33FirebaseConfig.isPlaceholderValue === 'function'){
              return window.A33FirebaseConfig.isPlaceholderValue(value) ? '' : value;
            }
            return value;
          };
          return {
            ...desc,
            config: {
              apiKey: normalizeField('apiKey'),
              authDomain: normalizeField('authDomain'),
              projectId: normalizeField('projectId'),
              storageBucket: normalizeField('storageBucket'),
              messagingSenderId: normalizeField('messagingSenderId'),
              appId: normalizeField('appId'),
              measurementId: normalizeField('measurementId')
            }
          };
        }
      }catch(_){ }
      return {
        hasRealConfig: false,
        source: 'placeholder',
        config: {
          apiKey: '',
          authDomain: '',
          projectId: '',
          storageBucket: '',
          messagingSenderId: '',
          appId: '',
          measurementId: ''
        }
      };
    }

    function buildAuthStatusCards(status, firebaseStatus){
      const sessionLabel = status?.isAuthenticated ? 'Activa' : (status?.isBusy ? 'Moviendo' : 'Sin sesión');
      const sessionNote = status?.user?.email || status?.message || 'Sin usuario autenticado.';
      const authLabel = status?.authReady ? 'Lista' : 'Pendiente';
      const authNote = firebaseStatus?.label || 'Sin diagnóstico';
      const persistenceLabel = status?.persistence || 'LOCAL';
      const persistenceNote = status?.isAuthenticated ? 'Persistente en este navegador' : 'Se aplicará al iniciar sesión';
      const userLabel = status?.user?.email ? 'Usuario actual' : 'Último chequeo';
      const userValue = status?.user?.email || formatUsersRolesTimestamp(status?.checkedAt || firebaseStatus?.checkedAt || '');
      const userNote = status?.user?.uidShort || (firebaseStatus?.runtime?.currentHost || '(sin host)');
      return `
        <div class="firebase-status-grid">
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(sessionLabel)}</span>
            <span class="firebase-status-label">Sesión</span>
            <span class="firebase-status-note">${escapeHtml(sessionNote)}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(authLabel)}</span>
            <span class="firebase-status-label">Auth</span>
            <span class="firebase-status-note">${escapeHtml(authNote)}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(persistenceLabel)}</span>
            <span class="firebase-status-label">Persistencia</span>
            <span class="firebase-status-note">${escapeHtml(persistenceNote)}</span>
          </article>
          <article class="firebase-status-card">
            <span class="firebase-status-value">${escapeHtml(userLabel)}</span>
            <span class="firebase-status-label">Referencia</span>
            <span class="firebase-status-note">${escapeHtml(userValue)}${userNote ? ` · ${escapeHtml(userNote)}` : ''}</span>
          </article>
        </div>
      `;
    }

    function buildAuthSessionList(user){
      if (!user){
        return `
          <ul class="auth-session-list">
            <li>
              <b>Estado</b>
              <span>Sin sesión activa todavía. Aquí entramos simple: correo, contraseña, persistencia local y salida limpia. Nada de teatro con permisos finos todavía.</span>
            </li>
          </ul>
        `;
      }
      const items = [
        ['Correo', user.email || 'Sin correo'],
        ['UID', user.uid || 'Sin UID'],
        ['Verificación', user.emailVerified ? 'Correo verificado' : 'Correo no verificado'],
        ['Último acceso', user.lastLoginAt || 'Sin dato'],
        ['Creado', user.createdAt || 'Sin dato']
      ];
      return `
        <ul class="auth-session-list">
          ${items.map(([label, value]) => `
            <li>
              <b>${escapeHtml(label)}</b>
              <span>${escapeHtml(value)}</span>
            </li>
          `).join('')}
        </ul>
      `;
    }

    function readFirebaseRuntimeConfigFormPayload(form){
      const fd = new FormData(form);
      const normalizeDomain = (value = '') => String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
      return {
        apiKey: String(fd.get('apiKey') || '').trim(),
        authDomain: normalizeDomain(fd.get('authDomain')),
        projectId: String(fd.get('projectId') || '').trim(),
        storageBucket: String(fd.get('storageBucket') || '').trim(),
        messagingSenderId: String(fd.get('messagingSenderId') || '').trim(),
        appId: String(fd.get('appId') || '').trim(),
        measurementId: String(fd.get('measurementId') || '').trim()
      };
    }

    function validateFirebaseRuntimeConfigPayload(payload = {}){
      const missing = ['apiKey', 'authDomain', 'projectId', 'appId'].filter((key) => !String(payload?.[key] || '').trim());
      if (missing.length){
        return `Faltan campos Firebase: ${missing.join(', ')}.`;
      }
      return '';
    }

    function buildFirebaseRuntimeConfigForm(configState){
      const cfg = configState?.config || {};
      const sourceLabel = configState?.source === 'runtime-local'
        ? 'Local en este navegador'
        : (configState?.hasRealConfig ? 'Embebida/real' : 'Pendiente');
      return `
        <article class="firebase-diag-card">
          <div class="config-card-top">
            <h4>Config Firebase del navegador</h4>
            <div class="config-chip">${escapeHtml(sourceLabel)}</div>
          </div>
          <p class="roles-inline-note">Puedes guardar la web config aquí sin editar archivos. Solo afecta este navegador actual.</p>
          <form class="roles-form-grid" data-firebase-config-form="save">
            <div class="roles-form-grid two">
              <div class="roles-field">
                <label for="firebase-api-key">API Key</label>
                <input id="firebase-api-key" name="apiKey" type="text" value="${escapeHtml(cfg.apiKey || '')}" autocomplete="off" placeholder="AIza...">
              </div>
              <div class="roles-field">
                <label for="firebase-auth-domain">Auth Domain</label>
                <input id="firebase-auth-domain" name="authDomain" type="text" value="${escapeHtml(cfg.authDomain || '')}" autocomplete="off" placeholder="tu-proyecto.firebaseapp.com">
              </div>
            </div>
            <div class="roles-form-grid two">
              <div class="roles-field">
                <label for="firebase-project-id">Project ID</label>
                <input id="firebase-project-id" name="projectId" type="text" value="${escapeHtml(cfg.projectId || '')}" autocomplete="off" placeholder="tu-proyecto">
              </div>
              <div class="roles-field">
                <label for="firebase-app-id">App ID</label>
                <input id="firebase-app-id" name="appId" type="text" value="${escapeHtml(cfg.appId || '')}" autocomplete="off" placeholder="1:123456:web:abcdef">
              </div>
            </div>
            <div class="roles-form-grid two">
              <div class="roles-field">
                <label for="firebase-storage-bucket">Storage Bucket (opcional)</label>
                <input id="firebase-storage-bucket" name="storageBucket" type="text" value="${escapeHtml(cfg.storageBucket || '')}" autocomplete="off" placeholder="tu-proyecto.firebasestorage.app">
              </div>
              <div class="roles-field">
                <label for="firebase-msg-id">Messaging Sender ID (opcional)</label>
                <input id="firebase-msg-id" name="messagingSenderId" type="text" value="${escapeHtml(cfg.messagingSenderId || '')}" autocomplete="off" placeholder="1234567890">
              </div>
            </div>
            <div class="roles-field">
              <label for="firebase-measurement-id">Measurement ID (opcional)</label>
              <input id="firebase-measurement-id" name="measurementId" type="text" value="${escapeHtml(cfg.measurementId || '')}" autocomplete="off" placeholder="G-XXXXXXX">
            </div>
            <div class="config-card-actions">
              <button type="submit" class="config-inline-btn">Guardar config local</button>
              <button type="button" class="config-inline-btn secondary" data-firebase-config-clear="1">Limpiar config</button>
            </div>
          </form>
        </article>
      `;
    }

    function buildAuthAccessSectionHtml(){
      const firebaseStatus = getFirebaseBaseStatusSnapshot();
      const authStatus = getAuthAccessStatusSnapshot();
      const configState = getFirebaseRuntimeConfigForForm();
      const configItems = [];
      configItems.push(`Origen: ${firebaseStatus?.configSourceLabel || 'Placeholder seguro'}`);
      configItems.push(`Project ID: ${firebaseStatus?.projectId || 'Pendiente'}`);
      configItems.push(`Auth domain: ${firebaseStatus?.authDomain || 'Pendiente'}`);
      if (Array.isArray(firebaseStatus?.missingKeys) && firebaseStatus.missingKeys.length){
        configItems.push(`Claves pendientes: ${firebaseStatus.missingKeys.join(', ')}`);
      }
      const diagItems = [];
      diagItems.push(`Estado acceso: ${authStatus?.label || 'Sin dato'}`);
      diagItems.push(`Estado Firebase: ${firebaseStatus?.label || 'Sin dato'}`);
      diagItems.push(`Host actual: ${firebaseStatus?.runtime?.currentHost || '(sin host)'}`);
      diagItems.push(`Origen actual: ${firebaseStatus?.runtime?.currentOrigin || '(sin origin)'}`);
      diagItems.push(`Persistencia: ${authStatus?.persistence || 'LOCAL'}`);
      if (authStatus?.error?.code){
        diagItems.push(`Error: ${authStatus.error.code}`);
      }

      const loginDisabled = !firebaseStatus?.hasRealConfig || authStatus?.isBusy;
      const loginDisabledAttr = loginDisabled ? 'disabled' : '';
      const statusClass = getAuthInlineStatusClass(authStatus);
      const sessionCard = authStatus?.isAuthenticated ? `
        <article class="firebase-diag-card">
          <div class="config-card-top">
            <h4>Sesión actual</h4>
            <div class="config-chip">${escapeHtml(authStatus?.user?.email || 'Activa')}</div>
          </div>
          <p class="roles-inline-note">Sesión real montada con persistencia local. El bloqueo por módulos viene después; aquí solo amarramos entrar, mantener y salir sin tropiezos.</p>
          ${buildAuthSessionList(authStatus?.user)}
          <div class="config-card-actions" style="margin-top:0.9rem;">
            <button type="button" class="config-inline-btn" data-auth-action="signout">Cerrar sesión</button>
            <button type="button" class="config-inline-btn secondary" data-auth-action="refresh">Revisar estado</button>
          </div>
          <div class="auth-inline-status ${escapeHtml(statusClass)}">${escapeHtml(authStatus?.message || 'Sesión activa.')}</div>
        </article>
      ` : `
        <article class="firebase-diag-card">
          <div class="config-card-top">
            <h4>Entrar</h4>
            <div class="config-chip">Email + contraseña</div>
          </div>
          <p class="roles-inline-note">Acceso simple y manejable: inicia sesión con un usuario ya existente en Firebase Authentication. Sin invitaciones ni administración real todavía.</p>
          <form class="roles-form-grid" data-auth-form="sign-in">
            <div class="roles-form-grid two">
              <div class="roles-field">
                <label for="auth-email">Correo</label>
                <input id="auth-email" name="email" type="email" inputmode="email" autocomplete="username" placeholder="usuario@dominio.com" ${loginDisabledAttr}>
              </div>
              <div class="roles-field">
                <label for="auth-password">Contraseña</label>
                <input id="auth-password" name="password" type="password" autocomplete="current-password" placeholder="Tu contraseña" ${loginDisabledAttr}>
              </div>
            </div>
            <div class="config-card-actions">
              <button type="submit" class="config-inline-btn" ${loginDisabledAttr}>Iniciar sesión</button>
              <button type="button" class="config-inline-btn secondary" data-auth-action="refresh">Revisar estado</button>
            </div>
          </form>
          <div class="auth-inline-status ${escapeHtml(statusClass)}">${escapeHtml(authStatus?.message || 'Sin sesión activa.')}</div>
          <ul class="config-list">
            <li>La sesión queda persistente en este navegador.</li>
            <li>Los errores comunes se traducen a mensajes claros.</li>
            <li>Si aún no existe el usuario, se crea luego desde el flujo administrativo real.</li>
          </ul>
        </article>
      `;

      return `
        <div class="config-panel-header">
          <div>
            <div class="config-section-kicker">Acceso real simple</div>
            <h3 class="config-panel-title" id="config-panel-title">Acceso</h3>
          </div>
          <div class="config-chip">${escapeHtml(getAuthAccessBadge(authStatus))}</div>
        </div>
        <p class="config-panel-copy">Aquí queda amarrado el primer acceso real de la Suite: login con Firebase Auth, sesión persistente y logout estable, sin meternos todavía en la administración completa de miembros ni en permisos finos.</p>
        <div class="firebase-banner">
          <div class="firebase-banner-copy">
            <strong>Estado actual</strong>
            <span>${escapeHtml(authStatus?.message || firebaseStatus?.message || 'Sin diagnóstico disponible.')}</span>
          </div>
          <div class="badge-warn" style="margin-top:0;">${escapeHtml(authStatus?.isAuthenticated ? 'Sesión real activa' : 'Acceso simple listo')}</div>
        </div>
        ${buildAuthStatusCards(authStatus, firebaseStatus)}
        <div class="firebase-diag-grid">
          ${sessionCard}
          ${buildFirebaseRuntimeConfigForm(configState)}
        </div>
        <div class="firebase-diag-grid">
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Diagnóstico y acciones</h4>
              <div class="config-chip">Auth + Firebase</div>
            </div>
            ${buildFirebaseDiagList(diagItems, 'Sin diagnóstico todavía.')}
            ${authStatus?.error?.message ? `<div class="badge-warn" style="margin-top:0;">${escapeHtml(authStatus.error.message)}</div>` : ''}
            <div class="config-card-actions" style="margin-top:0.9rem;">
              <button type="button" class="config-inline-btn" data-firebase-refresh="status">Refrescar diagnóstico</button>
              <button type="button" class="config-inline-btn secondary" data-firebase-refresh="boot">Probar acceso Firebase</button>
            </div>
          </article>
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Configuración activa</h4>
              <div class="config-chip">${escapeHtml(firebaseStatus?.hasRealConfig ? 'Real' : 'Pendiente')}</div>
            </div>
            ${buildFirebaseDiagList(configItems, 'Sin datos de configuración todavía.')}
            <div class="small-note">La config local guardada aquí evita tocar archivos y deja el navegador listo para probar acceso real.</div>
          </article>
        </div>
        <div class="firebase-diag-grid">
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Advertencias / pendientes</h4>
              <div class="config-chip">Sin humo</div>
            </div>
            ${buildFirebaseDiagList(authStatus?.firebase?.warnings || firebaseStatus?.warnings || [], 'Nada crítico detectado en este momento.')}
          </article>
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Lo que ya quedó resuelto</h4>
              <div class="config-chip">Etapa 7</div>
            </div>
            <ul>
              <li>Login real con <span class="firebase-inline-code">Email/Password</span> sin añadir frameworks nuevos.</li>
              <li>Persistencia local mediante <span class="firebase-inline-code">browserLocalPersistence</span> para sostener la sesión.</li>
              <li>Logout estable y mensajes claros ante errores comunes de acceso o configuración.</li>
            </ul>
          </article>
        </div>
        <div class="firebase-diag-grid">
          <article class="firebase-diag-card">
            <div class="config-card-top">
              <h4>Base Firebase</h4>
              <div class="config-chip">Diagnóstico técnico</div>
            </div>
            ${buildFirebaseStatusCards(firebaseStatus)}
          </article>
        </div>
      `;
    }

    async function refreshFirebaseBaseSection({ onExport, onImport, attemptBoot = false } = {}){
      try{
        if (window.A33Firebase && typeof window.A33Firebase.refreshStatus === 'function'){
          await window.A33Firebase.refreshStatus({ attemptBoot: !!attemptBoot });
        }
        if (window.A33Auth && typeof window.A33Auth.refresh === 'function'){
          await window.A33Auth.refresh();
        }
        if (window.A33Workspace && typeof window.A33Workspace.refresh === 'function'){
          await window.A33Workspace.refresh({ forceEnsure:false });
        }
      }catch(err){
        showToast('No se pudo refrescar el acceso Firebase.');
      }
      renderConfigurationModule({
        sectionId: 'firebase-base',
        onExport,
        onImport
      });
    }

    function getConfigurationModuleSections(){
      return [
        {
          id: 'overview',
          label: 'Vista general',
          navLabel: 'Vista general',
          state: 'Contenedor',
          buildContent: () => `
            <div class="config-panel-header">
              <div>
                <div class="config-section-kicker">Arquitectura interna</div>
                <h3 class="config-panel-title" id="config-panel-title">Vista general</h3>
              </div>
              <div class="config-chip">Módulo contenedor</div>
            </div>
            <p class="config-panel-copy">Configuración ahora separa carriles por intención: respaldo operativo, CRUD local de usuarios, acceso Firebase simple, contexto real de espacio compartido y un hueco limpio para ajustes globales futuros. Menos cajón de sastre, más orden con dientes.</p>
            <div class="config-grid">
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Respaldo</h4>
                  <div class="config-chip">Operativo</div>
                </div>
                <p>Exporta o importa el JSON completo del navegador actual sin romper compatibilidad.</p>
                <div class="config-card-actions">
                  <button type="button" class="config-inline-btn" data-config-open-section="respaldo">Abrir Respaldo</button>
                </div>
              </article>
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Usuarios y Roles</h4>
                  <div class="config-chip">CRUD local</div>
                </div>
                <p>Ya opera con catálogo local, persistencia provisional y flujo completo para conectarse luego a lógica real.</p>
                <div class="config-card-actions">
                  <button type="button" class="config-inline-btn secondary" data-config-open-section="usuarios-roles">Abrir CRUD local</button>
                </div>
              </article>
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Acceso</h4>
                  <div class="config-chip">Firebase Auth</div>
                </div>
                <p>Login real simple, sesión persistente, logout estable y diagnóstico claro sin meternos todavía en control fino por módulo.</p>
                <div class="config-card-actions">
                  <button type="button" class="config-inline-btn secondary" data-config-open-section="firebase-base">Abrir acceso</button>
                </div>
              </article>
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Espacio compartido</h4>
                  <div class="config-chip">Contexto real</div>
                </div>
                <p>Usuario real, espacio de trabajo y vínculo base en Firestore para que la Suite tenga pertenencia real.</p>
                <div class="config-card-actions">
                  <button type="button" class="config-inline-btn secondary" data-config-open-section="workspace-context">Abrir contexto</button>
                </div>
              </article>
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Ajustes globales</h4>
                  <div class="config-chip">Reservado</div>
                </div>
                <p>Espacio listo para parámetros transversales de la Suite sin invadir respaldo ni usuarios.</p>
                <div class="config-card-actions">
                  <button type="button" class="config-inline-btn secondary" data-config-open-section="ajustes-globales">Ver carril</button>
                </div>
              </article>
            </div>
          `
        },
        {
          id: 'respaldo',
          label: 'Respaldo',
          navLabel: 'Respaldo',
          state: 'Operativo',
          buildContent: () => `
            <div class="config-panel-header">
              <div>
                <div class="config-section-kicker">Sección activa</div>
                <h3 class="config-panel-title" id="config-panel-title">Respaldo</h3>
              </div>
              <div class="badge-warn" style="margin-top:0;">Local · sin sync</div>
            </div>
            <p class="config-panel-copy">Exporta o importa un JSON con todos los datos guardados en este navegador actual. El formato se mantiene intacto; solo lo acomodamos donde corresponde.</p>
            <div class="config-section-actions">
              <button type="button" class="config-inline-btn" data-config-action="export">Exportar JSON</button>
              <button type="button" class="config-inline-btn secondary" data-config-action="import">Importar JSON</button>
            </div>
            <ul class="config-list">
              <li>Incluye IndexedDB y localStorage de la Suite.</li>
              <li>La importación reemplaza los datos del navegador actual.</li>
              <li>Recomendado: exportar antes de importar. La paranoia aquí sí paga dividendos.</li>
            </ul>
          `
        },
        {
          id: 'usuarios-roles',
          label: 'Usuarios y Roles',
          navLabel: 'Usuarios y Roles',
          state: 'CRUD local',
          buildContent: () => buildUsersRolesSectionHtml()
        },
        {
          id: 'firebase-base',
          label: 'Acceso',
          navLabel: 'Acceso',
          state: getAuthAccessBadge(getAuthAccessStatusSnapshot()),
          buildContent: () => buildAuthAccessSectionHtml()
        },
        {
          id: 'workspace-context',
          label: 'Espacio compartido',
          navLabel: 'Espacio compartido',
          state: getWorkspaceContextBadge(getWorkspaceContextStatusSnapshot()),
          buildContent: () => buildWorkspaceContextSectionHtml()
        },
        {
          id: 'ajustes-globales',
          label: 'Ajustes globales',
          navLabel: 'Ajustes globales',
          state: 'Reservado',
          buildContent: () => `
            <div class="config-panel-header">
              <div>
                <div class="config-section-kicker">Espacio futuro</div>
                <h3 class="config-panel-title" id="config-panel-title">Ajustes globales</h3>
              </div>
              <div class="config-chip">Listo para crecer</div>
            </div>
            <p class="config-panel-copy">Este carril queda libre para parámetros transversales de la Suite. No toca respaldo ni usuarios, y eso es exactamente la idea.</p>
            <div class="config-grid">
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Parámetros de operación</h4>
                  <div class="config-chip">Futuro</div>
                </div>
                <p>Constantes compartidas, defaults globales y switches del sistema cuando llegue su momento.</p>
              </article>
              <article class="config-card">
                <div class="config-card-top">
                  <h4>Entorno / dispositivo</h4>
                  <div class="config-chip">Futuro</div>
                </div>
                <p>Ajustes locales del dispositivo, presentación o comportamiento PWA sin romper otros carriles.</p>
              </article>
            </div>
          `
        }
      ];
    }

    function buildConfigurationModuleHtml({ sectionId = 'overview' } = {}){
      const sections = getConfigurationModuleSections();
      const currentSection = sections.find(section => section.id === sectionId) || sections[0];
      const navHtml = sections.map(section => `
        <button
          type="button"
          class="config-nav-btn${section.id === currentSection.id ? ' active' : ''}"
          data-config-open-section="${escapeHtml(section.id)}"
          aria-pressed="${section.id === currentSection.id ? 'true' : 'false'}"
        >
          <span>${escapeHtml(section.navLabel || section.label)}</span>
          <span class="config-nav-meta">${escapeHtml(section.state || '')}</span>
        </button>
      `).join('');

      return `
        <div class="config-shell" data-config-shell="1">
          <div class="config-module-head">
            <div class="config-module-title-row">
              <div>
                <div class="config-section-kicker">Módulo contenedor</div>
                <h3 class="config-module-title">Configuración</h3>
              </div>
              <div class="badge-warn" style="margin-top:0;">Local + acceso Firebase</div>
            </div>
            <div class="config-module-copy">Ordena ajustes transversales de la Suite con secciones claras, CRUD local útil, acceso Firebase simple y contexto real de espacio compartido sin convertir esto en un laberinto.</div>
            <div class="config-module-stats">
              <div class="config-stat">
                <span class="config-stat-value">5</span>
                <span class="config-stat-label">Carriles listos</span>
              </div>
              <div class="config-stat">
                <span class="config-stat-value">4</span>
                <span class="config-stat-label">Piezas Firebase</span>
              </div>
              <div class="config-stat">
                <span class="config-stat-value">${getUsersRolesUI().users.length}</span>
                <span class="config-stat-label">Usuarios locales</span>
              </div>
            </div>
          </div>

          <div class="config-nav" role="tablist" aria-label="Secciones de Configuración">
            ${navHtml}
          </div>

          <section class="config-panel" aria-labelledby="config-panel-title">
            ${currentSection.buildContent()}
          </section>
        </div>
      `;
    }

    function renderConfigurationModule({ sectionId = 'overview', onExport, onImport } = {}){
      const bodyEl = document.getElementById('backup-modal-body');
      if (!bodyEl) return;
      bodyEl.innerHTML = buildConfigurationModuleHtml({ sectionId });
      bodyEl.scrollTop = 0;
      bindConfigurationModuleEvents({ onExport, onImport });
    }

    function bindConfigurationModuleEvents({ onExport, onImport } = {}){
      const root = document.querySelector('[data-config-shell="1"]');
      if (!root) return;

      root.querySelectorAll('[data-config-open-section]').forEach((button) => {
        button.onclick = () => {
          renderConfigurationModule({
            sectionId: button.dataset.configOpenSection || 'overview',
            onExport,
            onImport
          });
        };
      });

      root.querySelectorAll('[data-ur-panel]').forEach((button) => {
        button.onclick = () => {
          handleUsersRolesPanelChange(
            button.dataset.urPanel || 'overview',
            button.dataset.urUserId || '',
            onExport,
            onImport
          );
        };
      });

      root.querySelectorAll('[data-ur-form]').forEach((form) => {
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const state = getUsersRolesUI();
          const mode = form.dataset.urForm || 'add';

          if (mode === 'add'){
            const payload = readUsersRolesFormPayload(form);
            const validationError = validateUsersRolesPayload(payload, state.users, 'add');
            if (validationError){
              showToast(validationError);
              return;
            }
            payload.id = generateUsersRolesUserId();
            payload.lastSeen = 'Aún sin acceso';
            const users = [...state.users, payload];
            setUsersRolesUI({ users, selectedId: payload.id, panel: 'overview', source: 'local' });
            showToast('Usuario agregado en la base local.');
            rerenderUsersRolesSection(onExport, onImport);
            return;
          }

          if (mode === 'edit'){
            const payload = readUsersRolesFormPayload(form);
            const validationError = validateUsersRolesPayload(payload, state.users, 'edit', payload.id);
            if (validationError){
              showToast(validationError);
              return;
            }
            const users = state.users.map((user) => user.id === payload.id ? { ...user, ...payload, lastSeen: user.lastSeen } : user);
            setUsersRolesUI({ users, selectedId: payload.id, panel: 'overview', source: 'local' });
            showToast('Usuario actualizado en la base local.');
            rerenderUsersRolesSection(onExport, onImport);
            return;
          }

          if (mode === 'assign-role'){
            const fd = new FormData(form);
            const role = CONFIG_ROLE_OPTIONS.includes(fd.get('role')) ? fd.get('role') : 'MIEMBRO';
            const scope = String(fd.get('scope') || '').trim() || 'Sin definir';
            const userId = form.dataset.urUserId || state.selectedId;
            const users = state.users.map((user) => user.id === userId ? { ...user, role, scope } : user);
            setUsersRolesUI({ users, selectedId: userId, panel: 'overview', source: 'local' });
            showToast('Rol local actualizado.');
            rerenderUsersRolesSection(onExport, onImport);
          }
        });
      });

      root.querySelectorAll('[data-ur-confirm-delete]').forEach((button) => {
        button.onclick = () => {
          const state = getUsersRolesUI();
          const userId = button.dataset.urConfirmDelete || '';
          const users = state.users.filter((user) => user.id !== userId);
          const isLastDeletion = !users.length;
          setUsersRolesUI({
            users,
            selectedId: users[0]?.id || null,
            panel: isLastDeletion ? 'overview' : 'overview',
            source: 'local'
          });
          showToast(isLastDeletion ? 'Se eliminó el último usuario local. Puedes crear uno nuevo.' : 'Usuario eliminado de la base local.');
          rerenderUsersRolesSection(onExport, onImport);
        };
      });

      root.querySelectorAll('[data-ur-reset-demo]').forEach((button) => {
        button.onclick = () => {
          const fallback = createDefaultUsersRolesUI();
          configurationUsersRolesUI = fallback;
          persistUsersRolesUI();
          showToast('Se restauró el ejemplo local de usuarios y roles.');
          rerenderUsersRolesSection(onExport, onImport);
        };
      });


      root.querySelectorAll('[data-auth-form="sign-in"]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const fd = new FormData(form);
          const email = String(fd.get('email') || '').trim();
          const password = String(fd.get('password') || '');
          const submitBtn = form.querySelector('button[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try{
            const result = window.A33Auth && typeof window.A33Auth.signIn === 'function'
              ? await window.A33Auth.signIn(email, password)
              : { ok:false, error:{ message:'A33Auth no está disponible.' } };
            if (result?.ok && window.A33Workspace && typeof window.A33Workspace.ensure === 'function'){
              await window.A33Workspace.ensure({ forceEnsure:true });
            }
            showToast(result?.ok ? 'Sesión iniciada correctamente.' : (result?.error?.message || 'No se pudo iniciar sesión.'));
            renderHomeAccessStrip();
            renderConfigurationModule({ sectionId: result?.ok ? 'workspace-context' : 'firebase-base', onExport, onImport });
          }finally{
            if (submitBtn) submitBtn.disabled = false;
          }
        });
      });

      root.querySelectorAll('[data-auth-action]').forEach((button) => {
        button.onclick = async () => {
          const action = button.dataset.authAction || 'refresh';
          button.disabled = true;
          try{
            if (action === 'signout'){
              const result = window.A33Auth && typeof window.A33Auth.signOut === 'function'
                ? await window.A33Auth.signOut()
                : { ok:false, error:{ message:'A33Auth no está disponible.' } };
              showToast(result?.ok ? 'Sesión cerrada correctamente.' : (result?.error?.message || 'No se pudo cerrar sesión.'));
            }else{
              await refreshFirebaseBaseSection({ onExport, onImport, attemptBoot:false });
              showToast('Estado de acceso refrescado.');
            }
            renderHomeAccessStrip();
            renderConfigurationModule({ sectionId: 'firebase-base', onExport, onImport });
          }finally{
            button.disabled = false;
          }
        };
      });

      root.querySelectorAll('[data-workspace-action]').forEach((button) => {
        button.onclick = async () => {
          const action = button.dataset.workspaceAction || 'refresh';
          button.disabled = true;
          try{
            await refreshWorkspaceContextSection({
              onExport,
              onImport,
              forceEnsure: action === 'ensure'
            });
            showToast(action === 'ensure' ? 'Contexto real verificado.' : 'Contexto real refrescado.');
          }finally{
            button.disabled = false;
          }
        };
      });

      root.querySelectorAll('[data-workspace-open-access]').forEach((button) => {
        button.onclick = () => {
          renderConfigurationModule({ sectionId: 'firebase-base', onExport, onImport });
        };
      });

      root.querySelectorAll('[data-firebase-config-form="save"]').forEach((form) => {
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const payload = readFirebaseRuntimeConfigFormPayload(form);
          const validationError = validateFirebaseRuntimeConfigPayload(payload);
          if (validationError){
            showToast(validationError);
            return;
          }
          try{
            if (window.A33FirebaseConfig && typeof window.A33FirebaseConfig.setRuntimeConfig === 'function'){
              window.A33FirebaseConfig.setRuntimeConfig(payload);
            }
            if (window.A33Auth && typeof window.A33Auth.reset === 'function') await window.A33Auth.reset();
            if (window.A33Firebase && typeof window.A33Firebase.reset === 'function') await window.A33Firebase.reset();
            await refreshFirebaseBaseSection({ onExport, onImport, attemptBoot:true });
            renderHomeAccessStrip();
            showToast('Config Firebase guardada en este navegador.');
          }catch(_){
            showToast('No se pudo guardar la config Firebase.');
          }
        });
      });

      root.querySelectorAll('[data-firebase-config-clear]').forEach((button) => {
        button.onclick = async () => {
          button.disabled = true;
          try{
            if (window.A33FirebaseConfig && typeof window.A33FirebaseConfig.clearRuntimeConfig === 'function'){
              window.A33FirebaseConfig.clearRuntimeConfig();
            }
            if (window.A33Auth && typeof window.A33Auth.reset === 'function') await window.A33Auth.reset();
            if (window.A33Firebase && typeof window.A33Firebase.reset === 'function') await window.A33Firebase.reset();
            await refreshFirebaseBaseSection({ onExport, onImport, attemptBoot:false });
            renderHomeAccessStrip();
            showToast('Config Firebase local limpiada.');
          }finally{
            button.disabled = false;
          }
        };
      });

      root.querySelectorAll('[data-firebase-refresh]').forEach((button) => {
        button.onclick = async () => {
          const mode = button.dataset.firebaseRefresh || 'status';
          button.disabled = true;
          try{
            await refreshFirebaseBaseSection({
              onExport,
              onImport,
              attemptBoot: mode === 'boot'
            });
            renderHomeAccessStrip();
            showToast(mode === 'boot' ? 'Diagnóstico Firebase actualizado.' : 'Diagnóstico refrescado.');
          }finally{
            button.disabled = false;
          }
        };
      });

      const exportBtn = root.querySelector('[data-config-action="export"]');
      if (exportBtn){
        exportBtn.onclick = () => {
          hideModal();
          if (typeof onExport === 'function') onExport();
        };
      }

      const importBtn = root.querySelector('[data-config-action="import"]');
      if (importBtn){
        importBtn.onclick = () => {
          hideModal();
          if (typeof onImport === 'function') onImport();
        };
      }
    }

    function showConfigurationHome({ onExport, onImport, initialSection = 'overview' } = {}){
      showModal({
        title: 'Configuración',
        bodyHtml: '',
        primaryText: 'Cerrar',
        onPrimary: hideModal,
        cancelText: 'Cancelar',
        onCancel: hideModal
      });

      renderConfigurationModule({
        sectionId: initialSection,
        onExport,
        onImport
      });
    }

    function showModal({ title, bodyHtml, primaryText, onPrimary, secondaryText, onSecondary, cancelText, onCancel, disableCancel, disablePrimary }){
      const modal = document.getElementById('backup-modal');
      const titleEl = document.getElementById('backup-modal-title');
      const bodyEl = document.getElementById('backup-modal-body');
      const btnCancel = document.getElementById('backup-modal-cancel');
      const btnPrimary = document.getElementById('backup-modal-primary');
      const btnSecondary = document.getElementById('backup-modal-secondary');

      titleEl.textContent = title || 'Configuración';
      bodyEl.innerHTML = bodyHtml || '';

      btnPrimary.textContent = primaryText || 'OK';
      btnPrimary.style.display = disablePrimary ? 'none' : 'inline-flex';
      btnPrimary.onclick = null;
      btnPrimary.onclick = async () => {
        if (typeof onPrimary === 'function') await onPrimary();
      };

      if (secondaryText && typeof onSecondary === 'function'){
        btnSecondary.style.display = 'inline-flex';
        btnSecondary.textContent = secondaryText;
        btnSecondary.onclick = null;
        btnSecondary.onclick = async () => {
          await onSecondary();
        };
      } else {
        btnSecondary.style.display = 'none';
        btnSecondary.onclick = null;
      }

      btnCancel.textContent = cancelText || 'Cancelar';
      btnCancel.style.display = disableCancel ? 'none' : 'inline-flex';
      btnCancel.onclick = null;
      btnCancel.onclick = () => {
        if (typeof onCancel === 'function') onCancel();
        hideModal();
      };

      modal.style.display = 'flex';
    }

    function hideModal(){
      const modal = document.getElementById('backup-modal');
      modal.style.display = 'none';
    }

    function downloadTextFile(filename, content){
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // --- Toast ---
    let __toastTimer = null;
    function showToast(message, ms=4000){
      const el = document.getElementById('a33-toast');
      if (!el) { try{ alert(message); }catch(_){ } return; }
      el.textContent = String(message || '');
      el.classList.add('show');
      if (__toastTimer) clearTimeout(__toastTimer);
      __toastTimer = setTimeout(() => {
        try{ el.classList.remove('show'); }catch(_){ }
      }, Math.max(1500, Number(ms) || 4000));
    }

    // --- Calculadora (ONLY) : export + reset blindado ---
    // Calculadora ONLY (estricto): NO incluye inventario.
    // Compat: backups viejos podrían traer arcano33_inventario; lo aceptamos pero lo IGNORAMOS al restaurar.
    const CALC_ONLY_KEYS = [
      'arcano33_recetas_v1',
      'arcano33_lote_actual',
      'arcano33_fecha_produccion',
      'arcano33_notas_lote',
      'arcano33_lotes'
    ];
    const CALC_ONLY_LEGACY_IGNORED_KEYS = ['arcano33_inventario'];
    const CALC_ONLY_ALLOWED_KEYS = CALC_ONLY_KEYS.concat(CALC_ONLY_LEGACY_IGNORED_KEYS);

    function snapshotCalculatorLocalStorage(){
      const data = {};
      for (const k of CALC_ONLY_KEYS){
        const v = A33Storage.getItem(k);
        if (v != null) data[k] = String(v);
      }
      return data;
    }

    function buildCalcOnlyFilename(){
      const d = new Date();
      const pad = (n) => String(n).padStart(2,'0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
      return `A33_Calculadora_ONLY_${stamp}.json`;
    }

    function buildCalculatorOnlyExport(){
      return {
        app: 'Suite A33',
        module: 'calculadora',
        exportedAt: new Date().toISOString(),
        schemaVersion: 1,
        data: {
          localStorage: snapshotCalculatorLocalStorage()
        }
      };
    }

    function validateCalculatorOnlyBackup(obj){
      if (!obj || typeof obj !== 'object') return { ok:false, reason:'Archivo inválido (no es un objeto JSON).' };

      // metadata mínima (estricta)
      const app = obj.app;
      const module = obj.module;
      if (app !== 'Suite A33') return { ok:false, reason:'Metadata inválida: app debe ser "Suite A33".' };
      if (module !== 'calculadora') return { ok:false, reason:'Metadata inválida: module debe ser "calculadora".' };

      const data = obj.data;
      if (!data || typeof data !== 'object') return { ok:false, reason:'Falta data.' };

      const ls = data.localStorage;
      if (!ls || typeof ls !== 'object') return { ok:false, reason:'Falta data.localStorage.' };

      // Debe contener solo claves permitidas (y al menos 1)
      const keys = Object.keys(ls);
      if (keys.length === 0) return { ok:false, reason:'data.localStorage está vacío.' };

      for (const k of keys){
        if (!CALC_ONLY_ALLOWED_KEYS.includes(k)){
          return { ok:false, reason:`Clave no permitida en data.localStorage: ${k}` };
        }
        const v = ls[k];
        if (typeof v !== 'string'){
          return { ok:false, reason:`Valor inválido para ${k}: se esperaba string.` };
        }
      }

      // Filtrar solo lo estrictamente permitido (sin inventario)
      const filtered = {};
      for (const k of CALC_ONLY_KEYS){
        if (typeof ls[k] === 'string') filtered[k] = ls[k];
      }
      return { ok:true, payload:{ app, module, exportedAt: obj.exportedAt, schemaVersion: obj.schemaVersion, localStorage: filtered } };
    }

    function normalizeJsonText(s){
      return String(s || '').replace(/^﻿/, '').trim();
    }

    function safeJsonParse(text){
      const t = normalizeJsonText(text);
      try{ return { ok:true, obj: JSON.parse(t) }; }catch(e){ return { ok:false, error:e }; }
    }

    function shallowEqualStringsObj(a,b){
      const ak = Object.keys(a||{}).sort();
      const bk = Object.keys(b||{}).sort();
      if (ak.length !== bk.length) return false;
      for (let i=0;i<ak.length;i++){
        if (ak[i] !== bk[i]) return false;
        if (String(a[ak[i]]) !== String(b[bk[i]])) return false;
      }
      return true;
    }

    async function deleteAllSuiteCaches(){
      if (!('caches' in window)) return;
      try{
        const names = await caches.keys();
        const victims = names.filter(n => { const s = String(n||"" ).toLowerCase(); return s.startsWith("a33-") || s.startsWith("arcano33-"); });
        await Promise.all(victims.map(n => caches.delete(n)));
      }catch(_){ }
    }

    function clearSuiteStorageExceptCalculator(keepCalculator){
      // localStorage: solo claves suite
      const suiteKeys = getSuiteLocalStorageKeysInThisBrowser();
      for (const k of suiteKeys){
        if (keepCalculator && CALC_ONLY_KEYS.includes(k)) continue;
        try{ A33Storage.removeItem(k); }catch(_){ }
      }

      // sessionStorage: solo claves suite
      try{
        const toRemove = A33Storage.keys({ scope:'session' }).filter(k => k && isSuiteLocalStorageKey(k));
        toRemove.forEach(k => { try{ A33Storage.removeItem(k, 'session'); }catch(_){ } });
      }catch(_){ }
    }

    function restoreCalculatorLocalStorage(lsObj){
      const entries = Object.entries(lsObj || {});
      for (const [k,v] of entries){
        if (!CALC_ONLY_KEYS.includes(k)) continue;
        try{ A33Storage.setItem(k, String(v)); }catch(_){ }
      }
    }

    async function resetSuitePreservingCalculator(validCalcPayload){
      // Anti-duplicado: si el respaldo coincide con lo actual, no borramos las claves de calculadora.
      const currentCalc = snapshotCalculatorLocalStorage();
      const incomingCalc = validCalcPayload?.localStorage || {};
      const keepCalculator = shallowEqualStringsObj(currentCalc, incomingCalc);

      // 1) IndexedDB (Suite)
      const all = await safeListIndexedDBDatabases();
      const suiteDbList = (Array.isArray(all) ? all : [])
        .filter(d => d && d.name && isSuiteDbName(d.name))
        .map(d => d.name);

      for (const dbName of suiteDbList){
        await deleteDatabase(dbName);
      }

      // 2) localStorage / sessionStorage
      clearSuiteStorageExceptCalculator(keepCalculator);

      // 3) caches (SW)
      await deleteAllSuiteCaches();

      // 4) Restaurar Calculadora (si no la mantuvimos)
      if (!keepCalculator){
        restoreCalculatorLocalStorage(incomingCalc);
      }

      return { kept: keepCalculator };
    }

    function buildBackupFilename(){
      const d = new Date();
      const pad = (n) => String(n).padStart(2,'0');
      const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      return `suitea33-backup-${stamp}.json`;
    }

    async function buildFullBackup(){
      const all = await safeListIndexedDBDatabases();
      const suiteDbList = (Array.isArray(all) ? all : []).filter(d => d && d.name && isSuiteDbName(d.name));

      const dbSnapshots = [];
      const dataIndexedDB = {};
      const dbVersions = {};
      const dbSchemas = {};

      for (const d of suiteDbList){
        try{
          const snap = await snapshotDatabase(d.name);
          dbSnapshots.push(snap);

          dataIndexedDB[d.name] = {};
          dbSchemas[d.name] = {};
          dbVersions[d.name] = snap.version;

          for (const [storeName, s] of Object.entries(snap.stores || {})){
            dataIndexedDB[d.name][storeName] = s.records || [];
            dbSchemas[d.name][storeName] = s.schema || {};
          }
        }catch(e){
          console.warn('No se pudo leer DB', d.name, e);
        }
      }

      const lsSnap = getSuiteLocalStorageSnapshot();
      const cleanIndexed = sanitizeIndexedDbPayload(dataIndexedDB, dbSchemas, dbVersions);

      const backup = {
        meta: {
          appName: BACKUP_APP_NAME,
          exportedAt: new Date().toISOString(),
          dbVersions: cleanIndexed.versions,
          dbSchemas: cleanIndexed.schemas
        },
        data: {
          indexedDB: cleanIndexed.data,
          localStorage: sanitizeSuiteLocalStorageMap(lsSnap.data)
        }
      };

      const jsonString = JSON.stringify(backup, null, 2);
      const estimatedBytes = new Blob([jsonString]).size;

      return {
        backup,
        jsonString,
        estimatedBytes,
        dbSnapshots,
        lsKeys: lsSnap.keys
      };
    }

    function validateBackupStructure(obj){
      if (!obj || typeof obj !== 'object') return { ok:false, reason:'Archivo inválido (no es un objeto JSON).' };
      if (!obj.meta || typeof obj.meta !== 'object') return { ok:false, reason:'Falta meta.' };
      if (!obj.data || typeof obj.data !== 'object') return { ok:false, reason:'Falta data.' };
      if (obj.meta.appName !== BACKUP_APP_NAME) return { ok:false, reason:`appName inválido: se esperaba "${BACKUP_APP_NAME}".` };
      if (!obj.data.indexedDB || typeof obj.data.indexedDB !== 'object') return { ok:false, reason:'Falta data.indexedDB.' };
      if (!obj.data.localStorage || typeof obj.data.localStorage !== 'object') return { ok:false, reason:'Falta data.localStorage.' };
      return { ok:true };
    }

    function summarizeBackupObject(obj){
      const cleanObj = sanitizeBackupObject(obj);
      const dbSnapshots = [];
      const indexed = cleanObj?.data?.indexedDB || {};
      const versions = cleanObj?.meta?.dbVersions || {};
      const schemas = cleanObj?.meta?.dbSchemas || {};

      for (const [dbName, stores] of Object.entries(indexed)){
        const snap = { name: dbName, version: versions?.[dbName] ?? '', stores: {} };
        if (stores && typeof stores === 'object'){
          for (const [storeName, records] of Object.entries(stores)){
            const arr = Array.isArray(records) ? records : [];
            snap.stores[storeName] = {
              count: arr.length,
              schema: (schemas?.[dbName]?.[storeName]) || {},
              records: [] // no duplicar aquí
            };
          }
        }
        dbSnapshots.push(snap);
      }

      const lsKeys = Object.keys(cleanObj?.data?.localStorage || {}).sort();
      let estimatedBytes = 0;
      try{
        estimatedBytes = new Blob([JSON.stringify(obj)]).size;
      }catch(_){}

      return { dbSnapshots, lsKeys, estimatedBytes, exportedAt: obj?.meta?.exportedAt, appName: obj?.meta?.appName };
    }

    async function buildDbVersionWarnings(backupObj){
      const cleanBackup = sanitizeBackupObject(backupObj);
      const warnings = [];
      const bVersions = cleanBackup?.meta?.dbVersions || {};
      const dbNames = Object.keys(cleanBackup?.data?.indexedDB || {});
      for (const dbName of dbNames){
        const b = bVersions?.[dbName];
        if (typeof b !== 'number') continue;
        try{
          const db = await openExistingDB(dbName);
          const c = db.version;
          try{ db.close(); }catch(_){}
          if (typeof c === 'number' && b !== c){
            warnings.push(`${dbName}: respaldo v${b} / este navegador v${c}`);
          }
        }catch(_){
          // Si no existe o no se puede abrir, no advertimos: se creará al importar.
        }
      }
      return warnings;
    }

    function getSuiteLocalStorageKeysInThisBrowser(){
      return A33Storage.keys({ scope: 'local' }).filter(k => k && isSuiteLocalStorageKey(k));
    }

    function deleteDatabase(dbName){
      return new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(dbName);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error || new Error(`No se pudo borrar la DB: ${dbName}`));
        req.onblocked = () => reject(new Error(`Bloqueado: cierra otras pestañas de la Suite y reintenta (DB: ${dbName}).`));
      });
    }

    function openDBForRestore(dbName, version, schemaByStore){
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(dbName, Number(version) || 1);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;

          const stores = schemaByStore && typeof schemaByStore === 'object'
            ? Object.entries(schemaByStore)
            : [];

          for (const [storeName, sch] of stores){
            if (db.objectStoreNames.contains(storeName)) continue;

            const keyPath = (sch && ('keyPath' in sch)) ? sch.keyPath : null;
            const autoIncrement = !!(sch && sch.autoIncrement);

            const opts = {};
            if (keyPath) opts.keyPath = keyPath;
            if (autoIncrement) opts.autoIncrement = true;

            let os;
            try{
              os = db.createObjectStore(storeName, opts);
            }catch(err){
              // fallback súper defensivo
              os = db.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
            }

            try{
              const indices = Array.isArray(sch?.indices) ? sch.indices : [];
              for (const idx of indices){
                if (!idx?.name) continue;
                try{
                  os.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique, multiEntry: !!idx.multiEntry });
                }catch(_){}
              }
            }catch(_){}
          }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error(`No se pudo abrir la DB para restaurar: ${dbName}`));
      });
    }

    async function restoreDatabase(dbName, dbPayload, dbVersion, dbSchemas){
      const schemaByStore = dbSchemas?.[dbName] || {};
      const version = dbVersion?.[dbName] || 1;

      const schemaAvailable = schemaByStore && typeof schemaByStore === 'object' && Object.keys(schemaByStore).length > 0;

      // Si hay esquema: recreamos DB y stores con total seguridad.
      // Si NO hay esquema: intentamos importar sobre una DB ya existente (sin crear / sin cambiar versión).
      const db = schemaAvailable
        ? await openDBForRestore(dbName, version, schemaByStore)
        : await openExistingDB(dbName);

      // Insertar registros por store
      const stores = dbPayload && typeof dbPayload === 'object'
        ? Object.entries(dbPayload)
        : [];

      for (const [storeName, records] of stores){
        if (!db.objectStoreNames.contains(storeName)) continue;

        const arr = Array.isArray(records) ? records : [];
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        // limpiar store antes de insertar
        try{ store.clear(); }catch(_){}

        for (const rec of arr){
          try{ store.put(rec); }catch(_){}
        }
        await txDone(tx);
      }

      try{ db.close(); }catch(_){}
    } 
    async function performImport(obj){ 
      const cleanObj = sanitizeBackupObject(obj);
      const dbPayload = cleanObj?.data?.indexedDB || {};
      const dbVersions = cleanObj?.meta?.dbVersions || {};
      const dbSchemas = cleanObj?.meta?.dbSchemas || {};

      // DBs del archivo que pertenecen a la Suite
      const fileSuite = Object.keys(dbPayload || {}).filter((dbName) => isSuiteDbName(dbName) && !isRetiredGateDbName(dbName));

      // DBs con esquema disponible (podemos borrar y recrear sin miedo)
      const schemaSupported = new Set(
        fileSuite.filter((dbName) => {
          const sch = dbSchemas?.[dbName];
          return sch && typeof sch === 'object' && Object.keys(sch).length > 0;
        })
      );

      // 2) Detectar DBs actuales de la Suite y borrarlas (solo si hay esquema para recrear)
      const current = await safeListIndexedDBDatabases();
      const currentSuite = (Array.isArray(current) ? current : [])
        .filter(d => d?.name && isSuiteDbName(d.name))
        .map(d => d.name);

      const toDelete = Array.from(new Set([...currentSuite, ...fileSuite]))
        .filter(dbName => schemaSupported.has(dbName));

      for (const dbName of toDelete){
        try{
          await deleteDatabase(dbName);
        }catch(e){
          // Si no existía, ok; si está bloqueado, es crítico
          if (String(e?.message || '').toLowerCase().includes('bloqueado')){
            throw e;
          }
        }
      }

      // 3) Restaurar DBs desde el archivo (con o sin esquema)
      for (const dbName of fileSuite){
        await restoreDatabase(dbName, dbPayload[dbName], dbVersions, dbSchemas);
      }

      // 4) Restaurar localStorage (solo keys Suite)
      const currentLsKeys = getSuiteLocalStorageKeysInThisBrowser();
      for (const k of currentLsKeys){
        try{ A33Storage.removeItem(k); }catch(_){}
      }

      const incoming = sanitizeSuiteLocalStorageMap(cleanObj?.data?.localStorage || {});
      for (const [k, v] of Object.entries(incoming)){
        if (!isSuiteLocalStorageKey(k)) continue;
        if (isRetiredGateStorageKey(k)) continue;
        try{ A33Storage.setItem(k, String(v ?? '')); }catch(_){}
      }

      return true;
    }

    function renderHomeAccessStrip(){
      const root = document.getElementById('home-access-strip');
      if (!root) return;
      const status = getAuthAccessStatusSnapshot();
      const workspaceStatus = getWorkspaceContextStatusSnapshot();
      const summary = status?.isAuthenticated
        ? (workspaceStatus?.hasContext
          ? `Sesión activa: ${status?.user?.email || 'usuario autenticado'} · ${workspaceStatus?.workspace?.name || workspaceStatus?.workspace?.id || 'espacio listo'} · ${workspaceStatus?.membership?.role || workspaceStatus?.role || 'MIEMBRO'}`
          : `Sesión activa: ${status?.user?.email || 'usuario autenticado'} · preparando contexto real…`)
        : (status?.code === 'needs-config'
          ? 'Completa la config de Firebase y habilita el acceso real.'
          : (status?.message || 'Sin sesión activa.'));
      const mainButtonLabel = status?.isAuthenticated
        ? (workspaceStatus?.hasContext ? 'Mi espacio' : 'Mi sesión')
        : (status?.code === 'needs-config' ? 'Configurar acceso' : 'Entrar');
      const actions = [];
      actions.push(`<button type="button" class="config-inline-btn" data-home-access-open="1">${escapeHtml(mainButtonLabel)}</button>`);
      if (status?.isAuthenticated){
        actions.push('<button type="button" class="config-inline-btn secondary" data-home-access-signout="1">Salir</button>');
      }
      root.innerHTML = `
        <div class="home-access-copy">
          <strong>${status?.isAuthenticated ? (workspaceStatus?.hasContext ? 'Acceso con contexto' : 'Acceso activo') : 'Acceso simple'}</strong>
          <span>${escapeHtml(summary)}</span>
        </div>
        <div class="home-access-actions">${actions.join('')}</div>
      `;
      bindHomeAccessStripEvents();
    }

    function bindHomeAccessStripEvents(){
      const root = document.getElementById('home-access-strip');
      if (!root) return;
      const openBtn = root.querySelector('[data-home-access-open]');
      if (openBtn){
        openBtn.onclick = () => {
          const authStatus = getAuthAccessStatusSnapshot();
          const workspaceStatus = getWorkspaceContextStatusSnapshot();
          showConfigurationHome({
            onExport: () => {
              const exportCard = document.getElementById('card-export-backup');
              if (exportCard) exportCard.click();
            },
            onImport: () => {
              const importCard = document.getElementById('card-import-backup');
              if (importCard) importCard.click();
            },
            initialSection: authStatus?.isAuthenticated && workspaceStatus?.hasContext ? 'workspace-context' : 'firebase-base'
          });
        };
      }
      const signOutBtn = root.querySelector('[data-home-access-signout]');
      if (signOutBtn){
        signOutBtn.onclick = async () => {
          signOutBtn.disabled = true;
          try{
            const result = window.A33Auth && typeof window.A33Auth.signOut === 'function'
              ? await window.A33Auth.signOut()
              : { ok:false, error:{ message:'A33Auth no está disponible.' } };
            if (result?.ok){
              showToast('Sesión cerrada correctamente.');
            }else{
              showToast(result?.error?.message || 'No se pudo cerrar sesión.');
            }
            renderHomeAccessStrip();
          }finally{
            signOutBtn.disabled = false;
          }
        };
      }
    }

    document.addEventListener('DOMContentLoaded', () => {

      // Navegación: tarjetas del menú principal
      document.querySelectorAll('[data-link]').forEach(card => {
        card.addEventListener('click', () => {
          const href = card.getAttribute('data-link');
          if (href) window.location.href = href;
        });
      });

      // --- Respaldo: Exportar / Importar ---
      const exportCard = document.getElementById('card-export-backup');
      const importCard = document.getElementById('card-import-backup');
      const fileInput = document.getElementById('backup-file-input');

      // Card: Configuración (hub)
      const backupHubCard = document.getElementById('card-backup-hub');
      if (backupHubCard){
        backupHubCard.addEventListener('click', () => {
          showConfigurationHome({
            onExport: () => {
              if (exportCard) exportCard.click();
            },
            onImport: () => {
              if (importCard) importCard.click();
            }
          });
        });
      }

      if (exportCard){
        exportCard.addEventListener('click', async () => {
          showModal({
            title: 'Resumen del respaldo',
            bodyHtml: '<div class="muted">Generando resumen...</div>',
            primaryText: 'Cerrar',
            onPrimary: hideModal,
            cancelText: 'Cancelar',
            onCancel: hideModal
          });

          try{
            const { backup, jsonString, estimatedBytes, dbSnapshots, lsKeys } = await buildFullBackup();

            const totalDbRecords = dbSnapshots.reduce((acc, d) => {
              const stores = Object.values(d.stores || {});
              return acc + stores.reduce((a, s) => a + (Number(s.count) || 0), 0);
            }, 0);

            const hasAnyData = totalDbRecords > 0 || (lsKeys && lsKeys.length > 0);

            if (!hasAnyData){
              showModal({
                title: 'Resumen del respaldo',
                bodyHtml: '<div class="badge-warn">⚠️ No hay datos para respaldar.</div>',
                primaryText: 'Cerrar',
                onPrimary: hideModal,
                disableCancel: true
              });
              return;
            }

            const summaryHtml = buildSummaryHtmlFromSnapshot({
              dbSnapshots,
              lsKeys,
              exportedAt: backup?.meta?.exportedAt,
              estimatedBytes,
              warnings: [],
              appName: backup?.meta?.appName
            });

            showModal({
              title: 'Resumen del respaldo',
              bodyHtml: summaryHtml,
              primaryText: 'Descargar respaldo',
              onPrimary: async () => {
                downloadTextFile(buildBackupFilename(), jsonString);
                hideModal();
              },
              cancelText: 'Cancelar',
              onCancel: hideModal
            });
          }catch(e){
            showModal({
              title: 'Error',
              bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
              primaryText: 'Cerrar',
              onPrimary: hideModal,
              disableCancel: true
            });
          }
        });
      }

      if (importCard && fileInput){
        importCard.addEventListener('click', () => {
          fileInput.value = '';
          fileInput.click();
        });

        fileInput.addEventListener('change', async () => {
          const file = fileInput.files && fileInput.files[0];
          if (!file) return;

          showModal({
            title: 'Resumen del archivo',
            bodyHtml: '<div class="muted">Leyendo archivo...</div>',
            primaryText: 'Cerrar',
            onPrimary: hideModal,
            cancelText: 'Cancelar',
            onCancel: hideModal
          });

          try{
            const text = await file.text();
            let obj;
            try{
              obj = JSON.parse(text);
            }catch(_){
              throw new Error('JSON inválido o corrupto.');
            }

            const v = validateBackupStructure(obj);
            if (!v.ok) throw new Error(v.reason);

            const sum = summarizeBackupObject(obj);

            // Comparar versiones del respaldo vs las DB existentes en ESTE navegador (solo advertencia, no bloqueo)
            const warnings = await buildDbVersionWarnings(obj);

            const summaryHtml = buildSummaryHtmlFromSnapshot({
              dbSnapshots: sum.dbSnapshots,
              lsKeys: sum.lsKeys,
              exportedAt: sum.exportedAt,
              estimatedBytes: sum.estimatedBytes,
              warnings: warnings,
              appName: sum.appName
            }) + `
              <hr>
              <div class="badge-warn">⚠️ Esto reemplazará todos los datos actuales de este navegador.</div>
            `;

            showModal({
              title: 'Resumen del archivo',
              bodyHtml: summaryHtml,
              primaryText: 'Importar y reemplazar',
              onPrimary: async () => {if (!confirm('Esto reemplazará TODOS los datos actuales de la Suite A33 en este navegador. ¿Importar y reemplazar?')) return;

                showModal({
                  title: 'Importando...',
                  bodyHtml: '<div class="muted">Aplicando respaldo... No cierres esta pestaña.</div>',
                  disableCancel: true,
                  disablePrimary: true
                });

                try{
                  await performImport(obj);

                  showModal({
                    title: 'Importación exitosa',
                    bodyHtml: '<div>✅ Respaldo importado correctamente.</div><div class="small-note">Recomendado: recargar para que todos los módulos lean los nuevos datos.</div>',
                    primaryText: 'Recargar ahora',
                    onPrimary: () => location.reload(),
                    cancelText: 'Más tarde',
                    onCancel: hideModal
                  });
                }catch(err){
                  showModal({
                    title: 'Error de importación',
                    bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(err?.message || err)}</div><div class="small-note">Tip: cierra otras pestañas de la Suite y vuelve a intentar.</div>`,
                    primaryText: 'Cerrar',
                    onPrimary: hideModal,
                    disableCancel: true
                  });
                }
              },
              cancelText: 'Cancelar',
              onCancel: hideModal
            });

          }catch(e){
            showModal({
              title: 'Error',
              bodyHtml: `<div class="badge-warn">⚠️ ${escapeHtml(e?.message || e)}</div>`,
              primaryText: 'Cerrar',
              onPrimary: hideModal,
              disableCancel: true
            });
          }
        });
      }
      try{
        if (window.A33Firebase && typeof window.A33Firebase.refreshStatus === 'function'){
          window.A33Firebase.refreshStatus({ attemptBoot: false });
        }
      }catch(_){ }

      renderHomeAccessStrip();
      try{
        const authEventName = (window.A33Auth && window.A33Auth.EVENT_NAME) || 'a33-auth-state';
        const workspaceEventName = (window.A33Workspace && window.A33Workspace.EVENT_NAME) || 'a33-workspace-state';
        window.addEventListener(authEventName, () => {
          renderHomeAccessStrip();
        });
        window.addEventListener(workspaceEventName, () => {
          renderHomeAccessStrip();
        });
        if (window.A33Auth && typeof window.A33Auth.refresh === 'function'){
          window.A33Auth.refresh().catch(() => {});
        }
        if (window.A33Workspace && typeof window.A33Workspace.refresh === 'function'){
          window.A33Workspace.refresh({ forceEnsure:false }).catch(() => {});
        }
      }catch(_){ }

      initHomeUi();

    });
  