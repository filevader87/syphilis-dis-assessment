/**
 * Mock DIS Assessment Generator
 * Creates 10 submissions with varying scores for dashboard testing.
 * Run: node scripts/generate-mocks.js
 */
const fs = require('fs');
const path = require('path');

// Copy of the scoring logic (mirrors netlify/functions/submit.js)
const QUESTIONS = require('../netlify/functions/_questions.json');

const PASS_PROFICIENT = 85;
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

// Correct answers for reference
// Q1:a Q2:c Q3:b Q4:c Q5:c Q6:c Q7:b Q8:a Q9:b Q10:b Q11:b Q12:b
// Q18 correct: [a, c]
// Write-in correct answers:
// Q13: "Early Non-Primary Non-Secondary, based on patient-described primary sign (chancre) within 12 months"
// Q15: "Early Non-Primary Non-Secondary, based on epidemiologic linkage to a documented partner with syphilis"
// Q17: "Unknown Duration with Ocular Syphilis Likely (probable) — no direct detection on ocular fluid"
// Q19: "No, not available. The concurrent nonreactive treponemal disqualifies Probable Path B"

const CORRECT = {
  mc:  {1:'a', 2:'c', 3:'b', 4:'c', 5:'c', 6:'c', 7:'b', 8:'a', 9:'b', 10:'b', 11:'b', 12:'b', 14:'a', 16:'b', 20:'b'},
  ms:  {18: ['a', 'c']},
  write: {
    13: "Stage: Early Non-Primary Non-Secondary. Evidence: specific patient-described primary sign/chancre within the previous 12 months.",
    15: "Stage: Early Non-Primary Non-Secondary. Criterion: epidemiologic linkage to a partner independently documented with syphilis during the previous 12 months.",
    17: "Base stage: Syphilis, Unknown Duration. Sub-classification: Ocular Syphilis, Likely (probable) — no direct-detection testing on ocular fluid.",
    19: "No, Secondary Probable Path B is not available because a returned nonreactive treponemal test disqualifies Path B; Path B requires no concurrent nonreactive treponemal result."
  }
};

function mcAll(correct) {
  const out = {};
  for (const [id, key] of Object.entries(CORRECT.mc)) out[id] = correct ? key : wrongMC(id, key);
  return out;
}

function wrongMC(id, correctKey) {
  // Return a specific distracter for variety
  const dist = {1:'c', 2:'a', 3:'d', 4:'a', 5:'d', 6:'a', 7:'a', 8:'d', 9:'d', 10:'a', 11:'a', 12:'c', 14:'d', 16:'c', 20:'a'};
  return dist[id] || 'b';
}

const MOCKS = [
  // 1. PERFECT — 26/26 (100%)
  { name: 'Perfect Score', token: 'mock-perfect', region: 'Region A', responses: {
    ...mcAll(true),
    18: ['a','c'],
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: CORRECT.write[17],
    19: CORRECT.write[19]
  }},

  // 2. STRONG PROFICIENT — 24/26 (92%) — miss Q12 (staging) + Q20
  { name: 'Strong Proficient', token: 'mock-strong', region: 'Region B', responses: {
    ...mcAll(true), 12:'a', 20:'d',
    18: ['a','c'],
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: CORRECT.write[17],
    19: CORRECT.write[19]
  }},

  // 3. BORDERLINE PROFICIENT — 22/26 (85%) — miss Q4, Q6, Q20, half Q17
  { name: 'Borderline Proficient', token: 'mock-borderline', region: 'Region A', responses: {
    ...mcAll(true), 4:'d', 6:'d', 20:'d',
    18: ['a','c'],
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: "The base stage is Unknown Duration. Sub-classification: Ocular Syphilis.",  // only matches group 1+2, misses "likely/probable" → 1/3 pts
    19: CORRECT.write[19]
  }},

  // 4. HIGH REINFORCEMENT — 19/26 (73%) — miss Q3, Q8, Q12, Q16, half Q15
  { name: 'High Reinforcement', token: 'mock-high-rein', region: 'Region C', responses: {
    ...mcAll(true), 3:'a', 8:'c', 12:'c', 16:'c',
    18: ['a','c'],
    13: CORRECT.write[13],
    15: "Early NPNS stage. Based on partner exposure.",  // matches group 1, misses group 2 (no "epi linkage"/"documented partner") → 1/2 pts
    17: CORRECT.write[17],
    19: CORRECT.write[19]
  }},

  // 5. MID REINFORCEMENT — 17/26 (65%) — miss Q1, Q4, Q9, Q16, partial Q18, fail Q19
  { name: 'Mid Reinforcement', token: 'mock-mid-rein', region: 'Region A', responses: {
    ...mcAll(true), 1:'b', 4:'d', 9:'a', 16:'c',
    18: ['a'],  // partial credit (1/2)
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: CORRECT.write[17],
    19: "yes"  // totally wrong → 0/2
  }},

  // 6. LOW REINFORCEMENT — 18/26 (69%) — miss Q2, Q5, Q11, Q16, Q14, fail Q19
  { name: 'Low Reinforcement', token: 'mock-low-rein', region: 'Region D', responses: {
    ...mcAll(true), 2:'d', 5:'a', 11:'c', 14:'d', 16:'d',
    18: ['a','c'],
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: CORRECT.write[17],
    19: "no."  // matches group 1 but not group 2 (no "treponemal" keyword) → 1/2 pts
  }},

  // 7. HIGH RETRAINING — 15/26 (58%) — miss Q1, Q3, Q6, Q7, Q12, Q16, Q20 + partial Q18
  { name: 'Just Below 70', token: 'mock-high-retrain', region: 'Region B', responses: {
    ...mcAll(true), 1:'d', 3:'a', 6:'d', 7:'c', 12:'d', 16:'d', 20:'a',
    18: ['a'],  // partial (1/2)
    13: CORRECT.write[13],
    15: CORRECT.write[15],
    17: CORRECT.write[17],
    19: CORRECT.write[19]
  }},

  // 8. MID RETRAINING — 14/26 (54%)
  { name: 'Mid Retraining', token: 'mock-mid-retrain', region: 'Region E', responses: {
    ...mcAll(true), 2:'b', 4:'d', 5:'b', 8:'d', 9:'d', 11:'a', 14:'d', 16:'a', 20:'a',
    18: ['c'],  // wrong pick
    13: "Primary Syphilis",  // wrong both groups — 0 pts
    15: "Unknown duration",  // wrong both groups — 0 pts
    17: "Unknown Duration. Ocular. probably.",  // gets all 3 groups — full 3 pts
    19: CORRECT.write[19]
  }},

  // 9. LOW RETRAINING — 10/26 (38%)
  { name: 'Low Retraining', token: 'mock-low-retrain', region: 'Region C', responses: {
    ...mcAll(true), 1:'c', 4:'a', 6:'d', 7:'d', 8:'b', 9:'c', 10:'d', 11:'b', 12:'d', 14:'b', 16:'a', 20:'d',
    18: ['b'],  // all wrong
    13: "idk",  // 0
    15: "unknown",  // 0
    17: "ocular likely",  // matches groups 2+3 but not 1 — partial 1pt
    19: "yes"  // 0
  }},

  // 10. VERY LOW — 5/26 (19%)
  { name: 'Near Total Failure', token: 'mock-fail', region: 'Region D', responses: {
    ...mcAll(true), 2:'a', 3:'d', 5:'b', 6:'b', 7:'c', 8:'c', 9:'a', 10:'c', 11:'d', 12:'a', 14:'c', 16:'d', 20:'c',
    18: ['b','d'],  // wrong picks
    13: "",  // 0
    15: "",  // 0
    17: "",  // 0
    19: ""   // 0
  }}
];

// ─── Generate & Save ─────────────────────────────────────────────────

const submissionsPath = path.join(__dirname, '..', 'data', 'submissions.json');
fs.mkdirSync(path.dirname(submissionsPath), { recursive: true });

const records = [];

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║        DIS ASSESSMENT — 10 MOCK SUBMISSIONS                 ║');
console.log('╠══════════════════════════════════════════════════════════════╣');

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
  console.log(`║ ${mock.token.padEnd(20)} ${bar} ${String(graded.pct+'%').padStart(4)} ${bandLabel.padEnd(22)} ║`);
}

console.log('╚══════════════════════════════════════════════════════════════╝');

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
    const writeInItems = r.items.filter(i => r.flagged.includes(i.id));
    console.log(`   ${r.token} (${r.pct}%): Q${r.flagged.join(', Q')}`);
  }
}
