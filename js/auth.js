let currentUser = null;
let userRole = 'MA'; // Default
let allUsers = []; 

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

  // Check if we have an active local session
  const activeUserId = localStorage.getItem('local_app_user_id');
  if (activeUserId) {
    const user = allUsers.find(u => u.id === activeUserId);
    if (user) {
      handleSession(user);
      return;
    }
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
    
    overlay.style.display = 'none';

    console.log('User logged in locally:', user.full_name, 'Role:', userRole);
    enforceUI();
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

    const { data: valid, error: rpcError } = await supabaseClient.rpc('verify_admin_pin', { input_pin: passVal });
    if (rpcError || !valid) {
      errorEl.textContent = 'Falsches Passwort.';
      errorEl.style.display = 'block';
      btn.textContent = 'Anmelden';
      btn.disabled = false;
      return;
    }
  }

  // Clear password input and set local session
  passInput.value = '';
  localStorage.setItem('local_app_user_id', user.id);
  handleSession(user);

  btn.textContent = 'Anmelden';
  btn.disabled = false;
}

async function handleLogout() {
  if (!confirm('Möchtest du dich wirklich abmelden?')) return;
  
  localStorage.removeItem('local_app_user_id');
  handleSession(null);
  
  if (typeof closeSettingsModal === 'function') {
    closeSettingsModal();
  }
}

document.addEventListener('DOMContentLoaded', initAuth);
