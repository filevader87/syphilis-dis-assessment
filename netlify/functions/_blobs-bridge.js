/* Blobs bridge: REST API with proper presigned URL handling */
const SITE_ID = process.env.SITE_ID || '21fd2f38-d3e8-4f3e-b48b-fc98f00b0bdc';
const TOKEN = process.env.NETLIFY_AUTH_TOKEN || '';
const API = TOKEN ? `https://api.netlify.com/api/v1/sites/${SITE_ID}/blobs/submissions` : '';
const HDR = TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};

// Try SDK first
let sdk = null;
try { const { getStore } = require('@netlify/blobs'); sdk = getStore('submissions'); } catch (_) {}

async function load() {
  if (sdk) { try { return (await sdk.get('submissions.json', { type: 'json' })) || []; } catch (_) {} }
  if (!API) return [];
  try {
    // Step 1: get presigned download URL
    const meta = await fetch(`${API}/submissions.json`, { headers: HDR });
    if (!meta.ok) return [];
    const { url } = await meta.json();
    if (!url) return [];
    // Step 2: download actual content
    const data = await fetch(url);
    if (!data.ok) return [];
    return (await data.json()) || [];
  } catch (_) { return []; }
}

async function append(record) {
  if (sdk) { try { const e = (await sdk.get('submissions.json', { type: 'json' })) || []; e.push(record); await sdk.setJSON('submissions.json', e); return 'blobs'; } catch (_) {} }
  if (!API) return 'none';
  try {
    const existing = await load();
    existing.push(record);
    // Step 1: get presigned upload URL
    const meta = await fetch(`${API}/submissions.json`, { method: 'PUT', headers: HDR });
    if (!meta.ok) return 'none';
    const { url } = await meta.json();
    if (!url) return 'none';
    // Step 2: upload content
    const put = await fetch(url, { method: 'PUT', body: JSON.stringify(existing), headers: { 'Content-Type': 'application/octet-stream' } });
    return put.ok ? 'api' : 'none';
  } catch (_) { return 'none'; }
}

async function saveAll(arr) {
  if (sdk) { try { await sdk.setJSON('submissions.json', arr); return 'blobs'; } catch (_) {} }
  if (!API) return 'none';
  try {
    const meta = await fetch(`${API}/submissions.json`, { method: 'PUT', headers: HDR });
    if (!meta.ok) return 'none';
    const { url } = await meta.json();
    if (!url) return 'none';
    const put = await fetch(url, { method: 'PUT', body: JSON.stringify(arr), headers: { 'Content-Type': 'application/octet-stream' } });
    return put.ok ? 'api' : 'none';
  } catch (_) { return 'none'; }
}

module.exports = { load, append, saveAll };
