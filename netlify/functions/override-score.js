const QUESTIONS = require('./_questions.json');
const { load: loadSubmissions, saveAll } = require('./_blobs-bridge');

const PASS_PROFICIENT = 80;
const PASS_REINFORCE = 70;

function band(pct) {
  if (pct >= PASS_PROFICIENT) return 'proficient';
  if (pct >= PASS_REINFORCE) return 'needs_reinforcement';
  return 'needs_retraining';
}

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

  const { token, questionId, earned, max } = body;
  if (!token || questionId == null) {
    return { statusCode: 400, body: JSON.stringify({ error: 'token and questionId required' }) };
  }
  const qId = Number(questionId);
  const newEarned = Number(earned);
  const newMax = Number(max) || undefined;

  const arr = await loadSubmissions();
  let found = false;
  for (const s of arr) {
    if (s.token !== token) continue;
    for (const item of (s.items || [])) {
      if (item.id === qId) {
        if (!item.overrides) item.overrides = [];
        item.overrides.push({ from: item.earned, to: newEarned, by: 'admin', at: new Date().toISOString(), maxOverride: newMax });
        item.earned = newEarned;
        if (newMax != null && newMax !== undefined) item.max = newMax;
        // Cap: earned cannot exceed max (prevents score inflation)
        if (item.earned > item.max) item.earned = item.max;
        item.correct = item.earned >= item.max;
        item.flagForReview = false;
        found = true;
      }
    }
    if (!found) continue;

    // Recalculate totals
    let totalEarned = 0, totalMax = 0;
    for (const item of (s.items || [])) {
      totalEarned += item.earned || 0;
      totalMax += item.max || 0;
    }
    s.earned = totalEarned;
    s.max = totalMax;
    s.pct = totalMax ? Math.round((totalEarned / totalMax) * 100) : 0;
    s.band = band(s.pct);

    // Recalculate domains
    const domains = {};
    for (const item of (s.items || [])) {
      const dom = item.domain;
      if (!domains[dom]) domains[dom] = { earned: 0, max: 0, total: 0, correct: 0 };
      domains[dom].earned += item.earned || 0;
      domains[dom].max += item.max || 0;
      domains[dom].total += 1;
      if (item.correct) domains[dom].correct += 1;
    }
    for (const d of Object.values(domains)) d.pct = d.max ? Math.round((d.earned / d.max) * 100) : 0;
    s.domains = domains;

    // Recalculate flagged list
    s.flagged = (s.items || []).filter(i => i.flagForReview).map(i => i.id);
    break;
  }

  if (!found) return { statusCode: 404, body: JSON.stringify({ error: 'Token/question not found' }) };

  const storage = await saveAll(arr);
  const updated = arr.find(s => s.token === token);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, storage, token: updated.token, earned: updated.earned, max: updated.max, pct: updated.pct, band: updated.band, domains: updated.domains })
  };
};