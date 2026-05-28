/**
 * Mock DIS Assessment Generator
 * Creates 10 submissions with varying scores for dashboard testing.
 * Run: node scripts/generate-mocks.js
 */
const fs = require('fs');
const path = require('path');

// Copy of the scoring logic (mirrors netlify/functions/submit.js)
const QUESTIONS = require('../netlify/functions/_questions.json');

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

// ─── Mock Submissions ───────────────────────────────────────────────

// Correct answers for the current 25-question bank.
const CORRECT = {
  mc:  {1:'a', 2:'c', 3:'b', 4:'c', 5:'c', 9:'b', 12:'a', 14:'d', 16:'c', 17:'b', 18:'b', 19:'b', 23:'b', 24:'a', 25:'b'},
  ms:  {6: ['b', 'c', 'e'], 22: ['a', 'b', 'd', 'f']},
  write: {
    7:  "Secondary Path B clinical criteria palmar plantar mucous reactive nontreponemal treponemal absent",
    8:  "No disqualified nonreactive treponemal concurrent nonreactive",
    10: "Unknown Duration probable path a outside 12 months no acquisition evidence",
    11: "Early non-primary non-secondary patient-described prior chancre primary symptom",
    13: "Early non-primary non-secondary epidemiologic linkage documented partner",
    15: "Unknown Duration probable path a not documented mere sexual contact no qualifying evidence",
    // Q19 is multiple choice in the current bank; this text is retained only as a reference for the requested rubric language.
    19: "No not probable adequate treatment three dose titer declined fourfold 1:1 not fourfold higher",
    20: "No not probable adequate treatment three dose titer declined fourfold",
    21: "Unknown Duration ocular likely no direct detection no ocular fluid"
  }
};

function wrongMC(id, correctKey) {
  // Specific distractors for the current MC question numbers.
  const dist = {1:'b', 2:'a', 3:'a', 4:'a', 5:'a', 9:'a', 12:'b', 14:'a', 16:'a', 17:'a', 18:'a', 19:'a', 23:'a', 24:'b', 25:'a'};
  return dist[id] || (correctKey === 'a' ? 'b' : 'a');
}

function correctResponses() {
  const out = {};
  for (const q of QUESTIONS) {
    if (q.type === 'mc') out[q.id] = CORRECT.mc[q.id];
    else if (q.type === 'ms') out[q.id] = [...CORRECT.ms[q.id]];
    else if (q.type === 'write') out[q.id] = CORRECT.write[q.id];
  }
  return out;
}

function wrongResponses() {
  const out = {};
  for (const q of QUESTIONS) {
    if (q.type === 'mc') out[q.id] = wrongMC(q.id, CORRECT.mc[q.id]);
    else if (q.type === 'ms') out[q.id] = q.id === 6 ? ['a'] : ['c'];
    else if (q.type === 'write') out[q.id] = '';
  }
  return out;
}

function withMisses({ wrongMc = [], wrongMs = [], partialWrite = [], wrongWrite = [] } = {}) {
  const out = correctResponses();
  for (const id of wrongMc) out[id] = wrongMC(id, CORRECT.mc[id]);
  for (const id of wrongMs) out[id] = id === 6 ? ['a'] : ['c'];
  for (const id of partialWrite) out[id] = partialWriteText(id);
  for (const id of wrongWrite) out[id] = '';
  return out;
}

function partialWriteText(id) {
  const partial = {
    7:  'Secondary Path B',
    8:  'No',
    10: 'Unknown Duration',
    11: 'Early non-primary non-secondary',
    13: 'Early non-primary non-secondary',
    15: 'Unknown Duration',
    20: 'No not probable',
    21: 'Unknown Duration ocular likely'
  };
  return partial[id] || 'partial';
}

const MOCKS = [
  // 1. PERFECT — 34/34 (100%)
  { name: 'Perfect Score', token: 'mock-perfect', region: 'Region 1', responses: correctResponses() },

  // 2. STRONG PROFICIENT — 31/34 (91%)
  { name: 'Strong Proficient', token: 'mock-strong', region: 'Region 2', responses: withMisses({
    wrongMc: [24],
    partialWrite: [15, 20]
  })},

  // 3. BORDERLINE PROFICIENT — 27/34 (79%)
  { name: 'Borderline Proficient', token: 'mock-borderline', region: 'Region 1', responses: withMisses({
    wrongMc: [4, 12, 18],
    wrongMs: [6],
    partialWrite: [8, 21]
  })},

  // 4. HIGH REINFORCEMENT — 25/34 (74%)
  { name: 'High Reinforcement', token: 'mock-high-rein', region: 'Region 2', responses: withMisses({
    wrongMc: [3, 5, 16, 23],
    wrongMs: [6],
    partialWrite: [13, 20],
    wrongWrite: [10]
  })},

  // 5. MID REINFORCEMENT — 22/34 (65%)
  { name: 'Mid Reinforcement', token: 'mock-mid-rein', region: 'Region 1', responses: withMisses({
    wrongMc: [1, 4, 9, 16, 19],
    wrongMs: [6, 22],
    partialWrite: [15, 21],
    wrongWrite: [8]
  })},

  // 6. LOW REINFORCEMENT — 24/34 (71%)
  { name: 'Low Reinforcement', token: 'mock-low-rein', region: 'Region 2', responses: withMisses({
    wrongMc: [2, 5, 14, 17],
    wrongMs: [6],
    partialWrite: [20, 21],
    wrongWrite: [7]
  })},

  // 7. HIGH RETRAINING — 20/34 (59%)
  { name: 'High Retraining', token: 'mock-high-retrain', region: 'Region 1', responses: withMisses({
    wrongMc: [1, 3, 12, 16, 23, 25],
    wrongMs: [6, 22],
    partialWrite: [21],
    wrongWrite: [7, 13]
  })},

  // 8. MID RETRAINING — 18/34 (53%)
  { name: 'Mid Retraining', token: 'mock-mid-retrain', region: 'Region 2', responses: withMisses({
    wrongMc: [2, 4, 5, 9, 14, 17, 18, 24],
    wrongMs: [6, 22],
    wrongWrite: [7, 8, 10]
  })},

  // 9. LOW RETRAINING — 13/34 (38%)
  { name: 'Low Retraining', token: 'mock-low-retrain', region: 'Region 1', responses: withMisses({
    wrongMc: [1, 3, 4, 9, 12, 14, 16, 23, 25],
    wrongMs: [6, 22],
    wrongWrite: [7, 8, 10, 11, 13]
  })},

  // 10. VERY LOW — 7/34 (21%)
  { name: 'Very Low', token: 'mock-fail', region: 'Region 2', responses: {
    ...wrongResponses(),
    1: CORRECT.mc[1],
    2: CORRECT.mc[2],
    3: CORRECT.mc[3],
    4: CORRECT.mc[4],
    5: CORRECT.mc[5],
    9: CORRECT.mc[9],
    12: CORRECT.mc[12]
  }}
];

// ─── Generate & Save ─────────────────────────────────────────────────

const submissionsPath = path.join(__dirname, '..', 'data', 'submissions.json');
fs.mkdirSync(path.dirname(submissionsPath), { recursive: true });

const records = [];

console.log('╔════════════════════════════════════════════════════════════════════╗');
console.log('║        DIS ASSESSMENT — 10 MOCK SUBMISSIONS                       ║');
console.log('╠════════════════════════════════════════════════════════════════════╣');

for (const mock of MOCKS) {
  const graded = gradeAll(mock.responses);
  const record = {
    token: mock.token,
    region: mock.region,
    earned: graded.earned,
    max: graded.max,
    pct: graded.pct,
    band: graded.band,
    domains: graded.domains,
    items: graded.items,
    flagged: graded.flagged,
    timestamp: new Date(Date.now() - Math.floor(Math.random() * 86400000) * 7).toISOString()
  };
  records.push(record);

  const bar = '█'.repeat(Math.floor(graded.pct / 5)) + '░'.repeat(20 - Math.floor(graded.pct / 5));
  const bandLabel = { proficient: '✅ PROFICIENT', needs_reinforcement: '⚠️  REINFORCE', needs_retraining: '❌ RETRAINING' }[graded.band];
  const score = `${graded.earned}/${graded.max}`;
  console.log(`║ ${mock.token.padEnd(20)} ${bar} ${score.padStart(5)} ${String(graded.pct+'%').padStart(4)} ${bandLabel.padEnd(22)} ║`);
}

console.log('╚════════════════════════════════════════════════════════════════════╝');

fs.writeFileSync(submissionsPath, JSON.stringify(records, null, 2));

console.log(`\n✅ Written ${records.length} submissions to data/submissions.json`);
console.log(`   Path: ${submissionsPath}`);

// Summary stats
const bands = { proficient: 0, needs_reinforcement: 0, needs_retraining: 0 };
const regions = {};
for (const r of records) {
  bands[r.band]++;
  regions[r.region] = (regions[r.region] || 0) + 1;
}
console.log(`\n📊 Distribution:`);
console.log(`   Proficient:          ${bands.proficient}`);
console.log(`   Needs Reinforcement: ${bands.needs_reinforcement}`);
console.log(`   Needs Retraining:    ${bands.needs_retraining}`);
console.log(`   Regions: ${Object.entries(regions).map(([k,v]) => `${k}(${v})`).join(', ')}`);

// Write flagged items for review
console.log(`\n🔍 Write-in responses flagged for review:`);
for (const r of records) {
  if (r.flagged.length) {
    console.log(`   ${r.token} (${r.earned}/${r.max}, ${r.pct}%): Q${r.flagged.join(', Q')}`);
  }
}
