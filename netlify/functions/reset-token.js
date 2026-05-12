const { load: loadSubmissions, append } = require('./_blobs-bridge');

function checkSecret(event) {
  const required = process.env.ADMIN_SECRET;
  if (!required) return { ok: true, dev: true };
  const provided = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  return { ok: provided === required };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const auth = checkSecret(event);
  if (!auth.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const token = (body.token || '').trim();
  if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };
  
  const arr = await loadSubmissions();
  const remaining = [];
  let archivedCount = 0;
  for (const r of arr) {
    if (r.token === token) {
      r._archivedAt = new Date().toISOString();
      r._archivedToken = r.token;
      r.token = token + '__archived_' + Date.now();
      archivedCount++;
    }
    remaining.push(r);
  }
  
  // Re-save the modified array (blobs bridge doesn't have a save-all, so we use the PUT pattern)
  const SITE_ID = process.env.SITE_ID || '21fd2f38-d3e8-4f3e-b48b-fc98f00b0bdc';
  const TOKEN = process.env.NETLIFY_AUTH_TOKEN || '';
  const API = TOKEN ? 'https://api.netlify.com/api/v1/sites/' + SITE_ID + '/blobs/submissions' : '';
  if (API) {
    await fetch(API + '/submissions.json', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/octet-stream' },
      body: JSON.stringify(remaining)
    });
  }
  
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, token, archivedCount }) };
};
