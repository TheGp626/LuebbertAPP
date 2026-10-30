/* ══ Start page: greeting, next own shift, module tiles ══
   Pure helpers first (testable with node --test); the DOM part follows below. */

var NEXT_SHIFT_KEY = 'luebbert_next_shift';

var HOME_TILES = [
  { mode: 'stunden', label: 'Stundenzettel', icon: 'clock' },
  { mode: 'protokoll', label: 'Protokoll schreiben', icon: 'clipboard' },
  { mode: 'wochenplan', label: 'Wochenplan', icon: 'calendar' },
  { mode: 'produkte', label: 'Produktdatenbank', icon: 'box' },
  { mode: 'ordner', label: 'Projektordner', icon: 'folder' },
  // The office dashboard is two tiles: same module (role guard), different view
  { mode: 'dashboard', view: 'prot', id: 'dashboard-prot', label: 'Protokoll-Übersicht', icon: 'file' },
  { mode: 'dashboard', view: 'work', id: 'dashboard-work', label: 'Buchhaltung', icon: 'chart' }
];

// Stored dashboard view ('prot' | 'work'); the old single "dashboard" mode has none → protocols
function dashViewFromStored(v) {
  return v === 'work' ? 'work' : 'prot';
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

// allowed = moduleAllowedForRole (auth.js); passed in so this stays testable
function homeTiles(role, allowed) {
  return HOME_TILES.filter(function(t) { return allowed(t.mode, role); });
}

// The card opens the Wochenplan: a role without access (Gast) gets no card instead of "Zugriff verweigert"
function homeNextAllowed(role, allowed) {
  return allowed('wochenplan', role);
}

// The cache belongs to one person: on a shared device another login must never see it
function nextShiftCacheValue(userId, shift) {
  return JSON.stringify({ u: userId, s: shift, at: Date.now() });
}

function readNextShiftCache(raw, userId) {
  try {
    var c = raw ? JSON.parse(raw) : null;
    return c && c.u === userId && c.s ? c.s : null;
  } catch (e) { return null; }
}

/* ── DOM part (browser only) ── */

// "heute" / "morgen" / "am Freitag" within the next 6 days, else "am 07.11."
function homeWhen(date) {
  var today = localDateStr();
  if (date === today) return 'heute';
  if (date === wpAddDays(today, 1)) return 'morgen';
  var p = wpParts(date);
  if (date < wpAddDays(today, 7)) return 'am ' + WP_WEEKDAYS_LONG[p.dow];
  return 'am ' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.';
}

function homeNextHtml(s) {
  var tc = wpTimeCol(s), head = planShiftHeading(s);
  var team = (s.plan_assignments || [])
    .filter(function(a) { return a.user_id !== (currentUser && currentUser.id) && WP_AGENCY.indexOf(a.role) === -1; })
    .map(function(a) { return firstName(a.name); }).filter(Boolean);
  var teamText = team.slice(0, 3).join(', ') + (team.length > 3 ? ' +' + (team.length - 3) : '');
  return '<div class="ui-hero" role="button" tabindex="0" onclick="selectMode(\'wochenplan\')">' +
    '<div class="ui-hero-when">Nächster Einsatz · ' + homeWhen(s.date) + '</div>' +
    '<div class="ui-num">' + escapeHtml(tc.big) + (tc.small ? ' <span>' + escapeHtml(tc.small) + '</span>' : '') + '</div>' +
    '<div class="ui-hero-place">' + escapeHtml(s.venue || '—') + (head && head !== s.venue ? ' · ' + escapeHtml(head) : '') + '</div>' +
    ((s.ap || teamText) ? '<div class="ui-sub" style="margin-top:2px;">' +
      escapeHtml([s.ap ? 'PL ' + s.ap : '', teamText ? 'mit ' + teamText : ''].filter(Boolean).join(' · ')) + '</div>' : '') +
    '</div>';
}

function homeShowNext(shift) {
  var box = document.getElementById('home-next');
  if (!box) return;
  // A cached shift can be outdated by now: run it through the same filter as the live list
  var s = shift && homeNextAllowed(userRole, moduleAllowedForRole) ? nextOwnShift([shift], new Date()) : null;
  box.innerHTML = s ? homeNextHtml(s) : '';
}

var _homeSeq = 0, _homeFetchedAt = 0, _homeFetchedFor = null;

async function refreshHomeNextShift(force) {
  var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  if (!me || typeof supabaseClient === 'undefined' || !homeNextAllowed(userRole, moduleAllowedForRole)) return;
  // enforceUI and exitToMenu both render: one query per 30 s per person is enough
  if (!force && _homeFetchedFor === me && Date.now() - _homeFetchedAt < 30000) return;
  _homeFetchedFor = me; _homeFetchedAt = Date.now();
  var seq = ++_homeSeq;
  var res = await supabaseClient.from('plan_assignments')
    .select('shift:plan_shifts!inner(*, plan_assignments(*))')
    .eq('user_id', me).gte('shift.date', localDateStr());
  // Offline or failed: keep whatever the cache already showed, no error message
  if (res.error || seq !== _homeSeq || !currentUser || currentUser.id !== me) { if (res.error) _homeFetchedAt = 0; return; }
  var seen = {};
  var next = nextOwnShift((res.data || []).map(function(r) { return r.shift; })
    .filter(function(s) { if (!s || seen[s.id]) return false; seen[s.id] = true; return true; }), new Date());
  try {
    if (next) localStorage.setItem(NEXT_SHIFT_KEY, nextShiftCacheValue(me, next));
    else localStorage.removeItem(NEXT_SHIFT_KEY);
  } catch (e) { /* storage blocked: the card just won't survive offline */ }
  homeShowNext(next);
}

function renderHome() {
  if (typeof currentUser === 'undefined' || !currentUser) return;
  var hello = document.getElementById('home-hello');
  if (hello) { var n = firstName(currentUser.full_name); hello.textContent = n ? 'Hallo ' + n : 'Hallo'; }
  var date = document.getElementById('home-date');
  if (date) date.textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  var tiles = document.getElementById('home-tiles');
  if (tiles) {
    tiles.innerHTML = homeTiles(userRole, moduleAllowedForRole).map(function(t) {
      return '<button type="button" class="ui-tile" id="btn-select-' + (t.id || t.mode) + '" onclick="selectMode(\'' + t.mode + '\'' + (t.view ? ', \'' + t.view + '\'' : '') + ')">' +
        '<span class="ui-tile-ico">' + uiIcon(t.icon) + '</span><span>' + t.label + '</span></button>';
    }).join('');
  }
  var cached = null;
  try { cached = readNextShiftCache(localStorage.getItem(NEXT_SHIFT_KEY), currentUser.id); } catch (e) { /* ignore */ }
  homeShowNext(cached);
  refreshHomeNextShift();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOME_TILES: HOME_TILES, firstName: firstName, homeTiles: homeTiles, homeNextAllowed: homeNextAllowed, dashViewFromStored: dashViewFromStored,
    nextShiftCacheValue: nextShiftCacheValue, readNextShiftCache: readNextShiftCache };
}
