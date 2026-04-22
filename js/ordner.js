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
    .select('id, name, description, created_at')
    .order('name', { ascending: true });

  showOrdnerLoading(false);
  if (error) { console.error('Ordner fetch:', error); showToast('Fehler beim Laden der Ordner.', 'danger'); return; }
  alleOrdner = data || [];
  renderOrdner(alleOrdner);
}

function renderOrdner(list) {
  var grid = document.getElementById('ordner-grid');
  var empty = document.getElementById('ordner-empty');
  if (!grid) return;

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
  renderOrdner(alleOrdner.filter(function(o) {
    return o.name.toLowerCase().includes(q) || (o.description || '').toLowerCase().includes(q);
  }));
}

// ── ORDNER DETAIL (FILE LIST) ──
async function openOrdnerDetail(id) {
  var folder = alleOrdner.find(function(o) { return o.id === id; });
  if (!folder) return;
  aktuellerOrdner = folder;

  // Switch views
  document.getElementById('ordner-list-view').style.display = 'none';
  document.getElementById('ordner-detail-view').style.display = 'block';

  var titleEl = document.getElementById('ordner-detail-title');
  if (titleEl) titleEl.textContent = '📁 ' + folder.name;
  initOrdnerDragDrop();

  var uploadBtn = document.getElementById('ordner-upload-btn');
  if (uploadBtn) uploadBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  var delFolderBtn = document.getElementById('ordner-delete-folder-btn');
  if (delFolderBtn) delFolderBtn.style.display = canManageOrdner ? 'inline-flex' : 'none';

  await fetchOrdnerFiles(id);
}

function closeOrdnerDetail() {
  aktuellerOrdner = null;
  ordnerFiles = [];
  var listView = document.getElementById('ordner-list-view');
  var detailView = document.getElementById('ordner-detail-view');
  if (listView) listView.style.display = 'block';
  if (detailView) detailView.style.display = 'none';
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
    var uploadBtn = document.getElementById('ordner-upload-btn');
    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Lädt hoch...'; }
    for (var i = 0; i < files.length; i++) {
      await uploadOrdnerFile(aktuellerOrdner.id, files[i]);
    }
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '+ Datei hochladen'; }
    await fetchOrdnerFiles(aktuellerOrdner.id);
    showToast('✅ ' + files.length + ' Datei(en) hochgeladen!');
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
      ? '<button class="btn" style="width:auto;padding:4px 10px;font-size:12px;color:var(--danger);flex-shrink:0;" onclick="deleteOrdnerFile(\'' + f.id + '\',\'' + f.file_url + '\')">✕</button>'
      : '';
    return '<div class="ordner-file-row" onclick="openFileViewer(\'' + f.file_url + '\',\'' + escOrdner(f.name) + '\',\'' + (f.file_type || '') + '\')">' +
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

  var uploadBtn = document.getElementById('ordner-upload-btn');
  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Lädt hoch...'; }

  for (var i = 0; i < files.length; i++) {
    await uploadOrdnerFile(aktuellerOrdner.id, files[i]);
  }

  if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = '+ Datei hochladen'; }
  await fetchOrdnerFiles(aktuellerOrdner.id);
  showToast('✅ ' + files.length + ' Datei(en) hochgeladen!');
}

async function uploadOrdnerFile(folderId, file) {
  var safeName = file.name.replace(/[^a-zA-Z0-9\-_.\u00C0-\u024F]/g, '_');
  var rand = Math.random().toString(36).slice(2, 7);
  var filePath = folderId + '/' + Date.now() + '_' + rand + '_' + safeName;

  var { error: upErr } = await supabaseClient.storage
    .from('project-files')
    .upload(filePath, file, { upsert: false, contentType: file.type || 'application/octet-stream' });

  if (upErr) { console.error('Upload error:', upErr); showToast('Upload fehlgeschlagen: ' + file.name, 'danger'); return; }

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
  if (dbErr) console.error('DB insert error:', dbErr);
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
function openOrdnerForm(id) {
  editingOrdnerId = id || null;
  var form = document.getElementById('ordner-form');
  var nameInp = document.getElementById('inp-ordner-name');
  var descInp = document.getElementById('inp-ordner-desc');
  var title = document.getElementById('ordner-form-title');
  if (id) {
    var o = alleOrdner.find(function(x) { return x.id === id; });
    if (!o) return;
    if (title) title.textContent = 'Ordner bearbeiten';
    if (nameInp) nameInp.value = o.name;
    if (descInp) descInp.value = o.description || '';
  } else {
    if (title) title.textContent = 'Neuer Ordner';
    if (nameInp) nameInp.value = '';
    if (descInp) descInp.value = '';
  }
  if (form) form.style.display = 'block';
  if (nameInp) nameInp.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeOrdnerForm() {
  editingOrdnerId = null;
  var form = document.getElementById('ordner-form');
  if (form) form.style.display = 'none';
}

async function saveOrdner() {
  var name = ((document.getElementById('inp-ordner-name') || {}).value || '').trim();
  var desc = ((document.getElementById('inp-ordner-desc') || {}).value || '').trim();
  if (!name) { showToast('Bitte einen Ordnernamen eingeben.', 'danger'); return; }

  var payload = {
    name: name,
    description: desc || null,
    created_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
  };

  if (editingOrdnerId) {
    var { error } = await supabaseClient.from('project_folders').update(payload).eq('id', editingOrdnerId);
    if (error) { showToast('Fehler: ' + error.message, 'danger'); return; }
    showToast('✅ Ordner aktualisiert.');
  } else {
    var { error: insErr } = await supabaseClient.from('project_folders').insert(payload);
    if (insErr) { showToast('Fehler: ' + insErr.message, 'danger'); return; }
    showToast('✅ Ordner erstellt.');
  }
  closeOrdnerForm();
  await fetchOrdner();
}

async function deleteCurrentOrdner() {
  if (!aktuellerOrdner) return;
  if (!confirm('Ordner "' + aktuellerOrdner.name + '" und alle darin enthaltenen Dateien wirklich löschen?')) return;
  // Delete all storage files first
  for (var i = 0; i < ordnerFiles.length; i++) {
    var f = ordnerFiles[i];
    if (f.file_url) {
      var parts = f.file_url.split('/project-files/');
      if (parts.length > 1) await supabaseClient.storage.from('project-files').remove([parts[1]]);
    }
  }
  var { error } = await supabaseClient.from('project_folders').delete().eq('id', aktuellerOrdner.id);
  if (error) { showToast('Fehler: ' + error.message, 'danger'); return; }
  showToast('Ordner gelöscht.');
  closeOrdnerDetail();
  await fetchOrdner();
}

// ── SHARED FILE VIEWER ──
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

  if (body) {
    if (isImage) {
      body.innerHTML = '<img src="' + url + '" style="max-width:100%;max-height:100%;object-fit:contain;display:block;" />';
    } else if (isPdf) {
      var viewerUrl = 'https://docs.google.com/viewer?url=' + encodeURIComponent(url) + '&embedded=true';
      body.innerHTML = '<iframe src="' + viewerUrl + '" style="width:100%;height:100%;border:none;min-height:70vh;" allowfullscreen>' +
        '<p style="color:#fff;padding:20px;">PDF kann nicht angezeigt werden. <a href="' + url + '" target="_blank" style="color:#60a5fa;">Herunterladen</a></p>' +
        '</iframe>';
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
