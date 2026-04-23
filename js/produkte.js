/**
 * Produktdatenbank Module
 * AL, PL, Admin können Produkte hochladen.
 * Alle eingeloggten Nutzer können Produkte ansehen.
 */

var alleProdukte = [];       // Cached from Supabase
var editingProduktId = null; // UUID of product being edited

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
    .select('id, name, description, pdf_url, content_text, created_at, product_images(id, image_url, sort_order)')
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
    // Thumbnail priority: 1) first product_image, 2) pdf_url image, 3) pdf canvas, 4) placeholder
    var images = (p.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
    var preview;
    if (images.length > 0) {
      preview = '<img src="' + images[0].image_url + '" class="produkt-thumb" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')" />';
    } else if (p.pdf_url) {
      var isImage = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(p.pdf_url);
      if (isImage) {
        preview = '<img src="' + p.pdf_url + '" class="produkt-thumb" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')" />';
      } else {
        preview = '<canvas class="produkt-thumb produkt-pdf-canvas" data-url="' + p.pdf_url + '" data-id="' + p.id + '" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')"></canvas>';
      }
    } else {
      preview = '<div class="produkt-pdf-thumb" style="opacity:0.3; cursor:default;">📄<span>Keine Datei</span></div>';
    }

    var editBtn = canUpload
      ? '<button class="btn" style="width:100%; margin-top:6px; padding:6px; font-size:12px;" onclick="event.stopPropagation();openProduktForm(\'' + p.id + '\')">Bearbeiten</button>'
      : '';
    var fileBtn = (images.length > 0 || p.pdf_url)
      ? '<button class="btn primary" style="width:100%; margin-top:10px; padding:8px; font-size:13px;" onclick="event.stopPropagation();openProduktViewer(\'' + p.id + '\')">👁 Anzeigen</button>'
      : '';
    return '<div class="produkt-card">' +
      preview +
      '<div class="produkt-name" style="margin-top:10px;">' + escHtml(p.name) + '</div>' +
      (p.description ? '<div class="produkt-desc">' + escHtml(p.description) + '</div>' : '') +
      fileBtn +
      editBtn +
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
      ctx2.fillStyle = 'var(--bg3, #2a2a2a)';
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
function openProduktForm(id) {
  editingProduktId = id || null;
  var form = document.getElementById('produkt-form');
  var title = document.getElementById('produkt-form-title');
  var nameInp = document.getElementById('inp-prod-name');
  var descInp = document.getElementById('inp-prod-desc');
  var contentInp = document.getElementById('inp-prod-content');
  var pdfInp = document.getElementById('inp-prod-pdf');
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
    if (pdfInp) pdfInp.value = '';
    if (pdfCurrent) {
      pdfCurrent.style.display = prod.pdf_url ? 'block' : 'none';
      pdfCurrent.textContent = prod.pdf_url ? 'Aktuell: Datei vorhanden (neu hochladen zum Ersetzen)' : '';
    }
    if (deleteBtn) deleteBtn.style.display = 'inline-flex';
    // Show existing images with delete buttons
    if (existingImgs) {
      var imgs = (prod.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });
      if (imgs.length > 0) {
        existingImgs.style.display = 'block';
        existingImgs.innerHTML = '<div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Vorhandene Bilder:</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
          imgs.map(function(img) {
            return '<div style="position:relative;">' +
              '<img src="' + img.image_url + '" style="width:80px;height:60px;object-fit:cover;border-radius:6px;display:block;" />' +
              '<button onclick="deleteProduktImage(\'' + img.id + '\',\'' + img.image_url + '\')" style="position:absolute;top:-6px;right:-6px;background:var(--danger);color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;">✕</button>' +
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
    if (pdfInp) pdfInp.value = '';
    if (pdfCurrent) pdfCurrent.style.display = 'none';
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (existingImgs) { existingImgs.style.display = 'none'; existingImgs.innerHTML = ''; }
  }

  if (form) form.style.display = 'block';
  if (nameInp) nameInp.focus();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeProduktForm() {
  editingProduktId = null;
  var form = document.getElementById('produkt-form');
  if (form) form.style.display = 'none';
}

// ── SAVE ──
async function saveProdukt() {
  var name = (document.getElementById('inp-prod-name') || {}).value || '';
  var desc = (document.getElementById('inp-prod-desc') || {}).value || '';
  var contentText = (document.getElementById('inp-prod-content') || {}).value || '';
  var pdfFile = (document.getElementById('inp-prod-pdf') || {}).files && document.getElementById('inp-prod-pdf').files[0];
  var imageFiles = Array.from(((document.getElementById('inp-prod-images') || {}).files) || []);

  if (!name.trim()) {
    showToast('Bitte einen Produktnamen eingeben.', 'danger');
    return;
  }

  if (typeof supabaseClient === 'undefined') {
    showToast('Keine Server-Verbindung.', 'danger');
    return;
  }

  var saveBtn = document.querySelector('#produkt-form .btn.primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Speichert...'; }

  try {
    var pdfUrl = null;

    // If editing, keep existing URL unless a new file is chosen
    if (editingProduktId) {
      var existing = alleProdukte.find(function(p) { return p.id === editingProduktId; });
      if (existing) pdfUrl = existing.pdf_url;
    }

    // Upload PDF/file if provided
    if (pdfFile) {
      var safeName = name.trim()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
        .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss')
        .replace(/[^a-zA-Z0-9\-_]/g, '_');
      var fileExt = pdfFile.name.split('.').pop() || 'pdf';
      var filePath = safeName + '_' + Date.now() + '.' + fileExt;

      var { error: uploadErr } = await supabaseClient.storage
        .from('product-pdfs')
        .upload(filePath, pdfFile, { upsert: false, contentType: pdfFile.type || 'application/octet-stream' });

      if (uploadErr) throw uploadErr;

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

    // Upload new images
    if (imageFiles.length > 0 && productId) {
      var existingCount = 0;
      if (editingProduktId) {
        var ep = alleProdukte.find(function(p) { return p.id === editingProduktId; });
        existingCount = ep && ep.product_images ? ep.product_images.length : 0;
      }
      for (var i = 0; i < imageFiles.length; i++) {
        var imgFile = imageFiles[i];
        var safeImg = imgFile.name
          .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
          .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
          .replace(/ß/g, 'ss')
          .replace(/[^a-zA-Z0-9\-_.]/g, '_');
        var imgPath = productId + '/' + Date.now() + '_' + i + '_' + safeImg;
        var { error: imgUpErr } = await supabaseClient.storage
          .from('product-images')
          .upload(imgPath, imgFile, { upsert: false, contentType: imgFile.type || 'image/jpeg' });
        if (imgUpErr) { console.error('Image upload error:', imgUpErr); continue; }
        var { data: imgUrlData } = supabaseClient.storage.from('product-images').getPublicUrl(imgPath);
        var imgUrl = imgUrlData && imgUrlData.publicUrl ? imgUrlData.publicUrl : null;
        if (imgUrl) {
          await supabaseClient.from('product_images').insert({
            product_id: productId,
            image_url: imgUrl,
            sort_order: existingCount + i
          });
        }
      }
    }

    showToast(editingProduktId ? '✅ Produkt aktualisiert!' : '✅ Produkt gespeichert!');
    closeProduktForm();
    await fetchProdukte();
  } catch(e) {
    console.error('Produkt save error:', e);
    showToast('Fehler beim Speichern: ' + (e.message || e), 'danger');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Speichern'; }
  }
}

// ── DELETE SINGLE IMAGE ──
async function deleteProduktImage(imgId, imgUrl) {
  if (!confirm('Bild löschen?')) return;
  try {
    if (imgUrl) {
      var parts = imgUrl.split('/product-images/');
      if (parts.length > 1) await supabaseClient.storage.from('product-images').remove([parts[1]]);
    }
    var { error } = await supabaseClient.from('product_images').delete().eq('id', imgId);
    if (error) throw error;
    showToast('Bild gelöscht.');
    // Refresh form images display
    if (editingProduktId) {
      await fetchProdukte();
      openProduktForm(editingProduktId);
    }
  } catch(e) { showToast('Fehler beim Löschen.', 'danger'); }
}

// ── DELETE PRODUKT ──
async function deleteProdukt() {
  if (!editingProduktId) return;
  if (!confirm('Produkt wirklich löschen?')) return;

  var prod = alleProdukte.find(function(p) { return p.id === editingProduktId; });

  try {
    // Delete product images from storage
    var imgs = prod && prod.product_images ? prod.product_images : [];
    for (var i = 0; i < imgs.length; i++) {
      if (imgs[i].image_url) {
        var parts = imgs[i].image_url.split('/product-images/');
        if (parts.length > 1) await supabaseClient.storage.from('product-images').remove([parts[1]]);
      }
    }
    // Delete PDF from storage if exists
    if (prod && prod.pdf_url) {
      var pdfParts = prod.pdf_url.split('/product-pdfs/');
      if (pdfParts.length > 1) {
        await supabaseClient.storage.from('product-pdfs').remove([pdfParts[1]]);
      }
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
function openProduktViewer(id) {
  var p = alleProdukte.find(function(x) { return x.id === id; });
  if (!p) return;

  var modal = document.getElementById('produkt-viewer-modal');
  var titleEl = document.getElementById('viewer-title');
  var subtitle = document.getElementById('viewer-subtitle');
  var body = document.getElementById('viewer-body');
  var dlBtn = document.getElementById('viewer-download-btn');

  if (titleEl) titleEl.textContent = p.name;

  var images = (p.product_images || []).slice().sort(function(a, b) { return a.sort_order - b.sort_order; });

  if (images.length > 0) {
    // Gallery view: images + content_text
    if (subtitle) subtitle.textContent = images.length + ' Bild' + (images.length > 1 ? 'er' : '');
    if (dlBtn) {
      dlBtn.href = images[0].image_url;
      dlBtn.style.display = 'inline-flex';
    }
    if (body) {
      var galleryHtml = '<div style="width:100%;height:100%;overflow-y:auto;padding:16px;box-sizing:border-box;">' +
        '<div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-bottom:' + (p.content_text ? '16px' : '0') + ';">' +
        images.map(function(img) {
          return '<img src="' + img.image_url + '" style="max-width:100%;max-height:60vh;object-fit:contain;border-radius:8px;cursor:pointer;" ' +
            'onclick="window.open(this.src,\'_blank\')" title="Klick zum Vergrößern" />';
        }).join('') +
        '</div>' +
        (p.content_text
          ? '<div style="color:#e0e0e0;font-size:14px;line-height:1.6;white-space:pre-wrap;background:rgba(255,255,255,0.05);padding:16px;border-radius:8px;">' + escHtml(p.content_text) + '</div>'
          : '') +
        '</div>';
      body.innerHTML = galleryHtml;
    }
  } else if (p.pdf_url) {
    // Fallback: PDF or single image file
    var isImage = /\.(jpe?g|png|gif|webp)(\?|$)/i.test(p.pdf_url);
    var isPdf = /\.pdf(\?|$)/i.test(p.pdf_url);
    if (subtitle) subtitle.textContent = isImage ? 'Bild' : 'PDF';
    if (dlBtn) { dlBtn.href = p.pdf_url; dlBtn.style.display = 'inline-flex'; }
    if (body) {
      if (isImage) {
        body.innerHTML = '<img src="' + p.pdf_url + '" style="max-width:100%; max-height:100%; object-fit:contain; display:block;" />';
      } else if (isPdf) {
        body.innerHTML =
          '<iframe src="' + p.pdf_url + '" style="width:100%; height:100%; border:none; min-height:70vh;" allowfullscreen>' +
            '<p style="color:#fff;padding:20px;">PDF kann nicht angezeigt werden. ' +
            '<a href="' + p.pdf_url + '" target="_blank" style="color:#60a5fa;">Herunterladen</a></p>' +
          '</iframe>';
      } else {
        body.innerHTML = '<p style="color:#fff;padding:20px;">Datei kann nicht angezeigt werden. ' +
          '<a href="' + p.pdf_url + '" target="_blank" style="color:#60a5fa;">Herunterladen</a></p>';
      }
    }
  } else if (p.content_text) {
    // Only text content
    if (subtitle) subtitle.textContent = 'Aufbauanleitung';
    if (dlBtn) dlBtn.style.display = 'none';
    if (body) {
      body.innerHTML = '<div style="color:#e0e0e0;font-size:14px;line-height:1.6;white-space:pre-wrap;padding:24px;max-width:720px;margin:0 auto;">' + escHtml(p.content_text) + '</div>';
    }
  } else {
    return; // Nothing to show
  }

  if (modal) modal.style.display = 'flex';
}

function closeProduktViewer() {
  var modal = document.getElementById('produkt-viewer-modal');
  var body = document.getElementById('viewer-body');
  if (body) body.innerHTML = ''; // Stop iframe/video loading
  if (modal) modal.style.display = 'none';
}

// ── UTIL ──
function escHtml(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
