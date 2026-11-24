/* ══ Start page ("Heute"): next own shift as the hero card; week strip and to-do rows live in heute.js ══
   Pure helpers first (testable with node --test); the DOM part follows below. */

var NEXT_SHIFT_KEY = 'luebbert_next_shift';

// Stored dashboard view ('prot' | 'work'); the old single "dashboard" mode has none → protocols
function dashViewFromStored(v) {
  return v === 'work' ? 'work' : 'prot';
}

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
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

// The card turns into the full "Heute" card when the shift is today, or last night's shift is still running
function homeIsToday(date, today) {
  var t = String(today).split('-').map(Number), d = new Date(Date.UTC(t[0], t[1] - 1, t[2] - 1));
  return date === today || date === d.toISOString().slice(0, 10);
}
// "Saal Europa, Sonnenallee 225": first location line plus the street; the postcode line stays out of the text
function homeAddress(s) {
  var loc = s && s.location ? String(s.location).split('\n').map(function(l) { return l.trim(); }).filter(Boolean) : [];
  var street = loc.find(function(l) { return /\d/.test(l) && !/^\d{5}\b/.test(l); });
  return [loc[0], street].filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(', ');
}
// Route link for maps: venue, street and the postcode line; a room name alone would only confuse the search
function homeMapsUrl(s) {
  var loc = s && s.location ? String(s.location).split('\n').map(function(l) { return l.trim(); }).filter(Boolean) : [];
  var street = loc.find(function(l) { return /\d/.test(l) && !/^\d{5}\b/.test(l); });
  var town = loc.find(function(l) { return /^\d{5}\b/.test(l); });
  var q = [s && s.venue, street, town].filter(Boolean).join(', ').trim();
  return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : null;
}

/* ── DOM part (browser only) ── */

// "heute" / "morgen" / "am Freitag" within the next 6 days, else "am 07.11."
function homeWhen(date) {
  var today = localDateStr();
  if (date === today) return 'heute';
  if (date === wpAddDays(today, -1)) return 'heute Nacht'; // yesterday's night shift (Abbau 0.30 Uhr) running now
  if (date === wpAddDays(today, 1)) return 'morgen';
  var p = wpParts(date);
  if (date < wpAddDays(today, 7)) return 'am ' + WP_WEEKDAYS_LONG[p.dow];
  return 'am ' + ('0' + p.d).slice(-2) + '.' + ('0' + p.m).slice(-2) + '.';
}

// Hero (Werkstatt): orange tag with action and time, venue, place, PL, team initials, Route.
// Today it is followed by a card with everything for the day (wpDetails, "Protokoll starten" for the AL, material).
// No phone numbers: the app stores none.
function homeHeroHtml(s, when, today) {
  var tc = wpTimeCol(s), head = planShiftHeading(s), addr = homeAddress(s), maps = homeMapsUrl(s);
  var team = (s.plan_assignments || [])
    .filter(function(a) { return a.user_id !== (currentUser && currentUser.id) && WP_AGENCY.indexOf(a.role) === -1; })
    .map(function(a) { return a.name; }).filter(Boolean);
  var initials = function(n) { return String(n).trim().split(/\s+/).map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase(); };
  var avs = team.slice(0, 4).map(function(n) { return '<span class="w-av" title="' + escapeHtml(n) + '">' + escapeHtml(initials(n)) + '</span>'; }).join('') +
    (team.length > 4 ? '<span class="w-av">+' + (team.length - 4) + '</span>' : '');
  return '<div class="w-hero"' + (today ? '' : ' role="button" tabindex="0" onclick="selectMode(\'wochenplan\')"') + '>' +
    '<span class="w-tag">' + escapeHtml(when) + ' · ' + escapeHtml(tc.big) + (tc.small ? ' ' + escapeHtml(tc.small) : '') + '</span>' +
    '<div class="w-hero-title">' + escapeHtml(s.venue || '—') + '</div>' +
    ((head && head !== s.venue) || addr ? '<div class="w-hero-sub">' + escapeHtml([head !== s.venue ? head : '', addr].filter(Boolean).join(' · ')) + '</div>' : '') +
    '<div class="w-hero-foot"><span>' + (s.ap ? 'PL ' + escapeHtml(s.ap) : '') + (avs ? ' <span class="w-avs">' + avs + '</span>' : '') + '</span>' +
      (maps ? '<a class="w-btn w-btn-accent" href="' + escapeHtml(maps) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">Route</a>' : '') + '</div>' +
  '</div>';
}

function homeTodayHtml(s) {
  // On site the plan and the material list come first (js/vorort.js), the details below
  return homeHeroHtml(s, 'Heute' + (s.date !== localDateStr() ? ' Nacht' : ''), true) +
    (typeof voBlockHtml === 'function' ? voBlockHtml(s) : '') +
    '<div class="w-card home-today wp-open">' + wpDetails(s) +
    '<div class="home-today-actions">' + wpProtButton(s, 'primary') +
      '<button type="button" class="ord-textbtn" onclick="selectMode(\'wochenplan\')">Im Wochenplan öffnen</button></div>' +
  '</div>';
}

function homeNextHtml(s) {
  if (homeIsToday(s.date, localDateStr())) return homeTodayHtml(s);
  var w = homeWhen(s.date);
  return homeHeroHtml(s, w.charAt(0).toUpperCase() + w.slice(1), false) + (typeof voBlockHtml === 'function' ? voBlockHtml(s) : '');
}

function homeShowNext(shift) {
  var box = document.getElementById('home-next');
  if (!box) return;
  // A cached shift can be outdated by now: run it through the same filter as the live list
  var s = shift && homeNextAllowed(userRole, moduleAllowedForRole) ? nextOwnShift([shift], new Date()) : null;
  if (s && typeof _wpShiftCache !== 'undefined') _wpShiftCache[s.id] = s; // "Protokoll starten" on the card reads it from there
  box.innerHTML = s ? homeNextHtml(s) : (userRole === 'MA' || userRole === 'AL')
    ? '<div class="w-empty"><b>Kein Einsatz geplant</b><p>Sobald du im Wochenplan stehst, siehst du ihn hier.</p>' +
      '<button type="button" class="w-btn" onclick="selectMode(\'wochenplan\')">Zum Plan</button></div>' : '';
}

var _homeSeq = 0, _homeFetchedAt = 0, _homeFetchedFor = null;

async function refreshHomeNextShift(force) {
  var me = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
  if (!me || typeof supabaseClient === 'undefined' || !homeNextAllowed(userRole, moduleAllowedForRole)) return;
  // enforceUI and exitToMenu both render: one query per 30 s per person is enough
  if (!force && _homeFetchedFor === me && Date.now() - _homeFetchedAt < 30000) return;
  _homeFetchedFor = me; _homeFetchedAt = Date.now();
  var seq = ++_homeSeq;
  // From yesterday: a shift "Abbau: 0.30 Uhr" belongs to the night after its listed day
  var yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  var res = await supabaseClient.from('plan_assignments')
    .select('shift:plan_shifts!inner(*, plan_assignments(*))')
    .eq('user_id', me).gte('shift.date', localDateStr(yesterday));
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
  if (hello) hello.textContent = 'Heute';
  var date = document.getElementById('home-date');
  if (date) { var n = firstName(currentUser.full_name);
    date.textContent = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }) + (n ? ' · Hallo ' + n : ''); }
  var cached = null;
  try { cached = readNextShiftCache(localStorage.getItem(NEXT_SHIFT_KEY), currentUser.id); } catch (e) { /* ignore */ }
  homeShowNext(cached);
  refreshHomeNextShift();
  if (typeof renderHeute === 'function') renderHeute();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { firstName: firstName, homeNextAllowed: homeNextAllowed, dashViewFromStored: dashViewFromStored,
    nextShiftCacheValue: nextShiftCacheValue, readNextShiftCache: readNextShiftCache, homeIsToday: homeIsToday, homeAddress: homeAddress, homeMapsUrl: homeMapsUrl };
}
