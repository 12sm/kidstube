// backend/tests/backfill.test.js
const { setupTestDb, teardownTestDb, seedProfile } = require('./helpers/testDb');

let db;
beforeEach(() => {
  db = setupTestDb();
  seedProfile(db, { id: 5, name: 'Weston' });
  seedProfile(db, { id: 6, name: 'Emery' });
});
afterEach(() => teardownTestDb(db));

const { buildCombinedProfile } = require('../src/childProfile');

describe('buildCombinedProfile', () => {
  test('returns generic fallback when no profiles exist', () => {
    const result = buildCombinedProfile(db);
    expect(result).toContain('ages 7-8');
  });

  test('returns single profile markdown when only one exists', () => {
    db.saveChildProfile(5, 'Weston loves space.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('Weston loves space.');
    expect(result).not.toContain('## Profile:');
  });

  test('combines both profiles with headers when both exist', () => {
    db.saveChildProfile(5, 'Weston loves space.');
    db.saveChildProfile(6, 'Emery loves animals.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('## Profile: Weston');
    expect(result).toContain('Weston loves space.');
    expect(result).toContain('## Profile: Emery');
    expect(result).toContain('Emery loves animals.');
  });

  test('returns generic fallback when profiles exist but markdown is empty', () => {
    db.saveChildProfile(5, '');
    db.saveChildProfile(6, '');
    const result = buildCombinedProfile(db);
    expect(result).toContain('ages 7-8');
  });
});
