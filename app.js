// ==============================================================================
// SAMARPIT IRANIWADI - Application Logic
// Features: Google OAuth, PostgreSQL Sync via Supabase, Offline Cache, Realtime
// ==============================================================================

const STORAGE_KEYS = {
  STATE: 'sabha-register-v1',
  SUPABASE_URL: 'sabha_supabase_url',
  SUPABASE_KEY: 'sabha_supabase_key'
};

// Application State
let S = {
  children: [],
  sabhas: [],
  att: {}
};

let tab = 'sabha';
let page = 'cur';
let attId = null;
let q = '';
let currentUser = null;
let supabaseClient = null;
let realtimeChannel = null;
let isSyncing = false;

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
// 1. Supabase & Auth Initialization
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
    console.log('[Samarpit] No Supabase credentials configured. Running in local/demo mode.');
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
      currentUser = session ? session.user : null;
      updateAuthUI();
      if (currentUser) {
        toast(`Signed in as ${currentUser.email}`, 'ok');
        await syncFromCloud();
      } else {
        render();
      }
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
    el.title = 'Saved locally in this browser. Tap Settings to connect Supabase.';
  }
}

function updateAuthUI() {
  const authContainer = $('#auth-status');
  if (!authContainer) return;

  if (currentUser) {
    const avatar = currentUser.user_metadata?.avatar_url || currentUser.user_metadata?.picture;
    const name = currentUser.user_metadata?.full_name || currentUser.email.split('@')[0];
    authContainer.innerHTML = `
      <div class="user-badge" title="${esc(currentUser.email)}">
        ${avatar ? `<img src="${esc(avatar)}" alt="${esc(name)}" class="user-avatar" referrerpolicy="no-referrer">` : ''}
        <span>${esc(name)}</span>
      </div>
      <button class="btn ghost sm" id="btn-sign-out" title="Sign Out">Logout</button>
    `;
    const btnOut = $('#btn-sign-out');
    if (btnOut) btnOut.onclick = handleSignOut;
  } else {
    authContainer.innerHTML = `
      <button class="btn btn-google sm" id="btn-sign-in">
        <svg width="15" height="15" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.86c2.26-2.09 3.685-5.17 3.685-9.09z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.37 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.37 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
        Sign in
      </button>
    `;
    const btnIn = $('#btn-sign-in');
    if (btnIn) btnIn.onclick = handleSignIn;
  }
}

async function handleSignIn() {
  if (!supabaseClient) {
    openSettingsDialog('Please configure your Supabase URL and Anon Key first.');
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
// 2. Real-time Synchronization
// ------------------------------------------------------------------------------

function setupRealtime() {
  if (!supabaseClient) return;
  if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);

  realtimeChannel = supabaseClient.channel('sabha_db_changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'children' }, () => syncFromCloud())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sabhas' }, () => syncFromCloud())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, () => syncFromCloud())
    .subscribe(status => {
      console.log('[Samarpit] Realtime subscription status:', status);
    });
}

// ------------------------------------------------------------------------------
// 3. Cloud Database Sync (Fetch & Cache)
// ------------------------------------------------------------------------------

async function syncFromCloud() {
  if (!supabaseClient || isSyncing) return;
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

    // Map attendance into { [sabhaId]: { [childId]: 1 | 0 } }
    const attMap = {};
    (aData || []).forEach(row => {
      if (!attMap[row.sabha_id]) attMap[row.sabha_id] = {};
      attMap[row.sabha_id][row.child_id] = row.status;
    });
    S.att = attMap;

    saveToLocalCache();
    render();
  } catch (err) {
    console.warn('[Samarpit] Cloud sync issue:', err.message);
  } finally {
    isSyncing = false;
  }
}

function saveToLocalCache() {
  try {
    localStorage.setItem(STORAGE_KEYS.STATE, JSON.stringify(S));
  } catch (e) {
    console.error('Error saving local cache', e);
  }
}

function loadLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STATE);
    if (raw) S = Object.assign(S, JSON.parse(raw));
  } catch (e) {}
}

// ------------------------------------------------------------------------------
// 4. CRUD Operations (Database + Local fallback)
// ------------------------------------------------------------------------------

async function dbSaveChild(childData, id) {
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

  // Update local memory
  if (id) {
    const existing = S.children.find(x => x.id === id);
    if (existing) Object.assign(existing, childData);
    else S.children.push({ id, ...childData });
  } else {
    S.children.push({ id: uid(), ...childData });
  }

  saveToLocalCache();
  render();
  toast(id ? 'Bhulku updated' : 'Bhulku added', 'ok');
}

async function dbDeleteChild(id) {
  if (supabaseClient && currentUser && !id.startsWith('local_')) {
    const { error } = await supabaseClient.from('children').delete().eq('id', id);
    if (error) throw error;
  }

  S.children = S.children.filter(x => x.id !== id);
  for (const s in S.att) delete S.att[s][id];

  saveToLocalCache();
  render();
  toast('Bhulku removed', 'ok');
}

async function dbSaveSabha(sabhaData, id) {
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
  } else {
    S.sabhas.push({ id: uid(), ...sabhaData });
  }

  saveToLocalCache();
  render();
  toast(id ? 'Sabha updated' : 'Sabha added', 'ok');
}

async function dbDeleteSabha(id) {
  if (supabaseClient && currentUser && !id.startsWith('local_')) {
    const { error } = await supabaseClient.from('sabhas').delete().eq('id', id);
    if (error) throw error;
  }

  S.sabhas = S.sabhas.filter(x => x.id !== id);
  delete S.att[id];

  saveToLocalCache();
  render();
  toast('Sabha deleted', 'ok');
}

async function dbSetAttendance(sabhaId, childId, status) {
  const currentAtt = S.att[sabhaId] = S.att[sabhaId] || {};

  // If status is null, delete attendance record
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

  saveToLocalCache();
  render();
}

async function dbMarkAllPresent(sabhaId) {
  const a = S.att[sabhaId] = S.att[sabhaId] || {};
  const upsertRows = [];

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

  saveToLocalCache();
  render();
  toast('Marked all present', 'ok');

  if (supabaseClient && currentUser && upsertRows.length > 0) {
    const { error } = await supabaseClient.from('attendance').upsert(upsertRows, { onConflict: 'sabha_id,child_id' });
    if (error) console.error('Batch attendance error:', error);
  }
}

// ------------------------------------------------------------------------------
// 5. Views & UI Rendering
// ------------------------------------------------------------------------------

function sCard(s, label, cls, needRecap) {
  const n = S.children.length;
  const a = S.att[s.id] || {};
  const marked = Object.keys(a).length;
  const p = Object.values(a).filter(v => v === 1).length;

  return `<article class="card ${cls || ''}">
    <div class="row">
      <span class="date">${fmt(s.date)}</span>
      ${label ? `<span class="chip">${label}</span>` : ''}
    </div>
    <div class="topic">${esc(s.topic)}</div>
    <div class="meta">Vakta: <strong>${esc(s.host) || 'Not assigned'}</strong></div>
    ${s.recap ? `<p class="recap">${esc(s.recap)}</p>` : (needRecap ? '<p class="meta">No recap yet. Tap Edit to add one.</p>' : '')}
    <div class="row" style="margin-top:10px">
      <span class="meta">${marked ? `<strong>${p}</strong> of ${n} present` : 'Attendance not marked'}</span>
      <span>
        <button class="btn ghost sm" data-act="att" data-id="${s.id}">Attendance</button>
        <button class="btn ghost sm" data-act="editS" data-id="${s.id}">Edit</button>
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
  const pages = [
    ['past', 'Past', past.length],
    ['up', 'Upcoming', now.length],
    ['cur', 'Current', cur ? 1 : 0]
  ];

  let h = `
  <div class="row" style="margin-top:16px">
    <h2 style="margin:0">Sabha Schedule</h2>
    <button class="btn" data-act="addS">+ Add Sabha</button>
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
  let h = '<h2 style="margin-top:16px">Attendance</h2>';

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
    <button class="btn ghost sm" data-act="allP">Mark All Present</button>
  </div>`;

  return h + c.map(k => `
  <div class="card row" style="padding: 12px 16px;">
    <span>
      <strong>${esc(k.name)}</strong>
      ${k.cls ? `<br><span class="meta">${esc(k.cls)}</span>` : ''}
    </span>
    <div class="seg" role="group" aria-label="Attendance for ${esc(k.name)}">
      <button data-act="mark" data-id="${k.id}" data-v="1" aria-pressed="${a[k.id] === 1}" class="${a[k.id] === 1 ? 'on-p' : ''}">Present</button>
      <button data-act="mark" data-id="${k.id}" data-v="0" aria-pressed="${a[k.id] === 0}" class="${a[k.id] === 0 ? 'on-a' : ''}">Absent</button>
    </div>
  </div>`).join('');
}

function kidsView() {
  let h = `
  <div class="row" style="margin-top:16px">
    <h2 style="margin:0">Bhulku Directory</h2>
    <button class="btn" data-act="addC">+ Add Bhulku</button>
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
        <button class="btn ghost sm" data-act="editC" data-id="${k.id}">Edit</button>
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
    mainView.innerHTML = tab === 'sabha' ? sabhaView() : tab === 'att' ? attView() : kidsView();
  }
}

// ------------------------------------------------------------------------------
// 6. Dialogs & Forms
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

// ------------------------------------------------------------------------------
// 7. Settings Dialog (Supabase Credentials & OAuth Setup)
// ------------------------------------------------------------------------------

function openSettingsDialog(notice) {
  const { url, key } = getSupabaseCredentials();

  dlg.innerHTML = `
    <div style="padding: 4px 0;">
      <h2 style="margin-top:0">Database & Cloud Setup</h2>
      ${notice ? `<div class="banner"><p style="margin:0;font-size:14px;">${esc(notice)}</p></div>` : ''}
      <p class="meta" style="margin-bottom:16px;">
        Connect your <strong>100% Free Supabase PostgreSQL</strong> database and Google OAuth to sync across all devices.
      </p>

      <form id="cfg-form">
        <label for="cfg_url">Supabase Project URL</label>
        <input id="cfg_url" name="url" type="url" placeholder="https://xyzcompany.supabase.co" value="${esc(url)}" required>

        <label for="cfg_key">Supabase Anon Public Key</label>
        <input id="cfg_key" name="key" type="password" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..." value="${esc(key)}" required>

        <div class="row" style="margin-top:20px">
          <button type="button" class="btn ghost sm" id="btn-view-sql">View SQL Schema</button>
          <span>
            <button type="button" class="btn ghost" id="cfg-cx">Close</button>
            <button class="btn" type="submit">Save & Connect</button>
          </span>
        </div>
      </form>

      <div style="border-top:1px solid var(--line);margin-top:20px;padding-top:14px;">
        <span class="meta" style="font-size:13px;">
          Need a Supabase database? Create one free at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>. Run <code>schema.sql</code> in the SQL Editor.
        </span>
      </div>
    </div>
  `;
  dlg.showModal();

  $('#cfg-form').onsubmit = async e => {
    e.preventDefault();
    const newUrl = $('#cfg_url').value.trim();
    const newKey = $('#cfg_key').value.trim();

    localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, newUrl);
    localStorage.setItem(STORAGE_KEYS.SUPABASE_KEY, newKey);

    dlg.close();
    toast('Connecting to Supabase...', 'info');

    const ok = await initSupabase();
    if (ok) {
      toast('Supabase connected successfully!', 'ok');
      await syncFromCloud();
    } else {
      toast('Could not connect. Check credentials.', 'error');
    }
  };

  $('#cfg-cx').onclick = () => dlg.close();
  $('#btn-view-sql').onclick = () => {
    window.open('schema.sql', '_blank');
  };
}

// ------------------------------------------------------------------------------
// 8. Event Listeners
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
  else if (act === 'allP') {
    await dbMarkAllPresent(attId);
  }
  else if (act === 'mark') {
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

// Settings button
const btnSettings = $('#btn-settings');
if (btnSettings) {
  btnSettings.onclick = () => openSettingsDialog();
}

// ------------------------------------------------------------------------------
// 9. Startup Sequence
// ------------------------------------------------------------------------------

(async function startup() {
  // Hide navigation tabs initially until authentication is verified
  const tabsNav = document.querySelector('.tabs');
  const statusBadge = $('#status-badge');
  if (tabsNav) tabsNav.style.display = 'none';
  if (statusBadge) statusBadge.style.display = 'none';

  render();

  // Try connecting to Supabase and verify session
  await initSupabase();
  if (supabaseClient && currentUser) {
    loadLocalCache();
    await syncFromCloud();
  } else {
    updateAuthUI();
    render();
  }
})();
