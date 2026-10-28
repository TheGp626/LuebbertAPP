/**
 * Projektordner Module — Datei-Manager (Google Drive Ersatz)
 */

var alleOrdner = [];
var aktuellerOrdner = null; // { id, name, description }
var ordnerFiles = [];
var editingOrdnerId = null;

var canManageOrdner = false; // PL / Admin only

// ── INIT ──
async function initOrdner() {
  canManageOrdner = typeof userRole !== 'undefined' && ['PL', 'Admin'].includes(userRole);
  var addBtn = document.getElementById('btn-add-ordner');
  if (addBtn) addBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';
  closeOrdnerDetail();
  await fetchOrdner();
}

// ── FETCH ORDNER ──
async function fetchOrdner() {
  showOrdnerLoading(true);
  if (typeof supabaseClient === 'undefined') { showOrdnerLoading(false); return; }

  var { data, error } = await supabaseClient
    .from('project_folders')
    .select('id, name, description, created_at, parent_id, pl_id')
    .order('name', { ascending: true });

  showOrdnerLoading(false);
  if (error) { console.error('Ordner fetch:', error); showToast('Fehler beim Laden der Ordner.', 'danger'); return; }
  alleOrdner = data || [];
  renderOrdner(alleOrdner);
}

function renderOrdner(list) {
  canManageOrdner = typeof userRole !== 'undefined' && ['PL', 'Admin'].includes(userRole);
  var addBtn = document.getElementById('btn-add-ordner');
  if (addBtn) addBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  var grid = document.getElementById('ordner-grid');
  var empty = document.getElementById('ordner-empty');
  if (!grid) return;

  // Top level shows only root folders; subfolders live inside their parent
  list = (list || []).filter(function(o) { return !o.parent_id; });

  if (!list || list.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }
  if (empty) empty.style.display = 'none';

  grid.innerHTML = list.map(function(o) {
    var date = o.created_at ? new Date(o.created_at).toLocaleDateString('de-DE') : '';
    var editBtn = canManageOrdner
      ? '<button class="btn" style="width:100%;margin-top:6px;padding:5px;font-size:12px;" onclick="event.stopPropagation();openOrdnerForm(\'' + o.id + '\')">Umbenennen</button>'
      : '';
    return '<div class="ordner-card" onclick="openOrdnerDetail(\'' + o.id + '\')">' +
      '<div style="font-size:40px;margin-bottom:8px;">📁</div>' +
      '<div class="produkt-name">' + escOrdner(o.name) + '</div>' +
      (o.description ? '<div class="produkt-desc">' + escOrdner(o.description) + '</div>' : '') +
      '<div style="font-size:11px;color:var(--text3);margin-top:6px;">' + date + '</div>' +
      editBtn +
      '</div>';
  }).join('');
}

function filterOrdner() {
  var q = ((document.getElementById('ordner-search') || {}).value || '').toLowerCase().trim();
  if (!q) { renderOrdner(alleOrdner); return; }
  // Match any folder (incl. subfolders), then surface the root folder that
  // contains the match — the list view only shows roots.
  var rootIds = {};
  alleOrdner.forEach(function(o) {
    if (!o.name.toLowerCase().includes(q) && !(o.description || '').toLowerCase().includes(q)) return;
    var cur = o, guard = 0;
    while (cur && cur.parent_id && guard++ < 10) {
      cur = alleOrdner.find(function(x) { return x.id === cur.parent_id; });
    }
    if (cur) rootIds[cur.id] = true;
  });
  renderOrdner(alleOrdner.filter(function(o) { return rootIds[o.id]; }));
}

// ── ORDNER DETAIL (FILE LIST + SUBFOLDERS) ──
function ordnerBreadcrumb(folder) {
  // Walk parent chain for the title, e.g. "K5 / Bühne / Pläne"
  var names = [folder.name], cur = folder, guard = 0;
  while (cur && cur.parent_id && guard++ < 10) {
    cur = alleOrdner.find(function(o) { return o.id === cur.parent_id; });
    if (cur) names.unshift(cur.name);
  }
  return names.join(' / ');
}

async function openOrdnerDetail(id) {
  var folder = alleOrdner.find(function(o) { return o.id === id; });
  if (!folder) return;
  aktuellerOrdner = folder;

  // Switch views
  document.getElementById('ordner-list-view').style.display = 'none';
  document.getElementById('ordner-detail-view').style.display = 'block';

  var titleEl = document.getElementById('ordner-detail-title');
  if (titleEl) titleEl.textContent = '📁 ' + ordnerBreadcrumb(folder);
  initOrdnerDragDrop();

  var uploadBtn = document.getElementById('ordner-upload-btn');
  if (uploadBtn) uploadBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  var subBtn = document.getElementById('ordner-add-sub-btn');
  if (subBtn) subBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  var delFolderBtn = document.getElementById('ordner-delete-folder-btn');
  if (delFolderBtn) delFolderBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  var einsBtn = document.getElementById('ordner-edit-einsaetze-btn');
  if (einsBtn) einsBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';
  renderOrdnerEinsaetze(folder);

  renderSubfolders(id);
  await fetchOrdnerFiles(id);
}

function renderSubfolders(parentId) {
  var grid = document.getElementById('ordner-subfolder-grid');
  if (!grid) return;
  var children = alleOrdner.filter(function(o) { return o.parent_id === parentId; });
  if (!children.length) { grid.innerHTML = ''; grid.style.display = 'none'; return; }
  grid.style.display = 'grid';
  grid.innerHTML = children.map(function(o) {
    var renameBtn = canManageOrdner
      ? '<button class="btn" style="width:100%;margin-top:6px;padding:4px;font-size:11px;" onclick="event.stopPropagation();renameOrdnerPrompt(\'' + o.id + '\')">Umbenennen</button>'
      : '';
    return '<div class="ordner-card" onclick="openOrdnerDetail(\'' + o.id + '\')">' +
      '<div style="font-size:32px;margin-bottom:6px;">📁</div>' +
      '<div class="produkt-name">' + escOrdner(o.name) + '</div>' +
      (o.description ? '<div class="produkt-desc">' + escOrdner(o.description) + '</div>' : '') +
      renameBtn +
      '</div>';
  }).join('');
}

async function createSubfolder() {
  if (!aktuellerOrdner || !canManageOrdner) return;
  var name = prompt('Name des neuen Unterordners:');
  if (!name || !name.trim()) return;
  var { error } = await supabaseClient.from('project_folders').insert({
    name: name.trim(),
    parent_id: aktuellerOrdner.id,
    created_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
  });
  if (error) { showToast('Fehler: ' + error.message, 'danger'); return; }
  showToast('✅ Unterordner erstellt.');
  var keepId = aktuellerOrdner.id;
  await fetchOrdner();          // refresh alleOrdner (re-shows list view)
  await openOrdnerDetail(keepId); // jump back into the folder
}

function ordnerGoBack() {
  if (aktuellerOrdner && aktuellerOrdner.parent_id) {
    openOrdnerDetail(aktuellerOrdner.parent_id);
  } else {
    closeOrdnerDetail();
  }
}

function closeOrdnerDetail() {
  aktuellerOrdner = null;
  ordnerFiles = [];
  var listView = document.getElementById('ordner-list-view');
  var detailView = document.getElementById('ordner-detail-view');
  if (listView) listView.style.display = 'block';
  if (detailView) detailView.style.display = 'none';
  renderOrdner(alleOrdner);
}

function initOrdnerDragDrop() {
  var zone = document.getElementById('ordner-detail-view');
  if (!zone || zone._dragInited) return;
  zone._dragInited = true;

  zone.addEventListener('dragover', function(e) {
    if (!canManageOrdner || !aktuellerOrdner) return;
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', function(e) {
    if (!e.relatedTarget || !zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', async function(e) {
    e.preventDefault();
    zone.classList.remove('drag-over');
    if (!canManageOrdner || !aktuellerOrdner) return;
    var files = Array.from(e.dataTransfer.files);
    if (!files.length) return;
    await runOrdnerUploads(aktuellerOrdner.id, files);
  });
}

async function fetchOrdnerFiles(folderId) {
  var container = document.getElementById('ordner-files-list');
  if (container) container.innerHTML = '<div style="color:var(--text3);padding:16px;">Lade Dateien...</div>';

  var { data, error } = await supabaseClient
    .from('folder_files')
    .select('id, name, file_url, file_type, file_size_bytes, created_at')
    .eq('folder_id', folderId)
    .order('name', { ascending: true });

  if (error) { console.error('Files fetch:', error); showToast('Fehler beim Laden.', 'danger'); return; }
  ordnerFiles = data || [];
  renderOrdnerFiles(ordnerFiles);
}

function renderOrdnerFiles(list) {
  var container = document.getElementById('ordner-files-list');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:32px 0;"><div class="empty-icon">📂</div><div>Noch keine Dateien in diesem Ordner.</div></div>';
    return;
  }

  container.innerHTML = list.map(function(f) {
    var icon = fileIcon(f.file_type, f.name);
    var size = f.file_size_bytes ? formatBytes(f.file_size_bytes) : '';
    var date = f.created_at ? new Date(f.created_at).toLocaleDateString('de-DE') : '';
    var delBtn = canManageOrdner
      ? '<button class="btn" style="width:auto;padding:4px 10px;font-size:12px;color:var(--danger);flex-shrink:0;" onclick="event.stopPropagation();deleteOrdnerFile(\'' + f.id + '\',\'' + f.file_url + '\')">✕</button>'
      : '';
    return '<div class="ordner-file-row" onclick="openOrdnerFileById(\'' + f.id + '\')">' +
      '<span class="ordner-file-icon">' + icon + '</span>' +
      '<div class="ordner-file-info">' +
        '<div class="ordner-file-name">' + escOrdner(f.name) + '</div>' +
        '<div class="ordner-file-meta">' + [size, date].filter(Boolean).join(' · ') + '</div>' +
      '</div>' +
      delBtn +
      '</div>';
  }).join('');
}

// ── UPLOAD FILE ──
function triggerOrdnerUpload() {
  document.getElementById('ordner-file-input').click();
}

async function handleOrdnerFileInput(input) {
  if (!aktuellerOrdner || !input.files || input.files.length === 0) return;
  var files = Array.from(input.files);
  input.value = '';
  await runOrdnerUploads(aktuellerOrdner.id, files);
}

async function runOrdnerUploads(folderId, files) {
  var uploadBtn = document.getElementById('ordner-upload-btn');
  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Lädt hoch...'; }

  var ok = 0, fail = 0;
  for (var i = 0; i < files.length; i++) {
    var success = await uploadOrdnerFile(folderId, files[i]);
    if (success) ok++; else fail++;
  }

  if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '+ Datei hochladen'; }
  await fetchOrdnerFiles(folderId);
  if (fail === 0) {
    showToast('✅ ' + ok + ' Datei(en) hochgeladen!');
  } else {
    showToast(ok + ' hochgeladen, ' + fail + ' fehlgeschlagen – Details in der Browser-Konsole.', 'danger');
  }
}

async function uploadOrdnerFile(folderId, file) {
  var safeName = file.name
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-zA-Z0-9\-_.]/g, '_');
  var rand = Math.random().toString(36).slice(2, 7);
  var filePath = folderId + '/' + Date.now() + '_' + rand + '_' + safeName;

  var { error: upErr } = await supabaseClient.storage
    .from('project-files')
    .upload(filePath, file, { upsert: true, contentType: file.type || 'application/octet-stream' });

  if (upErr) {
    console.error('Storage upload error for "' + file.name + '":', upErr.message || upErr);
    return false;
  }

  var { data: urlData } = supabaseClient.storage.from('project-files').getPublicUrl(filePath);
  var publicUrl = urlData && urlData.publicUrl ? urlData.publicUrl : null;

  var { error: dbErr } = await supabaseClient.from('folder_files').insert({
    folder_id: folderId,
    name: file.name,
    file_url: publicUrl,
    file_type: file.type || null,
    file_size_bytes: file.size || null,
    created_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
  });

  if (dbErr) {
    console.error('DB insert error for "' + file.name + '":', dbErr.message || dbErr);
    return false;
  }
  return true;
}

async function deleteOrdnerFile(id, url) {
  if (!confirm('Datei wirklich löschen?')) return;
  try {
    // Remove from storage
    if (url) {
      var parts = url.split('/project-files/');
      if (parts.length > 1) await supabaseClient.storage.from('project-files').remove([parts[1]]);
    }
    var { error } = await supabaseClient.from('folder_files').delete().eq('id', id);
    if (error) throw error;
    showToast('Datei gelöscht.');
    if (aktuellerOrdner) await fetchOrdnerFiles(aktuellerOrdner.id);
  } catch(e) { showToast('Fehler beim Löschen.', 'danger'); }
}

// ── ORDNER ERSTELLEN / BEARBEITEN ──
// ── PL & EINSÄTZE (AL-Erinnerung) ──
var EINSATZ_ACTIONS = ['Aufbau', 'Teilaufbau', 'Umbau', 'Teilabbau', 'Abbau'];
var _ordnerUsers = null;            // active app_users {id, full_name, role}
var _editEinsaetzeExisting = [];    // saved jobs of the folder being edited (for diffEinsaetze)
var _ordnerFormReturnId = null;     // reopen this folder's detail view after saving

async function loadOrdnerUsers() {
  if (_ordnerUsers) return _ordnerUsers;
  // Inactive users too: an already assigned AL/PL who left must still show up in the form
  var { data, error } = await supabaseClient.from('app_users').select('id, full_name, role, is_active').order('full_name');
  if (error) { console.error('Ordner users:', error); return []; }
  _ordnerUsers = data || [];
  return _ordnerUsers;
}

function ordnerUserOptions(roles, selectedId, emptyLabel) {
  var opts = emptyLabel !== undefined ? '<option value="">' + escOrdner(emptyLabel) + '</option>' : '';
  return opts + (_ordnerUsers || []).filter(function(u) {
    return roles.indexOf(u.role) !== -1 && (u.is_active !== false || u.id === selectedId);
  }).map(function(u) {
    return '<option value="' + u.id + '"' + (u.id === selectedId ? ' selected' : '') + '>' + escOrdner(u.full_name) +
      (u.is_active === false ? ' (inaktiv)' : '') + '</option>';
  }).join('');
}

function shortDateDE(iso) {
  var p = (iso || '').split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' : '—';
}

function addEinsatzRow(e) {
  e = e || {};
  var list = document.getElementById('ordner-einsatz-rows');
  if (!list) return;
  var row = document.createElement('div');
  row.className = 'einsatz-row';
  row.dataset.id = e.id || '';
  row.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; align-items:center;';
  row.innerHTML =
    '<input type="date" class="meta-input einsatz-date" style="flex:1 1 130px; margin:0;" value="' + escOrdner(e.date || '') + '">' +
    '<select class="meta-input einsatz-action" style="flex:1 1 110px; margin:0;">' +
      EINSATZ_ACTIONS.map(function(a) { return '<option' + (a === (e.action || 'Aufbau') ? ' selected' : '') + '>' + a + '</option>'; }).join('') +
    '</select>' +
    '<select class="meta-input einsatz-al" style="flex:2 1 160px; margin:0;">' + ordnerUserOptions(['AL', 'Admin'], e.al_id, '– AL wählen –') + '</select>' +
    '<label style="font-size:12px; display:flex; align-items:center; gap:4px; white-space:nowrap;"><input type="checkbox" class="einsatz-cancelled"' + (e.cancelled ? ' checked' : '') + '> abgesagt/übernommen</label>' +
    '<button type="button" class="btn" style="width:auto; padding:4px 10px; color:var(--danger);" title="Einsatz entfernen" onclick="this.parentElement.remove()">🗑</button>';
  list.appendChild(row);
}

function readEinsatzRows() {
  return Array.prototype.map.call(document.querySelectorAll('#ordner-einsatz-rows .einsatz-row'), function(row) {
    var r = {
      date: row.querySelector('.einsatz-date').value,
      action: row.querySelector('.einsatz-action').value,
      al_id: row.querySelector('.einsatz-al').value,
      cancelled: row.querySelector('.einsatz-cancelled').checked
    };
    if (row.dataset.id) r.id = row.dataset.id;
    return r;
  });
}

async function openOrdnerForm(id) {
  // The form lives in the list view; coming from a folder's detail view, return there after saving
  var detail = document.getElementById('ordner-detail-view');
  _ordnerFormReturnId = null;
  if (id && detail && detail.style.display !== 'none') {
    _ordnerFormReturnId = id;
    detail.style.display = 'none';
    document.getElementById('ordner-list-view').style.display = 'block';
  }
  editingOrdnerId = id || null;
  var form = document.getElementById('ordner-form');
  var nameInp = document.getElementById('inp-ordner-name');
  var descInp = document.getElementById('inp-ordner-desc');
  var title = document.getElementById('ordner-form-title');
  var o = id ? alleOrdner.find(function(x) { return x.id === id; }) : null;
  if (id && !o) return;
  if (title) title.textContent = o ? 'Ordner bearbeiten' : 'Neuer Ordner';
  if (nameInp) nameInp.value = o ? o.name : '';
  if (descInp) descInp.value = o ? (o.description || '') : '';

  await loadOrdnerUsers();
  var plSel = document.getElementById('inp-ordner-pl');
  if (plSel) plSel.innerHTML = ordnerUserOptions(['PL', 'Admin'], o ? o.pl_id : null, '– keine PL –');
  var rows = document.getElementById('ordner-einsatz-rows');
  if (rows) rows.innerHTML = '';
  _editEinsaetzeExisting = [];
  if (o) {
    var { data, error } = await supabaseClient.from('einsaetze').select('id, date, action, al_id, cancelled')
      .eq('folder_id', o.id).order('date');
    if (error) { console.error('Einsätze laden:', error); showToast('Einsätze konnten nicht geladen werden.', 'danger'); }
    _editEinsaetzeExisting = data || [];
    _editEinsaetzeExisting.forEach(addEinsatzRow);
  }

  if (form) form.style.display = 'block';
  if (nameInp) nameInp.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeOrdnerForm() {
  editingOrdnerId = null;
  var form = document.getElementById('ordner-form');
  if (form) form.style.display = 'none';
  if (_ordnerFormReturnId) { var back = _ordnerFormReturnId; _ordnerFormReturnId = null; openOrdnerDetail(back); }
}

// After a partly failed save: take the DB state as the new baseline and give form rows that were
// already inserted their id, so the retry neither re-deletes nor inserts duplicates
async function resyncEinsatzRows(folderId) {
  var { data, error } = await supabaseClient.from('einsaetze').select('id, date, action, al_id, cancelled').eq('folder_id', folderId);
  if (error) { console.error('Einsätze neu laden:', error); return; }
  _editEinsaetzeExisting = data || [];
  var claimed = {};
  document.querySelectorAll('#ordner-einsatz-rows .einsatz-row').forEach(function(row) { if (row.dataset.id) claimed[row.dataset.id] = true; });
  document.querySelectorAll('#ordner-einsatz-rows .einsatz-row').forEach(function(row) {
    if (row.dataset.id) return;
    var r = { date: row.querySelector('.einsatz-date').value, action: row.querySelector('.einsatz-action').value, al_id: row.querySelector('.einsatz-al').value };
    var match = _editEinsaetzeExisting.find(function(x) { return !claimed[x.id] && x.date === r.date && x.action === r.action && x.al_id === r.al_id; });
    if (match) { row.dataset.id = match.id; claimed[match.id] = true; }
  });
}

// Writes the job rows of a folder; every write is row-checked (RLS failures don't error)
async function saveEinsaetze(folderId, edited) {
  var d = diffEinsaetze(_editEinsaetzeExisting, edited);
  if (d.remove.length) {
    var { data: del, error: delErr } = await supabaseClient.from('einsaetze').delete().in('id', d.remove).select('id');
    if (delErr || !del || del.length !== d.remove.length) throw delErr || new Error('Einsätze löschen abgelehnt');
  }
  for (var i = 0; i < d.update.length; i++) {
    var u = d.update[i];
    var { data: up, error: upErr } = await supabaseClient.from('einsaetze')
      .update({ date: u.date, action: u.action, al_id: u.al_id, cancelled: u.cancelled }).eq('id', u.id).select('id');
    if (upErr || !up || up.length !== 1) throw upErr || new Error('Einsatz aktualisieren abgelehnt');
  }
  if (d.insert.length) {
    var rows = d.insert.map(function(r) { return Object.assign({ folder_id: folderId }, r); });
    var { data: ins, error: insErr } = await supabaseClient.from('einsaetze').insert(rows).select('id');
    if (insErr || !ins || ins.length !== rows.length) throw insErr || new Error('Einsätze anlegen abgelehnt');
  }
}

async function saveOrdner() {
  var name = ((document.getElementById('inp-ordner-name') || {}).value || '').trim();
  var desc = ((document.getElementById('inp-ordner-desc') || {}).value || '').trim();
  var plId = ((document.getElementById('inp-ordner-pl') || {}).value || '') || null;
  var einsaetze = readEinsatzRows();
  if (!name) { showToast('Bitte einen Ordnernamen eingeben.', 'danger'); return; }
  if (einsaetze.some(function(r) { return !r.date || !r.al_id; })) { showToast('Bitte Datum und AL für jeden Einsatz ausfüllen.', 'danger'); return; }
  if (einsaetze.length && !plId) { showToast('Bitte eine Projektleitung wählen.', 'danger'); return; }

  var payload = {
    name: name,
    description: desc || null,
    pl_id: plId
  };

  var folderId = editingOrdnerId;
  if (editingOrdnerId) {
    var { data: upd, error } = await supabaseClient.from('project_folders').update(payload).eq('id', editingOrdnerId).select('id');
    if (error || !upd || !upd.length) { showToast('Fehler: ' + (error ? error.message : 'Ordner nicht gespeichert'), 'danger'); return; }
  } else {
    // created_by only on insert: an edit must not hand the folder over to the editor
    payload.created_by = typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null;
    var { data: created, error: insErr } = await supabaseClient.from('project_folders').insert(payload).select('id').single();
    if (insErr) { showToast('Fehler: ' + insErr.message, 'danger'); return; }
    folderId = created.id;
  }
  var wasNew = !editingOrdnerId;
  editingOrdnerId = folderId; // a retry after a failed job save must update this folder, not create another
  try {
    await saveEinsaetze(folderId, einsaetze);
  } catch (e) {
    console.error('Einsätze speichern:', e);
    await resyncEinsatzRows(folderId);
    showToast('Fehler beim Speichern der Einsätze', 'danger');
    return;
  }
  showToast(wasNew ? '✅ Ordner erstellt.' : '✅ Ordner aktualisiert.');
  var returnId = _ordnerFormReturnId;
  _ordnerFormReturnId = null;
  closeOrdnerForm();
  await fetchOrdner();
  if (returnId) await openOrdnerDetail(returnId);
}

// Detail view: PL + jobs with protocol status
async function renderOrdnerEinsaetze(folder) {
  var box = document.getElementById('ordner-einsaetze');
  if (!box) return;
  box.style.display = 'none';
  var { data: rows, error } = await supabaseClient.from('einsaetze')
    .select('id, date, action, al_id, cancelled, al:app_users!einsaetze_al_id_fkey(full_name)')
    .eq('folder_id', folder.id).order('date');
  if (error) { console.error('Einsätze:', error); return; }
  if (!rows || !rows.length) return;
  var alIds = rows.map(function(r) { return r.al_id; });
  var dates = rows.map(function(r) { return r.date; });
  var { data: prots } = await supabaseClient.from('protocols').select('al_id, date').in('al_id', alIds).in('date', dates);
  var done = {};
  (prots || []).forEach(function(p) { done[p.al_id + '|' + p.date] = true; });
  await loadOrdnerUsers();
  var pl = (_ordnerUsers || []).find(function(u) { return u.id === folder.pl_id; });
  var ICON = { done: '✅', open: '⏳', future: '🕓', cancelled: '✖' };
  var today = localDateStr();
  box.innerHTML = '<div style="font-weight:600; margin-bottom:6px;">Projektleitung: ' + escOrdner(pl ? pl.full_name : '—') + '</div>' +
    rows.map(function(r) {
      var st = einsatzStatus(r, !!done[r.al_id + '|' + r.date], today);
      return '<div style="padding:2px 0;">' + ICON[st] + ' ' + shortDateDE(r.date) + ' ' + escOrdner(r.action) + ' – ' + escOrdner(r.al ? r.al.full_name : '—') + '</div>';
    }).join('');
  box.style.display = 'block';
}

async function renameOrdnerPrompt(id) {
  var o = alleOrdner.find(function(x) { return x.id === id; });
  if (!o || !canManageOrdner) return;
  var name = prompt('Neuer Name:', o.name);
  if (!name || !name.trim() || name.trim() === o.name) return;
  var { error } = await supabaseClient.from('project_folders').update({ name: name.trim() }).eq('id', id);
  if (error) { showToast('Fehler: ' + error.message, 'danger'); return; }
  showToast('✅ Umbenannt.');
  var keepId = aktuellerOrdner ? aktuellerOrdner.id : null;
  await fetchOrdner();
  if (keepId) await openOrdnerDetail(keepId);
}

// Collects the folder and all nested subfolder ids (depth-first over the cached list)
function collectOrdnerTreeIds(rootId) {
  var ids = [rootId];
  for (var i = 0; i < ids.length; i++) {
    /* eslint-disable no-loop-func */
    alleOrdner.forEach(function(o) {
      if (o.parent_id === ids[i] && ids.indexOf(o.id) === -1) ids.push(o.id);
    });
  }
  return ids;
}

async function deleteCurrentOrdner() {
  if (!aktuellerOrdner) return;
  var treeIds = collectOrdnerTreeIds(aktuellerOrdner.id);
  var subCount = treeIds.length - 1;
  var msg = 'Ordner "' + aktuellerOrdner.name + '"' +
    (subCount > 0 ? ' inkl. ' + subCount + ' Unterordner(n)' : '') +
    ' und alle enthaltenen Dateien wirklich löschen?';
  if (!confirm(msg)) return;

  // Remove storage objects of the whole subtree (DB rows cascade via FK)
  var { data: allFiles } = await supabaseClient
    .from('folder_files').select('file_url').in('folder_id', treeIds);
  var paths = (allFiles || []).map(function(f) {
    var parts = (f.file_url || '').split('/project-files/');
    return parts.length > 1 ? parts[1] : null;
  }).filter(Boolean);
  if (paths.length) await supabaseClient.storage.from('project-files').remove(paths);

  var { error } = await supabaseClient.from('project_folders').delete().eq('id', aktuellerOrdner.id);
  if (error) { showToast('Fehler: ' + error.message, 'danger'); return; }
  showToast('Ordner gelöscht.');
  var parentId = aktuellerOrdner.parent_id;
  closeOrdnerDetail();
  await fetchOrdner();
  if (parentId) await openOrdnerDetail(parentId);
}

// ── SHARED FILE VIEWER ──
// Looks the file up by id — passing name/url through inline onclick strings
// breaks as soon as a filename contains a quote character.
function openOrdnerFileById(id) {
  var f = ordnerFiles.find(function(x) { return x.id === id; });
  if (!f) return;
  openFileViewer(f.file_url, f.name, f.file_type || '');
}

function openFileViewer(url, name, mimeType) {
  var modal = document.getElementById('produkt-viewer-modal');
  var titleEl = document.getElementById('viewer-title');
  var subtitleEl = document.getElementById('viewer-subtitle');
  var body = document.getElementById('viewer-body');
  var dlBtn = document.getElementById('viewer-download-btn');

  if (titleEl) titleEl.textContent = name || 'Datei';
  if (dlBtn) dlBtn.href = url;

  var isImage = /image\//i.test(mimeType) || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(url);
  var isPdf = /pdf/i.test(mimeType) || /\.pdf(\?|$)/i.test(url);
  if (subtitleEl) subtitleEl.textContent = isImage ? 'Bild' : isPdf ? 'PDF' : 'Datei';

  if (modal) modal.style.display = 'flex'; // visible first so the zoom viewer can measure its width
  if (body) {
    body.style.display = 'flex';
    body.style.alignItems = 'center';
    body.style.justifyContent = 'center';
    body.style.touchAction = '';
    if (isImage) {
      mountZoomViewer(body, { kind: 'image', url: url });
    } else if (isPdf) {
      mountZoomViewer(body, { kind: 'pdf', url: url });
    } else {
      body.innerHTML = '<div style="color:#fff;padding:40px;text-align:center;">' +
        '<div style="font-size:64px;margin-bottom:16px;">' + fileIcon(mimeType, name) + '</div>' +
        '<div style="font-size:16px;margin-bottom:20px;">' + escOrdner(name) + '</div>' +
        '<a href="' + url + '" target="_blank" class="btn primary" style="display:inline-block;width:auto;padding:12px 24px;text-decoration:none;">⬇ Herunterladen</a>' +
        '</div>';
    }
  }
  if (modal) modal.style.display = 'flex';
}

// ── ZOOMABLE VIEWER (PDF via PDF.js, images) ──
// The page itself has user-scalable=no, so pinch/zoom is implemented here:
// content width = fit-width * zoom; pinch + buttons + double-tap change `zoom`.
var PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
var PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
var _pdfjsPromise = null;
var _zv = null; // current zoom viewer state

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = PDFJS_SRC;
    s.onload = function() {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = function() { _pdfjsPromise = null; reject(new Error('pdf.js load failed')); };
    document.head.appendChild(s);
  });
  return _pdfjsPromise;
}

function mountZoomViewer(body, opts) {
  var token = {};
  _zv = { token: token, zoom: 1, fitW: 0, pages: [], renderTimer: null, renderGen: 0 };
  var zv = _zv;

  body.innerHTML =
    '<div style="position:relative;width:100%;height:100%;">' +
      '<div id="zv-scroll" style="position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;touch-action:pan-x pan-y;">' +
        '<div id="zv-content" style="margin:0 auto;"></div>' +
      '</div>' +
      '<div style="position:absolute;right:12px;bottom:12px;display:flex;gap:6px;z-index:5;">' +
        '<button class="zv-btn" data-z="out">−</button>' +
        '<button class="zv-btn" data-z="fit">⤢</button>' +
        '<button class="zv-btn" data-z="in">+</button>' +
      '</div>' +
      '<div id="zv-status" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;pointer-events:none;">Lade…</div>' +
    '</div>';
  body.style.display = 'block';

  var scroll = body.querySelector('#zv-scroll');
  var content = body.querySelector('#zv-content');
  var status = body.querySelector('#zv-status');
  zv.scroll = scroll; zv.content = content;

  function alive() { return _zv === zv && document.body.contains(scroll); }

  function applyZoom(newZoom, cx, cy) {
    newZoom = Math.max(1, Math.min(6, newZoom));
    if (cx === undefined) { cx = scroll.clientWidth / 2; cy = scroll.clientHeight / 2; }
    var ratio = newZoom / zv.zoom;
    // keep the focal point stable while resizing
    var px = (scroll.scrollLeft + cx) * ratio - cx;
    var py = (scroll.scrollTop + cy) * ratio - cy;
    zv.zoom = newZoom;
    content.style.width = (zv.fitW * zv.zoom) + 'px';
    scroll.scrollLeft = px;
    scroll.scrollTop = py;
    scheduleRerender();
  }
  zv.applyZoom = applyZoom;

  function scheduleRerender() {
    if (!zv.rerender) return;
    clearTimeout(zv.renderTimer);
    zv.renderTimer = setTimeout(function() { if (alive()) zv.rerender(); }, 250);
  }

  body.querySelectorAll('.zv-btn').forEach(function(b) {
    b.addEventListener('click', function() {
      var z = b.getAttribute('data-z');
      if (z === 'in') applyZoom(zv.zoom * 1.4);
      else if (z === 'out') applyZoom(zv.zoom / 1.4);
      else applyZoom(1);
    });
  });

  // Pinch zoom + double-tap
  var pinch = null, lastTap = 0;
  function dist(t) { return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY); }
  scroll.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      pinch = { d: dist(e.touches), z: zv.zoom };
    } else if (e.touches.length === 1) {
      var now = Date.now();
      if (now - lastTap < 300) {
        var r = scroll.getBoundingClientRect();
        var t = e.touches[0];
        applyZoom(zv.zoom > 1.2 ? 1 : 2.5, t.clientX - r.left, t.clientY - r.top);
        e.preventDefault();
      }
      lastTap = now;
    }
  }, { passive: false });
  scroll.addEventListener('touchmove', function(e) {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      var r = scroll.getBoundingClientRect();
      var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      var cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      applyZoom(pinch.z * dist(e.touches) / pinch.d, cx, cy);
    }
  }, { passive: false });
  scroll.addEventListener('touchend', function(e) { if (e.touches.length < 2) pinch = null; });
  // Ctrl+wheel / trackpad pinch on desktop
  scroll.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    var r = scroll.getBoundingClientRect();
    applyZoom(zv.zoom * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  function setFitWidth() {
    zv.fitW = Math.max(200, scroll.clientWidth);
    content.style.width = (zv.fitW * zv.zoom) + 'px';
  }

  if (opts.kind === 'image') {
    setFitWidth();
    var img = new Image();
    img.src = opts.url;
    img.style.cssText = 'width:100%;height:auto;display:block;user-select:none;-webkit-user-drag:none;';
    img.onload = function() { if (alive()) status.style.display = 'none'; };
    img.onerror = function() { if (alive()) status.textContent = 'Bild konnte nicht geladen werden.'; };
    content.appendChild(img);
    return;
  }

  // PDF
  setFitWidth();
  loadPdfJs().then(function(pdfjs) {
    return pdfjs.getDocument({ url: opts.url }).promise;
  }).then(function(pdf) {
    if (!alive()) return;
    status.style.display = 'none';
    var chain = Promise.resolve();
    for (var n = 1; n <= pdf.numPages; n++) {
      (function(num) {
        chain = chain.then(function() { return pdf.getPage(num); }).then(function(page) {
          if (!alive()) return;
          var canvas = document.createElement('canvas');
          canvas.style.cssText = 'width:100%;height:auto;display:block;margin:0 0 8px;background:#fff;';
          content.appendChild(canvas);
          zv.pages.push({ page: page, canvas: canvas });
        });
      })(n);
    }
    zv.rerender = function() {
      var gen = ++zv.renderGen;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var cssW = zv.fitW * zv.zoom;
      // cap backing-store width to keep memory sane on phones
      var targetW = Math.min(cssW * dpr, 3000);
      zv.pages.reduce(function(p, item) {
        return p.then(function() {
          if (!alive() || gen !== zv.renderGen) return;
          var vp0 = item.page.getViewport({ scale: 1 });
          var vp = item.page.getViewport({ scale: targetW / vp0.width });
          var c = item.canvas;
          // render offscreen first so the old bitmap stays visible (no flicker)
          var off = document.createElement('canvas');
          off.width = Math.floor(vp.width); off.height = Math.floor(vp.height);
          return item.page.render({ canvasContext: off.getContext('2d'), viewport: vp }).promise.then(function() {
            if (!alive() || gen !== zv.renderGen) return;
            c.width = off.width; c.height = off.height;
            c.getContext('2d').drawImage(off, 0, 0);
          });
        });
      }, Promise.resolve());
    };
    return chain.then(function() { if (alive()) zv.rerender(); });
  }).catch(function(err) {
    console.error('PDF viewer:', err);
    if (!alive()) return;
    // Fallback: Google viewer iframe
    body.style.display = 'flex';
    body.innerHTML = '<iframe src="https://docs.google.com/viewer?url=' + encodeURIComponent(opts.url) + '&embedded=true" ' +
      'style="width:100%;height:100%;border:none;min-height:70vh;" allowfullscreen></iframe>';
  });
}

// ── UTILS ──
function showOrdnerLoading(show) {
  var el = document.getElementById('ordner-loading');
  var grid = document.getElementById('ordner-grid');
  if (el) el.style.display = show ? 'flex' : 'none';
  if (grid) grid.style.display = show ? 'none' : 'grid';
}

function fileIcon(mimeType, name) {
  var t = (mimeType || '') + (name || '');
  if (/image/i.test(t) || /\.(jpe?g|png|gif|webp|svg)/i.test(t)) return '🖼️';
  if (/pdf/i.test(t) || /\.pdf/i.test(t)) return '📄';
  if (/word|docx?/i.test(t) || /\.docx?/i.test(t)) return '📝';
  if (/excel|xlsx?|spreadsheet/i.test(t) || /\.xlsx?/i.test(t)) return '📊';
  if (/video/i.test(t) || /\.(mp4|mov|avi)/i.test(t)) return '🎬';
  if (/zip|rar|7z/i.test(t) || /\.(zip|rar|7z)/i.test(t)) return '🗜️';
  return '📎';
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escOrdner(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
