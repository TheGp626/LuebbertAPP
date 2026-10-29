/**
 * Produktdatenbank Module
 * AL, PL, Admin können Produkte hochladen.
 * Alle eingeloggten Nutzer können Produkte ansehen.
 */

var alleProdukte = [];       // Cached from Supabase
var editingProduktId = null; // UUID of product being edited
var lightboxMedia = [];      // [{url, type}] for current lightbox
var lightboxIndex = 0;       // current position in lightbox

// ── INIT ──
async function initProdukte() {
  // Show/hide upload button based on role
  var canUpload = typeof userRole !== 'undefined' && ['AL', 'PL', 'Admin'].includes(userRole);
  var addBtn = document.getElementById('btn-add-produkt');
  if (addBtn) addBtn.style.display = canUpload ? 'inline-flex' : 'none';

  closeProduktForm();
  await fetchProdukte();
}

// ── FETCH ──
async function fetchProdukte() {
  var loading = document.getElementById('produkt-loading');
  var grid = document.getElementById('produkt-grid');
  var empty = document.getElementById('produkt-empty');
  if (loading) loading.style.display = 'flex';
  if (grid) grid.innerHTML = '';
  if (empty) empty.style.display = 'none';

  if (typeof supabaseClient === 'undefined') {
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    return;
  }

  var { data, error } = await supabaseClient
    .from('products')
    .select('id, name, description, pdf_url, content_text, created_at, product_images(id, image_url, media_type, sort_order)')
    .order('name', { ascending: true });

  if (loading) loading.style.display = 'none';

  if (error) {
    console.error('Produkte fetch error:', error);
    showToast('Fehler beim Laden der Produkte.', 'danger');
    if (empty) empty.style.display = 'flex';
    return;
  }

  alleProdukte = data || [];
  renderProdukte(alleProdukte);
}

// ── RENDER ──
function renderProdukte(list) {
  var grid = document.getElementById('produkt-grid');
  var empty = document.getElementById('produkt-empty');
  if (!grid) return;

  if (!list || list.length === 0) {
    grid.innerHTML = '';
    if (empty) empty.style.display = 'flex';
    return;
  }

  if (empty) empty.style.display = 'none';
  var canUpload = typeof userRole !== 'undefined' && ['AL', 'PL', 'Admin'].includes(userRole);

  // Configure PDF.js worker once
  if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  grid.innerHTML = list.map(function(p) {
    // Thumbnail priority: 1) first product_image/video, 2) pdf_url image, 3) pdf canvas, 4) placeholder
    var images = (p.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
    var preview;
    if (images.length > 0) {
      var first = images[0];
      if (first.media_type === 'video') {
        preview = '<div class="produkt-video-thumb-wrap" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')">' +
          '<video src="' + escHtml(first.image_url) + '" muted preload="metadata" playsinline></video>' +
          '<div class="produkt-video-play-icon"></div>' +
          '</div>';
      } else {
        preview = '<img src="' + escHtml(first.image_url) + '" class="produkt-thumb" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')" />';
      }
    } else if (p.pdf_url) {
      var pdfKind = aufbauFileKind(p.pdf_url);
      if (pdfKind === 'image') {
        preview = '<img src="' + escHtml(p.pdf_url) + '" class="produkt-thumb" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')" />';
      } else if (pdfKind === 'pdf') {
        preview = '<canvas class="produkt-thumb produkt-pdf-canvas" data-url="' + escHtml(p.pdf_url) + '" data-id="' + p.id + '" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')"></canvas>';
      } else {
        preview = '<div class="produkt-pdf-thumb" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')">📄<span>Aufbau-Datei</span></div>';
      }
    } else {
      preview = '<div class="produkt-pdf-thumb" style="opacity:0.3; cursor:default;">📄<span>Keine Datei</span></div>';
    }

    var menuBtn = canUpload
      ? '<button type="button" class="ui-icon-btn produkt-card-menu" aria-label="Produkt-Aktionen" onclick="event.stopPropagation();produktMenu(\'' + p.id + '\')">' + uiIcon('dots') + '</button>'
      : '';
    var badges = produktBadges(p).map(function(b) { return '<span class="ui-pill ui-pill-info">' + escHtml(b) + '</span>'; }).join(' ');
    return '<div class="produkt-card" role="button" tabindex="0" onclick="openProduktViewer(\'' + p.id + '\')">' +
      preview +
      '<div class="produkt-card-body">' +
        '<div class="produkt-name">' + escHtml(p.name) + '</div>' +
        (p.description ? '<div class="produkt-desc">' + escHtml(p.description) + '</div>' : '') +
        (badges ? '<div class="produkt-badges">' + badges + '</div>' : '') +
      '</div>' +
      menuBtn +
      '</div>';
  }).join('');

  // Render PDF first pages into canvases
  renderPdfThumbnails();
}

async function renderPdfThumbnails() {
  if (typeof pdfjsLib === 'undefined') return;
  var canvases = document.querySelectorAll('.produkt-pdf-canvas');
  for (var i = 0; i < canvases.length; i++) {
    var canvas = canvases[i];
    var url = canvas.dataset.url;
    if (!url) continue;
    try {
      var loadingTask = pdfjsLib.getDocument({ url: url, cMapUrl: null, disableRange: false });
      var pdf = await loadingTask.promise;
      var page = await pdf.getPage(1);
      var viewport = page.getViewport({ scale: 1 });
      var scale = Math.min(200 / viewport.width, 140 / viewport.height);
      var scaled = page.getViewport({ scale: scale });
      canvas.width = scaled.width;
      canvas.height = scaled.height;
      var ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: scaled }).promise;
      canvas.style.background = '#fff';
    } catch (e) {
      canvas.width = 200;
      canvas.height = 140;
      var ctx2 = canvas.getContext('2d');
      ctx2.fillStyle = '#2a2a2a'; // canvas can't resolve CSS variables
      ctx2.fillRect(0, 0, 200, 140);
      ctx2.font = '48px serif';
      ctx2.textAlign = 'center';
      ctx2.fillText('📄', 100, 80);
    }
  }
}

// ── SEARCH / FILTER ──
function filterProdukte() {
  var q = (document.getElementById('prod-search') || {}).value || '';
  q = q.toLowerCase().trim();
  if (!q) { renderProdukte(alleProdukte); return; }
  var filtered = alleProdukte.filter(function(p) {
    return p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q);
  });
  renderProdukte(filtered);
}

// ── FORM ──
// keepFiles: re-render after a media delete without dropping files the user already picked
function openProduktForm(id, keepFiles) {
  editingProduktId = id || null;
  var form = document.getElementById('produkt-form');
  var title = document.getElementById('produkt-form-title');
  var nameInp = document.getElementById('inp-prod-name');
  var descInp = document.getElementById('inp-prod-desc');
  var contentInp = document.getElementById('inp-prod-content');
  var pdfCurrent = document.getElementById('inp-prod-pdf-current');
  var deleteBtn = document.getElementById('btn-delete-produkt');
  var existingImgs = document.getElementById('prod-existing-images');

  if (id) {
    var prod = alleProdukte.find(function(p) { return p.id === id; });
    if (!prod) return;
    if (title) title.textContent = 'Produkt bearbeiten';
    if (nameInp) nameInp.value = prod.name || '';
    if (descInp) descInp.value = prod.description || '';
    if (contentInp) contentInp.value = prod.content_text || '';
    if (pdfCurrent) {
      pdfCurrent.style.display = prod.pdf_url ? 'block' : 'none';
      pdfCurrent.innerHTML = prod.pdf_url
        ? 'Aktuell: <a href="' + escHtml(prod.pdf_url) + '" target="_blank" rel="noopener" style="color:var(--accent, #60a5fa);">Aufbau-Datei öffnen</a> (neue Datei wählen zum Ersetzen)'
        : '';
    }
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    // Show existing media with delete buttons
    if (existingImgs) {
      var imgs = (prod.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
      if (imgs.length > 0) {
        existingImgs.style.display = 'block';
        existingImgs.innerHTML = '<div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Vorhandene Medien' +
            (imgs.length > 1 ? ' – „Titelbild“ antippen, um das Bild für die Karte festzulegen' : '') + ':</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px;">' +
          imgs.map(function(img, n) {
            var mediaType = img.media_type || 'image';
            var url = escHtml(img.image_url);
            var thumb = mediaType === 'video'
              ? '<div class="produkt-video-thumb-wrap" style="width:80px;height:60px;">' +
                  '<video src="' + url + '" muted preload="metadata" playsinline style="pointer-events:none;"></video>' +
                  '<div class="produkt-video-play-icon" style="pointer-events:none;"></div>' +
                '</div>'
              : '<img src="' + url + '" class="produkt-form-media" />';
            var isCover = n === 0;
            var coverCtl = imgs.length > 1
              ? (isCover
                  ? '<div class="produkt-cover-badge">★ Titelbild</div>'
                  : '<button type="button" class="produkt-cover-btn" onclick="setProduktCover(\'' + jsAttrArg(id) + '\',\'' + jsAttrArg(img.id) + '\')">Titelbild</button>')
              : '';
            return '<div style="position:relative;width:80px;">' +
              thumb +
              '<button onclick="deleteProduktMedia(\'' + jsAttrArg(img.id) + '\',\'' + jsAttrArg(img.image_url) + '\',\'' + jsAttrArg(mediaType) + '\')" aria-label="Medium löschen" ' +
              'style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>' +
              coverCtl +
              '</div>';
          }).join('') +
          '</div>';
      } else {
        existingImgs.style.display = 'none';
        existingImgs.innerHTML = '';
      }
    }
  } else {
    if (title) title.textContent = 'Neues Produkt';
    if (nameInp) nameInp.value = '';
    if (descInp) descInp.value = '';
    if (contentInp) contentInp.value = '';
    if (pdfCurrent) { pdfCurrent.style.display = 'none'; pdfCurrent.innerHTML = ''; }
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (existingImgs) { existingImgs.style.display = 'none'; existingImgs.innerHTML = ''; }
  }

  if (!keepFiles) resetProduktFileInputs();
  setProduktFormError('');
  if (form) form.style.display = 'block';
  var modal = document.getElementById('produkt-form-modal');
  if (modal) modal.classList.add('open');
  if (nameInp && !id) nameInp.focus();
}

function closeProduktForm() {
  editingProduktId = null;
  resetProduktFileInputs();
  setProduktFormError('');
  var modal = document.getElementById('produkt-form-modal');
  if (modal) modal.classList.remove('open');
}

// Pills on a product card
function produktBadges(p) {
  var out = [];
  if (p.pdf_url) out.push('Aufbau-Datei');
  var n = (p.product_images || []).length;
  if (n === 1) out.push('1 Medium');
  else if (n > 1) out.push(n + ' Medien');
  return out;
}

// "…" menu of a product card; editing only for AL, PL and Admin
function produktMenuItems(p, role) {
  if (['AL', 'PL', 'Admin'].indexOf(role) === -1) return [];
  return [{ label: 'Bearbeiten', action: 'openProduktForm', args: [p.id] }];
}

function produktMenu(id) {
  var p = alleProdukte.find(function(x) { return x.id === id; });
  if (p) openUiMenu(produktMenuItems(p, typeof userRole !== 'undefined' ? userRole : ''));
}

// Clear every file input so files never carry over to the next product
function resetProduktFileInputs() {
  ['inp-prod-images', 'inp-prod-pdf'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var sel = document.getElementById('inp-prod-pdf-selected');
  if (sel) { sel.textContent = ''; sel.style.display = 'none'; }
}

function setProduktFormError(msg) {
  var el = document.getElementById('produkt-form-error');
  if (!el) return;
  el.textContent = msg || '';
  el.style.display = msg ? 'block' : 'none';
}

// Show which Aufbau-Datei was picked so a wrong pick is visible before saving
function produktPdfSelected() {
  var inp = document.getElementById('inp-prod-pdf');
  var sel = document.getElementById('inp-prod-pdf-selected');
  if (!inp || !sel) return;
  var f = inp.files && inp.files[0];
  if (!f) { sel.textContent = ''; sel.style.display = 'none'; return; }
  var kb = f.size / 1024;
  var size = kb >= 1024 ? (kb / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(kb)) + ' KB';
  sel.textContent = 'Ausgewählt: ' + (f.name || 'Datei') + ' (' + size + ')';
  sel.style.display = 'block';
}

// ── SAVE ──
async function saveProdukt() {
  var name = (document.getElementById('inp-prod-name') || {}).value || '';
  var desc = (document.getElementById('inp-prod-desc') || {}).value || '';
  var contentText = (document.getElementById('inp-prod-content') || {}).value || '';
  var pdfFile = (document.getElementById('inp-prod-pdf') || {}).files && document.getElementById('inp-prod-pdf').files[0];
  var imageFiles = Array.from(((document.getElementById('inp-prod-images') || {}).files) || []);

  setProduktFormError('');
  if (!name.trim()) {
    showToast('Bitte einen Produktnamen eingeben.', 'danger');
    setProduktFormError('Bitte einen Produktnamen eingeben.');
    return;
  }

  if (typeof supabaseClient === 'undefined') {
    showToast('Keine Server-Verbindung.', 'danger');
    setProduktFormError('Keine Server-Verbindung.');
    return;
  }

  var saveBtn = document.querySelector('#produkt-form .btn.primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert...'; }

  var wasEditing = !!editingProduktId;
  try {
    var pdfUrl = null;
    var oldPdfUrl = null;

    // If editing, keep existing URL unless a new file is chosen
    if (editingProduktId) {
      var existing = alleProdukte.find(function(p) { return p.id === editingProduktId; });
      if (existing) pdfUrl = oldPdfUrl = existing.pdf_url;
    }

    // Upload Aufbau-Datei if provided
    if (pdfFile) {
      var prepared = await prepareProduktUpload(pdfFile, false);
      var filePath = produktFileKey({ name: prepared.name, type: prepared.type }, name.trim(), Date.now());

      var { error: uploadErr } = await supabaseClient.storage
        .from('product-pdfs')
        .upload(filePath, prepared.file, { upsert: false, contentType: prepared.type || 'application/octet-stream' });

      if (uploadErr) throw new Error('Aufbau-Datei: ' + uploadErrorMessage(uploadErr));

      var { data: urlData } = supabaseClient.storage
        .from('product-pdfs')
        .getPublicUrl(filePath);

      pdfUrl = urlData && urlData.publicUrl ? urlData.publicUrl : null;
    }

    var payload = {
      name: name.trim(),
      description: desc.trim() || null,
      pdf_url: pdfUrl,
      content_text: contentText.trim() || null,
      created_by: typeof currentUser !== 'undefined' && currentUser ? currentUser.id : null
    };

    var productId = editingProduktId;

    if (editingProduktId) {
      var { error: upErr } = await supabaseClient.from('products').update(payload).eq('id', editingProduktId);
      if (upErr) throw upErr;
    } else {
      var { data: inserted, error: insErr } = await supabaseClient.from('products').insert(payload).select('id').single();
      if (insErr) throw insErr;
      productId = inserted.id;
    }

    // The new Aufbau-Datei is saved; drop the replaced one from storage (best effort)
    if (pdfFile && oldPdfUrl && oldPdfUrl !== pdfUrl) {
      var oldKey = storagePathFromUrl(oldPdfUrl, 'product-pdfs');
      if (oldKey) {
        try { await supabaseClient.storage.from('product-pdfs').remove([oldKey]); }
        catch (e) { console.warn('Old Aufbau-Datei not removed:', e); }
      }
    }

    // Upload new media files (images + videos)
    var mediaFailures = [];
    if (imageFiles.length > 0 && productId) {
      var nextSort = 0;
      if (editingProduktId) {
        var ep = alleProdukte.find(function(p) { return p.id === editingProduktId; });
        nextSort = produktNextSortOrder(ep && ep.product_images);
      }
      for (var i = 0; i < imageFiles.length; i++) {
        var mediaFile = imageFiles[i];
        var mType = contentTypeFor(mediaFile.name, mediaFile.type);
        var isVideo = mType.indexOf('video/') === 0;
        var bucketName = isVideo ? 'product-videos' : 'product-images';
        var mediaType = isVideo ? 'video' : 'image';

        try {
          var prep = isVideo
            ? { file: mediaFile, name: mediaFile.name, type: mType }
            : await prepareProduktUpload(mediaFile, true);
          var baseName = String(prep.name || '').replace(/\.[^.]*$/, '');
          var mediaPath = produktFileKey({ name: prep.name, type: prep.type }, baseName, Date.now() + '_' + i, productId + '/');

          var { error: mediaUpErr } = await supabaseClient.storage
            .from(bucketName)
            .upload(mediaPath, prep.file, { upsert: false, contentType: prep.type || 'application/octet-stream' });
          if (mediaUpErr) throw new Error(uploadErrorMessage(mediaUpErr));

          var { data: mediaUrlData } = supabaseClient.storage.from(bucketName).getPublicUrl(mediaPath);
          var mediaUrl = mediaUrlData && mediaUrlData.publicUrl ? mediaUrlData.publicUrl : null;
          if (!mediaUrl) throw new Error('Keine URL erhalten');
          var { error: rowErr } = await supabaseClient.from('product_images').insert({
            product_id: productId,
            image_url: mediaUrl,
            media_type: mediaType,
            sort_order: nextSort + i
          });
          if (rowErr) throw new Error(uploadErrorMessage(rowErr));
        } catch (mediaErr) {
          console.error('Media upload error:', mediaErr);
          mediaFailures.push((mediaFile.name || 'Datei') + ': ' + (mediaErr && mediaErr.message ? mediaErr.message : uploadErrorMessage(mediaErr)));
        }
      }
    }

    resetProduktFileInputs();
    if (mediaFailures.length > 0) {
      showToast('⚠️ Produkt gespeichert, aber ' + mediaFailures.length + ' Datei(en) nicht hochgeladen.', 'danger');
      await fetchProdukte();
      // Keep the form open on this product so the reason stays visible
      openProduktForm(productId);
      setProduktFormError('Produkt gespeichert, aber nicht hochgeladen:\n' + mediaFailures.join('\n'));
    } else {
      showToast(wasEditing ? '✅ Produkt aktualisiert!' : '✅ Produkt gespeichert!');
      closeProduktForm();
      await fetchProdukte();
    }
  } catch(e) {
    console.error('Produkt save error:', e);
    var reason = e && e.message ? e.message : uploadErrorMessage(e);
    showToast('Fehler beim Speichern: ' + reason, 'danger');
    setProduktFormError('Fehler beim Speichern: ' + reason);
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ── DELETE SINGLE MEDIA ──
async function deleteProduktMedia(mediaId, mediaUrl, mediaType) {
  var label = mediaType === 'video' ? 'Video' : 'Bild';
  if (!confirm(label + ' löschen?')) return;
  try {
    var bucketName = mediaType === 'video' ? 'product-videos' : 'product-images';
    var mediaKey = storagePathFromUrl(mediaUrl, bucketName);
    if (mediaKey) await supabaseClient.storage.from(bucketName).remove([mediaKey]);
    var { error } = await supabaseClient.from('product_images').delete().eq('id', mediaId);
    if (error) throw error;
    showToast(label + ' gelöscht.');
    if (editingProduktId) {
      await fetchProdukte();
      openProduktForm(editingProduktId, true);
    }
  } catch(e) { showToast('Fehler beim Löschen.', 'danger'); }
}

// ── DELETE PRODUKT ──
async function deleteProdukt() {
  if (!editingProduktId) return;
  if (!confirm('Produkt wirklich löschen?')) return;

  var prod = alleProdukte.find(function(p) { return p.id === editingProduktId; });

  try {
    // Delete product media from storage
    var imgs = prod && prod.product_images ? prod.product_images : [];
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].image_url) {
        var bucketName = imgs[i].media_type === 'video' ? 'product-videos' : 'product-images';
        var imgKey = storagePathFromUrl(imgs[i].image_url, bucketName);
        if (imgKey) await supabaseClient.storage.from(bucketName).remove([imgKey]);
      }
    }
    // Delete PDF from storage if exists
    if (prod && prod.pdf_url) {
      var pdfKey = storagePathFromUrl(prod.pdf_url, 'product-pdfs');
      if (pdfKey) await supabaseClient.storage.from('product-pdfs').remove([pdfKey]);
    }
    var { error } = await supabaseClient.from('products').delete().eq('id', editingProduktId);
    if (error) throw error;
    showToast('Produkt gelöscht.');
    closeProduktForm();
    await fetchProdukte();
  } catch(e) {
    console.error('Produkt delete error:', e);
    showToast('Fehler beim Löschen.', 'danger');
  }
}

// ── VIEWER ──
// Prominent bar with an always-visible link to the Aufbau-Datei (iframes stay blank on Android, iOS shows page 1 only)
function aufbauDateiBarHtml(url, kind) {
  var label = kind === 'pdf' ? 'PDF öffnen' : 'Aufbau-Datei öffnen';
  return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
      'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px 14px;margin-bottom:16px;">' +
    '<div style="color:#e0e0e0;font-size:14px;font-weight:600;">📄 Aufbau-Datei' + (kind === 'pdf' ? ' (PDF)' : kind === 'image' ? ' (Bild)' : '') + '</div>' +
    '<a href="' + escHtml(url) + '" target="_blank" rel="noopener" class="btn primary" ' +
      'style="width:auto;padding:8px 16px;font-size:13px;text-decoration:none;">' + label + '</a>' +
    '</div>';
}

var AUFBAU_MAX_PAGES = 15;

// Page size for the inline Aufbau-Datei: full viewer width (max 900px), rendered at screen density (max 2.5x)
function aufbauPageScale(pageWidth, containerWidth, dpr) {
  var cssWidth = Math.min(containerWidth > 0 ? containerWidth : 320, 900);
  var density = Math.min(Math.max(dpr || 1, 1), 2.5);
  return { cssWidth: cssWidth, renderScale: cssWidth / pageWidth * density };
}

// The Aufbau-Datei shown directly in the viewer (no extra tap): images as <img>, PDFs as rendered pages
function aufbauDateiInlineHtml(url, kind) {
  if (kind === 'image') return '<img src="' + escHtml(url) + '" class="aufbau-inline-img" alt="Aufbau-Datei" />';
  if (kind === 'pdf') return '<div class="aufbau-pdf-pages" data-url="' + escHtml(url) + '"><div class="aufbau-pdf-loading">Aufbau-Datei wird geladen…</div></div>';
  return '<p style="color:#bbb;font-size:13px;text-align:center;margin:8px 0 16px;">Diese Datei kann hier nicht angezeigt werden. Bitte über „Aufbau-Datei öffnen“ ansehen.</p>';
}

// Draws the PDF pages into the viewer. Stops quietly when the viewer was closed or switched meanwhile.
async function renderAufbauPdfPages(box) {
  if (!box || typeof pdfjsLib === 'undefined') return;
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  var pdf = null;
  try {
    pdf = await pdfjsLib.getDocument({ url: box.dataset.url }).promise;
    if (!box.isConnected) return;
    box.innerHTML = '';
    var pages = Math.min(pdf.numPages, AUFBAU_MAX_PAGES);
    for (var n = 1; n <= pages; n++) {
      var page = await pdf.getPage(n);
      if (!box.isConnected) return;
      var base = page.getViewport({ scale: 1 });
      var s = aufbauPageScale(base.width, box.clientWidth, window.devicePixelRatio);
      var vp = page.getViewport({ scale: s.renderScale });
      var canvas = document.createElement('canvas');
      canvas.className = 'aufbau-pdf-page';
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      canvas.style.width = s.cssWidth + 'px';
      box.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    }
    if (pdf.numPages > pages) {
      var more = document.createElement('div');
      more.className = 'aufbau-pdf-loading';
      more.textContent = 'Weitere ' + (pdf.numPages - pages) + ' Seiten über „PDF öffnen“ ansehen.';
      box.appendChild(more);
    }
  } catch (e) {
    console.warn('Aufbau-Datei anzeigen:', e);
    if (box.isConnected) box.innerHTML = '<div class="aufbau-pdf-loading">Die Vorschau konnte nicht geladen werden. Bitte über „PDF öffnen“ ansehen.</div>';
  } finally {
    // The canvases keep their pixels; the document and its worker memory are not needed any more
    if (pdf) pdf.destroy();
  }
}

function openProduktViewer(id) {
  var p = alleProdukte.find(function(x) { return x.id === id; });
  if (!p) return;

  var modal = document.getElementById('produkt-viewer-modal');
  var titleEl = document.getElementById('viewer-title');
  var subtitle = document.getElementById('viewer-subtitle');
  var body = document.getElementById('viewer-body');
  var dlBtn = document.getElementById('viewer-download-btn');

  var images = (p.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
  var kind = aufbauFileKind(p.pdf_url);
  if (images.length === 0 && !p.pdf_url && !p.content_text) return; // Nothing to show

  if (titleEl) titleEl.textContent = p.name;

  // Download button: the Aufbau-Datei wins over the first photo
  if (dlBtn) {
    if (p.pdf_url) { dlBtn.href = p.pdf_url; dlBtn.textContent = '⬇ Aufbau-Datei'; dlBtn.style.display = 'inline-flex'; }
    else if (images.length > 0) { dlBtn.href = images[0].image_url; dlBtn.textContent = '⬇ Download'; dlBtn.style.display = 'inline-flex'; }
    else { dlBtn.removeAttribute('href'); dlBtn.style.display = 'none'; }
  }

  var textHtml = p.content_text
    ? '<div style="color:#e0e0e0;font-size:14px;line-height:1.6;white-space:pre-wrap;background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;margin-top:16px;">' + escHtml(p.content_text) + '</div>'
    : '';
  var wrapOpen = '<div style="width:100%;height:100%;overflow-y:auto;padding:16px;box-sizing:border-box;display:flex;flex-direction:column;">';

  if (images.length > 0) {
    // Build mediaList for lightbox
    var mediaList = images.map(function(img) {
      return { url: img.image_url, type: img.media_type || 'image' };
    });
    window.currentViewerMediaList = mediaList;

    var imgCount = images.filter(function(m) { return m.media_type !== 'video'; }).length;
    var vidCount = images.length - imgCount;
    var subtitleParts = [];
    if (p.pdf_url) subtitleParts.push('Aufbau-Datei');
    if (imgCount > 0) subtitleParts.push(imgCount + ' Bild' + (imgCount > 1 ? 'er' : ''));
    if (vidCount > 0) subtitleParts.push(vidCount + ' Video' + (vidCount > 1 ? 's' : ''));
    if (subtitle) subtitle.textContent = subtitleParts.join(', ');

    if (body) {
      body.innerHTML = wrapOpen +
        (p.pdf_url ? aufbauDateiBarHtml(p.pdf_url, kind) + aufbauDateiInlineHtml(p.pdf_url, kind) : '') +
        '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">' +
        images.map(function(img, idx) {
          if (img.media_type === 'video') {
            return '<div class="viewer-media-item" onclick="openLightbox(currentViewerMediaList,' + idx + ')">' +
              '<video src="' + escHtml(img.image_url) + '" muted preload="metadata" playsinline style="max-height:200px;"></video>' +
              '<div class="viewer-video-badge">&#x25B6; Video</div>' +
              '</div>';
          }
          return '<div class="viewer-media-item" onclick="openLightbox(currentViewerMediaList,' + idx + ')">' +
            '<img src="' + escHtml(img.image_url) + '" />' +
            '</div>';
        }).join('') +
        '</div>' +
        textHtml +
        '</div>';
    }
  } else if (p.pdf_url) {
    // Only the Aufbau-Datei (PDF, image or unknown type)
    if (subtitle) subtitle.textContent = kind === 'image' ? 'Aufbau-Datei (Bild)' : kind === 'pdf' ? 'Aufbau-Datei (PDF)' : 'Aufbau-Datei';
    // Rendered with pdf.js on every device (an <iframe> stays blank on Android and shows one page on iOS)
    if (body) body.innerHTML = wrapOpen + aufbauDateiBarHtml(p.pdf_url, kind) + aufbauDateiInlineHtml(p.pdf_url, kind) + textHtml + '</div>';
  } else {
    // Only text content
    if (subtitle) subtitle.textContent = 'Aufbauanleitung';
    if (body) {
      body.innerHTML = '<div style="color:#e0e0e0;font-size:14px;line-height:1.6;white-space:pre-wrap;padding:24px;max-width:720px;margin:0 auto;">' + escHtml(p.content_text) + '</div>';
    }
  }

  if (modal) modal.style.display = 'flex';
  // After the modal is visible, so the page width is known
  if (body) renderAufbauPdfPages(body.querySelector('.aufbau-pdf-pages'));
}

function closeProduktViewer() {
  var modal = document.getElementById('produkt-viewer-modal');
  var body = document.getElementById('viewer-body');
  if (body) { body.innerHTML = ''; body.style.display = 'flex'; } // Stop iframe/video loading; restore centering
  if (typeof _zv !== 'undefined') _zv = null;
  if (modal) modal.style.display = 'none';
  window.currentViewerMediaList = null;
  closeLightbox();
}

// ── LIGHTBOX ──
function openLightbox(mediaList, index) {
  lightboxMedia = mediaList || [];
  lightboxIndex = index || 0;
  var lb = document.getElementById('media-lightbox');
  if (!lb || lightboxMedia.length === 0) return;
  lb.classList.add('open');
  lightboxRender();
  document.addEventListener('keydown', lightboxKeyHandler);
}

function closeLightbox() {
  var lb = document.getElementById('media-lightbox');
  if (lb) lb.classList.remove('open');
  var wrap = document.getElementById('lightbox-media-wrap');
  if (wrap) {
    var vid = wrap.querySelector('video');
    if (vid) { vid.pause(); vid.src = ''; }
    wrap.innerHTML = '';
  }
  document.removeEventListener('keydown', lightboxKeyHandler);
}

function lightboxRender() {
  var wrap = document.getElementById('lightbox-media-wrap');
  var counter = document.getElementById('lightbox-counter');
  var prevBtn = document.querySelector('.lightbox-prev');
  var nextBtn = document.querySelector('.lightbox-next');
  if (!wrap) return;

  var item = lightboxMedia[lightboxIndex];
  if (!item) return;

  var oldVideo = wrap.querySelector('video');
  if (oldVideo) { oldVideo.pause(); oldVideo.src = ''; }

  if (item.type === 'video') {
    wrap.innerHTML = '<video src="' + item.url + '" controls autoplay playsinline ' +
      'style="max-width:92vw;max-height:88vh;border-radius:6px;outline:none;display:block;"></video>';
  } else {
    wrap.innerHTML = '<img src="' + item.url + '" alt="" />';
  }

  if (counter) {
    counter.textContent = (lightboxIndex + 1) + ' / ' + lightboxMedia.length;
    counter.style.display = lightboxMedia.length > 1 ? 'block' : 'none';
  }

  var single = lightboxMedia.length <= 1;
  if (prevBtn) prevBtn.classList.toggle('hidden', single);
  if (nextBtn) nextBtn.classList.toggle('hidden', single);
}

function lightboxNav(direction) {
  if (lightboxMedia.length === 0) return;
  var wrap = document.getElementById('lightbox-media-wrap');
  var vid = wrap && wrap.querySelector('video');
  if (vid) { vid.pause(); vid.src = ''; }
  lightboxIndex = (lightboxIndex + direction + lightboxMedia.length) % lightboxMedia.length;
  lightboxRender();
}

function lightboxBackdropClick(event) {
  if (event.target === document.getElementById('media-lightbox')) {
    closeLightbox();
  }
}

function lightboxKeyHandler(e) {
  if (e.key === 'Escape')      { closeLightbox(); return; }
  if (e.key === 'ArrowLeft')   { lightboxNav(-1); return; }
  if (e.key === 'ArrowRight')  { lightboxNav(1);  return; }
}

// ── UTIL ──
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ── FILE HELPERS (pure, unit-tested in tests/produkte.test.js) ──
var PRODUKT_MIME_EXT = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/heic': 'heic', 'image/heif': 'heif',
  'image/tiff': 'tif', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm'
};
var PRODUKT_EXT_MIME = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff',
  tiff: 'image/tiff', bmp: 'image/bmp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'
};
// MIME types the product-images bucket accepts
var PRODUKT_BUCKET_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
var PRODUKT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// Extension from the file name if it looks like a real one, otherwise from the MIME type; '' if unknown.
function fileExtension(name, type) {
  var n = String(name || '').trim();
  var dot = n.lastIndexOf('.');
  if (dot > -1 && dot < n.length - 1) {
    var ext = n.slice(dot + 1);
    if (/^[a-z0-9]{1,5}$/i.test(ext)) return ext.toLowerCase();
  }
  return PRODUKT_MIME_EXT[String(type || '').toLowerCase()] || '';
}

// ASCII-only storage name: umlauts transliterated, accents stripped, everything else -> '_'.
function sanitizeStorageName(str) {
  var s = String(str || '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[^A-Za-z0-9\-_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60).replace(/_+$/, '');
  return s || 'datei';
}

// Storage key: [prefix]<sanitised base>_<stamp>[.ext]
function produktFileKey(file, baseName, stamp, prefix) {
  var ext = fileExtension(file && file.name, file && file.type);
  return (prefix || '') + sanitizeStorageName(baseName) + '_' + stamp + (ext ? '.' + ext : '');
}

// Real MIME if the browser gave one, else derived from the extension.
function contentTypeFor(name, type) {
  var t = String(type || '').toLowerCase();
  if (t && t !== 'application/octet-stream') return t;
  return PRODUKT_EXT_MIME[fileExtension(name, '')] || 'application/octet-stream';
}

function isPdfMagic(bytes) {
  if (!bytes || bytes.length < 5) return false;
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // %PDF-
}

function isBucketImageType(type) {
  return PRODUKT_BUCKET_IMAGE_TYPES.indexOf(String(type || '').toLowerCase()) > -1;
}

// German, user-facing reason for a failed storage/DB call.
function uploadErrorMessage(err) {
  var msg = String((err && (err.message || err.error)) || err || '');
  var code = String((err && (err.statusCode || err.status)) || '');
  if (/mime type|not supported|invalid_mime/i.test(msg) || code === '415') return 'Format nicht unterstützt – bitte als JPG/PNG speichern';
  if (/maximum allowed size|too large|payload/i.test(msg) || code === '413') return 'Datei zu groß (max. 10 MB für Bilder)';
  if (/failed to fetch|network|load failed|timeout/i.test(msg)) return 'Keine Verbindung zum Server – bitte erneut versuchen';
  if (/row-level security|permission|unauthori[sz]ed|403/i.test(msg) || code === '403') return 'Keine Berechtigung zum Hochladen';
  return 'Upload fehlgeschlagen' + (msg ? ': ' + msg : '');
}

// Kind of the stored Aufbau-Datei, judged by its URL.
function aufbauFileKind(url) {
  if (!url) return 'none';
  var path = String(url).split('?')[0];
  if (/\.(jpe?g|png|gif|webp|svg)$/i.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  return 'other';
}

// Object key inside a bucket from its public URL, or null.
function storagePathFromUrl(url, bucket) {
  if (!url) return null;
  var parts = String(url).split('/' + bucket + '/');
  if (parts.length < 2) return null;
  var key = parts.slice(1).join('/' + bucket + '/').split('?')[0];
  try { return decodeURIComponent(key); } catch (e) { return key; }
}

// ── FILE PREPARATION (browser only) ──
async function readFileHead(file, n) {
  try {
    var buf = await file.slice(0, n).arrayBuffer();
    return new Uint8Array(buf);
  } catch (e) { return null; }
}

// Re-encode any browser-decodable image (e.g. HEIC on Safari) as JPEG. Resolves null if it can't decode.
function convertImageToJpeg(file, maxDim) {
  maxDim = maxDim || 3000;
  return new Promise(function(resolve) {
    var url;
    try { url = URL.createObjectURL(file); } catch (e) { resolve(null); return; }
    var img = new Image();
    img.onload = function() {
      try {
        var scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        var ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; // JPEG has no alpha
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(blob) {
          if (!blob) { resolve(null); return; }
          var base = String(file.name || 'bild').replace(/\.[^.]*$/, '') || 'bild';
          var name = base + '.jpg';
          try { resolve(new File([blob], name, { type: 'image/jpeg' })); }
          catch (e) { blob.name = name; resolve(blob); }
        }, 'image/jpeg', 0.85);
      } catch (e) { URL.revokeObjectURL(url); resolve(null); }
    };
    img.onerror = function() { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Returns { file, name, type } ready for upload, or throws an Error with a German message.
// forImageBucket: the target bucket only accepts PRODUKT_BUCKET_IMAGE_TYPES up to 10 MB.
async function prepareProduktUpload(file, forImageBucket) {
  var name = file.name || '';
  var type = String(file.type || '').toLowerCase();
  if (!type || type === 'application/octet-stream') {
    if (isPdfMagic(await readFileHead(file, 5))) type = 'application/pdf';
    else type = contentTypeFor(name, type);
  }
  if (type === 'application/pdf' && fileExtension(name, '') !== 'pdf') name = (name || 'datei') + '.pdf';

  var isRaster = type.indexOf('image/') === 0 && type !== 'image/svg+xml' && type !== 'image/gif';
  var needsConvert = isRaster && (!isBucketImageType(type) || (forImageBucket && file.size > PRODUKT_IMAGE_MAX_BYTES));
  if (needsConvert) {
    var jpg = await convertImageToJpeg(file);
    if (jpg) return { file: jpg, name: jpg.name, type: 'image/jpeg' };
    if (forImageBucket) throw new Error(!isBucketImageType(type)
      ? 'Format nicht unterstützt – bitte als JPG/PNG speichern'
      : 'Datei zu groß (max. 10 MB für Bilder)');
  }
  if (forImageBucket && !isBucketImageType(type)) throw new Error('Format nicht unterstützt – bitte als JPG/PNG speichern');
  if (forImageBucket && file.size > PRODUKT_IMAGE_MAX_BYTES) throw new Error('Datei zu groß (max. 10 MB für Bilder)');
  return { file: file, name: name, type: type };
}


// New sort_order values when `coverId` becomes the cover (= lowest sort_order): cover 0, the others 1..n in their
// current order. Only rows whose value changes are returned.
function produktCoverOrder(images, coverId) {
  if (!images.some(function(i) { return i.id === coverId; })) return [];
  var ordered = images.slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
  var cover = ordered.filter(function(i) { return i.id === coverId; });
  var rest = ordered.filter(function(i) { return i.id !== coverId; });
  return cover.concat(rest)
    .map(function(i, n) { return { id: i.id, sort_order: n, old: i.sort_order }; })
    .filter(function(r) { return r.sort_order !== r.old; })
    .map(function(r) { return { id: r.id, sort_order: r.sort_order }; });
}

// sort_order for the next uploaded file: after the highest one in use (the count collides after a deletion)
function produktNextSortOrder(images) {
  return (images || []).reduce(function(max, i) { return Math.max(max, (Number(i.sort_order) || 0) + 1); }, 0);
}

var _produktCoverBusy = false;

// Makes one picture/video the product's cover (first on the card and in the viewer)
async function setProduktCover(productId, imageId) {
  var prod = alleProdukte.find(function(p) { return p.id === productId; });
  if (!prod || _produktCoverBusy) return;
  var updates = produktCoverOrder(prod.product_images || [], imageId);
  if (!updates.length) return;
  _produktCoverBusy = true;
  var failed = false;
  try {
    for (var i = 0; i < updates.length; i++) {
      var res = await supabaseClient.from('product_images').update({ sort_order: updates[i].sort_order }).eq('id', updates[i].id).select('id');
      if (res.error || !res.data || !res.data.length) {
        console.error('Titelbild setzen:', res.error);
        failed = true;
        break;
      }
      // Local copy follows each saved row, so a retry after a failure starts from what the server has
      var img = prod.product_images.find(function(x) { return x.id === updates[i].id; });
      if (img) img.sort_order = updates[i].sort_order;
    }
  } finally {
    _produktCoverBusy = false;
  }
  showToast(failed ? 'Titelbild konnte nicht gespeichert werden.' : 'Titelbild gespeichert');
  renderProdukte(alleProdukte);
  openProduktForm(productId, true);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fileExtension: fileExtension, sanitizeStorageName: sanitizeStorageName, produktFileKey: produktFileKey,
    contentTypeFor: contentTypeFor, isPdfMagic: isPdfMagic, isBucketImageType: isBucketImageType,
    uploadErrorMessage: uploadErrorMessage, aufbauFileKind: aufbauFileKind, storagePathFromUrl: storagePathFromUrl,
    produktCoverOrder: produktCoverOrder, produktNextSortOrder: produktNextSortOrder, aufbauPageScale: aufbauPageScale,
    produktBadges: produktBadges, produktMenuItems: produktMenuItems };
}
