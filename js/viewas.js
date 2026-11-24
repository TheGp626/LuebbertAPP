/* ══ "Ansicht als …": an Admin looks at the app as MA, AL, PL, Buchhaltung or Gast without logging in again ══
   Only the interface switches (userRole, tabs, screens, cost columns). The database still answers as the Admin, so
   lists can show more than the real role would see, and anything saved is saved as the Admin. Remembered per device
   until switched back; a non-Admin login ignores it. Pure helper first (node --test), the DOM part below. */

var VIEW_AS_KEY = 'luebbert_view_as';
var VIEW_AS_ROLES = ['Admin', 'PL', 'AL', 'MA', 'Buchhaltung', 'Gast'];
var VIEW_AS_LABELS = { Admin: 'Admin', PL: 'PL – Projektleitung', AL: 'AL – Aufbauleitung', MA: 'MA – Mitarbeiter', Buchhaltung: 'Buchhaltung', Gast: 'Gast' };

// realRole = role of the login, stored = remembered choice → the role the interface uses
function viewAsEffective(realRole, stored) {
  if (realRole !== 'Admin' || !stored || VIEW_AS_ROLES.indexOf(stored) === -1) return realRole;
  return stored;
}

/* ── DOM part ── */

function viewAsStored() { try { return localStorage.getItem(VIEW_AS_KEY) || ''; } catch (e) { return ''; } }
function viewAsReal() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.realRole) || (typeof userRole !== 'undefined' ? userRole : null); }
function viewAsIsAdmin() { return viewAsReal() === 'Admin'; }

// Called by handleSession right after the login role is known
function viewAsApply() {
  if (typeof currentUser === 'undefined' || !currentUser) { viewAsChip(); return; }
  currentUser.realRole = currentUser.realRole || currentUser.role;
  userRole = viewAsEffective(currentUser.realRole, viewAsStored());
  currentUser.role = userRole;
  if (typeof canSeeCosts === 'function') document.body.classList.toggle('no-costs', !canSeeCosts(currentUser));
  viewAsChip();
}

function openViewAsMenu() {
  if (!viewAsIsAdmin()) return;
  openUiMenu(VIEW_AS_ROLES.map(function(r) {
    return { label: (r === userRole ? '✓ ' : '') + (r === 'Admin' ? 'Admin (eigene Ansicht)' : 'Ansicht als ' + VIEW_AS_LABELS[r]), action: 'setViewAs', args: [r] };
  }));
}

function setViewAs(role) {
  if (!viewAsIsAdmin() || VIEW_AS_ROLES.indexOf(role) === -1) return;
  try { if (role === 'Admin') localStorage.removeItem(VIEW_AS_KEY); else localStorage.setItem(VIEW_AS_KEY, role); } catch (e) { /* this session only */ }
  userRole = role;
  currentUser.role = role;
  if (typeof canSeeCosts === 'function') document.body.classList.toggle('no-costs', !canSeeCosts(currentUser));
  // Start fresh on the role's first screen: cached Heute data and the open module belong to the old view
  if (typeof _homeFetchedAt !== 'undefined') _homeFetchedAt = 0;
  if (typeof plState !== 'undefined') plState = null;
  if (typeof exitToMenu === 'function') exitToMenu();
  if (typeof enforceUI === 'function') enforceUI();
  viewAsChip();
  showToast(role === 'Admin' ? 'Wieder deine eigene Ansicht' : 'Ansicht als ' + VIEW_AS_LABELS[role]);
}

// While viewing as another role: a small badge on top, one tap to switch or go back
function viewAsChip() {
  var el = document.getElementById('view-as-chip');
  var on = viewAsIsAdmin() && userRole !== 'Admin';
  if (!on) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'view-as-chip';
    el.className = 'view-as-chip';
    el.onclick = openViewAsMenu;
    document.body.appendChild(el);
  }
  el.textContent = 'Ansicht: ' + userRole + ' · wechseln';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { viewAsEffective: viewAsEffective, VIEW_AS_ROLES: VIEW_AS_ROLES };
}
