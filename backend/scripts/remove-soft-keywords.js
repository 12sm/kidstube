#!/usr/bin/env node
// backend/scripts/remove-soft-keywords.js
// Removes contextual keywords that are better handled by LLM than hard blocks.
// Safe to re-run — DELETE WHERE is idempotent.

const db = require('../src/db');

db.migrate();

const SOFT_KEYWORDS = ['die', 'death', 'scary', 'violence'];

const existing = db.getDb()
  .prepare(`SELECT id, value FROM filter_rules WHERE rule_type='keyword_block' AND value IN (${SOFT_KEYWORDS.map(() => '?').join(',')})`)
  .all(...SOFT_KEYWORDS);

if (existing.length === 0) {
  console.log('No soft keywords found — already removed or never existed.');
  process.exit(0);
}

console.log('Removing soft keywords:');
existing.forEach(r => console.log(`  [${r.id}] ${r.value}`));

db.getDb()
  .prepare(`DELETE FROM filter_rules WHERE rule_type='keyword_block' AND value IN (${SOFT_KEYWORDS.map(() => '?').join(',')})`)
  .run(...SOFT_KEYWORDS);

console.log(`Removed ${existing.length} keyword rule(s).`);
console.log('Remaining keyword rules:');
const remaining = db.getDb().prepare("SELECT id, value FROM filter_rules WHERE rule_type='keyword_block'").all();
remaining.forEach(r => console.log(`  [${r.id}] ${r.value}`));
