const { load: loadSubmissions, saveAll } = require('./_blobs-bridge');

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
  const rawToken = body.token || '';
  if (!rawToken) return { statusCode: 400, body: JSON.stringify({ error: 'token required' }) };
  const token = rawToken.trim();
  if (!token) return { statusCode: 400, body: JSON.stringify({ error: 'token cannot be empty' }) };
  if (token.includes('__archived_')) return { statusCode: 400, body: JSON.stringify({ error: 'token cannot contain __archived_' }) };
  
  const arr = await loadSubmissions();
  let archivedCount = 0;
  for (const r of arr) {
    if (r.token === token) {
      r._archivedAt = new Date().toISOString();
      r._archivedToken = r.token;
      r.token = token + '__archived_' + Date.now();
      archivedCount++;
    }
  }
  
  const storage = await saveAll(arr);
  
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, token, archivedCount, storage }) };
};
