/**
 * POMPOM PDP Tagger — Main App Controller
 * Screen 1: Shoot Setup
 */

// ─── App State ────────────────────────────────────────────────────────────────

const state = {
  currentScreen: 1,
  folderId: null,
  folderName: null,
  looks: [],       // [{ name, folderId, files: [], model: null, bg: null }]
  modelFiles: [],  // files in Models/ subfolder
  bgFiles: [],     // files in Backgrounds/ subfolder
  picker: null,    // { lookIdx, type: 'model' | 'bg' }
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const DOM = {
  // Nav
  navBtns: document.querySelectorAll('.nav-step'),
  screens: document.querySelectorAll('.screen'),
  // Screen 1
  driveStatusRow:  $('drive-status-row'),
  driveDot:        $('drive-dot'),
  driveStatusText: $('drive-status-text'),
  btnConnectDrive: $('btn-connect-drive'),
  cardFolder:      $('card-folder'),
  inputFolder:     $('input-folder'),
  btnLoadFolder:   $('btn-load-folder'),
  folderMeta:      $('folder-meta'),
  cardLooks:       $('card-looks'),
  looksGrid:       $('looks-grid'),
  footerS1:        $('footer-s1'),
  setupSummary:    $('setup-summary'),
  btnToTagger:     $('btn-to-tagger'),
  // Modal
  modal:           $('modal'),
  modalBackdrop:   $('modal-backdrop'),
  modalTitle:      $('modal-title'),
  modalClose:      $('modal-close'),
  modalGrid:       $('modal-grid'),
  modalEmpty:      $('modal-empty'),
  modalLoading:    $('modal-loading'),
  // Toast
  toast:           $('toast'),
};

// ─── Screen routing ───────────────────────────────────────────────────────────

function showScreen(n) {
  state.currentScreen = n;
  DOM.screens.forEach(s => s.classList.toggle('hidden', s.id !== `screen-${n}`));
  DOM.navBtns.forEach(btn => {
    const num = parseInt(btn.dataset.screen);
    btn.classList.toggle('active', num === n);
    if (!btn.disabled && num !== n) btn.blur();
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(msg, type = '') {
  DOM.toast.textContent = msg;
  DOM.toast.classList.remove('hidden', 'error');
  if (type === 'error') DOM.toast.classList.add('error');
  void DOM.toast.offsetWidth;
  DOM.toast.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    DOM.toast.classList.remove('show');
    setTimeout(() => DOM.toast.classList.add('hidden'), 250);
  }, 3500);
}

// ─── Step 1: Google Drive connect ─────────────────────────────────────────────

DOM.btnConnectDrive.addEventListener('click', async () => {
  DOM.btnConnectDrive.disabled = true;
  DOM.btnConnectDrive.textContent = 'Connecting…';

  try {
    await Drive.connect();
    setDriveConnected(true);
    DOM.cardFolder.classList.remove('hidden');
    showToast('Google Drive connected');
  } catch (e) {
    setDriveConnected(false);
    DOM.btnConnectDrive.disabled = false;
    DOM.btnConnectDrive.textContent = 'Connect Google Drive';
    showToast(e.message || 'Connection failed', 'error');
  }
});

function setDriveConnected(ok) {
  DOM.driveDot.className = 'status-dot ' + (ok ? 'connected' : 'error');
  DOM.driveStatusText.textContent = ok ? 'Connected' : 'Connection failed';
  DOM.btnConnectDrive.textContent = ok ? '✓ Connected' : 'Retry Connection';
  DOM.btnConnectDrive.disabled = ok;
}

// ─── Step 2: Load folder ──────────────────────────────────────────────────────

DOM.btnLoadFolder.addEventListener('click', loadFolder);
DOM.inputFolder.addEventListener('keydown', e => { if (e.key === 'Enter') loadFolder(); });

async function loadFolder() {
  const raw = DOM.inputFolder.value.trim();
  const folderId = Drive.parseFolderId(raw);

  if (!folderId) {
    showToast('Paste a valid Drive folder URL or ID', 'error');
    return;
  }

  DOM.btnLoadFolder.disabled = true;
  DOM.btnLoadFolder.textContent = 'Loading…';
  DOM.folderMeta.classList.add('hidden');
  DOM.cardLooks.classList.add('hidden');
  DOM.footerS1.classList.add('hidden');

  try {
    // Verify folder exists and get its name
    const folder = await Drive.getFile(folderId);
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error('That link points to a file, not a folder.');
    }

    state.folderId  = folderId;
    state.folderName = folder.name;
    saveLastFolder(folderId);

    DOM.folderMeta.innerHTML = `Loaded: <strong>${folder.name}</strong>`;
    DOM.folderMeta.classList.remove('hidden');

    // Scan for Look subfolders + Models + Backgrounds
    await scanFolder(folderId);

  } catch (e) {
    showToast(e.message || 'Failed to load folder', 'error');
  } finally {
    DOM.btnLoadFolder.disabled = false;
    DOM.btnLoadFolder.textContent = 'Load';
  }
}

async function scanFolder(folderId) {
  // Run all three lookups in parallel
  const [lookFolders, modelsFolder, bgsFolder] = await Promise.all([
    Drive.findSubfoldersByPattern(folderId, CONFIG.LOOK_FOLDER_RE),
    Drive.findSubfolder(folderId, CONFIG.MODELS_FOLDER),
    Drive.findSubfolder(folderId, CONFIG.BACKGROUNDS_FOLDER),
  ]);

  if (!lookFolders.length) {
    showToast('No "Look N" subfolders found in this folder', 'error');
    return;
  }

  // Load model + background files — use subfolders if they exist, otherwise use root images
  let modelFiles = [];
  let bgFiles    = [];

  if (modelsFolder) {
    modelFiles = await Drive.listFolder(modelsFolder.id, { imageOnly: true });
  }
  if (bgsFolder) {
    bgFiles = await Drive.listFolder(bgsFolder.id, { imageOnly: true });
  }

  // Fallback: load loose image files from the root folder for both pickers
  if (!modelFiles.length || !bgFiles.length) {
    const rootImages = await Drive.listFolder(folderId, { imageOnly: true });
    if (!modelFiles.length) modelFiles = rootImages;
    if (!bgFiles.length)    bgFiles    = rootImages;
  }

  state.modelFiles = modelFiles;
  state.bgFiles    = bgFiles;

  // Build look entries (file list loaded lazily per look)
  state.looks = lookFolders.map(f => ({
    name:     f.name,
    folderId: f.id,
    files:    null,
    model:    null,
    bg:       null,
  }));

  restoreLooksState();
  renderLooksGrid();

  DOM.cardLooks.classList.remove('hidden');

  // Show folder count info
  showToast(`Found ${lookFolders.length} look${lookFolders.length !== 1 ? 's' : ''}, ${modelFiles.length} model photo${modelFiles.length !== 1 ? 's' : ''}, ${bgFiles.length} background${bgFiles.length !== 1 ? 's' : ''}`);

  checkFooter();
}

// ─── Looks grid ───────────────────────────────────────────────────────────────

function renderLooksGrid() {
  DOM.looksGrid.innerHTML = '';
  state.looks.forEach((look, idx) => {
    const card = createLookCard(look, idx);
    DOM.looksGrid.appendChild(card);
    // Kick off file count load in background
    loadLookFileCount(idx);
  });
}

function createLookCard(look, idx) {
  const card = document.createElement('div');
  card.className = 'look-card';
  card.dataset.lookIdx = idx;

  card.innerHTML = `
    <div class="look-card-header">
      <div class="look-preview-wrap">
        <div class="look-preview" id="preview-${idx}">
          <div class="spinner" style="width:14px;height:14px;border-width:2px;"></div>
        </div>
        <span class="look-name">${look.name}</span>
      </div>
      <span class="look-badge" id="badge-${idx}">…</span>
    </div>
    <div class="look-pickers">
      ${pickerSlotHTML(idx, 'model', look.model)}
      ${pickerSlotHTML(idx, 'bg',    look.bg)}
    </div>
  `;

  card.querySelector(`[data-picker="model-${idx}"]`)
    .addEventListener('click', () => openPicker(idx, 'model'));
  card.querySelector(`[data-picker="bg-${idx}"]`)
    .addEventListener('click', () => openPicker(idx, 'bg'));

  return card;
}

function pickerSlotHTML(idx, type, selected) {
  const label     = type === 'model' ? 'Model Face' : 'Background';
  const emoji     = type === 'model' ? '👤' : '🖼️';
  const isSelected = !!selected;
  const slotClass = isSelected ? 'picker-slot selected' : 'picker-slot';

  const thumbHTML = isSelected && selected.blobUrl
    ? `<img class="picker-thumb" src="${selected.blobUrl}" alt="${selected.name}">`
    : `<div class="picker-thumb-placeholder">${emoji}</div>`;

  const nameHTML = isSelected
    ? `<span class="picker-name">${selected.name}</span>`
    : `<span class="picker-name placeholder">Click to select…</span>`;

  return `
    <button class="${slotClass}" data-picker="${type}-${idx}">
      ${thumbHTML}
      <div class="picker-info">
        <div class="picker-type">${label}</div>
        ${nameHTML}
      </div>
      <span class="picker-chevron">›</span>
    </button>
  `;
}

function refreshLookCard(idx) {
  const look = state.looks[idx];
  const card = DOM.looksGrid.querySelector(`[data-look-idx="${idx}"]`);
  if (!card) return;
  const pickers = card.querySelector('.look-pickers');
  pickers.innerHTML = pickerSlotHTML(idx, 'model', look.model) + pickerSlotHTML(idx, 'bg', look.bg);
  pickers.querySelector(`[data-picker="model-${idx}"]`)
    .addEventListener('click', () => openPicker(idx, 'model'));
  pickers.querySelector(`[data-picker="bg-${idx}"]`)
    .addEventListener('click', () => openPicker(idx, 'bg'));
}

async function loadLookFileCount(idx) {
  const look = state.looks[idx];
  const badge   = $(`badge-${idx}`);
  const preview = $(`preview-${idx}`);
  try {
    const files = await Drive.listFolder(look.folderId, { imageOnly: true });
    look.files = files;
    if (badge) badge.textContent = `${files.length} file${files.length !== 1 ? 's' : ''}`;

    // Show 2 preview images — prefer garment shots, skip shoes/bg
    if (preview && files.length) {
      const isShoeOrBg = f => /shoe|bg|background/i.test(f.name);
      const garments = files.filter(f => !isShoeOrBg(f));
      const picks = (garments.length ? garments : files).slice(0, 2);
      preview.innerHTML = picks.map(f =>
        `<img src="${Drive.loadThumbnail(f)}" alt="${f.name}" onerror="this.style.display='none'">`
      ).join('');
    } else if (preview) {
      preview.innerHTML = '🧥';
    }
  } catch {
    if (badge)   badge.textContent = '?';
    if (preview) preview.innerHTML = '🧥';
  }
}

// ─── Picker modal ─────────────────────────────────────────────────────────────

function openPicker(lookIdx, type) {
  state.picker = { lookIdx, type };

  const isModel   = type === 'model';
  const files     = isModel ? state.modelFiles : state.bgFiles;
  const current   = isModel ? state.looks[lookIdx].model : state.looks[lookIdx].bg;
  const lookName  = state.looks[lookIdx].name;

  DOM.modalTitle.textContent = isModel
    ? `Select Model Face — ${lookName}`
    : `Select Background — ${lookName}`;

  DOM.modalGrid.innerHTML    = '';
  DOM.modalEmpty.classList.add('hidden');
  DOM.modalLoading.classList.remove('hidden');
  DOM.modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  if (!files.length) {
    DOM.modalLoading.classList.add('hidden');
    DOM.modalEmpty.classList.remove('hidden');
    return;
  }

  DOM.modalLoading.classList.add('hidden');
  renderPickerGrid(files, current);
}

function renderPickerGrid(files, current) {
  DOM.modalGrid.innerHTML = '';
  files.forEach(file => {
    const isSelected = current && current.id === file.id;
    const thumbUrl = Drive.loadThumbnail(file);
    const card = document.createElement('div');
    card.className = 'asset-card' + (isSelected ? ' selected' : '');
    card.dataset.fileId = file.id;
    card.innerHTML = `
      <div class="asset-thumb-wrap">
        <img src="${thumbUrl}" alt="${file.name}" onerror="this.parentElement.innerHTML='🖼️'">
      </div>
      <div class="asset-name" title="${file.name}">${file.name}</div>
    `;
    card.addEventListener('click', () => selectAsset(file));
    DOM.modalGrid.appendChild(card);
  });
}

function loadCardThumbnail(card, file) {
  const wrap = card.querySelector('.asset-thumb-wrap');
  const url = Drive.loadThumbnail(file);
  wrap.innerHTML = '';
  const img = document.createElement('img');
  img.src = url;
  img.alt = file.name;
  img.onerror = () => { wrap.innerHTML = '🖼️'; };
  wrap.appendChild(img);
}

function selectAsset(file) {
  const { lookIdx, type } = state.picker;

  DOM.modalGrid.querySelectorAll('.asset-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.fileId === file.id);
  });

  const entry = { id: file.id, name: file.name, blobUrl: Drive.loadThumbnail(file) };

  if (type === 'model') state.looks[lookIdx].model = entry;
  else                  state.looks[lookIdx].bg    = entry;

  closePicker();
  refreshLookCard(lookIdx);
  checkFooter();
  saveLooksState();
}

function closePicker() {
  DOM.modal.classList.add('hidden');
  document.body.style.overflow = '';
  state.picker = null;
}

DOM.modalClose.addEventListener('click', closePicker);
DOM.modalBackdrop.addEventListener('click', closePicker);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !DOM.modal.classList.contains('hidden')) closePicker();
});

// ─── Footer / readiness ───────────────────────────────────────────────────────

function checkFooter() {
  if (!state.looks.length) { DOM.footerS1.classList.add('hidden'); return; }

  const assigned  = state.looks.filter(l => l.model);
  const total     = state.looks.length;
  const allReady  = assigned.length === total;

  DOM.footerS1.classList.remove('hidden');
  DOM.setupSummary.textContent = `${assigned.length} of ${total} looks have a model assigned.`;
  DOM.btnToTagger.disabled = !allReady;

  if (!allReady) {
    DOM.btnToTagger.textContent = `Assign model to all looks to continue (${total - assigned.length} remaining)`;
  } else {
    DOM.btnToTagger.textContent = 'Next: Tag Photos →';
  }
}

DOM.btnToTagger.addEventListener('click', () => {
  if (state.looks.every(l => l.model)) {
    enableNav(2);
    showScreen(2);
    initTagger();
  }
});


// ─── Nav clicks (for already-enabled steps) ───────────────────────────────────

DOM.navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (!btn.disabled) showScreen(parseInt(btn.dataset.screen));
  });
});

function enableNav(n) {
  DOM.navBtns.forEach(btn => {
    if (parseInt(btn.dataset.screen) <= n) btn.disabled = false;
  });
}

// ─── Persist state to localStorage ───────────────────────────────────────────

function saveLastFolder(folderId) {
  try { localStorage.setItem('pdp_last_folder', folderId); } catch {}
}

function getLastFolder() {
  try { return localStorage.getItem('pdp_last_folder'); } catch { return null; }
}

// Save model/bg (Screen 1) and slot assignments (Screen 2) keyed by folder ID
function saveLooksState() {
  if (!state.folderId) return;
  try {
    const payload = state.looks.map(l => ({
      name:   l.name,
      model:  l.model  ? { id: l.model.id,  name: l.model.name  } : null,
      bg:     l.bg     ? { id: l.bg.id,     name: l.bg.name     } : null,
      inputs: l.inputs
        ? Object.fromEntries(
            Object.entries(l.inputs).map(([k, v]) => [k, { id: v.id, name: v.name, source: v.source }])
          )
        : null,
    }));
    localStorage.setItem('pdp_looks_' + state.folderId, JSON.stringify(payload));
  } catch {}
}

// Restore saved assignments after a folder scan rebuilds state.looks
function restoreLooksState() {
  if (!state.folderId) return;
  try {
    const saved = JSON.parse(localStorage.getItem('pdp_looks_' + state.folderId) || 'null');
    if (!saved) return;
    state.looks.forEach(look => {
      const s = saved.find(l => l.name === look.name);
      if (!s) return;
      if (s.model) look.model = { ...s.model, blobUrl: Drive.getThumbnailUrl(s.model.id) };
      if (s.bg)    look.bg    = { ...s.bg,    blobUrl: Drive.getThumbnailUrl(s.bg.id)    };
      if (s.inputs) look.inputs = s.inputs;
    });
  } catch {}
}

// ─── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  showScreen(1);

  // Try silent auto-connect on every page load
  DOM.btnConnectDrive.textContent = 'Connecting…';
  DOM.btnConnectDrive.disabled = true;

  const token = await Drive.connectSilent();

  if (token) {
    setDriveConnected(true);
    DOM.cardFolder.classList.remove('hidden');

    // Restore last folder automatically
    const lastFolder = getLastFolder();
    if (lastFolder) {
      DOM.inputFolder.value = lastFolder;
      await loadFolder();
    }
  } else {
    DOM.btnConnectDrive.disabled = false;
    DOM.btnConnectDrive.textContent = 'Connect Google Drive';
  }
})();
