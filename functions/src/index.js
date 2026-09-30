const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

const REGION = 'us-central1';
const BACKEND_VERSION = '2026.03.25-etapa11';
const DEFAULT_WORKSPACE_ID = 'default';
const PROFILE_VERSION = 2;

setGlobalOptions({ region: REGION, maxInstances: 10 });

const ROLE_DEFINITIONS = {
  admin: {
    label: 'Admin',
    permissions: [
      'suite.use',
      'config.view',
      'users.view',
      'users.manage',
      'roles.assign',
      'backup.manage',
      'firebase.admin',
      'sales.use',
      'agenda.use',
      'finance.use',
      'purchases.use',
      'reports.view',
      'inventory.use',
      'production.use',
      'lots.use',
      'pedidos.use',
      'center.view',
      'sandbox.use',
      'catalog.view'
    ]
  },
  ventas: {
    label: 'Ventas',
    permissions: [
      'suite.use',
      'sales.use',
      'agenda.use',
      'customers.view',
      'inventory.use',
      'production.use',
      'lots.use',
      'pedidos.use',
      'center.view',
      'reports.view',
      'catalog.view'
    ]
  },
  finanzas: {
    label: 'Finanzas',
    permissions: [
      'suite.use',
      'finance.use',
      'purchases.use',
      'reports.view',
      'center.view',
      'catalog.view'
    ]
  },
  consulta: {
    label: 'Consulta',
    permissions: [
      'suite.use',
      'reports.view',
      'center.view',
      'catalog.view'
    ]
  }
};

function cleanString(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function normalizeWorkspaceId(value) {
  const cleaned = cleanString(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/-{2,}/g, '-').replace(/^[-_]+|[-_]+$/g, '');
  return cleaned || DEFAULT_WORKSPACE_ID;
}

function validRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_DEFINITIONS, role);
}

function validStatus(status) {
  return status === 'active' || status === 'inactive';
}

function assertName(name) {
  const clean = cleanString(name).replace(/\s+/g, ' ');
  if (clean.length < 2 || clean.length > 80) {
    throw new HttpsError('invalid-argument', 'El nombre debe tener entre 2 y 80 caracteres.');
  }
  return clean;
}

function assertEmail(email) {
  const clean = normalizeEmail(email);
  const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  if (!ok || clean.length > 120) {
    throw new HttpsError('invalid-argument', 'El correo no tiene un formato válido.');
  }
  return clean;
}

function normalizeRole(role) {
  const clean = cleanString(role).toLowerCase();
  if (!validRole(clean)) {
    throw new HttpsError('invalid-argument', 'Rol inválido.');
  }
  return clean;
}

function normalizeStatus(status) {
  const clean = cleanString(status).toLowerCase();
  if (!validStatus(clean)) {
    throw new HttpsError('invalid-argument', 'Estado inválido.');
  }
  return clean;
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 14; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function workspaceRef(workspaceId) {
  return db.collection('workspaces').doc(workspaceId);
}

function memberRef(workspaceId, uid) {
  return workspaceRef(workspaceId).collection('members').doc(uid);
}

function archivedMemberRef(workspaceId, uid) {
  return workspaceRef(workspaceId).collection('archivedMembers').doc(uid);
}

async function getWorkspaceSummary(workspaceId) {
  const snap = await workspaceRef(workspaceId).get();
  return snap.exists ? snap.data() || {} : {};
}

async function assertNotLastActiveAdmin(workspaceId, uid) {
  const summary = await getWorkspaceSummary(workspaceId);
  const activeAdminCount = Number(summary.activeAdminCount || 0);
  if (activeAdminCount <= 1) {
    throw new HttpsError('failed-precondition', 'No puedes dejar el workspace sin al menos un Admin activo.');
  }
  return activeAdminCount;
}

function buildPermissions(role) {
  return Array.from(new Set((ROLE_DEFINITIONS[role] && ROLE_DEFINITIONS[role].permissions) || ROLE_DEFINITIONS.consulta.permissions));
}

function buildClaims({ role, status, workspaceId }) {
  return {
    role,
    status,
    workspaceId,
    permissionsVersion: PROFILE_VERSION
  };
}

async function recomputeWorkspaceSummary(workspaceId) {
  const membersSnap = await workspaceRef(workspaceId).collection('members').get();
  let total = 0;
  let active = 0;
  let inactive = 0;
  let activeAdminCount = 0;

  membersSnap.forEach((doc) => {
    const data = doc.data() || {};
    total += 1;
    if (data.status === 'active') {
      active += 1;
      if (data.role === 'admin') activeAdminCount += 1;
    } else {
      inactive += 1;
    }
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await workspaceRef(workspaceId).set({
    workspaceId,
    summaryVersion: PROFILE_VERSION,
    memberCount: total,
    activeCount: active,
    inactiveCount: inactive,
    activeAdminCount,
    bootstrapCompletedAt: activeAdminCount > 0 ? now : admin.firestore.FieldValue.delete(),
    updatedAt: now
  }, { merge: true });

  return { total, active, inactive, activeAdminCount };
}

async function assertAuthenticated(request) {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError('unauthenticated', 'Debes iniciar sesión para usar esta función.');
  }
  return {
    uid: request.auth.uid,
    token: request.auth.token || {},
    email: normalizeEmail(request.auth.token && request.auth.token.email)
  };
}

async function assertAdminContext(request) {
  const authContext = await assertAuthenticated(request);
  const workspaceId = normalizeWorkspaceId(authContext.token.workspaceId || DEFAULT_WORKSPACE_ID);
  if (cleanString(authContext.token.role).toLowerCase() !== 'admin' || cleanString(authContext.token.status).toLowerCase() !== 'active') {
    throw new HttpsError('permission-denied', 'Tu token no trae privilegios administrativos activos.');
  }

  const memberSnap = await memberRef(workspaceId, authContext.uid).get();
  const memberData = memberSnap.exists ? memberSnap.data() || {} : null;
  if (!memberData || memberData.role !== 'admin' || memberData.status !== 'active') {
    throw new HttpsError('permission-denied', 'Tu perfil ya no tiene permisos administrativos vigentes.');
  }

  return {
    uid: authContext.uid,
    workspaceId,
    email: authContext.email,
    member: memberData
  };
}

async function writeMemberProfile({ uid, workspaceId, name, email, role, status, actorUid, createdBy, authProvider, preserveCreatedAt, extra = {} }) {
  const ref = memberRef(workspaceId, uid);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await ref.get();
  const existingData = existing.exists ? existing.data() || {} : {};

  const payload = {
    uid,
    workspaceId,
    name,
    email,
    role,
    status,
    permissions: buildPermissions(role),
    profileVersion: PROFILE_VERSION,
    authProvider: authProvider || existingData.authProvider || 'password',
    createdBy: existing.exists ? (existingData.createdBy || createdBy || actorUid || 'system') : (createdBy || actorUid || 'system'),
    updatedBy: actorUid || 'system',
    lastAdminMutationAt: now,
    updatedAt: now,
    ...extra
  };

  if (preserveCreatedAt && existing.exists && existingData.createdAt) {
    payload.createdAt = existingData.createdAt;
  } else if (!existing.exists) {
    payload.createdAt = now;
  }

  await ref.set(payload, { merge: true });
  return payload;
}

async function archiveMemberProfile({ workspaceId, uid, actorUid, reason, memberData, authUserExists }) {
  const source = memberData && typeof memberData === 'object' ? memberData : {};
  await archivedMemberRef(workspaceId, uid).set({
    ...source,
    uid,
    workspaceId,
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    archivedBy: actorUid || 'system',
    archiveReason: cleanString(reason || 'deleted'),
    authUserExists: !!authUserExists
  }, { merge: true });
}

exports.a33AdminHealthcheck = onCall(async (request) => {
  const authContext = await assertAuthenticated(request);
  const requestedWorkspace = request.data && request.data.workspaceId ? request.data.workspaceId : authContext.token.workspaceId;
  const workspaceId = normalizeWorkspaceId(requestedWorkspace || DEFAULT_WORKSPACE_ID);
  const workspaceSnap = await workspaceRef(workspaceId).get();
  const workspaceData = workspaceSnap.exists ? workspaceSnap.data() || {} : {};
  const activeAdminCount = Number(workspaceData.activeAdminCount || 0);
  return {
    ok: true,
    region: REGION,
    backendVersion: BACKEND_VERSION,
    workspaceId,
    workspaceExists: workspaceSnap.exists,
    workspaceReady: workspaceSnap.exists && activeAdminCount > 0,
    activeAdminCount,
    currentUserCanBootstrap: activeAdminCount < 1,
    message: activeAdminCount > 0
      ? 'Backend administrativo desplegado y workspace con admin activo.'
      : 'Backend administrativo desplegado. Falta bootstrap inicial del admin.'
  };
});

exports.a33BootstrapWorkspaceAdmin = onCall(async (request) => {
  const authContext = await assertAuthenticated(request);
  const workspaceId = normalizeWorkspaceId((request.data && request.data.workspaceId) || authContext.token.workspaceId || DEFAULT_WORKSPACE_ID);
  const userRecord = await auth.getUser(authContext.uid);
  const email = assertEmail(userRecord.email || authContext.email);
  const name = assertName(userRecord.displayName || email.split('@')[0] || 'Administrador');

  const workspaceDoc = workspaceRef(workspaceId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(workspaceDoc);
    const data = snap.exists ? snap.data() || {} : {};
    const owner = cleanString(data.bootstrapOwner || '');
    const activeAdminCount = Number(data.activeAdminCount || 0);

    if (activeAdminCount > 0 && owner && owner !== authContext.uid) {
      throw new HttpsError('failed-precondition', 'Ese workspace ya tiene un admin inicial activo.');
    }

    tx.set(workspaceDoc, {
      workspaceId,
      name: data.name || 'Workspace principal',
      bootstrapOwner: authContext.uid,
      bootstrapStatus: 'pending',
      profileVersion: PROFILE_VERSION,
      createdAt: snap.exists && data.createdAt ? data.createdAt : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  await auth.setCustomUserClaims(authContext.uid, buildClaims({ role: 'admin', status: 'active', workspaceId }));
  await auth.revokeRefreshTokens(authContext.uid);
  await writeMemberProfile({
    uid: authContext.uid,
    workspaceId,
    name,
    email,
    role: 'admin',
    status: 'active',
    actorUid: authContext.uid,
    createdBy: 'system-bootstrap',
    authProvider: (userRecord.providerData && userRecord.providerData[0] && userRecord.providerData[0].providerId) || 'password',
    preserveCreatedAt: true,
    extra: {
      bootstrapOrigin: 'callable',
      bootstrapCompletedAt: admin.firestore.FieldValue.serverTimestamp()
    }
  });

  const summary = await recomputeWorkspaceSummary(workspaceId);
  await workspaceDoc.set({
    bootstrapOwner: authContext.uid,
    bootstrapStatus: 'ready',
    bootstrapCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    ok: true,
    workspaceId,
    role: 'admin',
    status: 'active',
    memberCount: summary.total,
    activeAdminCount: summary.activeAdminCount,
    message: 'Admin inicial creado correctamente. Refresca el token en la app para ver el rol nuevo.'
  };
});

exports.a33AdminUpsertUser = onCall(async (request) => {
  const adminContext = await assertAdminContext(request);
  const input = request.data && typeof request.data === 'object' ? request.data : {};
  const workspaceId = normalizeWorkspaceId(input.workspaceId || adminContext.workspaceId);
  if (workspaceId !== adminContext.workspaceId) {
    throw new HttpsError('permission-denied', 'No puedes administrar otro workspace.');
  }

  const name = assertName(input.name);
  const email = assertEmail(input.email);
  const role = normalizeRole(input.role);
  const status = normalizeStatus(input.status);
  const providedUid = cleanString(input.uid || '');
  const providedPassword = cleanString(input.tempPassword || '');

  let userRecord;
  let created = false;
  let temporaryPassword = '';

  if (providedUid) {
    const existingMemberSnap = await memberRef(workspaceId, providedUid).get();
    const existingMember = existingMemberSnap.exists ? existingMemberSnap.data() || {} : null;
    const wasActiveAdmin = !!(existingMember && existingMember.role === 'admin' && existingMember.status === 'active');
    const willBeActiveAdmin = role === 'admin' && status === 'active';

    if (providedUid === adminContext.uid && !willBeActiveAdmin) {
      throw new HttpsError('failed-precondition', 'Tu propio perfil debe seguir como Admin activo desde este panel.');
    }
    if (wasActiveAdmin && !willBeActiveAdmin) {
      await assertNotLastActiveAdmin(workspaceId, providedUid);
    }

    userRecord = await auth.updateUser(providedUid, {
      email,
      displayName: name,
      disabled: status !== 'active'
    });
    if (providedPassword) {
      await auth.updateUser(providedUid, { password: providedPassword });
      temporaryPassword = providedPassword;
    }
  } else {
    temporaryPassword = providedPassword || generateTemporaryPassword();
    try {
      userRecord = await auth.createUser({
        email,
        displayName: name,
        password: temporaryPassword,
        disabled: status !== 'active'
      });
      created = true;
    } catch (error) {
      if (error && error.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'Ya existe un usuario de Authentication con ese correo.');
      }
      throw error;
    }
  }

  await auth.setCustomUserClaims(userRecord.uid, buildClaims({ role, status, workspaceId }));
  await auth.revokeRefreshTokens(userRecord.uid);
  await writeMemberProfile({
    uid: userRecord.uid,
    workspaceId,
    name,
    email,
    role,
    status,
    actorUid: adminContext.uid,
    createdBy: adminContext.uid,
    authProvider: (userRecord.providerData && userRecord.providerData[0] && userRecord.providerData[0].providerId) || 'password',
    preserveCreatedAt: true,
    extra: {
      passwordProvisioning: created ? 'temporary-generated' : (providedPassword ? 'temporary-manual' : 'unchanged')
    }
  });

  const summary = await recomputeWorkspaceSummary(workspaceId);

  return {
    ok: true,
    created,
    uid: userRecord.uid,
    workspaceId,
    role,
    status,
    memberCount: summary.total,
    activeAdminCount: summary.activeAdminCount,
    temporaryPassword: created ? temporaryPassword : '',
    message: created
      ? 'Usuario creado en Authentication y perfil sincronizado en Firestore.'
      : 'Usuario actualizado en Authentication, claims y Firestore.'
  };
});

exports.a33AdminDeleteUser = onCall(async (request) => {
  const adminContext = await assertAdminContext(request);
  const input = request.data && typeof request.data === 'object' ? request.data : {};
  const workspaceId = normalizeWorkspaceId(input.workspaceId || adminContext.workspaceId);
  const uid = cleanString(input.uid || '');

  if (!uid) {
    throw new HttpsError('invalid-argument', 'Debes indicar el uid del usuario a borrar.');
  }
  if (workspaceId !== adminContext.workspaceId) {
    throw new HttpsError('permission-denied', 'No puedes borrar usuarios de otro workspace.');
  }
  if (uid === adminContext.uid) {
    throw new HttpsError('failed-precondition', 'No se permite borrarte a ti mismo desde esta función.');
  }

  const memberSnap = await memberRef(workspaceId, uid).get();
  const memberData = memberSnap.exists ? memberSnap.data() || {} : null;
  const targetIsActiveAdmin = !!(memberData && memberData.role === 'admin' && memberData.status === 'active');
  if (targetIsActiveAdmin) {
    await assertNotLastActiveAdmin(workspaceId, uid);
  }

  let authUserExists = true;
  try {
    await auth.getUser(uid);
  } catch (error) {
    if (error && error.code === 'auth/user-not-found') authUserExists = false;
    else throw error;
  }

  if (memberData) {
    await archiveMemberProfile({
      workspaceId,
      uid,
      actorUid: adminContext.uid,
      reason: 'deleted-from-admin-panel',
      memberData,
      authUserExists
    });
  }

  await memberRef(workspaceId, uid).delete();
  try {
    await auth.deleteUser(uid);
  } catch (error) {
    if (!error || error.code !== 'auth/user-not-found') throw error;
  }

  const summary = await recomputeWorkspaceSummary(workspaceId);

  return {
    ok: true,
    uid,
    workspaceId,
    memberCount: summary.total,
    activeAdminCount: summary.activeAdminCount,
    archived: !!memberData,
    message: 'Usuario borrado de Authentication y perfil archivado de forma segura en Firestore.'
  };
});
