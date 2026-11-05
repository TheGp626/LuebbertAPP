// ── RATEN & FORMELN ──

// ── PROTOKOLL RATES ──

// Fallback only (offline before the first settings load): admins edit the rates in Einstellungen
// (app_settings.vehicle_rates). € per job: wk = Mo–Fr, sa = Saturday, so = Sunday.
var PROT_VEHICLE_RATES = {
  'Hängerzug':       { wk: 80,  sa: 80,  so: 80 },
  'Solo':            { wk: 70,  sa: 70,  so: 70 },
  'Leih LKW':        { wk: 0,   sa: 0,   so: 0 },
  'Sprinter':        { wk: 40,  sa: 40,  so: 40 },
  'PKW':             { wk: 20,  sa: 20,  so: 20 },
  'Spedition':       { wk: 0,   sa: 0,   so: 0 },
  'Bischoff':        { wk: 750, sa: 750, so: 837.5 },
  'Rainer':          { wk: 700, sa: 750, so: 750 },
  'Hansetrans Solo': { wk: 250, sa: 250, so: 250 }
};

function protVehicleRates() {
  var r = (typeof appSetting === 'function') ? appSetting('vehicle_rates') : null;
  return (r && typeof r === 'object' && Object.keys(r).length) ? r : PROT_VEHICLE_RATES;
}

// jsonb does not keep key order → list vehicles alphabetically
function protVehicleTypes() {
  return Object.keys(protVehicleRates()).sort(function(a, b) { return a.localeCompare(b, 'de'); });
}

// cost = amount entered for a Spedition transport (its price changes per job); null/'' → no amount
function calcTransportCost(type, dateStr, cost) {
  if (type === 'Spedition') return parseFloat(cost) >= 0 ? parseFloat(cost) : 0;
  var r = protVehicleRates()[type];
  if (!r) return 0;
  if (!dateStr) return r.wk;
  var day = new Date(dateStr).getDay();
  return day === 0 ? r.so : day === 6 ? r.sa : r.wk;
}

var PROT_PERSONNEL_RATES = {
  'AL fest': 0,
  'AL frei': 25,
  'MA fest': 0,
  'MA frei': 21.50,
  'Fahrer fest': 0,
  'Fahrer frei': 30,
  'Zenjob Tag': 23.50,
  'Zenjob Nacht': 29.38,
  'Zenjob Sonntag': 35.25,
  'Zenjob Feiertag': 35.25,
  'Rockit Tag': 30,
  'Rockit Nacht': 45,
  'Rockit Sonntag': 60,
  'Rockit Feiertag': 60
};

// ── EMPLOYMENT TYPE (Beschäftigungsart) ──
// The type lives on the person (app_users.employment_type); a shift stores "<Funktion> <Typ>" (e.g. "MA Minijob")
// as a snapshot. Old keys like "MA frei" / "AL fest" stay valid and keep the PROT_PERSONNEL_RATES table.
var EMPLOYMENT_TYPES = ['Minijob', 'Midijob', 'Rechnung', 'Fest'];
var TYPED_FUNCTIONS = ['MA', 'AL', 'Fahrer'];
var PERSONNEL_RATE_DEFAULTS = {
  Minijob:  { MA: 21.5, AL: 25, Fahrer: 30 },
  Midijob:  { MA: 21.5, AL: 25, Fahrer: 30 },
  Rechnung: { MA: 21.5, AL: 25, Fahrer: 30 },
  Fest:     { MA: 0,    AL: 0,  Fahrer: 0 }
};

function positionKey(func, type) {
  if (TYPED_FUNCTIONS.indexOf(func) === -1) return func;
  return func + ' ' + (EMPLOYMENT_TYPES.indexOf(type) !== -1 ? type : 'Minijob');
}

function splitPosition(key) {
  var parts = String(key || '').split(' ');
  var func = parts[0], rest = parts.slice(1).join(' ');
  if (TYPED_FUNCTIONS.indexOf(func) !== -1 && EMPLOYMENT_TYPES.indexOf(rest) !== -1) return { func: func, type: rest, legacy: false };
  if (TYPED_FUNCTIONS.indexOf(func) !== -1 && (rest === 'frei' || rest === 'fest')) return { func: func, type: null, legacy: rest };
  return { func: String(key || ''), type: null, legacy: false };
}

// Does a personal rate entry (app_users.role_rates[].role) apply to a position? Old entries "MA frei" keep
// applying to the paid types, "MA fest" to Fest
function roleRateMatches(entryRole, key) {
  if (entryRole === key) return true;
  var e = splitPosition(entryRole), k = splitPosition(key);
  if (!e.legacy || !k.type || e.func !== k.func) return false;
  return e.legacy === 'fest' ? k.type === 'Fest' : k.type !== 'Fest';
}

function personnelRate(key) {
  var p = splitPosition(key);
  if (!p.type) return PROT_PERSONNEL_RATES[key] || 0;
  var s = (typeof appSetting === 'function') ? appSetting('personnel_rates') : null;
  var row = (s && s[p.type] && typeof s[p.type][p.func] === 'number') ? s[p.type] : PERSONNEL_RATE_DEFAULTS[p.type];
  return row[p.func] || 0;
}

// ── STUNDENZETTEL CONSTANTS ──

var STUNDEN_MONSTER_PRICE = 1.84;

// Default per-dept wages (overridden by user settings stored in localStorage key 'stundenzettel_dept_wages')
var STUNDEN_DEPT_WAGES_DEFAULT = {
  'AL (Aufbauleitung)': 20,
  'MA für Auf-/ Abbau': 17
};

// ── HELPER FUNCTIONS ──

// netto-arbeitsstunden aus start/end/pause
function calcNetHours(startMins, endMins, pauseMins) {
  if (startMins === null || endMins === null) return 0;
  var effEnd = (endMins < startMins) ? endMins + 1440 : endMins;
  if (effEnd <= startMins) return 0;
  var netMins = effEnd - startMins - (pauseMins || 0);
  return Math.max(0, netMins / 60);
}

// schicht in tag/nacht/sonntag/feiertag aufteilen (für zenjob/rockit)
// customRate: optional override rate (€/h) for registered employees.
// If provided and > 0, it replaces PROT_PERSONNEL_RATES for non-Zenjob/Rockit positions.
function calcSplitShiftCosts(basePos, dateStr, isHoliday, startMins, endMins, pauseMins, customRate) {
  var effEnd = (endMins < startMins) ? endMins + 1440 : endMins;
  var totalWorkMins = effEnd - startMins;
  if (totalWorkMins <= 0) return [];

  // Pause deduction is applied proportionally to simplicity.
  var pauseRatio = (pauseMins || 0) / totalWorkMins;
  var netFactor = Math.max(0, 1 - pauseRatio); // a break longer than the shift must not produce negative hours/money

  // If not Zenjob/Rockit, just return the base position
  if (basePos !== 'Zenjob' && basePos !== 'Rockit') {
    var desc = basePos;
    var rate = (typeof customRate === 'number' && customRate > 0) ? customRate : personnelRate(desc);
    var hrs = Math.max(3, (totalWorkMins * netFactor) / 60);
    return [{ desc: desc, hrs: hrs, rate: rate }];
  }
  
  // Dynamic split per minute
  var d = new Date(dateStr);
  var isSunToday = d.getDay() === 0;
  var isSunTomorrow = d.getDay() === 6; // If it started on Sat and ends Sun morning
  
  var counts = { day: 0, night: 0, sun: 0, holiday: 0 };
  
  for (var m = startMins; m < effEnd; m++) {
    var minOfDay = m % 1440;
    var dayOffset = Math.floor(m / 1440);
    var isSun = (dayOffset === 0) ? isSunToday : isSunTomorrow;
    
    // Both agencies define a Feiertag rate (Zenjob Feiertag / Rockit Feiertag)
    if (isHoliday) {
      counts.holiday++;
    } else if (isSun) {
      counts.sun++;
    } else if (minOfDay >= 1320 || minOfDay < 360) {
      // 22:00 to 06:00
      counts.night++;
    } else {
      counts.day++;
    }
  }
  
  var results = [];
  function addBucket(bucketKey, bucketLabel) {
    if (counts[bucketKey] > 0) {
      var bucketHrs = (counts[bucketKey] * netFactor) / 60;
      var desc = basePos + ' ' + bucketLabel;
      // Fallbacks if Zenjob Feiertag isn't defined
      var rate = PROT_PERSONNEL_RATES[desc] || PROT_PERSONNEL_RATES[basePos + ' Tag'] || 0;
      results.push({ desc: desc, hrs: bucketHrs, rate: rate });
    }
  }
  
  addBucket('day', 'Tag');
  addBucket('night', 'Nacht');
  addBucket('sun', 'Sonntag');
  addBucket('holiday', 'Feiertag');

  var totalHrs = results.reduce(function(s, r) { return s + r.hrs; }, 0);
  if (totalHrs > 0 && totalHrs < 4) {
    var scale = 4 / totalHrs;
    results.forEach(function(r) { r.hrs *= scale; });
  }

  return results;
}
