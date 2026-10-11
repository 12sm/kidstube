// backend/tests/backfill.test.js
const { setupTestDb, teardownTestDb, seedProfile } = require('./helpers/testDb');

let db;
beforeEach(() => {
  db = setupTestDb();
  seedProfile(db, { id: 5, name: 'Child1' });
  seedProfile(db, { id: 6, name: 'Child2' });
});
afterEach(() => teardownTestDb(db));

const { buildCombinedProfile } = require('../src/childProfile');

describe('buildCombinedProfile', () => {
  test('returns young-child fallback (never ages 7-8) when no profiles exist', () => {
    const result = buildCombinedProfile(db);
    expect(result).toContain('assume about 5 years old');
    expect(result).not.toMatch(/7[-–]8/);
  });

  test('returns single profile markdown when only one exists', () => {
    db.saveChildProfile(5, 'Child1 loves space.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('Child1 loves space.');
    expect(result).not.toContain('## Profile:');
  });

  test('combines both profiles with headers when both exist', () => {
    db.saveChildProfile(5, 'Child1 loves space.');
    db.saveChildProfile(6, 'Child2 loves animals.');
    const result = buildCombinedProfile(db);
    expect(result).toContain('## Profile: Child1');
    expect(result).toContain('Child1 loves space.');
    expect(result).toContain('## Profile: Child2');
    expect(result).toContain('Child2 loves animals.');
  });

  test('returns young-child fallback when profiles exist but markdown is empty', () => {
    db.saveChildProfile(5, '');
    db.saveChildProfile(6, '');
    const result = buildCombinedProfile(db);
    expect(result).toContain('assume about 5 years old');
    expect(result).not.toMatch(/7[-–]8/);
  });
});
