// ES module copy of planWhen/planGuessAction from js/plan-parser.js for the Edge Functions.
// plan-time.test.mjs checks that both copies return the same results.

const PLAN_WHEN_LABELS = ['Teilaufbau', 'Teilabbau', 'Aufbau', 'Abbau', 'Umbau', 'Umstellen', 'Anlieferung', 'Abholung', 'Lieferung'];

// "Aufbau: 8 - 9 Uhr" → { time: '08:00', end: '09:00', prefix: null, label: 'Aufbau' }
export function planWhen(wann) {
  const hm = (h, m) => ('0' + h).slice(-2) + ':' + (m || '00');
  const labelOf = (line) => {
    const l = line.toLowerCase();
    return PLAN_WHEN_LABELS.find(x => l.indexOf(x.toLowerCase()) === 0) || null;
  };
  const re = /(?:\b(ab|bis)\s+)?(\d{1,2})(?:[.:](\d{2}))?(?:\s*-\s*(\d{1,2})(?:[.:](\d{2}))?)?\s*Uhr/i;
  let firstLabel = null;
  for (const line of wann || []) {
    const label = labelOf(line);
    if (!firstLabel) firstLabel = label;
    const m = re.exec(line);
    if (m && +m[2] <= 24 && (!m[4] || +m[4] <= 24)) {
      return { time: hm(m[2], m[3]), end: m[4] ? hm(m[4], m[5]) : null, prefix: m[1] ? m[1].toLowerCase() : null, label };
    }
  }
  return { time: null, end: null, prefix: null, label: firstLabel };
}

// "Abbau: 0.30 Uhr" → protocol action
export function planGuessAction(wann) {
  const t = (wann || []).join(' ');
  const has = (w) => new RegExp('\\b' + w, 'i').test(t);
  if (has('Umbau') || has('Umstellen')) return 'Umbau';
  if (has('Abbau') && !has('Aufbau')) return 'Abbau';
  if (has('Teilaufbau')) return 'Teilaufbau';
  return 'Aufbau';
}
