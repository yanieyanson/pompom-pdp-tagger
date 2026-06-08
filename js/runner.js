/**
 * Screen 3 — Review & Run
 * Uploads assets to Flora, runs technique, saves outputs to Google Drive.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Flora asset URL cache ────────────────────────────────────────────────────
// Maps Drive file ID → Flora asset URL so re-runs skip re-uploading.
// Flora docs confirm asset URLs are long-lived HTTPS URLs.

const ASSET_CACHE_KEY = 'pdp_flora_asset_cache';

function _assetCache() {
  try { return JSON.parse(localStorage.getItem(ASSET_CACHE_KEY) || '{}'); } catch { return {}; }
}
function _cacheAsset(driveId, floraUrl) {
  try {
    const c = _assetCache();
    c[driveId] = floraUrl;
    localStorage.setItem(ASSET_CACHE_KEY, JSON.stringify(c));
  } catch {}
}
function _getCachedAsset(driveId) {
  return _assetCache()[driveId] || null;
}

// ─── Flora API calls (via Vercel proxy) ───────────────────────────────────────

async function floraReserve(filename, contentType) {
  const res = await fetch(`${CONFIG.API_BASE}/flora?action=reserve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, contentType })
  });
  if (!res.ok) throw new Error(`Flora reserve failed: ${res.status}`);
  return res.json();
}

async function floraComplete(assetId) {
  const res = await fetch(`${CONFIG.API_BASE}/flora?action=complete&assetId=${assetId}`, {
    method: 'POST'
  });
  if (!res.ok) throw new Error(`Flora complete failed: ${res.status}`);
  return res.json();
}

async function floraPollAsset(assetId) {
  for (let i = 0; i < 30; i++) {
    const res  = await fetch(`${CONFIG.API_BASE}/flora?action=asset&assetId=${assetId}`);
    const data = await res.json();
    if (data.status === 'ready')  return data.url;
    if (data.status === 'failed') throw new Error('Asset processing failed');
    await sleep(3000);
  }
  throw new Error('Asset timed out');
}

async function floraRun(inputs) {
  const res = await fetch(`${CONFIG.API_BASE}/flora?action=run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    if (res.status === 402) throw new Error('Not enough Flora credits — top up your Flora workspace at app.flora.ai');
    throw new Error(errData.details?.message || errData.error || `Flora run failed (${res.status})`);
  }
  return res.json();
}

async function floraPollRun(runId, onProgress) {
  const start = Date.now();
  while (Date.now() - start < 1200000) { // 20 min max
    const res  = await fetch(`${CONFIG.API_BASE}/flora?action=run-status&runId=${runId}`);
    const data = await res.json();
    if (data.status === 'completed') return data;
    if (data.status === 'failed')    throw new Error(data.error_message || data.error_code || 'Run failed');
    onProgress(data.progress || 0);
    await sleep(10000);
  }
  throw new Error(`Timed out after 20 min — check Flora dashboard for run ${runId}`);
}

// ─── Upload a Drive file to Flora ─────────────────────────────────────────────

async function uploadDriveFileToFlora(fileId, filename, updateStatus) {
  // Return cached URL if we've already uploaded this file
  const cached = _getCachedAsset(fileId);
  if (cached) {
    updateStatus && updateStatus(`Using cached asset for ${filename}`);
    return cached;
  }

  const ext         = filename.split('.').pop().toLowerCase();
  const mimeTypes   = { heic:'image/heic', heif:'image/heif', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp' };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  // 1. Download from Drive
  const blob = await Drive.downloadFile(fileId);

  // 2. Reserve Flora upload slot
  const { asset_id, upload } = await floraReserve(filename, contentType);

  // 3. Upload directly to signed URL (S3 presigned POST)
  const formFields = upload.form_fields || upload.formFields || {};
  const fileField  = upload.file_field  || upload.fileField  || 'file';
  const form = new FormData();
  for (const [k, v] of Object.entries(formFields)) form.append(k, v);
  form.append(fileField, blob, filename);
  const uploadRes = await fetch(upload.url, { method: 'POST', body: form });
  if (!uploadRes.ok && uploadRes.status !== 204) {
    throw new Error(`S3 upload failed: ${uploadRes.status}`);
  }

  // 4. Complete & wait for asset to be ready
  await floraComplete(asset_id);
  const url = await floraPollAsset(asset_id);

  // Cache the URL so future runs skip this upload
  _cacheAsset(fileId, url);
  return url;
}

// ─── Drive output helpers ─────────────────────────────────────────────────────

async function getOrCreateOutputFolder() {
  await Drive.ensureToken();
  const q = `'${state.folderId}' in parents and name = 'PDP Outputs' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await fetch(`${CONFIG.DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${Drive.getToken()}` }
  });
  const { files } = await res.json();
  if (files && files.length) return files[0].id;

  // Create it
  const create = await fetch(`${CONFIG.DRIVE_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Drive.getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'PDP Outputs', mimeType: 'application/vnd.google-apps.folder', parents: [state.folderId] })
  });
  return (await create.json()).id;
}

async function uploadOutputToDrive(url, filename, folderId) {
  await Drive.ensureToken();
  const res  = await fetch(url);
  const blob = await res.blob();

  // Upload to Drive via multipart
  const meta  = JSON.stringify({ name: filename, parents: [folderId] });
  const form  = new FormData();
  form.append('metadata', new Blob([meta], { type: 'application/json' }));
  form.append('file', blob, filename);

  const upload = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Drive.getToken()}` },
    body: form
  });
  const data = await upload.json();

  // Make shareable
  await fetch(`${CONFIG.DRIVE_API}/files/${data.id}/permissions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${Drive.getToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });

  return `https://drive.google.com/file/d/${data.id}/view`;
}

// ─── Build Flora inputs with fallbacks ────────────────────────────────────────

function buildInputsWithFallbacks(inputs) {
  const resolved = { ...inputs };
  // Fallbacks for missing slots
  if (!resolved['sku-bottom']  && resolved['sku-top'])    resolved['sku-bottom']  = resolved['sku-top'];
  if (!resolved['accessories'] && resolved['sku-top'])    resolved['accessories'] = resolved['sku-top'];
  return resolved;
}

// ─── Run a single look ────────────────────────────────────────────────────────

async function runLook(lookIdx, updateStatus) {
  const look     = state.looks[lookIdx];
  const inputs   = buildInputsWithFallbacks(look.inputs || {});
  const required = ['sku-top', 'model-face', 'background'];

  for (const r of required) {
    if (!inputs[r]) throw new Error(`Missing required slot: ${r}`);
  }

  const SLOT_ORDER = ['sku-top', 'sku-bottom', 'footwear', 'accessories', 'model-face', 'background'];
  const assetUrls  = {};

  // Upload each assigned slot to Flora
  const slots = SLOT_ORDER.filter(s => inputs[s]);
  for (let i = 0; i < slots.length; i++) {
    const slotId = slots[i];
    const file   = inputs[slotId];
    const cached = _getCachedAsset(file.id);
    updateStatus(cached
      ? `${slotId} (${i + 1}/${slots.length}) — cached ✓`
      : `Uploading ${slotId} (${i + 1}/${slots.length})…`);
    assetUrls[slotId] = await uploadDriveFileToFlora(file.id, file.name, updateStatus);
  }

  // Build technique inputs array
  const techniqueInputs = SLOT_ORDER
    .filter(s => assetUrls[s])
    .map(s => ({ id: s, type: 'imageUrl', value: assetUrls[s] }));

  // Add frontal prompt
  techniqueInputs.push({
    id: 'straight-on-full-body-frontal-prompt',
    type: 'text',
    value: CONFIG.FRONTAL_PROMPT
  });

  // Fire technique
  updateStatus('Starting Flora technique…');
  const { run_id } = await floraRun(techniqueInputs);

  // Poll
  updateStatus('Running…');
  const completed = await floraPollRun(run_id, (progress) => {
    updateStatus(`Flora running… ${Math.round(progress)}%`);
  });

  // Save outputs to Drive
  updateStatus('Saving outputs to Drive…');
  const outputFolder = await getOrCreateOutputFolder();
  const links = {};

  for (const output of completed.outputs || []) {
    const filename = output.output_id === 'model-frontal-photo'
      ? `${look.name}_frontal_v1.jpg`
      : `${look.name}_side_v1.jpg`;
    const link = await uploadOutputToDrive(output.url, filename, outputFolder);
    links[output.output_id] = link;
  }

  return { runId: run_id, links };
}

// ─── Run result tracking ──────────────────────────────────────────────────────

const _runResults = {}; // idx → 'done' | 'failed' | 'skip'

// ─── Screen 3 init ────────────────────────────────────────────────────────────

function initRunScreen() {
  renderRunReview();
  document.getElementById('btn-run-all').addEventListener('click', runAll);
  document.getElementById('btn-back-s2').addEventListener('click', () => showScreen(2));
}

function renderRunReview() {
  const container = document.getElementById('run-review');
  const SLOT_LABELS = {
    'sku-top':     'Top',
    'sku-bottom':  'Bottom',
    'footwear':    'Shoe',
    'accessories': 'Acc',
    'model-face':  'Model',
    'background':  'BG',
  };
  const SLOTS = Object.keys(SLOT_LABELS);

  let html = `<div class="review-table">
    <div class="review-header">
      <div class="review-cell">Look</div>
      ${SLOTS.map(s => `<div class="review-cell">${SLOT_LABELS[s]}</div>`).join('')}
      <div class="review-cell">Status</div>
    </div>`;

  state.looks.forEach((look, idx) => {
    const inputs   = buildInputsWithFallbacks(look.inputs || {});
    const allReady = ['sku-top','model-face','background'].every(s => inputs[s]);
    html += `<div class="review-row" id="review-row-${idx}">
      <div class="review-cell review-look-name">${look.name}</div>
      ${SLOTS.map(s => {
        const f = inputs[s];
        return `<div class="review-cell">
          ${f ? `<img class="review-thumb" src="${Drive.getThumbnailUrl(f.id)}" title="${f.name}" onerror="this.style.opacity=0.2">` : '<span class="review-missing">—</span>'}
        </div>`;
      }).join('')}
      <div class="review-cell">
        <span class="run-badge ${allReady ? 'ready' : 'warn'}" id="run-badge-${idx}">
          ${allReady ? 'Ready' : 'Missing slots'}
        </span>
      </div>
    </div>`;
  });

  html += '</div>';
  container.innerHTML = html;

  updateCostEst();
}

function updateCostEst() {
  const failedIndices = _getFailedIndices();
  const readyCount = failedIndices.length > 0
    ? failedIndices.length
    : state.looks.filter(l => {
        const inp = buildInputsWithFallbacks(l.inputs || {});
        return ['sku-top','model-face','background'].every(s => inp[s]);
      }).length;
  const label = failedIndices.length > 0 ? 'failed look' : 'look';
  document.getElementById('run-cost-est').textContent =
    `${readyCount} ${label}${readyCount !== 1 ? 's' : ''} · ~$${(readyCount * CONFIG.COST_PER_RUN).toFixed(2)} estimated`;
}

function _getFailedIndices() {
  return Object.entries(_runResults)
    .filter(([, r]) => r === 'failed')
    .map(([i]) => parseInt(i));
}

async function _executeRun(indices) {
  try {
    await Drive.ensureToken();
  } catch (e) {
    showToast('Drive session expired — please reconnect Google Drive', 'error');
    return;
  }

  const list = document.getElementById('run-status-list');
  list.classList.remove('hidden');

  // Build or reset status rows for this batch
  for (const idx of indices) {
    let row = document.getElementById(`status-row-${idx}`);
    if (!row) {
      row = document.createElement('div');
      row.id = `status-row-${idx}`;
      list.appendChild(row);
    }
    row.className = 'run-status-row';
    row.innerHTML = `
      <div class="run-status-look">${state.looks[idx].name}</div>
      <div class="run-status-msg" id="status-msg-${idx}">Pending</div>
      <div class="run-status-icon" id="status-icon-${idx}">·</div>
      <div class="run-status-links" id="status-links-${idx}"></div>
    `;
  }

  for (const idx of indices) {
    const inputs = buildInputsWithFallbacks(state.looks[idx].inputs || {});
    if (!['sku-top','model-face','background'].every(s => inputs[s])) {
      setStatus(idx, 'Skipped — missing required slots', 'skip');
      _runResults[idx] = 'skip';
      continue;
    }

    setStatus(idx, 'Starting…', 'running');
    try {
      const { runId, links } = await runLook(idx, msg => setStatus(idx, msg, 'running'));
      setStatus(idx, '✓ Done', 'done');
      showOutputLinks(idx, links);
      _runResults[idx] = 'done';
    } catch (e) {
      setStatus(idx, '✗ ' + e.message, 'failed');
      _runResults[idx] = 'failed';
    }
  }
}

async function runAll() {
  const btn = document.getElementById('btn-run-all');
  btn.disabled = true;
  btn.textContent = 'Running…';

  // Clear previous results and rebuild full status list
  Object.keys(_runResults).forEach(k => delete _runResults[k]);
  document.getElementById('run-status-list').innerHTML = '';

  const allIndices = state.looks.map((_, i) => i);
  await _executeRun(allIndices);

  btn.textContent = 'Run Complete';
  _updateRetryButton();
}

async function runFailed() {
  const failedIndices = _getFailedIndices();
  if (!failedIndices.length) return;

  const btn      = document.getElementById('btn-run-all');
  const btnRetry = document.getElementById('btn-retry-failed');
  btn.disabled = true;
  if (btnRetry) { btnRetry.disabled = true; btnRetry.textContent = 'Retrying…'; }

  // Clear failed results so they get re-evaluated
  failedIndices.forEach(idx => delete _runResults[idx]);

  await _executeRun(failedIndices);

  btn.disabled = false;
  btn.textContent = 'Run Complete';
  _updateRetryButton();
}

function _updateRetryButton() {
  const failedCount = _getFailedIndices().length;
  let btnRetry = document.getElementById('btn-retry-failed');

  if (failedCount === 0) {
    if (btnRetry) btnRetry.remove();
    return;
  }

  if (!btnRetry) {
    btnRetry = document.createElement('button');
    btnRetry.id = 'btn-retry-failed';
    btnRetry.className = 'btn btn-outline btn-lg';
    btnRetry.addEventListener('click', runFailed);
    document.getElementById('run-controls').appendChild(btnRetry);
  }
  btnRetry.disabled = false;
  btnRetry.textContent = `Re-run Failed (${failedCount})`;
  updateCostEst();
}

function setStatus(idx, msg, state) {
  const msgEl  = document.getElementById(`status-msg-${idx}`);
  const iconEl = document.getElementById(`status-icon-${idx}`);
  const row    = document.getElementById(`status-row-${idx}`);
  if (msgEl) msgEl.textContent = msg;
  if (row) row.className = `run-status-row ${state}`;
  if (iconEl) {
    iconEl.innerHTML = state === 'running' ? '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div>'
      : state === 'done'    ? '✓'
      : state === 'failed'  ? '✗'
      : state === 'skip'    ? '–'
      : '·';
  }
}

function showOutputLinks(idx, links) {
  const el = document.getElementById(`status-links-${idx}`);
  if (!el) return;
  const linksHtml = Object.entries(links).map(([key, url]) => {
    const label = key === 'model-frontal-photo' ? 'Frontal' : 'Side';
    return `<a href="${url}" target="_blank" class="output-link">${label} →</a>`;
  }).join('');
  el.innerHTML = linksHtml;
}
