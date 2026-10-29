/* ══ Start page: greeting, next own shift, module tiles ══
   Pure helpers first (testable with node --test); the DOM part follows below. */

var NEXT_SHIFT_KEY = 'luebbert_next_shift';

var HOME_TILES = [
  { mode: 'stunden', label: 'Stundenzettel', icon: 'clock' },
  { mode: 'protokoll', label: 'Protokoll', icon: 'clipboard' },
  { mode: 'wochenplan', label: 'Wochenplan', icon: 'calendar' },
  { mode: 'produkte', label: 'Produktdatenbank', icon: 'box' },
  { mode: 'ordner', label: 'Projektordner', icon: 'folder' },
  { mode: 'dashboard', label: 'Office Dashboard', icon: 'chart' }
];

function firstName(fullName) {
  return String(fullName || '').trim().split(/\s+/)[0] || '';
}

// allowed = moduleAllowedForRole (auth.js); passed in so this stays testable
function homeTiles(role, allowed) {
  return HOME_TILES.filter(function(t) { return allowed(t.mode, role); });
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HOME_TILES: HOME_TILES, firstName: firstName, homeTiles: homeTiles,
    nextShiftCacheValue: nextShiftCacheValue, readNextShiftCache: readNextShiftCache };
}
