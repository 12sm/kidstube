// Idempotent seed for profile 6 (Emery) adaptive enrichment.
// Run: docker exec kidstube-backend node /app/scripts/seed-enrichment.js
const db = require('../src/db');

const PROFILE = 6;

// SolarBalls — verified 2026-06-26 via YouTube search result URL:
// https://www.youtube.com/channel/UCQF0f62JXnfFSxKDmN8SDUg
// NOTE: brief contained UCEMOYP1uFlfsZsa-aQU2-cw which was INCORRECT.
const ENRICHMENT_CHANNELS = [
  { channel_id: 'UCQF0f62JXnfFSxKDmN8SDUg', label: 'SolarBalls' },
];
const ENRICHMENT_TOPICS = [
  { value: 'funny animals for kids', label: 'Funny animals' },
  { value: 'space for kids', label: 'Space' },
  { value: 'solar system for kids', label: 'Solar system' },
];

function main() {
  for (const ch of ENRICHMENT_CHANNELS) {
    db.upsertChannel({ channel_id: ch.channel_id, profile_id: PROFILE, channel_name: ch.label, thumbnail_url: null, whitelisted: 1 });
    db.addEnrichmentSource({ profile_id: PROFILE, type: 'channel', value: ch.channel_id, label: ch.label });
    console.log('channel source:', ch.label);
  }
  for (const t of ENRICHMENT_TOPICS) {
    db.addEnrichmentSource({ profile_id: PROFILE, type: 'topic', value: t.value, label: t.label });
    console.log('topic source:', t.value);
  }
  // Reproducible tag-suppression cleanup (already applied live; idempotent here).
  db.upsertTagSetting(PROFILE, 'minecraft', 1.0, null);
  db.upsertTagSetting(PROFILE, 'gaming', 1.0, null);
  db.upsertTagSetting(PROFILE, 'family-friendly', 1.0, null);
  db.upsertTagSetting(PROFILE, 'storytelling', 0.5, 2.0);
  console.log('tag settings normalized.');
  console.log('enrichment sources now:', JSON.stringify(db.getEnrichmentSources(PROFILE), null, 2));
}

main();
