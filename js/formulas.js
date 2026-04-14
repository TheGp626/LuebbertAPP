/**
 * Formula & Rate Configuration for LÜBBERT APP
 * Centralized for easy modification of costs and rates.
 */

// ── PROTOKOLL RATES ──

var PROT_VEHICLE_RATES = {
  'Hängerzug': 120,
  'Solo-LKW': 100,
  'Sprinter': 60,
  'PKW': 30
};

var PROT_PERSONNEL_RATES = {
  'AL fest': 20,
  'AL frei': 25,
  'MA fest': 17,
  'MA frei': 20,
  'Fahrer fest': 15,
  'Fahrer frei': 18,
  'Zenjob Tag': 25,
  'Zenjob Nacht': 30,
  'Zenjob Sonntag': 35,
  'Rockit Tag': 25,
  'Rockit Nacht': 30,
  'Rockit Sonntag': 35,
  'Rockit Feiertag': 40
};

// ── STUNDENZETTEL CONSTANTS ──

var STUNDEN_MONSTER_PRICE = 1.84;

// Default per-dept wages (overridden by user settings stored in localStorage key 'stundenzettel_dept_wages')
var STUNDEN_DEPT_WAGES_DEFAULT = {
  'AL (Aufbauleitung)': 20,
  'MA für Auf-/ Abbau': 17
};

// ── HELPER FUNCTIONS ──

/**
 * Calculates the net working time in hours.
 * @param {number} startMins - Start time in minutes from midnight
 * @param {number} endMins - End time in minutes from midnight
 * @param {number} pauseMins - Pause in minutes
 * @returns {number} Hours
 */
function calcNetHours(startMins, endMins, pauseMins) {
  if (startMins === null || endMins === null) return 0;
  var effEnd = (endMins < startMins) ? endMins + 1440 : endMins;
  if (effEnd <= startMins) return 0;
  var netMins = effEnd - startMins - (pauseMins || 0);
  return Math.max(0, netMins / 60);
}

/**
 * Splits shift hours into buckets (Day, Night, Sunday, Holiday) for dynamic pricing.
 * Night is 23:00 to 06:00.
 */
function calcSplitShiftCosts(basePos, dateStr, isHoliday, startMins, endMins, pauseMins) {
  var effEnd = (endMins < startMins) ? endMins + 1440 : endMins;
  var totalWorkMins = effEnd - startMins;
  if (totalWorkMins <= 0) return [];
  
  // Pause deduction is applied proportionally to simplicity.
  var pauseRatio = (pauseMins || 0) / totalWorkMins;
  var netFactor = 1 - pauseRatio;
  
  // If not Zenjob/Rockit, just return the base position
  if (basePos !== 'Zenjob' && basePos !== 'Rockit') {
    var desc = basePos;
    var rate = PROT_PERSONNEL_RATES[desc] || 0;
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
    
    if (isHoliday && basePos === 'Rockit') {
      counts.holiday++;
    } else if (isSun) {
      counts.sun++;
    } else if (minOfDay >= 1380 || minOfDay < 360) {
      // 23:00 to 06:00
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
  if (totalHrs > 0 && totalHrs < 3) {
    var scale = 3 / totalHrs;
    results.forEach(function(r) { r.hrs *= scale; });
  }

  return results;
}
