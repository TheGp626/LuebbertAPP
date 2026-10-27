// Pure push building for notify-plan-change (no Deno/Node APIs → testable with `node --test`)

const ddmm = (iso) => { const p = iso.split('-'); return `${p[2]}.${p[1]}.`; };

export function planPushText(kw, isFirst, changes) {
  if (isFirst) {
    return { title: `Wochenplan KW ${kw}`, body: changes.length === 1
      ? `Du bist am ${ddmm(changes[0].date)} eingeplant (${changes[0].venue}).`
      : `Du bist an ${changes.length} Einsätzen eingeplant, der erste am ${ddmm(changes[0].date)}.` };
  }
  const c = changes[0];
  const what = c.kind === 'entfallen' ? 'entfällt' : c.kind === 'neu' ? 'ist neu' : 'wurde geändert';
  return { title: `Wochenplan KW ${kw} geändert`, body: changes.length === 1
    ? `Dein Einsatz am ${ddmm(c.date)} (${c.venue}) ${what}.`
    : `${changes.length} deiner Einsätze haben sich geändert, u. a. am ${ddmm(c.date)} (${c.venue}).` };
}

// week: {kw, version, removed:[{date, venue, user_ids}]}, shifts: [{date, venue, change_status, plan_assignments:[{user_id}]}]
// First upload → everyone planned gets "you are planned"; later uploads → only changed/new/removed shifts.
// Past days are skipped. Returns [{user_id, title, body}].
export function buildPlanPushes(week, shifts, today) {
  const isFirst = week.version === 1;
  const byUser = new Map();
  const add = (uid, date, venue, kind) => {
    if (!uid || date < today) return;
    if (!byUser.has(uid)) byUser.set(uid, []);
    const list = byUser.get(uid);
    if (!list.some(c => c.date === date && c.venue === venue && c.kind === kind)) list.push({ date, venue, kind });
  };
  for (const s of shifts) {
    if (!isFirst && !s.change_status) continue;
    for (const a of s.plan_assignments || []) add(a.user_id, s.date, s.venue || 'Einsatz', isFirst ? 'neu' : s.change_status);
  }
  if (!isFirst) for (const r of week.removed || []) for (const uid of r.user_ids || []) add(uid, r.date, r.venue || 'Einsatz', 'entfallen');
  return [...byUser.entries()].map(([user_id, changes]) => {
    changes.sort((a, b) => a.date.localeCompare(b.date));
    return { user_id, ...planPushText(week.kw, isFirst, changes) };
  });
}
