// Pure push building for notify-plan-change (no Deno/Node APIs → testable with `node --test`)

const ddmm = (iso) => { const p = iso.split('-'); return `${p[2]}.${p[1]}.`; };

// One push per person per Stand, however many of their shifts are affected.
// kinds: 'neu' = newly planned on it, 'zeit' = its time changed, 'geändert' = changed (plans saved without the detail),
// 'unassigned' = taken off it, 'entfallen' = the whole shift is gone.
export function planPushText(kw, isFirst, changes) {
  if (isFirst) {
    return { title: `Wochenplan KW ${kw}`, body: changes.length === 1
      ? `Du bist am ${ddmm(changes[0].date)} eingeplant (${changes[0].venue}).`
      : `Du bist an ${changes.length} Einsätzen eingeplant, der erste am ${ddmm(changes[0].date)}.` };
  }
  const title = `Wochenplan KW ${kw} geändert`;
  const c = changes[0];
  if (changes.length === 1) {
    if (c.kind === 'unassigned') return { title, body: `Du bist am ${ddmm(c.date)} (${c.venue}) nicht mehr eingeteilt.` };
    if (c.kind === 'entfallen') return { title, body: `Dein Einsatz am ${ddmm(c.date)} (${c.venue}) entfällt.` };
    if (c.kind === 'neu') return { title, body: `Du bist am ${ddmm(c.date)} neu eingeplant (${c.venue}).` };
    if (c.kind === 'zeit') return { title, body: `Dein Einsatz am ${ddmm(c.date)} (${c.venue}) hat eine neue Zeit.` };
    return { title, body: `Dein Einsatz am ${ddmm(c.date)} (${c.venue}) wurde geändert.` };
  }
  // Several at once: say how many of each sort, never one push per shift
  const n = (k) => changes.filter(x => x.kind === k).length;
  const gained = n('neu'), lost = n('unassigned') + n('entfallen'), timed = n('zeit') + n('geändert');
  const parts = [];
  if (gained) parts.push(`${gained} neu`);
  if (timed) parts.push(`${timed} mit neuer Zeit`);
  if (lost) parts.push(`${lost} entfallen`);
  return { title, body: `${changes.length} deiner Einsätze: ${parts.join(', ')}. Der erste am ${ddmm(c.date)} (${c.venue}).` };
}

// week: {kw, version, removed:[{date, venue, user_ids, kind?}]} – kind 'unassigned' = still on the plan, but these
// users were taken off it; without kind the whole shift was removed.
// shifts: [{date, venue, change_status, change_fields?, added_user_ids?, plan_assignments:[{user_id}]}]
// First upload → everyone planned gets "you are planned". Later uploads → a person hears about a shift only when they
// gained it (new shift, or added to an existing one), lost it, or its time changed. A changed note, vehicle, material,
// room or colleague is not worth a push. A changed shift saved without change_fields (the live app's upload does not
// write them) cannot be told apart and notifies everyone on it, as before.
// Past days are skipped. Returns [{user_id, title, body}], one entry per person.
export function buildPlanPushes(week, shifts, today) {
  const isFirst = week.version === 1;
  const byUser = new Map();
  const add = (uid, date, venue, kind) => {
    if (!uid || date < today) return;
    if (!byUser.has(uid)) byUser.set(uid, []);
    const list = byUser.get(uid);
    // one line per shift and person: gaining it already says everything, a new time comes second
    const i = list.findIndex(c => c.date === date && c.venue === venue && c.kind !== 'unassigned' && c.kind !== 'entfallen');
    if (kind !== 'unassigned' && kind !== 'entfallen' && i !== -1) { if (kind === 'neu') list[i].kind = 'neu'; return; }
    if (!list.some(c => c.date === date && c.venue === venue && c.kind === kind)) list.push({ date, venue, kind });
  };
  for (const s of shifts) {
    const venue = s.venue || 'Einsatz', people = s.plan_assignments || [];
    if (isFirst || s.change_status === 'neu') { for (const a of people) add(a.user_id, s.date, venue, 'neu'); continue; }
    if (s.change_status !== 'geändert') continue;
    if (!Array.isArray(s.change_fields)) { for (const a of people) add(a.user_id, s.date, venue, 'geändert'); continue; }
    const added = Array.isArray(s.added_user_ids) ? s.added_user_ids : [];
    for (const uid of added) if (people.some(a => a.user_id === uid)) add(uid, s.date, venue, 'neu');
    if (s.change_fields.includes('Wann')) for (const a of people) add(a.user_id, s.date, venue, 'zeit');
  }
  if (!isFirst) for (const r of week.removed || []) {
    const kind = r.kind === 'unassigned' ? 'unassigned' : 'entfallen';
    for (const uid of r.user_ids || []) add(uid, r.date, r.venue || 'Einsatz', kind);
  }
  return [...byUser.entries()].map(([user_id, changes]) => {
    changes.sort((a, b) => a.date.localeCompare(b.date));
    return { user_id, ...planPushText(week.kw, isFirst, changes) };
  });
}
