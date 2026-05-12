// Strips correct-answers/rubrics from the private question bank
// and writes the public copy that index.html fetches.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'netlify', 'functions', '_questions.json');
const dest = path.join(__dirname, '..', 'public', 'questions.json');

const bank = JSON.parse(fs.readFileSync(src, 'utf8'));
const stripped = bank.map(q => {
  const { correct, rubric, displayDomain, domain, ...rest } = q;
  return { ...rest, domain: displayDomain || domain };
});
fs.writeFileSync(dest, JSON.stringify(stripped, null, 2));
console.log(`Wrote ${stripped.length} public questions -> ${dest}`);
