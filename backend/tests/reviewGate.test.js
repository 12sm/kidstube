// backend/tests/reviewGate.test.js
const { setupTestDb, seedProfile, seedVideo, seedTag, teardownTestDb } = require('./helpers/testDb');
const reviewGate = require('../src/reviewGate');
const { buildSystemPrompt } = require('../src/llm');
const { reviewPendingImports } = require('../src/cron');

const EMERY = 'Emery is nearly 5, Pre-K. Loves gaming and pets.';
const WESTON = 'Weston is an 8-year-old second grader who loves space.';

let db;
beforeAll(() => { db = setupTestDb(); reviewGate.ensureSchema(db); });
afterEach(() => {
  db.getDb().prepare('DELETE FROM video_reviews').run();
  teardownTestDb(db);
});

function seedFamily() {
  seedProfile(db, { id: 5, name: 'Weston' });
  seedProfile(db, { id: 6, name: 'Emery' });
  db.saveChildProfile(5, WESTON);
  db.saveChildProfile(6, EMERY);
}

function seedSearchVideo(id, { title = 'Search video', needsReview = 1, source = 'search', status = 'approved', channel = 'sc' } = {}) {
  seedVideo(db, { video_id: id, channel_id: channel, title, status });
  db.getDb().prepare('UPDATE videos SET discovery_source = ?, needs_llm_review = ? WHERE video_id = ?').run(source, needsReview, id);
}

const approve = jest.fn(async () => ({ approved: true, reason: null, tags: ['minecraft'] }));
const reject  = jest.fn(async () => ({ approved: false, reason: 'scary themes', tags: ['horror'] }));
const boom    = jest.fn(async () => { throw new Error('LLM review timed out after 8000ms'); });
beforeEach(() => { approve.mockClear(); reject.mockClear(); boom.mockClear(); });

describe('per-profile prompt', () => {
  test("judges for the watching child's age, not ages 7-8", () => {
    const p = buildSystemPrompt(EMERY, { strict: true });
    expect(p).toContain('The viewer is 5 years old');
    expect(p).toContain(EMERY);
    expect(p).toContain('When genuinely unsure whether it is safe, reject.');
    expect(p).toContain('you judge safety for this age, not taste');
    expect(p).not.toMatch(/7[-–]8/);
  });

  test('with no profile, falls back to a young child, never 7-8', () => {
    const p = buildSystemPrompt(null);
    expect(p).toContain('assume about 5 years old');
    expect(p).not.toMatch(/7[-–]8/);
  });

  test('channel (non-strict) reviews keep the lenient tie-break', () => {
    expect(buildSystemPrompt(WESTON)).toContain('When in doubt, approve.');
  });
});

describe('resolveReviewProfile', () => {
  test("uses the child's own profile and age", () => {
    seedFamily();
    expect(reviewGate.resolveReviewProfile(db, 6)).toMatchObject({ markdown: EMERY, age: 5, source: 'profile' });
    expect(reviewGate.resolveReviewProfile(db, 5)).toMatchObject({ markdown: WESTON, age: 8, source: 'profile' });
  });

  test('an unknown or empty profile falls back to the youngest child', () => {
    seedFamily();
    db.saveChildProfile(5, '');
    expect(reviewGate.resolveReviewProfile(db, 5)).toMatchObject({ markdown: EMERY, age: 5, source: 'youngest' });
    expect(reviewGate.resolveReviewProfile(db, null)).toMatchObject({ markdown: EMERY, age: 5, source: 'youngest' });
  });

  test('no profiles at all: no profile text, judged as about 5', () => {
    seedProfile(db, { id: 5 });
    expect(reviewGate.resolveReviewProfile(db, 5)).toMatchObject({ markdown: null, age: 5, source: 'fallback' });
  });

  test('a profile without a stated age borrows the youngest stated age', () => {
    seedFamily();
    db.saveChildProfile(5, 'Loves space and capybaras.');
    expect(reviewGate.resolveReviewProfile(db, 5).age).toBe(5);
  });
});

describe('checkPlayable (the gate)', () => {
  test('a search result is reviewed for the watching child before it plays, then cached', async () => {
    seedFamily();
    seedSearchVideo('s1');
    const r = await reviewGate.checkPlayable(db, 's1', 6, { review: approve });
    expect(r).toEqual({ playable: true });
    expect(approve).toHaveBeenCalledTimes(1);
    const opts = approve.mock.calls[0][1];
    expect(opts).toMatchObject({ childProfile: EMERY, age: 5, strict: true });

    await reviewGate.checkPlayable(db, 's1', 6, { review: approve });
    expect(approve).toHaveBeenCalledTimes(1); // cached per video + profile

    await reviewGate.checkPlayable(db, 's1', 5, { review: approve });
    expect(approve).toHaveBeenCalledTimes(2); // other child gets their own review
    expect(approve.mock.calls[1][1]).toMatchObject({ childProfile: WESTON, age: 8 });
  });

  test('a rejected result is not playable', async () => {
    seedFamily();
    seedSearchVideo('s2');
    expect(await reviewGate.checkPlayable(db, 's2', 6, { review: reject })).toEqual({ playable: false, reason: 'rejected' });
    expect(reviewGate.getVerdict(db, 's2', 6)).toMatchObject({ verdict: 'rejected', reason: 'scary themes', age: 5 });
  });

  test('fails closed when the LLM errors or times out, and does not cache the failure', async () => {
    seedFamily();
    seedSearchVideo('s3');
    expect(await reviewGate.checkPlayable(db, 's3', 6, { review: boom })).toEqual({ playable: false, reason: 'review_failed' });
    expect(reviewGate.getVerdict(db, 's3', 6)).toBeNull();
    // next attempt retries
    expect(await reviewGate.checkPlayable(db, 's3', 6, { review: approve })).toEqual({ playable: true });
  });

  test('stale approvals from the old nightly run (needs_llm_review = 0) are still gated', async () => {
    seedFamily();
    seedSearchVideo('old', { needsReview: 0 });
    expect(await reviewGate.checkPlayable(db, 'old', 6, { review: reject })).toEqual({ playable: false, reason: 'rejected' });
  });

  test('enrichment videos are gated too', async () => {
    seedFamily();
    seedSearchVideo('e1', { source: 'enrichment' });
    await reviewGate.checkPlayable(db, 'e1', 6, { review: approve });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  test('parent-approved channel videos play without an extra review', async () => {
    seedFamily();
    seedVideo(db, { video_id: 'sub1' });
    expect(await reviewGate.checkPlayable(db, 'sub1', 6, { review: boom })).toEqual({ playable: true });
    expect(boom).not.toHaveBeenCalled();
  });

  test('unknown and rejected videos are not playable', async () => {
    seedFamily();
    seedVideo(db, { video_id: 'rej', status: 'rejected' });
    expect(await reviewGate.checkPlayable(db, 'nope', 6, { review: approve })).toEqual({ playable: false, reason: 'not_found' });
    expect(await reviewGate.checkPlayable(db, 'rej', 6, { review: approve })).toEqual({ playable: false, reason: 'not_approved' });
  });
});

describe('runLlmReviewStrict', () => {
  const { runLlmReviewStrict, parseResponseStrict } = require('../src/llm');

  test('throws (never approves) with no API key', async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(runLlmReviewStrict({ title: 'x' }, {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  });

  test('an unparseable reply is an error, not an approval', () => {
    expect(() => parseResponseStrict('I think it is fine')).toThrow();
    expect(() => parseResponseStrict('{"reason":"x"}')).toThrow();
    expect(parseResponseStrict('{"approved":false,"reason":"scary"}')).toMatchObject({ approved: false, reason: 'scary' });
  });
});

describe('gateSearchResults', () => {
  test('drops rejected and failed results, keeps approved and parent-approved ones', async () => {
    seedFamily();
    seedVideo(db, { video_id: 'sub1' });
    seedSearchVideo('good');
    seedSearchVideo('bad');
    seedSearchVideo('err');
    const review = jest.fn(async (video) => {
      if (video.video_id === 'bad') return { approved: false, reason: 'kidnapping', tags: [] };
      if (video.video_id === 'err') throw new Error('timeout');
      return { approved: true, reason: null, tags: [] };
    });
    const out = await reviewGate.gateSearchResults(db, 6,
      ['sub1', 'good', 'bad', 'err'].map(video_id => ({ video_id })), { review });
    expect(out.map(v => v.video_id)).toEqual(['sub1', 'good']);
  });
});

describe('hideRejectedFor', () => {
  test("hides only this child's rejected videos", async () => {
    seedFamily();
    seedSearchVideo('x');
    await reviewGate.checkPlayable(db, 'x', 6, { review: reject });
    const list = [{ video_id: 'x' }, { video_id: 'y' }];
    expect(reviewGate.hideRejectedFor(db, 6, list).map(v => v.video_id)).toEqual(['y']);
    expect(reviewGate.hideRejectedFor(db, 5, list).map(v => v.video_id)).toEqual(['x', 'y']);
  });
});

describe('findSuggestion', () => {
  test('suggests a playable video on a similar topic, never an unreviewed or blocked one', async () => {
    seedFamily();
    seedSearchVideo('blocked', { title: 'Scary Minecraft night' });
    seedTag(db, 'blocked', 'minecraft');
    seedSearchVideo('unreviewed', { title: 'Minecraft other' });
    seedTag(db, 'unreviewed', 'minecraft');
    seedVideo(db, { video_id: 'blockedchan', channel_id: 'nope', title: 'Minecraft blocked channel' });
    seedTag(db, 'blockedchan', 'minecraft');
    db.getDb().prepare('INSERT INTO channels (channel_id, profile_id, channel_name, whitelisted) VALUES (?,?,?,0)').run('nope', 6, 'Nope');
    seedVideo(db, { video_id: 'safe', channel_id: 'good', title: 'Minecraft building for kids' });
    seedTag(db, 'safe', 'minecraft');
    seedVideo(db, { video_id: 'other', channel_id: 'good', title: 'Cooking' });
    seedTag(db, 'other', 'cooking');

    await reviewGate.checkPlayable(db, 'blocked', 6, { review: reject });
    const s = reviewGate.findSuggestion(db, 'blocked', 6);
    expect(s).toMatchObject({ video_id: 'safe', title: 'Minecraft building for kids' });
  });

  test('falls back to title keywords when the blocked video has no tags', () => {
    seedFamily();
    seedSearchVideo('blocked', { title: 'Dinosaur hunt gone wrong' });
    seedVideo(db, { video_id: 'dino', channel_id: 'good', title: 'Dinosaur facts' });
    expect(reviewGate.findSuggestion(db, 'blocked', 6)).toMatchObject({ video_id: 'dino' });
  });
});

describe('nightly reviewPendingImports', () => {
  const run = (review) => reviewPendingImports({ rejected: 0 }, { delayMs: 0, review });

  test("reviews each pending video once per child with that child's profile", async () => {
    seedFamily();
    seedSearchVideo('p1');
    const review = jest.fn(async (video, opts) => (
      opts.age === 5 ? { approved: false, reason: 'too scary for 5', tags: [] } : { approved: true, reason: null, tags: [] }
    ));
    await run(review);
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls.map(c => c[1].childProfile).sort()).toEqual([EMERY, WESTON].sort());
    const v = db.getVideoById('p1');
    expect(v.status).toBe('approved');           // still fine for Weston
    expect(v.needs_llm_review).toBe(0);
    expect(reviewGate.getVerdict(db, 'p1', 6).verdict).toBe('rejected'); // hidden for Emery
    expect(reviewGate.getVerdict(db, 'p1', 5).verdict).toBe('approved');
  });

  test('rejected for every child -> rejected outright', async () => {
    seedFamily();
    seedSearchVideo('p2');
    await run(reject);
    const v = db.getVideoById('p2');
    expect(v.status).toBe('rejected');
    expect(v.rejection_reason).toBe('LLM: scary themes');
  });

  test('an LLM error leaves the video pending and gated', async () => {
    seedFamily();
    seedSearchVideo('p3');
    await run(boom);
    const v = db.getVideoById('p3');
    expect(v.needs_llm_review).toBe(1);
    expect(await reviewGate.checkPlayable(db, 'p3', 6, { review: boom })).toMatchObject({ playable: false });
  });
});
