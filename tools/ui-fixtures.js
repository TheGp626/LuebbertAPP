// Fake data for tools/ui-check.js (made-up people and jobs; 'today' in the data is 2026-11-24, logged-in user u1)
const W = 'w48';
const A = (shift_id, user_id, name, role) => ({ id: shift_id + user_id, shift_id, user_id, name, role });
const S = (id, date, sort, venue, location, title, details, wann, people, open) => ({ id, week_id: W, date, sort, key: 'k' + id, venue, location, title, details, wann,
  ap: 'Lena Projektleitung', notes: null, color: null, open_slots: open || [], change_status: null, ap_user_id: 'u9', change_fields: null, added_user_ids: null,
  plan_assignments: people });
const shifts = [
  S('s1', '2026-11-24', 1, 'Estrel Berlin', 'Convention Hall I\nSonnenallee 225\n12057 Berlin', 'IPM AG Future Battery Forum', '40 Stehtisch Ø 80 weiß\n4 Brückentisch 200 x 80\n12 Lounge-Sessel schwarz', 'Aufbau: 07.00 Uhr',
    [A('s1', 'u1', 'Max Muster', 'AL'), A('s1', 'u3', 'Edib Probe', 'MA'), A('s1', 'u4', 'Peer Test', 'MA')]),
  S('s2', '2026-11-24', 2, 'Rotes Rathaus', 'Rathausstraße 15\n10178 Berlin', 'Spreeküche Empfang', 'Stehtische, Lounge', 'Aufbau: 14.00 Uhr',
    [A('s2', 'u2', 'Paul Beispiel', 'AL')], [{ role: 'MA', count: 2 }]),
  S('s3', '2026-11-25', 1, 'Estrel Berlin', 'Convention Hall I\nSonnenallee 225\n12057 Berlin', 'IPM AG Future Battery Forum', 'Abbau', 'Abbau: 18.00 Uhr',
    [A('s3', 'u1', 'Max Muster', 'AL'), A('s3', 'u3', 'Edib Probe', 'MA')]),
  S('s4', '2026-11-27', 1, 'Hotel Adlon', 'Unter den Linden 77\n10117 Berlin', 'Gala Musterverein', 'Bühne, Bestuhlung 240 Plätze', 'Aufbau: 09.00 Uhr',
    [A('s4', 'u2', 'Paul Beispiel', 'AL')], [{ role: 'AL', count: 1 }, { role: 'MA', count: 3 }]),
];
const P = (id, date, s, e, pause, name, loc, al) => ({ id, user_id: 'u1', start_time: s, end_time: e, pause_mins: pause, position_role: 'MA', status: 'offen',
  shift_date: date, protocol_id: 'p' + id, ort: null, protocols: { date, al_name_fallback: al, pl_name_fallback: null, projects: { name, location: loc } } });
const PR = (id, date, action, cost, name, loc, al, crew, mailed) => ({ id, date, action, is_holiday: false, total_cost: cost, al_id: 'u2', pl_id: 'u9', job_no: '26-04' + id,
  created_by: 'u2', notes_damages: '', notes_incidents: '', notes_feedback: '', al_name_fallback: al, pl_name_fallback: 'Lena Projektleitung', created_at: date + 'T20:00:00Z', mailed_at: mailed ? date + 'T21:00:00Z' : null,
  projects: { name, location: loc }, al: { full_name: al }, pl: { full_name: 'Lena Projektleitung' },
  shifts: crew.map((c, i) => ({ id: id * 10 + i, user_id: c[0], temp_worker_name: null, position_role: c[2], start_time: c[3], end_time: c[4], pause_mins: 30, status: mailed ? 'eingetragen' : 'offen', shift_date: date, ort: null, app_users: { full_name: c[1] } })),
  protocol_transports: [{ id: 1, protocol_id: id, vehicle_type: 'Hängerzug', cost: 180 }], protocol_equipments: [], worker_ratings: [] });
const protocols = [
  PR(31, '2026-11-21', 'Aufbau', 1240.5, 'IPM AG Future Battery Forum', 'Estrel Berlin', 'Paul Beispiel', [['u2', 'Paul Beispiel', 'AL', '07:00:00', '15:30:00'], ['u3', 'Edib Probe', 'MA', '07:00:00', '15:30:00'], ['u4', 'Peer Test', 'MA', '07:00:00', '15:30:00']], false),
  PR(30, '2026-11-20', 'Aufbau', 860, 'Spreeküche Empfang', 'Rotes Rathaus', 'Paul Beispiel', [['u2', 'Paul Beispiel', 'AL', '14:00:00', '23:15:00'], ['u1', 'Max Muster', 'MA', '14:00:00', '23:15:00']], true),
  PR(29, '2026-11-18', 'Abbau', 640, 'BREKO 2026', 'Estrel Berlin', 'Max Muster', [['u1', 'Max Muster', 'AL', '18:00:00', '23:30:00'], ['u3', 'Edib Probe', 'MA', '18:00:00', '23:30:00']], true),
];
module.exports = {
  einsaetze: [{ folder_id: 'f1', job_no: '26-0412.01', date: '2026-11-24', cancelled: false, folder: { name: 'Estrel IPM FBF' } },
    { folder_id: 'f2', job_no: null, date: '2026-11-24', cancelled: false, folder: { name: 'Estrel Breko' } }],
  folder_files: [
    { id: 'ff1', name: 'IPM AG FBF26_Setup_Foyer 3_Lübbert-1.pdf', file_url: 'x', file_type: 'application/pdf', folder_id: 'f1' },
    { id: 'ff2', name: 'IPM AG FBF26_Setup_CH I A Plenum_Lübbert-1.pdf', file_url: 'x', file_type: 'application/pdf', folder_id: 'f1' },
    { id: 'ff3', name: 'Auftragsbestätigung 26-0412.pdf', file_url: 'x', file_type: 'application/pdf', folder_id: 'f1' }],
  protocols,
  shifts: [
    P(1, '2026-11-21', '07:00:00', '15:30:00', 30, 'IPM AG Future Battery Forum', 'Estrel Berlin', 'Paul Beispiel'),
    P(2, '2026-11-20', '14:00:00', '23:15:00', 45, 'Spreeküche Empfang', 'Rotes Rathaus', 'Paul Beispiel'),
    { id: 3, user_id: 'u1', start_time: '09:00:00', end_time: '13:00:00', pause_mins: 0, position_role: 'MA', status: 'eingetragen', shift_date: '2026-11-22', protocol_id: null, ort: 'Lager Marienfelde', protocols: null },
  ],
  plan_weeks: [{ id: W, year: 2026, kw: 48, week_start: '2026-11-23', week_end: '2026-11-29', version: 1, notified_version: 1, removed: [], file_name: 'KW48.pdf', uploaded_by: 'u9', uploaded_at: '2026-11-22T10:00:00Z' }],
  plan_shifts: shifts,
  plan_assignments: shifts.filter(s => s.plan_assignments.some(a => a.user_id === 'u1')).map(s => ({ shift: s, user_id: 'u1' })),
  app_users: [
    { id: 'u1', full_name: 'Max Muster', role: 'Admin', active: true, employment_type: 'aushilfe', is_fest: false },
    { id: 'u2', full_name: 'Paul Beispiel', role: 'AL', active: true, employment_type: 'aushilfe' },
    { id: 'u3', full_name: 'Edib Probe', role: 'MA', active: true, employment_type: 'aushilfe' },
    { id: 'u4', full_name: 'Peer Test', role: 'MA', active: true, employment_type: 'aushilfe' },
  ],
  project_folders: [
    { id: 'f1', name: 'Estrel IPM FBF', description: 'Future Battery Forum', created_at: '2026-11-10', parent_id: null, ends_on: '2026-12-02' },
    { id: 'f2', name: 'Estrel Breko', description: '', created_at: '2026-11-05', parent_id: null, ends_on: '2026-11-27' },
    { id: 'f3', name: 'Spreeküche Rotes Rathaus', description: 'Empfang Filmtreffen', created_at: '2026-11-20', parent_id: null, ends_on: '2026-12-01' },
  ],
  products: [
    { id: 'p1', name: 'Stehtisch Ø 80 weiß', description: 'Klappbar, Höhe 110 cm', category: 'Tische', product_images: [] },
    { id: 'p2', name: 'Stuhl Modell Berlin', description: 'Stapelstuhl schwarz', category: 'Stühle', product_images: [] },
    { id: 'p3', name: 'Lounge-Sessel Leder', description: 'Clubsessel schwarz', category: 'Lounge', product_images: [] },
  ],
};
