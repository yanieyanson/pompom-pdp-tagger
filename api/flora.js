/**
 * Vercel serverless function — Flora API proxy.
 * Keeps FLORA_API_KEY server-side.
 *
 * Endpoints (all via query ?action=...):
 *   POST ?action=reserve      → Reserve an asset upload slot
 *   POST ?action=complete     → Mark asset upload complete
 *   GET  ?action=asset        → Get asset status + URL
 *   POST ?action=run          → Create a technique run
 *   GET  ?action=run-status   → Poll a technique run
 */

const FLORA_BASE = 'https://app.flora.ai/api/v1';
const TECHNIQUE  = 'pdp-product-shot-generator';

function floraHeaders(extra = {}) {
  return {
    Authorization: `Bearer ${process.env.FLORA_API_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function floraFetch(path, options = {}) {
  const url = `${FLORA_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { ...floraHeaders(), ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw Object.assign(new Error(data?.message || `Flora ${res.status}`), { status: res.status, data });
  }
  return data;
}

module.exports = async function handler(req, res) {
  // CORS — allow the browser app to call this from any origin during dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, assetId, runId } = req.query;

  try {
    // ── POST ?action=reserve ──────────────────────────────────────────────────
    // Body: { filename, contentType }
    // Returns: { asset_id, upload: { url, form_fields, file_field } }
    if (req.method === 'POST' && action === 'reserve') {
      const { filename, contentType } = req.body;
      const data = await floraFetch('/assets', {
        method: 'POST',
        body: JSON.stringify({
          source:       'signed-url',
          workspace_id: process.env.FLORA_WORKSPACE || 'ws_qd7amwxs2qks9ywzt57zrpabr586rhj6',
          file_name:    filename,
          content_type: contentType,
        }),
      });
      return res.json(data);
    }

    // ── POST ?action=complete&assetId=... ─────────────────────────────────────
    // Returns Flora asset completion response
    if (req.method === 'POST' && action === 'complete' && assetId) {
      const data = await floraFetch(`/assets/${assetId}/complete`, { method: 'POST' });
      return res.json(data);
    }

    // ── GET ?action=asset&assetId=... ─────────────────────────────────────────
    // Returns: { asset_id, status, url, failure_message }
    if (req.method === 'GET' && action === 'asset' && assetId) {
      const data = await floraFetch(`/assets/${assetId}`);
      return res.json(data);
    }

    // ── POST ?action=run ──────────────────────────────────────────────────────
    // Body: { inputs: [{ id, type, value }], project_id }
    // Returns: { run_id, status }
    if (req.method === 'POST' && action === 'run') {
      const { inputs, project_id } = req.body;
      const data = await floraFetch(`/techniques/${TECHNIQUE}/runs`, {
        method: 'POST',
        body: JSON.stringify({ inputs, mode: 'async', project_id }),
      });
      return res.json(data);
    }

    // ── GET ?action=run-status&runId=... ──────────────────────────────────────
    // Returns: { run_id, status, progress, outputs, error_message }
    if (req.method === 'GET' && action === 'run-status' && runId) {
      const data = await floraFetch(`/techniques/${TECHNIQUE}/runs/${runId}`);
      return res.json(data);
    }

    return res.status(400).json({ error: 'Unknown action or missing parameters' });

  } catch (err) {
    console.error('[flora proxy]', err.message, err.data);
    return res.status(err.status || 500).json({ error: err.message, details: err.data });
  }
};
