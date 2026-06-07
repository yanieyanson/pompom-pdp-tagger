/**
 * Screen 2 — Photo Tagger
 * Tags garment photos by type + angle, renames files in Google Drive.
 */

// ─── Tagger state ─────────────────────────────────────────────────────────────

const tagger = {
  lookIdx:    0,
  photoIdx:   0,
  photos:     [],    // all image files for current look
  type:       null,  // selected garment type (e.g. 'TOP')
  angle:      null,  // selected angle (e.g. 'front')
  busy:       false, // renaming in progress
};

// Types that don't need an angle
const NO_ANGLE_TYPES = new Set(['SHOE']);

// Regex to detect already-tagged filenames
const TAGGED_RE = /^L\d+_(TOP|BOTTOM|DRESS|SHOE|ACC)(_[a-z]+)?\.[a-zA-Z0-9]+$/;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

function tDOM(id) { return document.getElementById(id); }

const T = {
  tabs:         () => tDOM('look-tabs'),
  frame:        () => tDOM('photo-frame'),
  img:          () => tDOM('photo-img'),
  taggedBadge:  () => tDOM('photo-tagged-badge'),
  emptyState:   () => tDOM('photo-empty'),
  counter:      () => tDOM('photo-counter'),
  filename:     () => tDOM('photo-filename'),
  btnPrev:      () => tDOM('btn-prev-photo'),
  btnNext:      () => tDOM('btn-next-photo'),
  btnSkip:      () => tDOM('btn-skip-photo'),
  btnBackS1:    () => tDOM('btn-back-s1'),
  typeButtons:  () => tDOM('type-buttons'),
  angleSection: () => tDOM('angle-section'),
  angleButtons: () => tDOM('angle-buttons'),
  hint:         () => tDOM('tag-hint'),
  progress:     () => tDOM('look-progress'),
  footerS2:     () => tDOM('footer-s2'),
  taggerSummary:() => tDOM('tagger-summary'),
  btnToRun:     () => tDOM('btn-to-run'),
};

// ─── Init ─────────────────────────────────────────────────────────────────────

function initTagger() {
  renderLookTabs();
  loadLook(tagger.lookIdx);
  bindTaggerEvents();
}

// ─── Look tabs ────────────────────────────────────────────────────────────────

function renderLookTabs() {
  const bar = T.tabs();
  bar.innerHTML = '';
  state.looks.forEach((look, idx) => {
    const tagged  = (look.files || []).filter(f => TAGGED_RE.test(f.name)).length;
    const total   = (look.files || []).length;
    const done    = total > 0 && tagged === total;
    const btn     = document.createElement('button');
    btn.className = 'look-tab' + (idx === tagger.lookIdx ? ' active' : '') + (done ? ' done' : '');
    btn.innerHTML = `${look.name} <span class="tab-badge">${tagged}/${total}</span>`;
    btn.addEventListener('click', () => {
      tagger.lookIdx = idx;
      loadLook(idx);
      renderLookTabs();
    });
    bar.appendChild(btn);
  });
}

// ─── Load a look ──────────────────────────────────────────────────────────────

async function loadLook(idx) {
  const look = state.looks[idx];
  tagger.lookIdx = idx;

  // Fetch files if not yet loaded
  if (!look.files) {
    look.files = await Drive.listFolder(look.folderId, { imageOnly: true });
  }

  tagger.photos = look.files;

  // Start at first untagged photo
  const firstUntagged = tagger.photos.findIndex(f => !TAGGED_RE.test(f.name));
  tagger.photoIdx = firstUntagged >= 0 ? firstUntagged : 0;

  resetTagSelection();
  showPhoto(tagger.photoIdx);
  updateProgress();
  checkTaggerFooter();
}

// ─── Show a photo ─────────────────────────────────────────────────────────────

function showPhoto(idx) {
  if (!tagger.photos.length) {
    T.img().src = '';
    T.emptyState().classList.remove('hidden');
    T.img().classList.add('hidden');
    T.counter().textContent = '0 of 0';
    T.filename().textContent = '';
    return;
  }

  T.emptyState().classList.add('hidden');
  T.img().classList.remove('hidden');

  tagger.photoIdx = Math.max(0, Math.min(idx, tagger.photos.length - 1));
  const file = tagger.photos[tagger.photoIdx];

  // Use large thumbnail for tagger view
  T.img().src = `https://drive.google.com/thumbnail?id=${file.id}&sz=w1200`;
  T.img().alt = file.name;
  T.counter().textContent = `${tagger.photoIdx + 1} of ${tagger.photos.length}`;
  T.filename().textContent = file.name;

  // Show tagged badge if already tagged
  const isTagged = TAGGED_RE.test(file.name);
  const badge = T.taggedBadge();
  if (isTagged) {
    badge.textContent = '✓ Tagged: ' + file.name;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  // Pre-fill type/angle if already tagged
  if (isTagged) {
    const parts = file.name.split('_');
    const type  = parts[1] || null;
    const angle = parts[2] ? parts[2].split('.')[0] : null;
    setTypeUI(type);
    setAngleUI(angle);
  } else {
    resetTagSelection();
  }

  updateNavButtons();
}

function updateNavButtons() {
  T.btnPrev().disabled = tagger.photoIdx === 0;
  T.btnNext().disabled = tagger.photoIdx >= tagger.photos.length - 1;
}

// ─── Tag controls ─────────────────────────────────────────────────────────────

function resetTagSelection() {
  tagger.type  = null;
  tagger.angle = null;
  setTypeUI(null);
  setAngleUI(null);
  T.angleSection().classList.add('hidden');
  T.hint().textContent = 'Select a garment type to begin.';
}

function setTypeUI(type) {
  tagger.type = type;
  T.typeButtons().querySelectorAll('.tag-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.type === type);
  });
}

function setAngleUI(angle) {
  tagger.angle = angle;
  T.angleButtons().querySelectorAll('.tag-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.angle === angle);
  });
}

function onTypeSelect(type) {
  setTypeUI(type);
  tagger.angle = null;
  setAngleUI(null);

  if (NO_ANGLE_TYPES.has(type)) {
    // No angle needed — apply immediately
    T.angleSection().classList.add('hidden');
    T.hint().textContent = `Footwear selected — tagging…`;
    applyTag();
  } else {
    T.angleSection().classList.remove('hidden');
    T.hint().textContent = `Now select the angle.`;
  }
}

function onAngleSelect(angle) {
  if (!tagger.type) {
    T.hint().textContent = 'Select a garment type first.';
    return;
  }
  setAngleUI(angle);
  T.hint().textContent = `${tagger.type} · ${angle} — tagging…`;
  applyTag();
}

// ─── Apply tag (rename file in Drive) ────────────────────────────────────────

async function applyTag() {
  if (tagger.busy) return;
  const file = tagger.photos[tagger.photoIdx];
  if (!file) return;

  const look     = state.looks[tagger.lookIdx];
  const ext      = file.name.split('.').pop().toLowerCase();
  const newName  = NO_ANGLE_TYPES.has(tagger.type)
    ? `${look.name}_${tagger.type}.${ext}`
    : `${look.name}_${tagger.type}_${tagger.angle}.${ext}`;

  tagger.busy = true;
  T.hint().textContent = `Saving as ${newName}…`;

  try {
    await Drive.renameFile(file.id, newName);
    // Update local file name so badge updates instantly
    file.name = newName;
    showToast(`✓ Saved as ${newName}`);
    renderLookTabs();
    updateProgress();
    checkTaggerFooter();
    // Advance to next untagged
    advanceToNextUntagged();
  } catch (e) {
    showToast('Rename failed: ' + e.message, 'error');
    T.hint().textContent = 'Error — try again.';
  } finally {
    tagger.busy = false;
  }
}

function advanceToNextUntagged() {
  const photos = tagger.photos;
  // Look for next untagged after current position
  for (let i = tagger.photoIdx + 1; i < photos.length; i++) {
    if (!TAGGED_RE.test(photos[i].name)) {
      showPhoto(i);
      resetTagSelection();
      return;
    }
  }
  // No more untagged after current — check before current
  for (let i = 0; i < tagger.photoIdx; i++) {
    if (!TAGGED_RE.test(photos[i].name)) {
      showPhoto(i);
      resetTagSelection();
      return;
    }
  }
  // All tagged — stay on current, show completion state
  showPhoto(tagger.photoIdx);
  T.hint().textContent = 'All photos in this look are tagged ✓';
}

// ─── Progress ─────────────────────────────────────────────────────────────────

function updateProgress() {
  const look    = state.looks[tagger.lookIdx];
  const files   = look.files || [];
  const tagged  = files.filter(f => TAGGED_RE.test(f.name)).length;
  const total   = files.length;
  T.progress().innerHTML = `
    <div class="progress-bar-wrap">
      <div class="progress-bar" style="width:${total ? (tagged/total*100) : 0}%"></div>
    </div>
    <span class="progress-label">${tagged} of ${total} tagged in ${look.name}</span>
  `;
}

function checkTaggerFooter() {
  const anyTagged = state.looks.some(l =>
    (l.files || []).some(f => TAGGED_RE.test(f.name))
  );
  const footer = T.footerS2();
  footer.classList.toggle('hidden', !anyTagged);
  if (anyTagged) {
    const totalTagged = state.looks.reduce((sum, l) =>
      sum + (l.files || []).filter(f => TAGGED_RE.test(f.name)).length, 0);
    T.taggerSummary().textContent = `${totalTagged} photo${totalTagged !== 1 ? 's' : ''} tagged across all looks.`;
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

function bindTaggerEvents() {
  T.btnPrev().addEventListener('click', () => {
    showPhoto(tagger.photoIdx - 1);
    resetTagSelection();
  });
  T.btnNext().addEventListener('click', () => {
    showPhoto(tagger.photoIdx + 1);
    resetTagSelection();
  });
  T.btnSkip().addEventListener('click', () => {
    showPhoto(tagger.photoIdx + 1);
    resetTagSelection();
  });
  T.btnBackS1().addEventListener('click', () => {
    if (typeof showScreen === 'function') showScreen(1);
  });
  T.typeButtons().addEventListener('click', e => {
    const btn = e.target.closest('.tag-btn[data-type]');
    if (btn && !tagger.busy) onTypeSelect(btn.dataset.type);
  });
  T.angleButtons().addEventListener('click', e => {
    const btn = e.target.closest('.tag-btn[data-angle]');
    if (btn && !tagger.busy) onAngleSelect(btn.dataset.angle);
  });
  T.btnToRun().addEventListener('click', () => {
    if (typeof showScreen === 'function') {
      enableNav(3);
      showScreen(3);
    }
  });

  // Keyboard shortcuts: 1-5 for type, F/B/S/D for angle
  document.addEventListener('keydown', handleTaggerKey);
}

function handleTaggerKey(e) {
  if (tDOM('screen-2').classList.contains('hidden')) return;
  if (tagger.busy) return;
  const map = { '1':'TOP','2':'BOTTOM','3':'DRESS','4':'SHOE','5':'ACC' };
  const angleMap = { 'f':'front','b':'back','s':'side','d':'detail' };
  const key = e.key.toLowerCase();
  if (map[e.key])         onTypeSelect(map[e.key]);
  else if (angleMap[key]) onAngleSelect(angleMap[key]);
  else if (key === 'arrowleft')  { showPhoto(tagger.photoIdx - 1); resetTagSelection(); }
  else if (key === 'arrowright') { showPhoto(tagger.photoIdx + 1); resetTagSelection(); }
}
