/**
 * Screen 2 — Assign & Check
 * Auto-detects Flora input slots from filenames, lets user override any slot.
 * No Drive renaming — assignments live in app state only.
 */

// ─── Flora input slots ────────────────────────────────────────────────────────

const SLOTS = [
  { id: 'sku-top',     label: 'SKU Top',     desc: 'Garment front view' },
  { id: 'sku-bottom',  label: 'SKU Bottom',  desc: 'Garment back view'  },
  { id: 'footwear',    label: 'Footwear',    desc: 'Shoes'              },
  { id: 'accessories', label: 'Accessory',   desc: 'Side / detail view' },
  { id: 'model-face',  label: 'Model Face',  desc: 'Character reference'},
  { id: 'background',  label: 'Background',  desc: 'Backdrop reference' },
];

// Keyword → slot mapping (mirrors run_pdp.js FILENAME_MAP)
const DETECT_RULES = [
  { slot: 'sku-top',     keywords: ['top_front', 'front'] },
  { slot: 'sku-bottom',  keywords: ['top_back',  'back']  },
  { slot: 'footwear',    keywords: ['shoe']               },
  { slot: 'accessories', keywords: ['top_side',  'side', 'acc'] },
  { slot: 'model-face',  keywords: ['model']              },
  { slot: 'background',  keywords: ['_bg', 'background']  },
];

// ─── Tagger state ─────────────────────────────────────────────────────────────

const tagger = {
  lookIdx: 0,
  // pending picker: { lookIdx, slotId }
  pendingSlot: null,
};

// ─── Auto-detect assignments from filenames ───────────────────────────────────

function detectAssignments(look) {
  const inputs = look.inputs || {};

  // All candidate files: look folder files + model + bg from Screen 1
  const lookFiles = look.files || [];
  const allFiles  = [...lookFiles];

  // Pre-fill model-face and background from Screen 1 selections
  if (!inputs['model-face'] && look.model) {
    inputs['model-face'] = { id: look.model.id, name: look.model.name, source: 'setup' };
  }
  if (!inputs['background'] && look.bg) {
    inputs['background'] = { id: look.bg.id, name: look.bg.name, source: 'setup' };
  }

  // Auto-detect remaining slots from look folder filenames
  for (const file of lookFiles) {
    const lower = file.name.toLowerCase();
    for (const rule of DETECT_RULES) {
      if (inputs[rule.slot]) continue; // already assigned
      if (rule.keywords.some(k => lower.includes(k))) {
        inputs[rule.slot] = { id: file.id, name: file.name, source: 'auto' };
        break;
      }
    }
  }

  look.inputs = inputs;
  return inputs;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function initTagger() {
  // Detect assignments for all looks upfront
  state.looks.forEach(look => detectAssignments(look));

  renderLookTabs();
  renderAssignmentGrid(tagger.lookIdx);
  bindTaggerEvents();
}

function renderLookTabs() {
  const bar = document.getElementById('look-tabs');
  bar.innerHTML = '';
  state.looks.forEach((look, idx) => {
    const filled  = SLOTS.filter(s => look.inputs?.[s.id]).length;
    const total   = SLOTS.length;
    const allDone = filled === total;
    const btn     = document.createElement('button');
    btn.className = 'look-tab' + (idx === tagger.lookIdx ? ' active' : '') + (allDone ? ' done' : '');
    btn.innerHTML = `${look.name} <span class="tab-badge">${filled}/${total}</span>`;
    btn.addEventListener('click', () => {
      tagger.lookIdx = idx;
      renderLookTabs();
      renderAssignmentGrid(idx);
    });
    bar.appendChild(btn);
  });
}

function renderAssignmentGrid(idx) {
  const look    = state.looks[idx];
  const inputs  = look.inputs || {};
  const grid    = document.getElementById('assignment-grid');

  grid.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'assignment-card';

  // Look header with file count
  const fileCount = (look.files || []).length;
  card.innerHTML = `
    <div class="assignment-header">
      <h2>${look.name}</h2>
      <span class="look-badge">${fileCount} file${fileCount !== 1 ? 's' : ''} in folder</span>
    </div>
  `;

  SLOTS.forEach(slot => {
    const assigned = inputs[slot.id];
    const row      = document.createElement('div');
    row.className  = 'slot-row' + (assigned ? '' : ' slot-missing');

    const thumbUrl = assigned
      ? `https://drive.google.com/thumbnail?id=${assigned.id}&sz=w120`
      : null;

    const sourceBadge = assigned?.source === 'auto'
      ? `<span class="source-badge auto">auto</span>`
      : assigned?.source === 'setup'
      ? `<span class="source-badge setup">setup</span>`
      : assigned
      ? `<span class="source-badge manual">manual</span>`
      : '';

    row.innerHTML = `
      <div class="slot-thumb">
        ${thumbUrl
          ? `<img src="${thumbUrl}" alt="${slot.label}" onerror="this.parentElement.innerHTML='🖼️'">`
          : `<div class="slot-thumb-empty">?</div>`}
      </div>
      <div class="slot-info">
        <div class="slot-label">${slot.label} ${sourceBadge}</div>
        <div class="slot-filename">${assigned ? assigned.name : '— not assigned'}</div>
        <div class="slot-desc">${slot.desc}</div>
      </div>
      <div class="slot-status">
        ${assigned
          ? `<span class="status-icon ok">✓</span>`
          : `<span class="status-icon warn">!</span>`}
      </div>
      <button class="btn btn-outline btn-sm slot-change-btn"
              data-look="${idx}" data-slot="${slot.id}">
        Change
      </button>
    `;

    card.appendChild(row);
  });

  grid.appendChild(card);

  // Summary line
  const filled  = SLOTS.filter(s => inputs[s.id]).length;
  const missing = SLOTS.filter(s => !inputs[s.id]).map(s => s.label);
  const summary = document.createElement('div');
  summary.className = 'assignment-summary';
  if (missing.length) {
    summary.innerHTML = `<span class="warn-text">Missing: ${missing.join(', ')}</span> — you can still run without them.`;
  } else {
    summary.innerHTML = `<span class="ok-text">✓ All slots assigned for ${look.name}</span>`;
  }
  grid.appendChild(summary);

  checkFooterS2();
}

function checkFooterS2() {
  // Show footer once every look has at least sku-top assigned
  const ready = state.looks.every(l => l.inputs?.['sku-top']);
  document.getElementById('footer-s2').classList.toggle('hidden', !ready);
}

// ─── Slot change picker ───────────────────────────────────────────────────────

function openSlotPicker(lookIdx, slotId) {
  tagger.pendingSlot = { lookIdx, slotId };

  const slot  = SLOTS.find(s => s.id === slotId);
  const look  = state.looks[lookIdx];

  // Build combined file list: look folder files + root model/bg files
  const lookFiles = look.files || [];
  const rootFiles = [...state.modelFiles, ...state.bgFiles].filter(
    f => !lookFiles.some(lf => lf.id === f.id)
  );
  const allFiles = [...lookFiles, ...rootFiles];

  // Reuse existing modal from Screen 1
  const current = look.inputs?.[slotId] || null;

  document.getElementById('modal-title').textContent = `Change ${slot.label} — ${look.name}`;
  document.getElementById('modal-grid').innerHTML    = '';
  document.getElementById('modal-empty').classList.add('hidden');
  document.getElementById('modal-loading').classList.add('hidden');
  document.getElementById('modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  const grid = document.getElementById('modal-grid');
  allFiles.forEach(file => {
    const isSelected = current && current.id === file.id;
    const thumbUrl   = Drive.loadThumbnail(file);
    const card       = document.createElement('div');
    card.className   = 'asset-card' + (isSelected ? ' selected' : '');
    card.dataset.fileId = file.id;
    card.innerHTML   = `
      <div class="asset-thumb-wrap">
        <img src="${thumbUrl}" alt="${file.name}" onerror="this.parentElement.innerHTML='🖼️'">
      </div>
      <div class="asset-name" title="${file.name}">${file.name}</div>
    `;
    card.addEventListener('click', () => assignSlot(file));
    grid.appendChild(card);
  });

  if (!allFiles.length) {
    document.getElementById('modal-empty').classList.remove('hidden');
  }
}

function assignSlot(file) {
  const { lookIdx, slotId } = tagger.pendingSlot;
  const look = state.looks[lookIdx];
  look.inputs = look.inputs || {};
  look.inputs[slotId] = { id: file.id, name: file.name, source: 'manual' };

  // Close modal
  document.getElementById('modal').classList.add('hidden');
  document.body.style.overflow = '';
  tagger.pendingSlot = null;

  renderLookTabs();
  renderAssignmentGrid(lookIdx);
  showToast(`✓ ${SLOTS.find(s => s.id === slotId)?.label} updated`);
  if (typeof saveLooksState === 'function') saveLooksState();
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindTaggerEvents() {
  // Slot change buttons (delegated)
  document.getElementById('assignment-grid').addEventListener('click', e => {
    const btn = e.target.closest('.slot-change-btn');
    if (btn) openSlotPicker(parseInt(btn.dataset.look), btn.dataset.slot);
  });

  document.getElementById('btn-back-s1').addEventListener('click', () => showScreen(1));
  document.getElementById('btn-to-run').addEventListener('click', () => {
    enableNav(3);
    showScreen(3);
    if (typeof initRunScreen === 'function') initRunScreen();
  });

  // Modal close reuses Screen 1 handlers — already bound in app.js
}
