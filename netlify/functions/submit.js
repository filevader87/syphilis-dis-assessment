const QUESTIONS = require('./_questions.json');
const { load: loadSubmissions, append: appendRecord } = require('./_blobs-bridge');

const PASS_PROFICIENT = 80;
const PASS_REINFORCE = 70;

function band(pct) {
  if (pct >= PASS_PROFICIENT) return 'proficient';
  if (pct >= PASS_REINFORCE) return 'needs_reinforcement';
  return 'needs_retraining';
}

function rubricScore(answer, rubric) {
  if (!answer || !rubric || !rubric.groups) return { matched: 0, total: 0 };
  const text = String(answer).toLowerCase();
  let matched = 0;
  for (const group of rubric.groups) {
    if (group.some(kw => text.includes(kw.toLowerCase()))) matched++;
  }
  return { matched, total: rubric.groups.length };
}

function scoreOne(q, response) {
  if (q.type === 'mc') {
    const isCorrect = response === q.correct;
    return { earned: isCorrect ? q.points : 0, max: q.points, correct: isCorrect, flagForReview: false };
  }
  if (q.type === 'ms') {
    const picks = Array.isArray(response) ? response : [];
    const correctSet = new Set(q.correct);
    const wrongPicks = picks.filter(p => !correctSet.has(p));
    const rightPicks = picks.filter(p => correctSet.has(p));
    if (wrongPicks.length === 0 && rightPicks.length === q.correct.length) {
      return { earned: q.points, max: q.points, correct: true, flagForReview: false };
    }
    if (q.partialCredit && wrongPicks.length === 0 && rightPicks.length > 0) {
      return { earned: 1, max: q.points, correct: false, flagForReview: false };
    }
    return { earned: 0, max: q.points, correct: false, flagForReview: false };
  }
  if (q.type === 'write') {
    const r = rubricScore(response, q.rubric);
    let earned = 0;
    if (r.total > 0 && r.matched === r.total) earned = q.points;
    else if (r.matched > 0) earned = Math.floor(q.points / 2);
    return {
      earned, max: q.points, correct: earned === q.points,
      flagForReview: true, rubricMatched: r.matched, rubricTotal: r.total
    };
  }
  return { earned: 0, max: q.points || 0, correct: false, flagForReview: false };
}

function gradeAll(responses) {
  const items = [];
  let earned = 0, max = 0;
  const domains = {};
  const flagged = [];
  for (const q of QUESTIONS) {
    const resp = responses[q.id];
    const s = scoreOne(q, resp);
    earned += s.earned;
    max += s.max;
    const dom = q.domain;
    if (!domains[dom]) domains[dom] = { earned: 0, max: 0, total: 0, correct: 0 };
    domains[dom].earned += s.earned;
    domains[dom].max += s.max;
    domains[dom].total += 1;
    if (s.correct) domains[dom].correct += 1;
    items.push({
      id: q.id, domain: dom, type: q.type, response: resp ?? null,
      earned: s.earned, max: s.max, correct: s.correct,
      flagForReview: s.flagForReview, rubricMatched: s.rubricMatched, rubricTotal: s.rubricTotal
    });
    if (s.flagForReview) flagged.push(q.id);
  }
  for (const d of Object.values(domains)) d.pct = d.max ? Math.round((d.earned / d.max) * 100) : 0;
  const pct = max ? Math.round((earned / max) * 100) : 0;
  return { items, earned, max, pct, band: band(pct), domains, flagged };
}

async function tokenHasSubmitted(token) {
  const arr = await loadSubmissions();
  return arr.some(r => r.token === token);
}

function tokenIsAllowed(token) {
  const raw = process.env.ALLOWED_TOKENS;
  if (!raw) return true;
  const set = raw.split(',').map(s => s.trim()).filter(Boolean);
  return set.includes(token);
}

function logEmail(record) {
  console.log('===== EMAIL REPORT =====');
  console.log('User:      ' + record.token);
  console.log('Score:     ' + record.earned + '/' + record.max + '  (' + record.pct + '%)  [' + record.band + ']');
  console.log('Submitted: ' + record.timestamp);
  console.log('Flagged for supervisor review: ' + (record.flagged.join(', ') || 'none'));
  console.log('Domain analysis:');
  for (const [dom, s] of Object.entries(record.domains)) {
    console.log('  - ' + dom.padEnd(50) + ' ' + s.earned + '/' + s.max + '  (' + s.pct + '%)');
  }
  console.log('========================');
}

async function sendResendEmail(record) {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL_TO;
  const from = process.env.REPORT_EMAIL_FROM || 'onboarding@resend.dev';
  if (!apiKey || !to) return { sent: false, reason: 'env not configured' };
  const rows = Object.entries(record.domains)
    .map(([d, s]) => '<tr><td>' + d + '</td><td>' + s.earned + '/' + s.max + '</td><td>' + s.pct + '%</td></tr>').join('');
  const html = '<h2>DIS Assessment Report — ' + record.token + '</h2>' +
    '<p><strong>Score:</strong> ' + record.earned + '/' + record.max + ' (' + record.pct + '%) — <strong>' + record.band.replace('_', ' ') + '</strong></p>' +
    '<p>Submitted: ' + record.timestamp + '</p>' +
    (record.flagged.length ? '<p><strong>Items flagged for review:</strong> ' + record.flagged.join(', ') + '</p>' : '') +
    '<table border="1" cellpadding="6" cellspacing="0"><thead><tr><th>Domain</th><th>Earned</th><th>%</th></tr></thead><tbody>' + rows + '</tbody></table>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: to.split(','), subject: 'DIS Assessment — ' + record.token + ' (' + record.pct + '%)', html })
    });
    return { sent: res.ok, status: res.status };
  } catch (e) { return { sent: false, reason: e.message }; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Invalid JSON' }; }
  const token = body.token || 'unknown';
  if (!tokenIsAllowed(token)) {
    return { statusCode: 403, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'token_not_allowed' }) };
  }
  if (await tokenHasSubmitted(token)) {
    return { statusCode: 409, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'already_submitted' }) };
  }
  let responses = {};
  if (body.responses && typeof body.responses === 'object' && !Array.isArray(body.responses)) {
    responses = body.responses;
  } else if (Array.isArray(body.answers)) {
    for (const a of body.answers) responses[a.id] = a.answer;
  }
  const region = (body.region || 'Unassigned').trim();
  const graded = gradeAll(responses);
  const record = {
    token, region, earned: graded.earned, max: graded.max, pct: graded.pct,
    band: graded.band, domains: graded.domains, items: graded.items,
    flagged: graded.flagged, timestamp: new Date().toISOString()
  };
  let storage = 'none';
  try { storage = await appendRecord(record); } catch (e) { console.error('Storage error:', e.message); }
  logEmail(record);
  const email = await sendResendEmail(record);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, storage, email, score: { earned: record.earned, max: record.max, pct: record.pct, band: record.band }, domains: record.domains, flagged: record.flagged })
  };
};

module.exports.gradeAll = gradeAll;
module.exports.scoreOne = scoreOne;
