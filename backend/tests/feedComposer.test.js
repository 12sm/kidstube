const { composeFeed } = require('../src/feedComposer');

// Helpers to build a pool. gaming ids start 'g', enrichment 'e', growth 'w'.
const vid = (id, channel) => ({ video_id: id, channel_id: channel || id });
const isGaming = v => v.video_id.startsWith('g');
const isGrowth = v => v.video_id.startsWith('w');

test('hits the target enrichment ratio (approx) for a full page', () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => vid('g' + i, 'gc' + i)),
    ...Array.from({ length: 20 }, (_, i) => vid('e' + i, 'ec' + i)),
  ];
  const out = composeFeed(pool, { ratio: 0.5, limit: 10, isGaming, isGrowth, growthMinPerPage: 0 });
  expect(out).toHaveLength(10);
  const enrich = out.filter(v => !isGaming(v)).length;
  expect(enrich).toBe(5); // round(10 * 0.5)
});

test('guarantees growth picks when available', () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => vid('g' + i, 'gc' + i)),
    ...Array.from({ length: 5 }, (_, i) => vid('w' + i, 'wc' + i)), // growth (also enrichment)
  ];
  const out = composeFeed(pool, { ratio: 0.2, limit: 10, isGaming, isGrowth, growthMinPerPage: 2 });
  expect(out.filter(isGrowth).length).toBeGreaterThanOrEqual(2);
});

test('backfills with gaming when enrichment is thin, still returns a full page', () => {
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => vid('g' + i, 'gc' + i)),
    vid('e0', 'ec0'), // only 1 enrichment available though ratio wants 5
  ];
  const out = composeFeed(pool, { ratio: 0.5, limit: 10, isGaming, isGrowth, growthMinPerPage: 0 });
  expect(out).toHaveLength(10);
  expect(out.filter(v => !isGaming(v)).length).toBe(1);
});

test('respects per-channel cap', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => vid('g' + i, 'SAME')), // all same channel
    ...Array.from({ length: 10 }, (_, i) => vid('e' + i, 'ec' + i)),
  ];
  const out = composeFeed(pool, { ratio: 0.2, limit: 10, isGaming, isGrowth, perChannelCap: 2, growthMinPerPage: 0 });
  expect(out.filter(v => v.channel_id === 'SAME').length).toBeLessThanOrEqual(2);
});

test('preserves input order within the gaming bucket', () => {
  const pool = [vid('g0','a'), vid('g1','b'), vid('g2','c')];
  const out = composeFeed(pool, { ratio: 0, limit: 3, isGaming, isGrowth, growthMinPerPage: 0 });
  expect(out.map(v => v.video_id)).toEqual(['g0', 'g1', 'g2']);
});

test('fills a full page when gaming is channel-capped but enrichment remains', () => {
  const pool = [
    ...Array.from({ length: 10 }, (_, i) => vid('g' + i, 'SAME')), // all gaming, one channel
    ...Array.from({ length: 10 }, (_, i) => vid('e' + i, 'ec' + i)), // abundant enrichment
  ];
  const out = composeFeed(pool, { ratio: 0.2, limit: 10, isGaming, isGrowth, perChannelCap: 2, growthMinPerPage: 0 });
  expect(out).toHaveLength(10); // not short — extra enrichment backfills past the ratio budget
  expect(out.filter(v => v.channel_id === 'SAME').length).toBeLessThanOrEqual(2);
});
