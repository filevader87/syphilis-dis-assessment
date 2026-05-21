const { load: loadSubmissions } = require('./_blobs-bridge');

const PASS_PROFICIENT = 80;
const PASS_REINFORCE = 70;

function bandOf(pct) {
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

function emptyRegionBlock() {
  return {
    totalSubmissions: 0, uniqueTesters: 0, avgPct: 0,
    proficientRate: 0, reinforcementRate: 0, retrainingRate: 0,
    bandCounts: { proficient: 0, needs_reinforcement: 0, needs_retraining: 0 }, domains: {}
  };
}

function build(subs) {
  const out = {
    thresholds: { proficient: PASS_PROFICIENT, reinforcement: PASS_REINFORCE },
    program: {
      totalSubmissions: subs.length, uniqueTesters: new Set(subs.map(s => s.token)).size,
      avgPct: 0, proficientRate: 0, reinforcementRate: 0, retrainingRate: 0, lastSubmission: null
    },
    bandCounts: { proficient: 0, needs_reinforcement: 0, needs_retraining: 0 },
    domains: {}, regions: {}, questionDifficulty: {}, rankings: [], alerts: [], timeline: [], flaggedReviews: []
  };
  if (!subs.length) return out;

  let pctSum = 0;
  for (const s of subs) {
    const pct = s.pct || 0;
    pctSum += pct;
    const b = s.band || bandOf(pct);
    out.bandCounts[b] = (out.bandCounts[b] || 0) + 1;
    if (!out.program.lastSubmission || s.timestamp > out.program.lastSubmission) out.program.lastSubmission = s.timestamp;

    for (const [dom, ds] of Object.entries(s.domains || {})) {
      if (!out.domains[dom]) out.domains[dom] = { earned: 0, max: 0, total: 0, correct: 0 };
      out.domains[dom].earned += ds.earned || 0;
      out.domains[dom].max += ds.max || 0;
      out.domains[dom].total += ds.total || 0;
      out.domains[dom].correct += ds.correct || 0;
    }

    const reg = s.region || 'Unassigned';
    if (!out.regions[reg]) out.regions[reg] = emptyRegionBlock();
    const rb = out.regions[reg];
    rb.totalSubmissions++;
    rb.bandCounts[b] = (rb.bandCounts[b] || 0) + 1;
    rb._pctSum = (rb._pctSum || 0) + pct;

    for (const [dom, ds] of Object.entries(s.domains || {})) {
      if (!rb.domains[dom]) rb.domains[dom] = { earned: 0, max: 0, total: 0, correct: 0 };
      rb.domains[dom].earned += ds.earned || 0;
      rb.domains[dom].max += ds.max || 0;
      rb.domains[dom].total += ds.total || 0;
      rb.domains[dom].correct += ds.correct || 0;
    }

    for (const item of (s.items || [])) {
      const k = item.id;
      if (!out.questionDifficulty[k]) out.questionDifficulty[k] = { id: k, domain: item.domain, attempts: 0, correct: 0, earned: 0, max: 0 };
      const q = out.questionDifficulty[k];
      q.attempts++; if (item.correct) q.correct++;
      q.earned += item.earned || 0; q.max += item.max || 0;
      if (item.flagForReview && !item.correct) {
        out.flaggedReviews.push({ token: s.token, region: s.region || 'Unassigned', timestamp: s.timestamp, questionId: k, domain: item.domain, response: item.response, rubricMatched: item.rubricMatched, rubricTotal: item.rubricTotal });
      }
    }
  }

  out.program.avgPct = Math.round(pctSum / subs.length);
  out.program.proficientRate = Math.round((out.bandCounts.proficient / subs.length) * 100);
  out.program.reinforcementRate = Math.round((out.bandCounts.needs_reinforcement / subs.length) * 100);
  out.program.retrainingRate = Math.round((out.bandCounts.needs_retraining / subs.length) * 100);

  for (const d of Object.values(out.domains)) d.pct = d.max ? Math.round((d.earned / d.max) * 100) : 0;
  for (const q of Object.values(out.questionDifficulty)) q.pct = q.max ? Math.round((q.earned / q.max) * 100) : 0;

  for (const [, rb] of Object.entries(out.regions)) {
    const n = rb.totalSubmissions;
    rb.uniqueTesters = n;
    rb.avgPct = n ? Math.round(rb._pctSum / n) : 0;
    rb.proficientRate = n ? Math.round((rb.bandCounts.proficient / n) * 100) : 0;
    rb.reinforcementRate = n ? Math.round((rb.bandCounts.needs_reinforcement / n) * 100) : 0;
    rb.retrainingRate = n ? Math.round((rb.bandCounts.needs_retraining / n) * 100) : 0;
    delete rb._pctSum;
    for (const d of Object.values(rb.domains)) d.pct = d.max ? Math.round((d.earned / d.max) * 100) : 0;
  }

  const byTester = {};
  for (const s of subs) {
    const pct = s.pct || 0;
    if (!byTester[s.token] || pct > byTester[s.token].pct) {
      byTester[s.token] = { token: s.token, region: s.region || 'Unassigned', earned: s.earned, max: s.max, pct, band: s.band || bandOf(pct), timestamp: s.timestamp };
    }
  }
  out.rankings = Object.values(byTester).sort((a, b) => b.pct - a.pct);

  for (const [dom, d] of Object.entries(out.domains)) {
    if (d.pct < PASS_REINFORCE) out.alerts.push({ level: d.pct < 50 ? 'critical' : 'warning', domain: dom, message: 'Domain "' + dom + '" averaging ' + d.pct + '% program-wide — below reinforcement threshold.' });
  }
  if (out.program.retrainingRate >= 25) out.alerts.push({ level: 'warning', domain: null, message: out.program.retrainingRate + '% of testers fall in the "needs retraining" band (<' + PASS_REINFORCE + '%).' });

  for (const [reg, rb] of Object.entries(out.regions)) {
    if (rb.retrainingRate >= 40) out.alerts.push({ level: 'critical', domain: null, message: reg + ': ' + rb.retrainingRate + '% of testers need retraining — immediate follow-up recommended.' });
    for (const [dom, d] of Object.entries(rb.domains)) {
      if (rb.totalSubmissions >= 2 && d.pct < 50) out.alerts.push({ level: 'warning', domain: dom, message: reg + ' · "' + dom + '" averaging ' + d.pct + '% — lowest-performing domain in this region.' });
    }
  }

  for (const q of Object.values(out.questionDifficulty)) {
    if (q.attempts >= 3 && q.pct < 50) out.alerts.push({ level: 'warning', domain: q.domain, message: 'Q' + q.id + ' (' + q.domain + ') is failing program-wide at ' + q.pct + '% — review training material.' });
  }

  const byDay = {};
  for (const s of subs) {
    const day = (s.timestamp || '').slice(0, 10);
    if (!day) continue;
    if (!byDay[day]) byDay[day] = { day, count: 0, pctSum: 0 };
    byDay[day].count++; byDay[day].pctSum += s.pct || 0;
  }
  out.timeline = Object.values(byDay).map(d => ({ day: d.day, count: d.count, avgPct: Math.round(d.pctSum / d.count) })).sort((a, b) => a.day.localeCompare(b.day));
  return out;
}

exports.handler = async (event) => {
  const auth = checkSecret(event);
  if (!auth.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  try { const subs = await loadSubmissions(); const metrics = build(subs); return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(metrics) }; }
  catch (e) { return { statusCode: 500, body: JSON.stringify({ error: e.message }) }; }
};

module.exports.build = build;
module.exports.bandOf = bandOf;
