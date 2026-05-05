let currentUser = null;
let userRole = 'MA'; // Default
let allUsers = [];

// ── SESSION & PIN SECURITY ──
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const REMEMBER_ME_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function getPinAttempts() {
  try { return JSON.parse(localStorage.getItem('_pin_attempts') || '{"count":0,"since":0}'); }
  catch { return { count: 0, since: 0 }; }
}
function recordPinFailure() {
  const a = getPinAttempts();
  const now = Date.now();
  if (now - a.since > PIN_LOCKOUT_MS) { a.count = 0; a.since = now; }
  a.count++;
  localStorage.setItem('_pin_attempts', JSON.stringify(a));
  return a.count;
}
function resetPinAttempts() {
  localStorage.removeItem('_pin_attempts');
}
function isPinLockedOut() {
  const a = getPinAttempts();
  return a.count >= PIN_MAX_ATTEMPTS && (Date.now() - a.since) < PIN_LOCKOUT_MS;
}
function pinLockoutRemaining() {
  const a = getPinAttempts();
  const remaining = PIN_LOCKOUT_MS - (Date.now() - a.since);
  return Math.ceil(remaining / 60000); // minutes
}

// Fetches the latest employee list from the public app_users table
async function fetchEmployees() {
  const { data, error } = await supabaseClient
    .from('app_users')
    .select('id, full_name, role, default_dept')
    .order('full_name', { ascending: true });

  if (error) {
    console.error('Fehler beim Laden der Mitarbeiter:', error);
    return;
  }
  
  allUsers = data || [];
  populateDropdown();
}

function populateDropdown() {
  const sel = document.getElementById('auth-name-select');
  if (!sel) return;
  
  // Clear existing options except the placeholder
  sel.innerHTML = '<option value="" disabled selected>Name auswählen...</option>';
  
  allUsers.forEach(emp => {
    let opt = document.createElement('option');
    opt.value = emp.id;
    opt.textContent = emp.full_name;
    sel.appendChild(opt);
  });
}

async function initAuth() {
  await fetchEmployees();

  // Show/hide password field based on selected user's role
  const nameSel = document.getElementById('auth-name-select');
  const pwWrapper = document.getElementById('auth-password-wrapper');
  if (nameSel && pwWrapper) {
    nameSel.addEventListener('change', () => {
      const user = allUsers.find(u => u.id === nameSel.value);
      if (user && user.role === 'MA') {
        pwWrapper.style.display = 'none';
        document.getElementById('auth-password').value = '';
      } else if (user) {
        pwWrapper.style.display = 'block';
      }
    });
  }

  // Check if we have an active local session (with expiry)
  const activeUserId = localStorage.getItem('local_app_user_id');
  const sessionTs = parseInt(localStorage.getItem('local_app_session_ts') || '0');
  const rememberMe = localStorage.getItem('local_app_remember_me') === '1';
  const activeTTL = rememberMe ? REMEMBER_ME_TTL_MS : SESSION_TTL_MS;
  if (activeUserId && (Date.now() - sessionTs) < activeTTL) {
    const user = allUsers.find(u => u.id === activeUserId);
    if (user) {
      handleSession(user);
      return;
    }
  } else if (activeUserId) {
    // Expired session — clear it
    localStorage.removeItem('local_app_user_id');
    localStorage.removeItem('local_app_session_ts');
    localStorage.removeItem('local_app_remember_me');
  }

  handleSession(null);
}

function handleSession(user) {
  const overlay = document.getElementById('auth-overlay');
  if (!overlay) return;

  if (user) {
    currentUser = { id: user.id, email: '' }; // Mock basic GoTrue object for backwards compatibility
    userRole = user.role;
    
    // Auto-sync the user's name across the app (Stundenzettel tracking)
    const snInput = document.getElementById('inp-name');
    if (snInput) {
      snInput.value = user.full_name;
    }
    localStorage.setItem('stundenzettel_name', user.full_name);
    window.currentUserRateConni    = parseFloat(user.hourly_rate_conni)    || 0;
    window.currentUserRateInternal = parseFloat(user.hourly_rate_internal) || 0;

    overlay.style.display = 'none';

    console.log('User logged in locally:', user.full_name, 'Role:', userRole);
    enforceUI();
    // If Projektordner is already rendered, re-render with correct permissions
    if (typeof activeModule !== 'undefined' && activeModule === 'ordner' &&
        typeof renderOrdner === 'function' && typeof alleOrdner !== 'undefined') {
      canManageOrdner = ['PL', 'Admin'].includes(userRole);
      var addBtn = document.getElementById('btn-add-ordner');
      if (addBtn) addBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';
      if (alleOrdner.length > 0) renderOrdner(alleOrdner);
    }
  } else {
    currentUser = null;
    userRole = 'MA';
    overlay.style.display = 'flex';
  }
}

function enforceUI() {
  const protBtn = document.getElementById('btn-select-protokoll');
  const dashBtn = document.getElementById('btn-select-dashboard');

  if (protBtn) {
    protBtn.style.display = (userRole === 'MA') ? 'none' : 'block';
  }
  if (dashBtn) {
    const isAdmin = ['AL', 'PL', 'Buchhaltung', 'Admin'].includes(userRole);
    dashBtn.style.display = isAdmin ? 'block' : 'none';
  }
}

async function handleAuthSubmit() {
  const nameSel = document.getElementById('auth-name-select');
  const passInput = document.getElementById('auth-password');
  const errorEl = document.getElementById('auth-error');
  const btn = document.getElementById('auth-submit-btn');

  errorEl.style.display = 'none';

  if (!nameSel || !nameSel.value) {
    errorEl.textContent = 'Bitte deinen Namen auswählen.';
    errorEl.style.display = 'block';
    return;
  }

  const user = allUsers.find(u => u.id === nameSel.value);
  if (!user) {
    errorEl.textContent = 'Benutzer nicht in Datenbank gefunden!';
    errorEl.style.display = 'block';
    return;
  }

  btn.textContent = 'Lädt...';
  btn.disabled = true;

  // Non-MA users require Admin PIN (validated server-side via Supabase RPC)
  if (user.role !== 'MA') {
    const passVal = passInput.value;
    if (!passVal) {
      errorEl.textContent = 'Bitte das Admin-Passwort eingeben.';
      errorEl.style.display = 'block';
      btn.textContent = 'Anmelden';
      btn.disabled = false;
      return;
    }

    // Check brute-force lockout
    if (isPinLockedOut()) {
      errorEl.textContent = `Zu viele Fehlversuche. Bitte ${pinLockoutRemaining()} Min. warten.`;
      errorEl.style.display = 'block';
      btn.textContent = 'Anmelden';
      btn.disabled = false;
      return;
    }

    const { data: valid, error: rpcError } = await supabaseClient.rpc('verify_admin_pin', { input_pin: passVal });
    if (rpcError || !valid) {
      const attempts = recordPinFailure();
      const remaining = PIN_MAX_ATTEMPTS - attempts;
      errorEl.textContent = remaining > 0
        ? `Falsches Passwort. Noch ${remaining} Versuch(e).`
        : `Zu viele Fehlversuche. Bitte ${PIN_LOCKOUT_MS / 60000} Min. warten.`;
      errorEl.style.display = 'block';
      btn.textContent = 'Anmelden';
      btn.disabled = false;
      return;
    }

    resetPinAttempts();
  }

  // Clear password input and set local session with timestamp
  passInput.value = '';
  const rememberChecked = document.getElementById('auth-remember')?.checked || false;
  if (rememberChecked) {
    localStorage.setItem('local_app_remember_me', '1');
  } else {
    localStorage.removeItem('local_app_remember_me');
  }
  localStorage.setItem('local_app_user_id', user.id);
  localStorage.setItem('local_app_session_ts', String(Date.now()));
  handleSession(user);

  btn.textContent = 'Anmelden';
  btn.disabled = false;
}

async function handleLogout() {
  if (!confirm('Möchtest du dich wirklich abmelden?')) return;
  
  localStorage.removeItem('local_app_user_id');
  localStorage.removeItem('local_app_session_ts');
  localStorage.removeItem('local_app_remember_me');
  handleSession(null);
  
  if (typeof closeSettingsModal === 'function') {
    closeSettingsModal();
  }
}

document.addEventListener('DOMContentLoaded', initAuth);
