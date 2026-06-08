/**
 * Google Drive API wrapper for browser use.
 * Uses Google Identity Services (GIS) token flow.
 * Access token is valid ~1 hour; user re-authorizes if expired.
 */

const Drive = (() => {
  let _token = null;
  let _tokenExpiry = 0;
  let _tokenClient = null;
  let _pendingResolve = null;
  let _pendingReject = null;
  const _blobCache = {};

  // ── Wait for GIS library to load ──────────────────────────────────────────

  function waitForGIS() {
    return new Promise((resolve) => {
      if (typeof google !== 'undefined' && google.accounts) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (typeof google !== 'undefined' && google.accounts) {
          clearInterval(check);
          resolve();
        }
      }, 100);
    });
  }

  // ── OAuth token request ───────────────────────────────────────────────────

  function _initTokenClient() {
    if (_tokenClient) return;
    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: CONFIG.DRIVE_SCOPE,
      callback: _handleTokenResponse,
      error_callback: (err) => {
        if (_pendingReject) _pendingReject(new Error(err.type || 'OAuth error'));
        _pendingResolve = null;
        _pendingReject  = null;
      }
    });
  }

  async function connect() {
    await waitForGIS();
    if (isConnected()) return _token;
    return new Promise((resolve, reject) => {
      _pendingResolve = resolve;
      _pendingReject  = reject;
      _initTokenClient();
      _tokenClient.requestAccessToken({ prompt: 'select_account' });
    });
  }

  // Silent connect — no popup, resolves null if user not already authorized
  async function connectSilent() {
    await waitForGIS();
    if (isConnected()) return _token;
    return new Promise((resolve) => {
      _pendingResolve = resolve;
      _pendingReject  = () => resolve(null);
      _initTokenClient();
      // prompt: '' skips account picker + consent if already granted
      _tokenClient.requestAccessToken({ prompt: '' });
      // Timeout fallback — if no response in 3s, assume silent auth not available
      setTimeout(() => {
        if (_pendingResolve) { resolve(null); _pendingResolve = null; _pendingReject = null; }
      }, 3000);
    });
  }

  function _handleTokenResponse(resp) {
    if (resp.error) {
      if (_pendingReject) _pendingReject(new Error(resp.error));
      _pendingResolve = null;
      _pendingReject  = null;
      return;
    }
    _token = resp.access_token;
    _tokenExpiry = Date.now() + (parseInt(resp.expires_in) - 60) * 1000;

    if (_pendingResolve) {
      _pendingResolve(_token);
      _pendingResolve = null;
      _pendingReject  = null;
    }
  }

  function isConnected() {
    return !!_token && Date.now() < _tokenExpiry;
  }

  function getToken() { return _token; }

  // ── Drive REST API helpers ────────────────────────────────────────────────

  async function apiFetch(path, params = {}) {
    const url = new URL(CONFIG.DRIVE_API + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    }
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${_token}` }
    });
    if (!res.ok) {
      let msg = `Drive API ${res.status}`;
      try { msg = (await res.json()).error?.message || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  }

  /** Get metadata for a single file or folder */
  async function getFile(fileId) {
    return apiFetch(`/files/${fileId}`, { fields: 'id,name,mimeType' });
  }

  /** List children of a folder. Optionally filter by mimeType. */
  async function listFolder(folderId, { mimeType, imageOnly } = {}) {
    let q = `'${folderId}' in parents and trashed = false`;
    if (mimeType)    q += ` and mimeType = '${mimeType}'`;
    if (imageOnly)   q += ` and mimeType contains 'image/'`;

    const res = await apiFetch('/files', {
      q,
      fields: 'files(id,name,mimeType,thumbnailLink,size)',
      pageSize: 200,
      orderBy: 'name',
    });
    return res.files || [];
  }

  /** Find a subfolder by exact name (case-sensitive) */
  async function findSubfolder(parentId, name) {
    const q = `'${parentId}' in parents and name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await apiFetch('/files', { q, fields: 'files(id,name)', pageSize: 1 });
    return (res.files || [])[0] || null;
  }

  /** Find subfolders whose names match a RegExp */
  async function findSubfoldersByPattern(parentId, pattern) {
    const all = await listFolder(parentId, { mimeType: 'application/vnd.google-apps.folder' });
    return all
      .filter(f => pattern.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }

  /** Extract a Drive folder ID from a URL or bare ID string */
  function parseFolderId(input) {
    if (!input) return null;
    input = input.trim();
    // Full URL: https://drive.google.com/drive/folders/FOLDER_ID
    // or:      https://drive.google.com/drive/u/0/folders/FOLDER_ID
    const urlMatch = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (urlMatch) return urlMatch[1];
    // Bare ID (alphanumeric + _ -)
    if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
    return null;
  }

  // ── Thumbnail fetching ────────────────────────────────────────────────────

  /**
   * Load an authenticated blob URL for a Drive file.
   * Uses Drive's thumbnailLink first (small preview), falls back to full file.
   * Results are cached.
   */
  /**
   * Returns a thumbnail URL for a Drive file.
   * Uses drive.google.com/thumbnail which:
   * - Returns JPEG for all formats including HEIC (works in all browsers)
   * - No CORS issue for <img> tags (uses browser Google session)
   * - No download needed — fast
   */
  function loadThumbnail(file) {
    return `https://drive.google.com/thumbnail?id=${file.id}&sz=w220`;
  }

  function getThumbnailUrl(fileId) {
    return `https://drive.google.com/thumbnail?id=${fileId}&sz=w220`;
  }

  /** Rename a file in Drive */
  async function renameFile(fileId, newName) {
    const res = await fetch(`${CONFIG.DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: newName }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Rename failed (${res.status})`);
    }
    return res.json();
  }

  /** Silently refresh the token if it has expired */
  async function ensureToken() {
    if (isConnected()) return _token;
    const tok = await connectSilent();
    if (!tok) throw new Error('Google Drive session expired — please reconnect.');
    return tok;
  }

  /** Download a Drive file as a Blob (for upload to Flora) */
  async function downloadFile(fileId) {
    await ensureToken();
    const res = await fetch(`${CONFIG.DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${_token}` }
    });
    if (!res.ok) throw new Error(`Drive download failed (${res.status})`);
    return res.blob();
  }

  return {
    connect,
    connectSilent,
    ensureToken,
    isConnected,
    getToken,
    getFile,
    listFolder,
    findSubfolder,
    findSubfoldersByPattern,
    parseFolderId,
    loadThumbnail,
    getThumbnailUrl,
    renameFile,
    downloadFile,
  };
})();
