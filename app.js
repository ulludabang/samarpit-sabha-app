// ==============================================================================
// SAMARPIT IRANIWADI - Application Logic
// Features: Google OAuth, Role-Based Access Control, Activity Audit Logs,
//           Multi-Device Realtime Sync, Supabase PostgreSQL, Offline Cache
// ==============================================================================

const MASTER_ADMIN_EMAIL = 'ulludabang@gmail.com';

const STORAGE_KEYS = {
  STATE: 'sabha-register-v1',
  SUPABASE_URL: 'sabha_supabase_url',
  SUPABASE_KEY: 'sabha_supabase_key',
  LOGS: 'sabha_activity_logs_v1',
  USERS: 'sabha_app_users_v1'
};

// Application State
let S = {
  children: [],
  sabhas: [],
  att: {}
};

let appUsers = [];
let activityLogs = [];
let dbMissingUsersTable = false;

let tab = 'sabha';
let page = 'cur';
let attId = null;
let q = '';
let currentUser = null;
let supabaseClient = null;
let realtimeChannel = null;
let isSyncing = false;
let syncPending = false;
let isSyncingUsers = false;
let syncUsersPending = false;
let lastRenderedStateHash = '';
let syncHeartbeat = null;
let reconnectTimer = null;

// DOM Utilities
const $ = s => document.querySelector(s);
const dlg = $('#dlg');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => 'local_' + Math.random().toString(36).slice(2, 9);
const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
const fmt = d => {
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return d;
  }
};
const timeAgo = dateString => {
  try {
    const d = new Date(dateString);
    const now = new Date();
    const diffSec = Math.max(0, Math.floor((now - d) / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateString;
  }
};

const kids = () => [...S.children].sort((a, b) => a.name.localeCompare(b.name));
const bySabha = () => [...S.sabhas].sort((a, b) => a.date.localeCompare(b.date));
const empty = (t, m) => `<div class="card empty"><h3>${esc(t)}</h3><p class="meta">${esc(m)}</p></div>`;

// Toast Notification
function toast(msg, type = 'info') {
  const container = $('#toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${esc(msg)}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 250);
  }, 3500);
}

// ------------------------------------------------------------------------------
// 1. Permissions & Role Checking
// ------------------------------------------------------------------------------

function isUserAdmin() {
  if (!currentUser || !currentUser.email) return false;
  const email = currentUser.email.toLowerCase().trim();
  if (email === MASTER_ADMIN_EMAIL.toLowerCase().trim()) return true;

  const user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === email);
  return !!(user && user.role === 'admin' && user.status === 'approved');
}

function getUserStatus() {
  if (!currentUser || !currentUser.email) return 'unauthenticated';
  const email = currentUser.email.toLowerCase().trim();
  if (email === MASTER_ADMIN_EMAIL.toLowerCase().trim()) return 'admin';

  const user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === email);
  if (!user) return 'pending';
  if (user.role === 'admin' && user.status === 'approved') return 'admin';
  if (user.status === 'pending') return 'pending';
  return 'viewer';
}

function getPendingRequests() {
  const seen = new Set();
  return appUsers.filter(u => {
    if (!u || !u.email) return false;
    const em = u.email.toLowerCase().trim();
    if (em === MASTER_ADMIN_EMAIL.toLowerCase()) return false;
    if (seen.has(em)) return false;
    seen.add(em);
    return u.status && u.status.toLowerCase() === 'pending';
  });
}

// ------------------------------------------------------------------------------
// 2. Supabase & Auth Initialization
// ------------------------------------------------------------------------------

function getSupabaseCredentials() {
  const customUrl = localStorage.getItem(STORAGE_KEYS.SUPABASE_URL);
  const customKey = localStorage.getItem(STORAGE_KEYS.SUPABASE_KEY);

  const url = customUrl || (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_URL) || '';
  const key = customKey || (window.APP_CONFIG && window.APP_CONFIG.SUPABASE_ANON_KEY) || '';

  return { url: url.trim(), key: key.trim() };
}

async function initSupabase() {
  const { url, key } = getSupabaseCredentials();

  if (!url || !key) {
    console.log('[Samarpit] No Supabase credentials configured.');
    updateSyncBadge('offline');
    return false;
  }

  try {
    if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
      console.error('[Samarpit] Supabase JS library not loaded.');
      return false;
    }

    supabaseClient = window.supabase.createClient(url, key);

    // Check existing auth session
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
    }

    // Subscribe to auth state changes
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      console.log('[Samarpit] Auth state change:', event, session?.user?.email);
      const prevUser = currentUser;
      currentUser = session ? session.user : null;

      if (currentUser && (!prevUser || prevUser.id !== currentUser.id)) {
        toast(`Signed in as ${currentUser.email}`, 'ok');
        await registerOrCheckUser();
        await syncFromCloud();
      }

      updateAuthUI();
      render();
    });

    updateSyncBadge('cloud');
    setupRealtime();
    return true;
  } catch (err) {
    console.error('[Samarpit] Supabase initialization failed:', err);
    updateSyncBadge('offline');
    return false;
  }
}

function updateSyncBadge(mode) {
  const el = $('#status-badge');
  if (!el) return;
  if (mode === 'cloud') {
    el.className = 'chip-status cloud';
    el.innerHTML = '● Cloud Connected';
    el.title = 'Connected to Supabase PostgreSQL database';
  } else {
    el.className = 'chip-status offline';
    el.innerHTML = '○ Local / Demo Mode';
    el.title = 'Saved locally in this browser.';
  }
}

function updateAuthUI() {
  const authContainer = $('#auth-status');
  if (!authContainer) return;

  if (currentUser) {
    const avatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
    const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    const isAdmin = isUserAdmin();
    const pendingCount = getPendingRequests().length;

    authContainer.innerHTML = `
      <div class="user-badge" title="${esc(currentUser.email)}">
        ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" class="user-avatar" referrerpolicy="no-referrer">` : ''}
        <span>${esc(name)}</span>
        <span class="badge-role ${isAdmin ? 'admin' : 'viewer'}">${isAdmin ? 'Admin' : 'Viewer'}</span>
      </div>
      ${isAdmin ? `
        <button class="btn ghost sm" id="btn-admin-panel" title="Admin & Allowance Requests" style="${pendingCount > 0 ? 'border-color:var(--accent);background:var(--soft);' : ''}">
          🛡️ Admin ${pendingCount > 0 ? `<span class="chip" style="padding:1px 6px;font-size:11px;margin-left:2px;">${pendingCount}</span>` : ''}
        </button>
      ` : (
        getUserStatus() === 'pending' ? `
          <button class="btn ghost sm" data-act="req-admin" title="Request pending approval" style="font-size:12px;padding:4px 9px;border-color:var(--accent);background:var(--soft);color:var(--accent-text);">⏳ Pending</button>
        ` : `
          <button class="btn ghost sm" data-act="req-admin" title="Request administrator permissions" style="font-size:12px;padding:4px 9px;">Request Admin</button>
        `
      )}
      <button class="btn ghost sm" id="btn-sign-out" title="Sign Out">Logout</button>
    `;

    const btnOut = $('#btn-sign-out');
    if (btnOut) btnOut.onclick = handleSignOut;

    const btnAdmin = $('#btn-admin-panel');
    if (btnAdmin) btnAdmin.onclick = openAdminModal;
  } else {
    authContainer.innerHTML = '';
  }
}

async function handleSignIn() {
  if (!supabaseClient) {
    toast('Database configuration is missing.', 'error');
    return;
  }
  toast('Redirecting to Google Sign-In...', 'info');
  const redirectUrl = window.location.origin + window.location.pathname;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectUrl
    }
  });
  if (error) {
    console.error('[Samarpit] Google OAuth Error:', error);
    toast(error.message, 'error');
  }
}

async function handleSignOut() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    toast(error.message, 'error');
  } else {
    currentUser = null;
    S = { children: [], sabhas: [], att: {} };
    localStorage.removeItem(STORAGE_KEYS.STATE);
    updateAuthUI();
    toast('Signed out successfully', 'ok');
    render();
  }
}

// ------------------------------------------------------------------------------
// 3. Allowance Request & User Management
// ------------------------------------------------------------------------------

async function registerOrCheckUser() {
  if (!currentUser || !currentUser.email) return;
  const email = currentUser.email.toLowerCase().trim();
  const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  const avatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;
  const isMaster = email === MASTER_ADMIN_EMAIL.toLowerCase().trim();

  // 1. Fetch user status directly from Supabase app_users table first
  let cloudUser = null;
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from('app_users')
        .select('*')
        .eq('email', email)
        .maybeSingle();

      if (!error && data) {
        cloudUser = data;
        dbMissingUsersTable = false;
      } else if (!error && !data) {
        dbMissingUsersTable = false;
      } else if (error) {
        console.warn('[Samarpit] Cloud check error:', error.message);
      }
    } catch (err) {
      console.warn('[Samarpit] Cloud user lookup warning:', err.message);
    }
  }

  let user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === email);

  if (cloudUser) {
    // USER ALREADY EXISTS IN SUPABASE:
    // CRITICAL: Always adopt the cloud role and status! Never downgrade an approved admin!
    if (!user) {
      user = { ...cloudUser };
      appUsers.push(user);
    } else {
      user.role = cloudUser.role;
      user.status = cloudUser.status;
    }

    user.name = name;
    if (avatar) user.avatar = avatar;

    if (isMaster) {
      user.role = 'admin';
      user.status = 'approved';
    }

    // Only update name and avatar metadata in Supabase (preserves existing admin role!)
    if (supabaseClient) {
      try {
        await supabaseClient
          .from('app_users')
          .update({
            name,
            avatar,
            role: user.role,
            status: user.status,
            updated_at: new Date().toISOString()
          })
          .eq('email', email);
      } catch (e) {}
    }
  } else {
    // TRULY NEW USER: Register as pending allowance request (or admin if master)
    const initialRole = isMaster ? 'admin' : (user?.role || 'viewer');
    const initialStatus = isMaster ? 'approved' : (user?.status || 'pending');

    if (!user) {
      user = {
        email,
        name,
        avatar,
        role: initialRole,
        status: initialStatus,
        created_at: new Date().toISOString()
      };
      appUsers.push(user);
      if (!isMaster) {
        logActivity('Allowance Request Registered', `New user ${name} (${email}) signed in and was added to pending requests.`);
      }
    } else {
      user.name = name;
      if (avatar) user.avatar = avatar;
      if (isMaster) {
        user.role = 'admin';
        user.status = 'approved';
      }
    }

    if (supabaseClient) {
      try {
        const { error } = await supabaseClient
          .from('app_users')
          .insert([{
            email,
            name,
            avatar,
            role: user.role,
            status: user.status
          }]);
        if (!error) dbMissingUsersTable = false;
      } catch (err) {
        console.warn('[Samarpit] App user insert warning:', err.message);
      }
    }
  }

  saveToLocalCache();
  updateAuthUI();
  render();
  broadcastChange('user_registered');
}

async function approveUserAsAdmin(targetEmail) {
  if (!isUserAdmin()) {
    toast('Only admins can approve requests.', 'error');
    return;
  }

  const emailNorm = targetEmail.toLowerCase().trim();
  let user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === emailNorm);

  if (user) {
    user.role = 'admin';
    user.status = 'approved';
  } else {
    user = { email: emailNorm, name: emailNorm.split('@')[0], role: 'admin', status: 'approved' };
    appUsers.push(user);
  }

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('app_users')
        .upsert({
          email: emailNorm,
          role: 'admin',
          status: 'approved',
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

      if (error) {
        dbMissingUsersTable = true;
        console.warn('[Samarpit] Cloud approve notice:', error.message);
      }
    } catch (err) {
      dbMissingUsersTable = true;
      console.warn('[Samarpit] Approve user cloud warning:', err.message);
    }
  }

  await logActivity(`Approved ${emailNorm} as Admin`, 'User was granted full administrator permissions.');
  saveToLocalCache();
  updateAuthUI();
  toast(`Approved ${emailNorm} as Admin!`, 'ok');
  broadcastChange('user_approved');
  openAdminModal();
}

async function dismissAllowanceRequest(targetEmail) {
  if (!isUserAdmin()) {
    toast('Only admins can dismiss requests.', 'error');
    return;
  }

  const emailNorm = targetEmail.toLowerCase().trim();
  let user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === emailNorm);

  if (user) {
    user.role = 'viewer';
    user.status = 'approved';
  }

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('app_users')
        .update({ role: 'viewer', status: 'approved', updated_at: new Date().toISOString() })
        .eq('email', emailNorm);

      if (error) {
        dbMissingUsersTable = true;
        console.warn('[Samarpit] Cloud dismiss notice:', error.message);
      }
    } catch (err) {
      dbMissingUsersTable = true;
      console.warn('[Samarpit] Dismiss user cloud warning:', err.message);
    }
  }

  await logActivity(`Dismissed admin request for ${emailNorm}`, 'User remains Viewer.');
  saveToLocalCache();
  updateAuthUI();
  toast(`Request dismissed. ${emailNorm} remains Viewer.`, 'ok');
  broadcastChange('user_dismissed');
  openAdminModal();
}

async function revokeAdminAccess(targetEmail) {
  if (!isUserAdmin()) {
    toast('Permission denied.', 'error');
    return;
  }

  const emailNorm = targetEmail.toLowerCase().trim();
  if (emailNorm === MASTER_ADMIN_EMAIL.toLowerCase()) {
    toast('Cannot modify Master Admin.', 'error');
    return;
  }

  const user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === emailNorm);
  if (user) {
    user.role = 'viewer';
    user.status = 'approved';
  }

  if (supabaseClient) {
    try {
      await supabaseClient
        .from('app_users')
        .update({ role: 'viewer', status: 'approved', updated_at: new Date().toISOString() })
        .eq('email', emailNorm);
    } catch (err) {
      console.warn('[Samarpit] Revoke admin error:', err.message);
    }
  }

  await logActivity(`Changed ${emailNorm} to Viewer`, 'Admin access revoked.');
  saveToLocalCache();
  updateAuthUI();
  toast(`Set ${emailNorm} to Viewer`, 'ok');
  broadcastChange('user_revoked');
  openAdminModal();
}

// ------------------------------------------------------------------------------
// 4. Activity Audit Logging
// ------------------------------------------------------------------------------

async function logActivity(action, details = '') {
  const email = currentUser?.email || 'System';
  const name = currentUser?.user_metadata?.full_name || email.split('@')[0];
  const avatar = currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture || null;

  const entry = {
    id: uid(),
    action,
    user_email: email,
    user_name: name,
    user_avatar: avatar,
    details: details || '',
    created_at: new Date().toISOString()
  };

  activityLogs.unshift(entry);
  if (activityLogs.length > 200) activityLogs.pop();

  if (supabaseClient && currentUser) {
    try {
      const { error } = await supabaseClient.from('activity_logs').insert([{
        action,
        user_email: email,
        user_name: name,
        user_avatar: avatar,
        details: details || ''
      }]);
      if (error) console.warn('[Samarpit] Log insert warning:', error.message);
    } catch (e) {
      console.warn('[Samarpit] Activity log error:', e);
    }
  }

  saveToLocalCache();
  if (tab === 'logs') render();
}

// ------------------------------------------------------------------------------
// 5. Real-time Synchronization
// ------------------------------------------------------------------------------

function computeStateHash() {
  try {
    return JSON.stringify({
      c: S.children.length,
      cid: S.children.map(x => x.id + x.name + (x.cls || '')).join('|'),
      s: S.sabhas.length,
      sid: S.sabhas.map(x => x.id + x.date + x.topic).join('|'),
      a: S.att,
      u: appUsers.map(x => x.email + x.role + x.status).join('|'),
      l: activityLogs.length ? activityLogs[0].id : ''
    });
  } catch (e) {
    return String(Date.now());
  }
}

function broadcastChange(actionType = 'general') {
  if (realtimeChannel) {
    try {
      realtimeChannel.send({
        type: 'broadcast',
        event: 'samarpit_change',
        payload: { actionType, from: currentUser?.email, time: Date.now() }
      });
    } catch (e) {
      console.warn('[Samarpit] Broadcast send notice:', e);
    }
  }
}

function setupRealtime() {
  if (!supabaseClient) return;

  if (realtimeChannel) {
    try {
      supabaseClient.removeChannel(realtimeChannel);
    } catch (e) {}
    realtimeChannel = null;
  }

  // Consolidated Realtime channel: listens to both instant broadcast messages & postgres DB WAL changes
  realtimeChannel = supabaseClient.channel('samarpit_live_sync', {
    config: {
      broadcast: { self: false }
    }
  });

  // 1. Instant Peer Broadcast: reflects changes across all connected devices in ~50ms
  realtimeChannel.on('broadcast', { event: 'samarpit_change' }, (msg) => {
    console.log('[Samarpit] Live broadcast event received:', msg?.payload?.actionType);
    syncFromCloud(true);
  });

  // 2. PostgreSQL WAL Database Listeners
  realtimeChannel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'children' }, () => syncFromCloud(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sabhas' }, () => syncFromCloud(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => syncFromCloud(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_users' }, () => syncFromCloud(true))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'activity_logs' }, () => syncUsersAndLogs(true));

  realtimeChannel.subscribe((status, err) => {
    console.log('[Samarpit] Realtime channel status:', status, err || '');
    if (status === 'SUBSCRIBED') {
      updateSyncBadge('cloud');
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      updateSyncBadge('offline');
      // Auto-reconnect with exponential backoff
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        if (currentUser) setupRealtime();
      }, 3500);
    }
  });

  startHeartbeat();
}

function startHeartbeat() {
  if (syncHeartbeat) clearInterval(syncHeartbeat);
  syncHeartbeat = setInterval(() => {
    if (supabaseClient && currentUser && !document.hidden) {
      syncFromCloud(false);
    }
  }, 2500);
}

// Window visibility change & focus listeners: sync immediately when tab becomes visible or active
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && supabaseClient && currentUser) {
    syncFromCloud(true);
  }
});

window.addEventListener('focus', () => {
  if (supabaseClient && currentUser) {
    syncFromCloud(true);
  }
});

// ------------------------------------------------------------------------------
// 6. Cloud Database Sync (Fetch & Cache)
// ------------------------------------------------------------------------------

async function syncFromCloud(forceRender = false) {
  if (!supabaseClient) return;
  if (isSyncing) {
    syncPending = true;
    return;
  }
  isSyncing = true;

  try {
    // 1. Fetch children
    const { data: cData, error: cErr } = await supabaseClient
      .from('children')
      .select('*')
      .order('name', { ascending: true });

    if (cErr) throw cErr;

    // 2. Fetch sabhas
    const { data: sData, error: sErr } = await supabaseClient
      .from('sabhas')
      .select('*')
      .order('date', { ascending: true });

    if (sErr) throw sErr;

    // 3. Fetch attendance
    const { data: aData, error: aErr } = await supabaseClient
      .from('attendance')
      .select('*');

    if (aErr) throw aErr;

    // Build state
    S.children = (cData || []).map(k => ({
      id: k.id,
      name: k.name || '',
      cls: k.cls || '',
      age: k.age != null ? k.age : '',
      hobby: k.hobby || '',
      phone: k.phone || '',
      address: k.address || '',
      food: k.food || ''
    }));

    S.sabhas = (sData || []).map(s => ({
      id: s.id,
      date: s.date,
      topic: s.topic,
      host: s.host || '',
      recap: s.recap || ''
    }));

    const attMap = {};
    (aData || []).forEach(row => {
      if (!attMap[row.sabha_id]) attMap[row.sabha_id] = {};
      attMap[row.sabha_id][row.child_id] = row.status;
    });
    S.att = attMap;

    await syncUsersAndLogs(false);

    const newHash = computeStateHash();
    if (forceRender || newHash !== lastRenderedStateHash) {
      lastRenderedStateHash = newHash;
      saveToLocalCache();
      render();
    }
  } catch (err) {
    console.warn('[Samarpit] Cloud sync warning:', err.message);
  } finally {
    isSyncing = false;
    if (syncPending) {
      syncPending = false;
      syncFromCloud(forceRender);
    }
  }
}

async function syncUsersAndLogs(shouldRender = true) {
  if (!supabaseClient) return;
  if (isSyncingUsers) {
    syncUsersPending = true;
    return;
  }
  isSyncingUsers = true;

  const wasAdmin = isUserAdmin();

  try {
    // 1. Fetch users from Supabase
    const { data: uData, error: uErr } = await supabaseClient
      .from('app_users')
      .select('*')
      .order('created_at', { ascending: false });

    if (uErr) {
      dbMissingUsersTable = true;
      console.warn('[Samarpit] app_users query warning:', uErr.message);
    } else if (uData) {
      dbMissingUsersTable = false;
      const cloudMap = new Map();
      uData.forEach(u => {
        if (u.email) cloudMap.set(u.email.toLowerCase().trim(), u);
      });

      // Retain any pending or new users in memory/local storage that aren't yet in cloud
      appUsers.forEach(u => {
        if (u.email && !cloudMap.has(u.email.toLowerCase().trim())) {
          cloudMap.set(u.email.toLowerCase().trim(), u);
        }
      });
      appUsers = Array.from(cloudMap.values());
    }

    // Always ensure master admin is in appUsers list
    const master = appUsers.find(u => u.email && u.email.toLowerCase().trim() === MASTER_ADMIN_EMAIL.toLowerCase().trim());
    if (!master) {
      appUsers.push({ email: MASTER_ADMIN_EMAIL, name: 'Master Admin', role: 'admin', status: 'approved' });
    } else {
      master.role = 'admin';
      master.status = 'approved';
    }

    // 2. Fetch activity logs from Supabase
    const { data: lData, error: lErr } = await supabaseClient
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (lErr) {
      console.warn('[Samarpit] activity_logs query warning:', lErr.message);
    } else if (lData) {
      const cloudIds = new Set(lData.map(l => l.id));
      const localOnly = activityLogs.filter(l => !cloudIds.has(l.id));
      activityLogs = [...lData, ...localOnly].slice(0, 150);
    }

    saveToLocalCache();
    updateAuthUI();

    if (shouldRender) {
      render();
    }

    if (!wasAdmin && isUserAdmin() && currentUser) {
      toast('🎉 You have been approved as Administrator!', 'ok');
    }
  } catch (e) {
    console.warn('[Samarpit] Users and logs sync warning:', e);
  } finally {
    isSyncingUsers = false;
    if (syncUsersPending) {
      syncUsersPending = false;
      syncUsersAndLogs(shouldRender);
    }
  }
}

function saveToLocalCache() {
  try {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(S));
    localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(activityLogs));
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(appUsers));
  } catch (e) {}
}

function loadLocalCache() {
  try {
    const rawState = localStorage.getItem(STORAGE_KEYS.STATE);
    if (rawState) S = Object.assign(S, JSON.parse(rawState));

    const rawLogs = localStorage.getItem(STORAGE_KEYS.LOGS);
    if (rawLogs) activityLogs = JSON.parse(rawLogs);

    const rawUsers = localStorage.getItem(STORAGE_KEYS.USERS);
    if (rawUsers) appUsers = JSON.parse(rawUsers);
  } catch (e) {}
}

// ------------------------------------------------------------------------------
// 7. CRUD Operations (Enforced: Admins Only Can Modify)
// ------------------------------------------------------------------------------

async function dbSaveChild(childData, id) {
  if (!isUserAdmin()) {
    toast('Permission denied: Admin access required to add or edit bhulku.', 'error');
    return;
  }

  if (supabaseClient && currentUser) {
    const payload = {
      name: childData.name,
      cls: childData.cls || null,
      age: childData.age ? parseInt(childData.age, 10) : null,
      hobby: childData.hobby || null,
      phone: childData.phone || null,
      address: childData.address || null,
      food: childData.food || null
    };

    if (id && !id.startsWith('local_')) {
      const { error } = await supabaseClient.from('children').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.from('children').insert([payload]).select();
      if (error) throw error;
      if (data && data[0]) id = data[0].id;
    }
  }

  if (id) {
    const existing = S.children.find(x => x.id === id);
    if (existing) Object.assign(existing, childData);
    else S.children.push({ id, ...childData });
    await logActivity(`Updated bhulku record: '${childData.name}'`, `Class: ${childData.cls || 'N/A'}`);
  } else {
    S.children.push({ id: uid(), ...childData });
    await logActivity(`Added new bhulku: '${childData.name}'`, `Class: ${childData.cls || 'N/A'}`);
  }

  saveToLocalCache();
  render();
  toast(id ? 'Bhulku updated' : 'Bhulku added', 'ok');
  broadcastChange('child_saved');
}

async function dbDeleteChild(id) {
  if (!isUserAdmin()) {
    toast('Permission denied: Admin access required.', 'error');
    return;
  }

  const child = S.children.find(x => x.id === id);
  const childName = child ? child.name : 'bhulku';

  if (supabaseClient && currentUser && !id.startsWith('local_')) {
    const { error } = await supabaseClient.from('children').delete().eq('id', id);
    if (error) throw error;
  }

  S.children = S.children.filter(x => x.id !== id);
  for (const s in S.att) delete S.att[s][id];

  await logActivity(`Deleted bhulku: '${childName}'`);
  saveToLocalCache();
  render();
  toast('Bhulku removed', 'ok');
  broadcastChange('child_deleted');
}

async function dbSaveSabha(sabhaData, id) {
  if (!isUserAdmin()) {
    toast('Permission denied: Admin access required to create or edit sabha.', 'error');
    return;
  }

  if (supabaseClient && currentUser) {
    const payload = {
      date: sabhaData.date,
      topic: sabhaData.topic,
      host: sabhaData.host || null,
      recap: sabhaData.recap || null
    };

    if (id && !id.startsWith('local_')) {
      const { error } = await supabaseClient.from('sabhas').update(payload).eq('id', id);
      if (error) throw error;
    } else {
      const { data, error } = await supabaseClient.from('sabhas').insert([payload]).select();
      if (error) throw error;
      if (data && data[0]) id = data[0].id;
    }
  }

  if (id) {
    const existing = S.sabhas.find(x => x.id === id);
    if (existing) Object.assign(existing, sabhaData);
    else S.sabhas.push({ id, ...sabhaData });
    await logActivity(`Updated sabha: '${sabhaData.topic}'`, `Date: ${sabhaData.date}`);
  } else {
    S.sabhas.push({ id: uid(), ...sabhaData });
    await logActivity(`Created new sabha: '${sabhaData.topic}'`, `Date: ${sabhaData.date}, Vakta: ${sabhaData.host || 'Not assigned'}`);
  }

  saveToLocalCache();
  render();
  toast(id ? 'Sabha updated' : 'Sabha added', 'ok');
  broadcastChange('sabha_saved');
}

async function dbDeleteSabha(id) {
  if (!isUserAdmin()) {
    toast('Permission denied: Admin access required.', 'error');
    return;
  }

  const s = S.sabhas.find(x => x.id === id);
  const topic = s ? s.topic : 'sabha';

  if (supabaseClient && currentUser && !id.startsWith('local_')) {
    const { error } = await supabaseClient.from('sabhas').delete().eq('id', id);
    if (error) throw error;
  }

  S.sabhas = S.sabhas.filter(x => x.id !== id);
  delete S.att[id];

  await logActivity(`Deleted sabha: '${topic}'`);
  saveToLocalCache();
  render();
  toast('Sabha deleted', 'ok');
  broadcastChange('sabha_deleted');
}

async function dbSetAttendance(sabhaId, childId, status) {
  if (!isUserAdmin()) {
    toast('View-only access: Only admins can mark attendance.', 'error');
    return;
  }

  const currentAtt = S.att[sabhaId] = S.att[sabhaId] || {};
  const child = S.children.find(x => x.id === childId);
  const sabha = S.sabhas.find(x => x.id === sabhaId);
  const childName = child ? child.name : 'bhulku';

  if (status === null) {
    delete currentAtt[childId];
    if (supabaseClient && currentUser && !sabhaId.startsWith('local_') && !childId.startsWith('local_')) {
      supabaseClient.from('attendance')
        .delete()
        .match({ sabha_id: sabhaId, child_id: childId })
        .then(({ error }) => { if (error) console.error('Att delete error:', error); });
    }
  } else {
    currentAtt[childId] = status;
    if (supabaseClient && currentUser && !sabhaId.startsWith('local_') && !childId.startsWith('local_')) {
      supabaseClient.from('attendance')
        .upsert({
          sabha_id: sabhaId,
          child_id: childId,
          status: status
        }, { onConflict: 'sabha_id,child_id' })
        .then(({ error }) => { if (error) console.error('Att upsert error:', error); });
    }
  }

  const statusLabel = status === 1 ? 'Present' : status === 0 ? 'Absent' : 'Unmarked';
  await logActivity(`Marked attendance: ${childName} as ${statusLabel}`, `Sabha: ${sabha ? sabha.topic : 'Date ' + sabhaId}`);

  saveToLocalCache();
  render();
  broadcastChange('attendance_updated');
}

async function dbMarkAllPresent(sabhaId) {
  if (!isUserAdmin()) {
    toast('View-only access: Only admins can mark attendance.', 'error');
    return;
  }

  const a = S.att[sabhaId] = S.att[sabhaId] || {};
  const upsertRows = [];
  const sabha = S.sabhas.find(x => x.id === sabhaId);

  S.children.forEach(k => {
    a[k.id] = 1;
    if (!sabhaId.startsWith('local_') && !k.id.startsWith('local_')) {
      upsertRows.push({
        sabha_id: sabhaId,
        child_id: k.id,
        status: 1
      });
    }
  });

  await logActivity(`Marked all ${S.children.length} bhulkus present`, `Sabha: ${sabha ? sabha.topic : 'Date ' + sabhaId}`);

  saveToLocalCache();
  render();
  toast('Marked all present', 'ok');
  broadcastChange('attendance_batch');

  if (supabaseClient && currentUser && upsertRows.length > 0) {
    const { error } = await supabaseClient.from('attendance').upsert(upsertRows, { onConflict: 'sabha_id,child_id' });
    if (error) console.error('Batch attendance error:', error);
  }
}

// ------------------------------------------------------------------------------
// 8. Views & UI Rendering
// ------------------------------------------------------------------------------

function renderRoleBanner() {
  const isAdmin = isUserAdmin();
  const status = getUserStatus();

  if (isAdmin) return '';

  if (status === 'pending') {
    return `
    <div class="readonly-banner" style="background:#fef7e0;border-color:#eab308;color:#854d0e;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <span style="font-size:18px;">⏳</span>
        <span><strong>Admin Allowance Request Pending:</strong> Your request to become an admin has been sent to the admins and is awaiting approval.</span>
      </div>
      <button class="btn sm ghost" data-act="req-admin" style="white-space:nowrap;padding:4px 10px;font-size:12px;border-color:#eab308;color:#854d0e;background:rgba(255,255,255,0.4);">View Request</button>
    </div>`;
  }

  return `
  <div class="readonly-banner">
    <div style="display:flex;align-items:center;gap:8px;flex:1;">
      <span style="font-size:18px;">👁️</span>
      <span><strong>View-Only Mode:</strong> You can explore all records. Need to add sabhas or mark attendance?</span>
    </div>
    <button class="btn sm" data-act="req-admin" style="white-space:nowrap;padding:6px 14px;font-size:13px;">
      Request Admin Access
    </button>
  </div>`;
}

function sCard(s, label, cls, needRecap) {
  const n = S.children.length;
  const a = S.att[s.id] || {};
  const marked = Object.keys(a).length;
  const p = Object.values(a).filter(v => v === 1).length;
  const isAdmin = isUserAdmin();

  return `<article class="card ${cls || ''}">
    <div class="row">
      <span class="date">${fmt(s.date)}</span>
      ${label ? `<span class="chip">${label}</span>` : ''}
    </div>
    <div class="topic">${esc(s.topic)}</div>
    <div class="meta">Vakta: <strong>${esc(s.host) || 'Not assigned'}</strong></div>
    ${s.recap ? `<p class="recap">${esc(s.recap)}</p>` : (needRecap ? '<p class="meta">No recap yet.' + (isAdmin ? ' Tap Edit to add one.' : '') + '</p>' : '')}
    <div class="row" style="margin-top:10px">
      <span class="meta">${marked ? `<strong>${p}</strong> of ${n} present` : 'Attendance not marked'}</span>
      <span>
        <button class="btn ghost sm" data-act="att" data-id="${s.id}">Attendance</button>
        ${isAdmin ? `<button class="btn ghost sm" data-act="editS" data-id="${s.id}">Edit</button>` : ''}
      </span>
    </div>
  </article>`;
}

function sabhaView() {
  const t = today();
  const all = bySabha();
  const past = all.filter(s => s.date < t).reverse();
  const now = all.filter(s => s.date >= t);
  const cur = now.shift();
  const isAdmin = isUserAdmin();
  const pages = [
    ['past', 'Past', past.length],
    ['up', 'Upcoming', now.length],
    ['cur', 'Current', cur ? 1 : 0]
  ];

  let h = renderRoleBanner() + `
  <div class="row" style="margin-top:14px">
    <h2 style="margin:0">Sabha Schedule</h2>
    ${isAdmin ? '<button class="btn" data-act="addS">+ Add Sabha</button>' : ''}
  </div>
  <div class="pages" role="group" aria-label="Sabha pages">
    ${pages.map(p => `<button data-act="page" data-id="${p[0]}" aria-pressed="${page === p[0]}">${p[1]} (${p[2]})</button>`).join('')}
  </div>`;

  if (page === 'past') {
    h += '<h2>Past Sabhas</h2>' + (past.length ? past.map(s => sCard(s, '', '', true)).join('') : empty('No past sabha', 'Sabhas dated before today appear here with their recap.'));
  } else if (page === 'up') {
    h += '<h2>Upcoming Sabhas</h2>' + (now.length ? now.map(s => sCard(s)).join('') : empty('Nothing upcoming', 'Add the next sabha with its date, topic and vakta.'));
  } else {
    h += '<h2>Current Sabha</h2>' + (cur ? sCard(cur, cur.date === t ? 'Today' : 'Next', 'cur') : empty('No current sabha', 'Add a sabha dated today or later.'));
  }
  return h;
}

function attView() {
  const t = today();
  const all = bySabha().reverse();
  const isAdmin = isUserAdmin();

  let h = renderRoleBanner() + '<h2 style="margin-top:14px">Attendance</h2>';

  if (!all.length || !S.children.length) {
    return h + empty('Nothing to mark yet', 'Add at least one bhulku and one sabha to mark attendance.');
  }

  if (!attId || !S.sabhas.some(s => s.id === attId)) {
    attId = (all.find(s => s.date <= t) || all[all.length - 1]).id;
  }

  const a = S.att[attId] || {};
  const c = kids();
  const P = c.filter(k => a[k.id] === 1).length;
  const A = c.filter(k => a[k.id] === 0).length;

  h += `
  <label for="sel">Select Sabha</label>
  <select id="sel">${all.map(s => `<option value="${s.id}"${s.id === attId ? ' selected' : ''}>${fmt(s.date)}: ${esc(s.topic)}</option>`).join('')}</select>
  <div class="row" style="margin:14px 0">
    <span class="meta"><strong>${P}</strong> present, <strong>${A}</strong> absent, <strong>${c.length - P - A}</strong> not marked</span>
    ${isAdmin ? '<button class="btn ghost sm" data-act="allP">Mark All Present</button>' : ''}
  </div>`;

  return h + c.map(k => `
  <div class="card row" style="padding: 12px 16px;">
    <span>
      <strong>${esc(k.name)}</strong>
      ${k.cls ? `<br><span class="meta">${esc(k.cls)}</span>` : ''}
    </span>
    <div class="seg" role="group" aria-label="Attendance for ${esc(k.name)}" style="${isAdmin ? '' : 'pointer-events:none;'}">
      <button ${isAdmin ? `data-act="mark" data-id="${k.id}" data-v="1"` : 'type="button"'} aria-pressed="${a[k.id] === 1}" class="${a[k.id] === 1 ? 'on-p' : ''}">Present</button>
      <button ${isAdmin ? `data-act="mark" data-id="${k.id}" data-v="0"` : 'type="button"'} aria-pressed="${a[k.id] === 0}" class="${a[k.id] === 0 ? 'on-a' : ''}">Absent</button>
    </div>
  </div>`).join('');
}

function kidsView() {
  const isAdmin = isUserAdmin();

  let h = renderRoleBanner() + `
  <div class="row" style="margin-top:14px">
    <h2 style="margin:0">Bhulku Directory</h2>
    ${isAdmin ? '<button class="btn" data-act="addC">+ Add Bhulku</button>' : ''}
  </div>`;

  if (!S.children.length) {
    return h + '<div style="margin-top:14px"></div>' + empty('No bhulku yet', 'Add each bhulku with class, hobby, age, phone, address and favourite food.');
  }

  return h + `
  <label class="sr" for="q">Search bhulku</label>
  <input id="q" type="search" placeholder="Search by name, class or phone..." value="${esc(q)}" style="margin:14px 0">
  <div id="list">${kidList()}</div>`;
}

function kidList() {
  const searchTerm = q.toLowerCase().trim();
  const L = kids().filter(k => (k.name + ' ' + (k.cls || '') + ' ' + (k.phone || '')).toLowerCase().includes(searchTerm));
  const isAdmin = isUserAdmin();

  if (!L.length) {
    return '<p class="meta" style="text-align:center;padding:20px;">No bhulku matches that search.</p>';
  }

  const r = (label, val) => val ? `<dt>${label}</dt><dd>${val}</dd>` : '';

  return L.map(k => {
    let m = 0, pr = 0;
    for (const s in S.att) {
      if (k.id in S.att[s]) {
        m++;
        if (S.att[s][k.id] === 1) pr++;
      }
    }
    const tel = k.phone ? `<a href="tel:${esc(k.phone.replace(/[^\d+]/g, ''))}">${esc(k.phone)}</a>` : '';
    const pct = m > 0 ? Math.round((pr / m) * 100) : 0;

    return `
    <article class="card">
      <div class="row">
        <h3>${esc(k.name)}</h3>
        ${isAdmin ? `<button class="btn ghost sm" data-act="editC" data-id="${k.id}">Edit</button>` : ''}
      </div>
      <dl>
        ${r('Class', esc(k.cls))}
        ${r('Age', esc(k.age))}
        ${r('Hobby', esc(k.hobby))}
        ${r('Phone', tel)}
        ${r('Address', esc(k.address))}
        ${r('Favourite food', esc(k.food))}
      </dl>
      <div class="meta" style="border-top:1px dashed var(--line);padding-top:8px;margin-top:8px;">
        ${m ? `Present at <strong>${pr}</strong> of <strong>${m}</strong> sabhas (${pct}%)` : 'Attendance not marked yet'}
      </div>
    </article>`;
  }).join('');
}

function logsView() {
  let h = `
  <div class="row" style="margin-top:14px">
    <div>
      <h2 style="margin:0">Activity Audit Logs</h2>
      <p class="sub" style="margin:2px 0 0;">Record of actions performed across the mandal</p>
    </div>
    <button class="btn ghost sm" id="btn-refresh-logs">Refresh</button>
  </div>
  <div style="margin-top:16px;"></div>`;

  if (!activityLogs.length) {
    return h + empty('No activity logs recorded yet', 'Actions such as creating sabhas, adding bhulkus, and marking attendance will be logged here.');
  }

  return h + activityLogs.map(log => {
    const avatar = log.user_avatar;
    const name = log.user_name || log.user_email?.split('@')[0] || 'Unknown';
    const initial = (name[0] || 'U').toUpperCase();

    return `
    <div class="log-card">
      ${avatar ? `<img src="${esc(avatar)}" class="log-avatar" alt="${esc(name)}" referrerpolicy="no-referrer">` : `<div class="log-avatar-placeholder">${initial}</div>`}
      <div class="log-body">
        <div class="log-action-text">${esc(log.action)}</div>
        ${log.details ? `<div class="meta" style="font-size:13px;margin-bottom:4px;">${esc(log.details)}</div>` : ''}
        <div class="log-meta-line">
          <span><strong>${esc(name)}</strong> (${esc(log.user_email)})</span>
          <span>•</span>
          <span>${timeAgo(log.created_at)}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

function loginGateView() {
  return `
  <div class="login-gate-container">
    <div class="login-gate-card">
      <div style="font-size: 50px; margin-bottom: 12px; line-height: 1;">🔐</div>
      <h2 style="margin: 0 0 10px; font-size: 23px;">Sign In Required</h2>
      <p class="meta" style="margin-bottom: 24px; font-size: 15px; line-height: 1.5;">
        Access to <strong>SAMARPIT IRANIWADI</strong> records, attendance, and sabha schedules is restricted. Please sign in with your Google account to enter.
      </p>
      <button class="btn btn-google" id="btn-gate-signin" style="width: 100%; justify-content: center; padding: 12px 20px; font-size: 16px; border-radius: 12px;">
        <svg width="18" height="18" viewBox="0 0 24 24" style="margin-right: 8px;"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.86c2.26-2.09 3.685-5.17 3.685-9.09z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.37 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
        <span>Sign in with Google</span>
      </button>
      <div style="margin-top: 22px; border-top: 1px solid var(--line); padding-top: 14px; width: 100%;">
        <span class="meta" style="font-size: 13px;">🔒 Authorized karyakars and teachers only</span>
      </div>
    </div>
  </div>`;
}

function render() {
  const tabsNav = document.querySelector('.tabs');
  const statusBadge = $('#status-badge');

  if (!currentUser) {
    if (tabsNav) tabsNav.style.display = 'none';
    if (statusBadge) statusBadge.style.display = 'none';
    const mainView = $('#view');
    if (mainView) {
      mainView.innerHTML = loginGateView();
      const btnGate = $('#btn-gate-signin');
      if (btnGate) btnGate.onclick = handleSignIn;
    }
    return;
  }

  // Logged-in view: show navigation and active tab content
  if (tabsNav) tabsNav.style.display = 'flex';
  if (statusBadge) statusBadge.style.display = 'inline-flex';

  document.querySelectorAll('.tabs button').forEach(b => {
    b.setAttribute('aria-current', String(b.dataset.tab === tab));
  });

  const mainView = $('#view');
  if (mainView) {
    mainView.innerHTML = tab === 'sabha' ? sabhaView() : tab === 'att' ? attView() : tab === 'kids' ? kidsView() : logsView();
    const btnRefreshLogs = $('#btn-refresh-logs');
    if (btnRefreshLogs) btnRefreshLogs.onclick = () => syncUsersAndLogs();
  }
}

// ------------------------------------------------------------------------------
// 9. Dialogs & Admin Management Modal
// ------------------------------------------------------------------------------

const field = (id, label, v, type, extra) => `
  <label for="${id}">${label}</label>
  <input id="${id}" name="${id}" type="${type || 'text'}" value="${esc(v)}" ${extra || ''}>
`;

function openForm(title, body, onSave, onDel) {
  dlg.innerHTML = `
    <form id="f">
      <h2 style="margin-top:0">${title}</h2>
      ${body}
      <div class="row" style="margin-top:24px">
        <span>${onDel ? '<button type="button" class="btn ghost danger" id="del">Delete</button>' : ''}</span>
        <span>
          <button type="button" class="btn ghost" id="cx">Cancel</button>
          <button class="btn" type="submit">Save</button>
        </span>
      </div>
    </form>
  `;
  dlg.showModal();

  $('#f').onsubmit = async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    dlg.close();
    try {
      await onSave(data);
    } catch (err) {
      console.error(err);
      toast(err.message || 'Error saving data', 'error');
    }
  };

  $('#cx').onclick = () => dlg.close();

  if (onDel) {
    const d = $('#del');
    d.onclick = async () => {
      if (!d.dataset.sure) {
        d.dataset.sure = '1';
        d.textContent = 'Tap again to confirm';
        return;
      }
      dlg.close();
      try {
        await onDel();
      } catch (err) {
        console.error(err);
        toast(err.message || 'Error deleting item', 'error');
      }
    };
  }
}

function childForm(id) {
  if (!isUserAdmin()) {
    toast('Admin access required.', 'error');
    return;
  }
  const k = S.children.find(x => x.id === id) || {};
  openForm(
    id ? 'Edit Bhulku' : 'Add New Bhulku',
    field('name', 'Name *', k.name, 'text', 'required autocomplete="off"') +
    field('cls', 'Class / Grade', k.cls) +
    field('age', 'Age', k.age, 'number', 'min="1" max="25"') +
    field('hobby', 'Hobby', k.hobby) +
    field('phone', 'Phone Number', k.phone, 'tel') +
    `<label for="address">Address</label><textarea id="address" name="address" rows="2">${esc(k.address)}</textarea>` +
    field('food', 'Favourite Food', k.food),
    data => dbSaveChild(data, id),
    id ? () => dbDeleteChild(id) : null
  );
}

function sabhaForm(id) {
  if (!isUserAdmin()) {
    toast('Admin access required.', 'error');
    return;
  }
  const s = S.sabhas.find(x => x.id === id) || { date: today() };
  openForm(
    id ? 'Edit Sabha' : 'Add New Sabha',
    field('date', 'Date *', s.date, 'date', 'required') +
    field('topic', 'Topic *', s.topic, 'text', 'required autocomplete="off"') +
    `<label for="host">Vakta (Speaker)</label>
     <input id="host" name="host" list="hosts" value="${esc(s.host)}" autocomplete="off" placeholder="Select or type speaker">
     <datalist id="hosts">${kids().map(k => `<option value="${esc(k.name)}">`).join('')}</datalist>
     <label for="recap">Recap</label>
     <textarea id="recap" name="recap" rows="4" placeholder="What was covered in this sabha?">${esc(s.recap)}</textarea>`,
    data => dbSaveSabha(data, id),
    id ? () => dbDeleteSabha(id) : null
  );
}

function openRequestAdminDialog() {
  const email = currentUser?.email || '';
  const name = currentUser?.user_metadata?.full_name || email.split('@')[0];
  const isPending = getUserStatus() === 'pending';

  dlg.innerHTML = `
    <form id="form-req-admin" style="padding: 2px 0;">
      <div style="font-size: 38px; margin-bottom: 6px;">🛡️</div>
      <h2 style="margin: 0 0 6px;">Request Administrator Access</h2>
      <p class="meta" style="margin-bottom: 16px; font-size: 14px; line-height: 1.5;">
        ${isPending ? 'You already have an active request awaiting admin approval. You can update your note below.' : 'Submit a request to become an Administrator for <strong>SAMARPIT IRANIWADI</strong>.'}
      </p>

      <div class="card" style="padding: 10px 14px; margin-bottom: 16px; background: var(--soft);">
        <div style="font-size: 12px; color: var(--mute);">Your Account:</div>
        <div style="font-weight: 600; font-size: 15px;">${esc(name)} (${esc(email)})</div>
        <div style="font-size: 12px; margin-top: 4px; color: var(--accent-text);">Current status: <strong>${isPending ? 'Pending Approval' : 'Viewer (Read-Only)'}</strong></div>
      </div>

      <label for="req_note">Optional Note / Role in Mandal</label>
      <input id="req_note" name="note" type="text" placeholder="e.g. Volunteer / Sabha Coordinator" autocomplete="off" style="margin-bottom: 6px;">

      <div class="row" style="margin-top: 20px;">
        <button type="button" class="btn ghost" id="req-cx">Cancel</button>
        <button class="btn" type="submit">${isPending ? 'Update Request' : 'Send Request to Admins'}</button>
      </div>
    </form>
  `;

  dlg.showModal();

  $('#req-cx').onclick = () => dlg.close();

  $('#form-req-admin').onsubmit = async e => {
    e.preventDefault();
    const note = $('#req_note').value.trim();
    dlg.close();
    toast('Submitting request to admins...', 'info');
    await requestAdminAccess(note);
  };
}

async function requestAdminAccess(note = '') {
  if (!currentUser || !currentUser.email) return;
  if (isUserAdmin()) {
    toast('You already have Administrator permissions!', 'ok');
    return;
  }
  const email = currentUser.email.toLowerCase().trim();
  const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
  const avatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture || null;

  let user = appUsers.find(u => u.email && u.email.toLowerCase().trim() === email);
  if (user) {
    if (user.role === 'admin' && user.status === 'approved') {
      toast('You are already an Admin.', 'ok');
      return;
    }
    user.status = 'pending';
    user.name = name;
    user.avatar = avatar;
  } else {
    user = { email, name, avatar, role: 'viewer', status: 'pending' };
    appUsers.push(user);
  }

  if (supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from('app_users')
        .upsert({
          email,
          name,
          avatar,
          role: 'viewer',
          status: 'pending',
          updated_at: new Date().toISOString()
        }, { onConflict: 'email' });

      if (error) throw error;
    } catch (err) {
      console.error('Request admin error:', err);
      toast(err.message || 'Error sending request', 'error');
      return;
    }
  }

  const logDetail = note ? `Note: "${note}"` : `New request submitted by ${name} (${email}).`;
  await logActivity('Requested Admin Access', logDetail);

  saveToLocalCache();
  updateAuthUI();
  render();
  toast('Admin access request sent! Admins have been notified.', 'ok');
  broadcastChange('user_requested');
}

function openAdminModal() {
  if (!isUserAdmin()) {
    toast('Admin access required.', 'error');
    return;
  }

  const pendingList = getPendingRequests();
  
  // Deduplicate and prepare current admins list
  const seenAdmins = new Set();
  const currentAdmins = [];
  
  // Master admin first
  currentAdmins.push({
    email: MASTER_ADMIN_EMAIL,
    name: 'Master Admin',
    role: 'admin',
    status: 'approved'
  });
  seenAdmins.add(MASTER_ADMIN_EMAIL.toLowerCase());

  appUsers.forEach(u => {
    if (!u || !u.email) return;
    const em = u.email.toLowerCase().trim();
    if (seenAdmins.has(em)) return;
    if (u.role === 'admin' && u.status === 'approved') {
      seenAdmins.add(em);
      currentAdmins.push(u);
    }
  });

  const setupSql = `-- SAMARPIT IRANIWADI - App Users & Audit Logs Setup
CREATE TABLE IF NOT EXISTS public.app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    avatar TEXT,
    role TEXT NOT NULL DEFAULT 'viewer',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO public.app_users (email, name, role, status)
VALUES ('ulludabang@gmail.com', 'Master Admin', 'admin', 'approved')
ON CONFLICT (email) DO UPDATE SET role = 'admin', status = 'approved';

CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL,
    user_email TEXT NOT NULL,
    user_name TEXT,
    user_avatar TEXT,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow select app_users" ON public.app_users;
CREATE POLICY "Allow select app_users" ON public.app_users FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow all app_users" ON public.app_users;
CREATE POLICY "Allow all app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow select activity_logs" ON public.activity_logs;
CREATE POLICY "Allow select activity_logs" ON public.activity_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow insert activity_logs" ON public.activity_logs;
CREATE POLICY "Allow insert activity_logs" ON public.activity_logs FOR INSERT WITH CHECK (true);

ALTER TABLE public.children REPLICA IDENTITY FULL;
ALTER TABLE public.sabhas REPLICA IDENTITY FULL;
ALTER TABLE public.attendance REPLICA IDENTITY FULL;
ALTER TABLE public.app_users REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN CREATE PUBLICATION supabase_realtime FOR ALL TABLES; END IF; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.children; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sabhas; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users; EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs; EXCEPTION WHEN OTHERS THEN NULL; END $$;`;

  dlg.innerHTML = `
    <div style="padding: 2px 0;">
      <div class="row">
        <h2 style="margin:0">🛡️ Administrator Management</h2>
        <button class="btn ghost sm" id="admin-modal-cx">✕</button>
      </div>
      <p class="meta" style="margin: 6px 0 16px;">
        Manage allowance requests and administrators for Samarpit Iraniwadi.
      </p>

      ${dbMissingUsersTable ? `
        <div style="background:#fff8e1; border:1.5px solid #ffe082; border-radius:12px; padding:12px 14px; margin-bottom:16px; color:#5d4037;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="font-size:20px;">⚠️</span>
            <strong style="color:#b26a00; font-size:14px;">Cloud Users Table Not Yet Initialized</strong>
          </div>
          <p style="font-size:12.5px; line-height:1.45; margin:0 0 10px; color:#6d4c41;">
            To sync allowance requests across all users' devices in real time, run the quick SQL script in your Supabase SQL Editor.
          </p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn sm" id="btn-copy-setup-sql" style="font-size:12.5px; padding:5px 12px; background:#e65100; color:#fff;">📋 Copy Setup SQL</button>
            <a href="https://supabase.com/dashboard/project/bsefanprsdzyndcjuhfo/sql/new" target="_blank" rel="noopener" class="btn sm ghost" style="font-size:12.5px; padding:5px 12px; text-decoration:none; color:#e65100; border-color:#e65100;">Open Supabase SQL Editor ↗</a>
          </div>
        </div>
      ` : ''}

      <h3 style="font-size:16px;margin: 16px 0 8px;">⏳ Pending Allowance Requests (${pendingList.length})</h3>
      ${pendingList.length === 0 ? `
        <div class="card" style="padding: 16px; text-align: center;">
          <p class="meta" style="margin:0;">No pending allowance requests.<br>When someone new logs in, their request will automatically appear here!</p>
        </div>
      ` : pendingList.map(u => `
        <div class="pending-user-card">
          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
            ${u.avatar ? `<img src="${esc(u.avatar)}" class="user-avatar" referrerpolicy="no-referrer">` : `<div class="user-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:700;">${(u.name || u.email)[0].toUpperCase()}</div>`}
            <div style="min-width:0;">
              <strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.name || u.email.split('@')[0])}</strong>
              <span class="meta" style="font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;">${esc(u.email)}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn btn-approve" data-act="approve-admin" data-email="${esc(u.email)}">Approve Admin</button>
            <button class="btn ghost sm" data-act="dismiss-request" data-email="${esc(u.email)}" title="Keep as Viewer">Dismiss</button>
          </div>
        </div>
      `).join('')}

      <h3 style="font-size:16px;margin: 20px 0 8px;">👑 Current Administrators</h3>
      <div class="card" style="padding: 8px 12px;">
        ${currentAdmins.map(u => {
          const isMaster = u.email.toLowerCase().trim() === MASTER_ADMIN_EMAIL.toLowerCase();
          const isCurrent = currentUser && u.email.toLowerCase().trim() === currentUser.email.toLowerCase().trim();
          return `
          <div class="row" style="padding: 8px 0; border-bottom: 1px solid var(--line);">
            <div>
              <strong>${esc(u.name || u.email.split('@')[0])}</strong> ${isMaster ? '<span class="chip" style="font-size:11px;padding:1px 6px;">Master Admin</span>' : ''}<br>
              <span class="meta" style="font-size:12px;">${esc(u.email)}</span>
            </div>
            ${(!isMaster && !isCurrent) ? `
              <button class="btn ghost sm danger" data-act="revoke-admin" data-email="${esc(u.email)}">Demote</button>
            ` : ''}
          </div>`;
        }).join('')}
      </div>

      <h3 style="font-size:16px;margin: 20px 0 8px;">➕ Add Administrator by Email</h3>
      <form id="form-direct-add-admin" class="row" style="gap:8px;">
        <input id="direct_admin_email" type="email" placeholder="karyakar@gmail.com" required style="padding:8px 12px;flex:1;">
        <button class="btn sm" type="submit" style="white-space:nowrap;">Add Admin</button>
      </form>
    </div>
  `;

  dlg.showModal();

  $('#admin-modal-cx').onclick = () => dlg.close();

  // Handle Copy Setup SQL button
  const copyBtn = $('#btn-copy-setup-sql');
  if (copyBtn) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(setupSql);
        toast('Setup SQL copied to clipboard! Paste in Supabase SQL Editor and click Run.', 'ok');
      } catch (e) {
        toast('Please copy schema from schema.sql in GitHub repo.', 'info');
      }
    };
  }

  // Handle Approve button
  dlg.querySelectorAll('[data-act="approve-admin"]').forEach(btn => {
    btn.onclick = async () => {
      const email = btn.dataset.email;
      btn.disabled = true;
      btn.innerText = 'Approving...';
      await approveUserAsAdmin(email);
    };
  });

  // Handle Dismiss button
  dlg.querySelectorAll('[data-act="dismiss-request"]').forEach(btn => {
    btn.onclick = async () => {
      const email = btn.dataset.email;
      btn.disabled = true;
      await dismissAllowanceRequest(email);
    };
  });

  // Handle Revoke button
  dlg.querySelectorAll('[data-act="revoke-admin"]').forEach(btn => {
    btn.onclick = async () => {
      const email = btn.dataset.email;
      if (confirm(`Remove admin permissions from ${email}?`)) {
        await revokeAdminAccess(email);
      }
    };
  });

  // Handle Direct Add form
  const formDirect = $('#form-direct-add-admin');
  if (formDirect) {
    formDirect.onsubmit = async e => {
      e.preventDefault();
      const input = $('#direct_admin_email');
      const email = input.value.trim().toLowerCase();
      if (!email) return;
      await approveUserAsAdmin(email);
    };
  }
}

// ------------------------------------------------------------------------------
// 10. Event Listeners
// ------------------------------------------------------------------------------

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const { act, id, v } = b.dataset;

  if (act === 'addS') sabhaForm();
  else if (act === 'editS') sabhaForm(id);
  else if (act === 'addC') childForm();
  else if (act === 'editC') childForm(id);
  else if (act === 'att') {
    attId = id;
    tab = 'att';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  else if (act === 'page') {
    page = id;
    render();
  }
  else if (act === 'req-admin') {
    openRequestAdminDialog();
  }
  else if (act === 'allP') {
    await dbMarkAllPresent(attId);
  }
  else if (act === 'mark') {
    if (!isUserAdmin()) {
      toast('View-only access: Only admins can mark attendance.', 'error');
      return;
    }
    const a = S.att[attId] = S.att[attId] || {};
    const val = +v;
    if (a[id] === val) {
      await dbSetAttendance(attId, id, null);
    } else {
      await dbSetAttendance(attId, id, val);
    }
  }
});

// Tab Switcher
document.querySelector('.tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) {
    tab = b.dataset.tab;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

// Search input
document.addEventListener('input', e => {
  if (e.target.id === 'q') {
    q = e.target.value;
    const list = $('#list');
    if (list) list.innerHTML = kidList();
  }
});

// Sabha dropdown in attendance tab
document.addEventListener('change', e => {
  if (e.target.id === 'sel') {
    attId = e.target.value;
    render();
  }
});

// ------------------------------------------------------------------------------
// 11. Startup Sequence
// ------------------------------------------------------------------------------

(async function startup() {
  const tabsNav = document.querySelector('.tabs');
  const statusBadge = $('#status-badge');
  if (tabsNav) tabsNav.style.display = 'none';
  if (statusBadge) statusBadge.style.display = 'none';

  loadLocalCache();
  render();

  await initSupabase();

  if (supabaseClient && currentUser) {
    await registerOrCheckUser();
    await syncFromCloud();
  }

  updateAuthUI();
  render();
})();
