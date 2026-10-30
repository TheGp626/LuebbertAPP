// Pure push building for notify-folder (no Deno/Node APIs → testable with `node --test`)

const ddmm = (iso) => { const p = iso.split('-'); return `${p[2]}.${p[1]}.`; };

// folder: {name, notified_al_ids}, einsaetze: [{al_id, date, action, cancelled}]
// One push per AL that was not told about this folder yet; names the earliest job. Returns [{user_id, title, body, url}].
export function buildFolderPushes(folder, einsaetze) {
  const told = new Set(folder.notified_al_ids || []);
  const byAl = new Map();
  for (const e of einsaetze || []) {
    if (!e.al_id || e.cancelled || told.has(e.al_id)) continue;
    if (!byAl.has(e.al_id)) byAl.set(e.al_id, []);
    byAl.get(e.al_id).push(e);
  }
  return [...byAl].map(([user_id, jobs]) => {
    jobs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    const first = jobs[0];
    const when = jobs.length === 1 ? `am ${ddmm(first.date)}` : `an ${jobs.length} Terminen, der erste am ${ddmm(first.date)}`;
    return {
      user_id, title: 'Neuer Projektordner',
      body: `${folder.name} – du bist AL ${when} (${first.action}). Alle Infos im Projektordner.`,
      url: './index.html?open=ordner',
    };
  });
}

// uuid[] literal for an equality filter (`.eq('notified_al_ids', pgUuidArray(ids))`)
export function pgUuidArray(ids) {
  return `{${(ids || []).join(',')}}`;
}
