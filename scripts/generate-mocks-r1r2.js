/**
 * DIS Mock Generator — 10 tests: 5 in Region 1, 5 in Region 2
 */
const fs = require('fs');
const path = require('path');
const QUESTIONS = require('../netlify/functions/_questions.json');

const CORRECT_MC = {1:'a',2:'c',3:'b',4:'c',5:'c',6:'c',7:'b',8:'a',9:'b',10:'b',11:'b',12:'b',14:'a',16:'b',20:'b'};
const CORRECT_MS = {18:['a','c']};
const CORRECT_WRITE = {
  13: "Stage: Early Non-Primary Non-Secondary. Evidence: specific patient-described primary sign/chancre within the previous 12 months.",
  15: "Stage: Early Non-Primary Non-Secondary. Criterion: epidemiologic linkage to a partner independently documented with syphilis during the previous 12 months.",
  17: "Base stage: Syphilis, Unknown Duration. Sub-classification: Ocular Syphilis, Likely (probable) — no direct-detection testing on ocular fluid.",
  19: "No, Secondary Probable Path B is not available because a returned nonreactive treponemal test disqualifies Path B; Path B requires no concurrent nonreactive treponemal result."
};
const WRONG_MC = {1:'c',2:'a',3:'d',4:'a',5:'d',6:'a',7:'a',8:'d',9:'d',10:'a',11:'a',12:'c',14:'d',16:'c',20:'a'};

function mcAll(correct) {
  const out = {};
  for (const [id, key] of Object.entries(CORRECT_MC)) out[id] = correct ? key : WRONG_MC[id] || 'b';
  return out;
}

function rubricScore(ans, rub) {
  if (!ans || !rub || !rub.groups) return {m:0,t:0};
  const t = String(ans).toLowerCase();
  let m=0;
  for (const g of rub.groups) if (g.some(k => t.includes(k.toLowerCase()))) m++;
  return {matched:m, total:rub.groups.length};
}

function scoreOne(q, resp) {
  if (q.type==='mc') return {e:resp===q.correct?q.points:0,m:q.points,c:resp===q.correct,f:false};
  if (q.type==='ms') {
    const p=Array.isArray(resp)?resp:[], cs=new Set(q.correct);
    const w=p.filter(x=>!cs.has(x)), r=p.filter(x=>cs.has(x));
    if(!w.length && r.length===q.correct.length) return {e:q.points,m:q.points,c:true,f:false};
    if(q.partialCredit && !w.length && r.length>0) return {e:1,m:q.points,c:false,f:false};
    return {e:0,m:q.points,c:false,f:false};
  }
  if (q.type==='write') {
    const s=rubricScore(resp,q.rubric);
    let e=0;
    if(s.total>0 && s.matched===s.total) e=q.points;
    else if(s.matched>0) e=Math.floor(q.points/2);
    return {e,m:q.points,c:e===q.points,f:true,rm:s.matched,rt:s.total};
  }
  return {e:0,m:q.points||0,c:false,f:false};
}

function gradeAll(responses) {
  const items=[], domains={}, flagged=[];
  let earned=0, max=0;
  for (const q of QUESTIONS) {
    const resp = responses[q.id];
    const s = scoreOne(q, resp);
    earned+=s.e; max+=s.m;
    const d=q.domain;
    if(!domains[d]) domains[d]={earned:0,max:0,total:0,correct:0};
    domains[d].earned+=s.e; domains[d].max+=s.m; domains[d].total+=1;
    if(s.c) domains[d].correct+=1;
    items.push({id:q.id,domain:d,type:q.type,response:resp??null,earned:s.e,max:s.m,correct:s.c,flagForReview:s.f,rubricMatched:s.rm,rubricTotal:s.rt});
    if(s.f) flagged.push(q.id);
  }
  for (const d of Object.values(domains)) d.pct = d.max ? Math.round((d.earned/d.max)*100) : 0;
  const pct = max ? Math.round((earned/max)*100) : 0;
  const band = pct>=85?'proficient':pct>=70?'needs_reinforcement':'needs_retraining';
  return {items,earned,max,pct,band,domains,flagged};
}

const MOCKS = [
  // ── REGION 1 (5 tests) ──
  // 1. Perfect — 100%
  {token:'R1-Alice', region:'Region 1', r:{...mcAll(true),18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:CORRECT_WRITE[19]}},
  // 2. Strong proficient — 92% (miss Q12, Q20)
  {token:'R1-Bob', region:'Region 1', r:{...mcAll(true),12:'a',20:'d',18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:CORRECT_WRITE[19]}},
  // 3. Borderline — 81% (miss Q4, Q6, Q20, partial Q17)
  {token:'R1-Carlos', region:'Region 1', r:{...mcAll(true),4:'d',6:'d',20:'d',18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:"The base stage is Unknown Duration. Sub-classification: Ocular Syphilis.",19:CORRECT_WRITE[19]}},
  // 4. Needs reinforcement — 73% (miss Q3, Q8, Q12, Q16, partial Q15)
  {token:'R1-Diana', region:'Region 1', r:{...mcAll(true),3:'a',8:'c',12:'c',16:'c',18:['a','c'],13:CORRECT_WRITE[13],15:"Early NPNS stage. Based on partner exposure.",17:CORRECT_WRITE[17],19:CORRECT_WRITE[19]}},
  // 5. Needs retraining — 58% (miss Q1, Q3, Q6, Q7, Q12, Q16, Q20, partial Q18)
  {token:'R1-Eric', region:'Region 1', r:{...mcAll(true),1:'d',3:'a',6:'d',7:'c',12:'d',16:'d',20:'a',18:['a'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:CORRECT_WRITE[19]}},

  // ── REGION 2 (5 tests) ──
  // 6. Strong proficient — 92% (miss Q1, Q9)
  {token:'R2-Fiona', region:'Region 2', r:{...mcAll(true),1:'c',9:'d',18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:CORRECT_WRITE[19]}},
  // 7. Needs reinforcement — 77% (miss Q2, Q5, Q11, Q16, partial Q19)
  {token:'R2-George', region:'Region 2', r:{...mcAll(true),2:'d',5:'a',11:'c',16:'d',18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:"No."}},
  // 8. Needs reinforcement — 69% (miss Q2, Q5, Q11, Q14, Q16, partial Q19)
  {token:'R2-Hannah', region:'Region 2', r:{...mcAll(true),2:'d',5:'a',11:'c',14:'d',16:'d',18:['a','c'],13:CORRECT_WRITE[13],15:CORRECT_WRITE[15],17:CORRECT_WRITE[17],19:"no."}},
  // 9. Needs retraining — 35% (heavy misses + partial write-ins)
  {token:'R2-Ivan', region:'Region 2', r:{...mcAll(true),1:'c',4:'a',6:'d',7:'d',8:'b',9:'c',10:'d',12:'d',14:'b',16:'a',20:'d',18:['b'],13:"idk",15:"unknown",17:"ocular likely",19:"yes"}},
  // 10. Needs retraining — 12% (near total failure)
  {token:'R2-Jasmine', region:'Region 2', r:{...mcAll(true),1:'c',2:'a',3:'d',4:'a',5:'b',6:'b',7:'c',8:'c',9:'a',10:'c',11:'d',12:'a',14:'c',16:'d',18:['b','d'],13:"",15:"",17:"",19:""}},
];

// ─── Generate ───
const submissionsPath = path.join(__dirname, '..', 'data', 'submissions.json');
fs.mkdirSync(path.dirname(submissionsPath), { recursive: true });

const records = [];

console.log('========================================');
console.log('  DIS ASSESSMENT — 10 MOCK SUBMISSIONS');
console.log('  Region 1: 5 tests | Region 2: 5 tests');
console.log('========================================');

for (const mock of MOCKS) {
  const graded = gradeAll(mock.r);
  const record = {
    token: mock.token,
    region: mock.region,
    earned: graded.earned, max: graded.max, pct: graded.pct, band: graded.band,
    domains: graded.domains, items: graded.items, flagged: graded.flagged,
    timestamp: new Date(Date.now() - Math.floor(Math.random() * 7 * 86400000)).toISOString()
  };
  records.push(record);
  const bar = '█'.repeat(Math.ceil(graded.pct/5)) + '░'.repeat(20-Math.ceil(graded.pct/5));
  const labels = {proficient:'✅ PROFICIENT', needs_reinforcement:'⚠️  REINFORCEMENT', needs_retraining:'❌ RETRAINING'};
  console.log(`${mock.region.padEnd(10)} ${mock.token.padEnd(14)} ${bar} ${String(graded.pct+'%').padStart(4)} ${labels[graded.band]}`);
}

console.log('========================================');

fs.writeFileSync(submissionsPath, JSON.stringify(records, null, 2));

// Stats
const r1 = records.filter(r=>r.region==='Region 1'), r2 = records.filter(r=>r.region==='Region 2');
const avg = arr => Math.round(arr.reduce((a,b)=>a+b.pct,0)/arr.length);
console.log(`\nRegion 1 avg: ${avg(r1)}% | Region 2 avg: ${avg(r2)}%`);
console.log(`Region 1: ${r1.map(r=>r.token+'('+r.pct+'%)').join(', ')}`);
console.log(`Region 2: ${r2.map(r=>r.token+'('+r.pct+'%)').join(', ')}`);
console.log(`\n✅ Written to ${submissionsPath}`);
