const { load: loadSubmissions } = require('./_blobs-bridge');

function checkSecret(event) {
  const required = process.env.ADMIN_SECRET;
  if (!required) return { ok: true, dev: true };
  const provided = event.headers['x-admin-secret'] || event.headers['X-Admin-Secret'];
  return { ok: provided === required };
}

function toCsv(subs) {
  const headers = ['timestamp', 'token', 'earned', 'max', 'pct', 'band', 'flagged', 'domains'];
  const rows = subs.map(s => [
    s.timestamp, s.token, s.earned, s.max, s.pct, s.band,
    (s.flagged || []).join('|'),
    Object.entries(s.domains || {}).map(([d, v]) => d + ':' + v.earned + '/' + v.max).join('|')
  ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','));
  return [headers.join(','), ...rows].join('\n');
}

exports.handler = async (event) => {
  const auth = checkSecret(event);
  if (!auth.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  try {
    const subs = await loadSubmissions();
    const fmt = (event.queryStringParameters || {}).format;
    if (fmt === 'csv') {
      return { statusCode: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="submissions.csv"' }, body: toCsv(subs) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify({ count: subs.length, submissions: subs }) };
  } catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};
