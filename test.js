// Validates scoring and analytics. Run before every deploy.
//   node test.js          -> exits 0 if all pass, 1 on any failure
// If you edit _questions.json or change band thresholds, run this first.

const assert = require('assert');
const { gradeAll, scoreOne } = require('./netlify/functions/submit.js');
const { build, bandOf }      = require('./netlify/functions/analytics.js');
const QUESTIONS              = require('./netlify/functions/_questions.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n      ${e.message}`); failed++; }
}
function section(label) { console.log(`\n${label}`); }

// ─── Answer keys ────────────────────────────────────────────────────────────
const PERFECT = {
  1:'a', 2:'c', 3:'b', 4:'c', 5:'c',
  6:['b','c','e'],  // ms
  7:'Secondary Path B clinical criteria palmar plantar mucous reactive nontreponemal 1:64 treponemal absent',
  8:'No not available disqualified nonreactive treponemal concurrent nonreactive',
  9:'b',
  10:'Unknown Duration probable path a 755 outside 12 months no acquisition evidence',
  11:'Early non-primary non-secondary NPNS 730 patient-described prior chancre painless ulcer primary symptom',
  12:'a',
  13:'Early non-primary non-secondary NPNS 730 epidemiologic linkage documented partner',
  14:'d',
  15:'Unknown Duration probable path a 755 not documented mere sexual contact no qualifying acquisition',
  16:'c', 17:'b', 18:'b', 19:'b',
  20:'No not probable adequate treatment three dose appropriate serologic fourfold 1:1 not fourfold higher',
  21:'Unknown Duration 755 ocular occular likely probable no direct detection no ocular fluid no aqueous',
  22:['a','b','d','f'],  // ms with partialCredit
  23:'b', 24:'a', 25:'b'
};
const ALL_WRONG  = Object.fromEntries(QUESTIONS.map(q => [q.id, q.type === 'ms' ? [] : 'z']));
const EMPTY      = {};

// ═══ SCORING ════════════════════════════════════════════════════════════════
section('Scoring — gradeAll');

test('Perfect answer key scores 34/34 = 100% proficient', () => {
  const r = gradeAll(PERFECT);
  assert.strictEqual(r.earned, 34);
  assert.strictEqual(r.max, 34);
  assert.strictEqual(r.pct, 100);
  assert.strictEqual(r.band, 'proficient');
});

test('All wrong scores 0/34 = 0% needs_retraining', () => {
  const r = gradeAll(ALL_WRONG);
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.pct, 0);
  assert.strictEqual(r.band, 'needs_retraining');
});

test('Empty responses do not crash, score 0', () => {
  const r = gradeAll(EMPTY);
  assert.strictEqual(r.earned, 0);
  assert.strictEqual(r.max, 34);
});

test('Write-in items are flagged for supervisor review', () => {
  const r = gradeAll(PERFECT);
  assert.deepStrictEqual(r.flagged.sort((a,b)=>a-b), [7, 8, 10, 11, 13, 15, 20, 21]);
});

test('Domain totals sum back to overall earned/max', () => {
  const r = gradeAll(PERFECT);
  const sumE = Object.values(r.domains).reduce((s,d) => s + d.earned, 0);
  const sumM = Object.values(r.domains).reduce((s,d) => s + d.max,    0);
  assert.strictEqual(sumE, r.earned);
  assert.strictEqual(sumM, r.max);
});

section('Scoring — multi-select Q22');

const Q22 = QUESTIONS.find(q => q.id === 22);

test('All correct, no wrong picks → full 1 point', () => {
  const r = scoreOne(Q22, ['a','b','d','f']);
  assert.strictEqual(r.earned, 1); assert.strictEqual(r.correct, true);
});
test('Some correct (no wrong) → partial 1 point', () => {
  const r = scoreOne(Q22, ['a','b']);
  assert.strictEqual(r.earned, 1); assert.strictEqual(r.correct, false);
});
test('One correct + one wrong → 0 points', () => {
  const r = scoreOne(Q22, ['a','c']);
  assert.strictEqual(r.earned, 0);
});
test('All wrong → 0 points', () => {
  const r = scoreOne(Q22, ['c','e']);
  assert.strictEqual(r.earned, 0);
});

section('Scoring — write-in rubric');

const Q13 = QUESTIONS.find(q => q.id === 13);

test('All rubric groups matched → full points', () => {
  const r = scoreOne(Q13, 'Early NPNS with epidemiologic linkage to a documented partner.');
  assert.strictEqual(r.earned, 2);
});
test('Some rubric groups matched → half points', () => {
  const r = scoreOne(Q13, 'Early NPNS — uncertain why.');  // missing epidemiologic-linkage group
  assert.strictEqual(r.earned, 1);
});
test('No rubric matches → 0 points', () => {
  const r = scoreOne(Q13, 'I do not know.');
  assert.strictEqual(r.earned, 0);
});
test('Empty write-in → 0 points', () => {
  const r = scoreOne(Q13, '');
  assert.strictEqual(r.earned, 0);
});

section('Band thresholds');

test('100% → proficient',    () => assert.strictEqual(bandOf(100), 'proficient'));
test('80% → proficient',     () => assert.strictEqual(bandOf(80),  'proficient'));
test('79% → reinforcement',  () => assert.strictEqual(bandOf(79),  'needs_reinforcement'));
test('70% → reinforcement',  () => assert.strictEqual(bandOf(70),  'needs_reinforcement'));
test('69% → retraining',     () => assert.strictEqual(bandOf(69),  'needs_retraining'));
test('0% → retraining',      () => assert.strictEqual(bandOf(0),   'needs_retraining'));

// ═══ ANALYTICS ══════════════════════════════════════════════════════════════
section('Analytics — empty state');

test('Empty submissions returns valid skeleton', () => {
  const m = build([]);
  assert.strictEqual(m.program.totalSubmissions, 0);
  assert.deepStrictEqual(m.regions, {});
  assert.deepStrictEqual(m.alerts, []);
  assert.deepStrictEqual(m.rankings, []);
});

section('Analytics — aggregation');

function mkSubmission(token, region, answers) {
  const g = gradeAll(answers);
  return {
    token, region,
    earned: g.earned, max: g.max, pct: g.pct, band: g.band,
    domains: g.domains, items: g.items, flagged: g.flagged,
    timestamp: '2026-05-01T10:00:00Z'
  };
}

const subs = [
  mkSubmission('dis-jane-r1',   'Region 1', PERFECT),               // 100%, proficient
  mkSubmission('dis-john-r1',   'Region 1', ALL_WRONG),             // 0%, retraining
  mkSubmission('dis-aisha-r2',  'Region 2', PERFECT),               // 100%, proficient
  mkSubmission('dis-marcus-r2', 'Region 2', { ...PERFECT, 1:'b', 2:'a' }), // ~92%, proficient
];

test('Total submissions counted correctly', () => {
  const m = build(subs);
  assert.strictEqual(m.program.totalSubmissions, 4);
});

test('Unique testers counted correctly', () => {
  const m = build(subs);
  assert.strictEqual(m.program.uniqueTesters, 4);
});

test('Band counts add up to total submissions', () => {
  const m = build(subs);
  const sum = m.bandCounts.proficient + m.bandCounts.needs_reinforcement + m.bandCounts.needs_retraining;
  assert.strictEqual(sum, 4);
  assert.strictEqual(m.bandCounts.proficient, 3);
  assert.strictEqual(m.bandCounts.needs_retraining, 1);
});

test('Region 1 and Region 2 both populated', () => {
  const m = build(subs);
  assert.ok(m.regions['Region 1'], 'Region 1 missing');
  assert.ok(m.regions['Region 2'], 'Region 2 missing');
  assert.strictEqual(m.regions['Region 1'].totalSubmissions, 2);
  assert.strictEqual(m.regions['Region 2'].totalSubmissions, 2);
});

test('Region 1 avg = (100+0)/2 = 50%', () => {
  const m = build(subs);
  assert.strictEqual(m.regions['Region 1'].avgPct, 50);
});

test('Region 2 avg ≈ 96% (both pass)', () => {
  const m = build(subs);
  assert.ok(m.regions['Region 2'].avgPct >= 90, `expected >=90, got ${m.regions['Region 2'].avgPct}`);
});

test('Region 1 retraining rate = 50% (1 of 2)', () => {
  const m = build(subs);
  assert.strictEqual(m.regions['Region 1'].retrainingRate, 50);
});

test('Region 2 retraining rate = 0%', () => {
  const m = build(subs);
  assert.strictEqual(m.regions['Region 2'].retrainingRate, 0);
});

test('Per-region domain percentages computed', () => {
  const m = build(subs);
  const r1Domains = m.regions['Region 1'].domains;
  assert.ok(Object.keys(r1Domains).length > 0, 'no domain data for R1');
  for (const [, d] of Object.entries(r1Domains)) {
    assert.ok(typeof d.pct === 'number', `pct missing for domain`);
    assert.ok(d.pct >= 0 && d.pct <= 100, `pct out of range: ${d.pct}`);
  }
});

test('Rankings sorted by pct descending', () => {
  const m = build(subs);
  for (let i = 1; i < m.rankings.length; i++) {
    assert.ok(m.rankings[i-1].pct >= m.rankings[i].pct, `ranking out of order at ${i}`);
  }
});

test('Top-ranked tester is one of the perfect scorers', () => {
  const m = build(subs);
  assert.strictEqual(m.rankings[0].pct, 100);
});

test('Rankings include region tag for each tester', () => {
  const m = build(subs);
  for (const r of m.rankings) {
    assert.ok(r.region === 'Region 1' || r.region === 'Region 2', `bad region: ${r.region}`);
  }
});

test('Question difficulty aggregates across all 4 submissions', () => {
  const m = build(subs);
  const q1 = m.questionDifficulty[1];
  assert.ok(q1, 'Q1 missing');
  assert.strictEqual(q1.attempts, 4);
});

test('Flagged write-in reviews are surfaced', () => {
  const m = build(subs);
  // John (all wrong) had write-ins fully flagged; perfect scorers also flagged for review
  assert.ok(m.flaggedReviews.length > 0, 'expected flagged reviews');
});

test('Region 1 retraining alert fires when ≥40%', () => {
  const m = build(subs);
  const hit = m.alerts.some(a => a.message.includes('Region 1') && a.message.includes('retraining'));
  assert.ok(hit, 'expected Region 1 retraining alert');
});

section('Analytics — handles unassigned region gracefully');

test('Submissions without region land in "Unassigned"', () => {
  const noReg = [{ ...mkSubmission('orphan', 'Unassigned', PERFECT) }];
  const m = build(noReg);
  assert.ok(m.regions['Unassigned'], 'Unassigned bucket missing');
  assert.strictEqual(m.regions['Unassigned'].totalSubmissions, 1);
});

// ═══ SUMMARY ════════════════════════════════════════════════════════════════
console.log(`\n${'='.repeat(50)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed === 0 ? 0 : 1);
