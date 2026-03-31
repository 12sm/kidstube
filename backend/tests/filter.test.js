const { isShort } = require('../src/filter');

describe('isShort', () => {
  test('rejects videos 60 seconds or under', () => {
    expect(isShort({ duration_seconds: 60 })).toBe(true);
    expect(isShort({ duration_seconds: 59 })).toBe(true);
    expect(isShort({ duration_seconds: 61 })).toBe(false);
  });

  test('rejects #shorts in title (case-insensitive)', () => {
    expect(isShort({ title: 'Cool video #Shorts' })).toBe(true);
    expect(isShort({ title: 'cool #short thing' })).toBe(true);
    expect(isShort({ title: 'Cool video' })).toBe(false);
  });

  test('rejects #short in description', () => {
    expect(isShort({ description: 'Watch this #shorts' })).toBe(true);
  });

  test('rejects #short in tags array', () => {
    expect(isShort({ tags: ['minecraft', '#short', 'gaming'] })).toBe(true);
    expect(isShort({ tags: ['minecraft', 'gaming'] })).toBe(false);
  });

  test('rejects when yt-dlp is_short flag is true', () => {
    expect(isShort({ is_short: true })).toBe(true);
    expect(isShort({ is_short: false })).toBe(false);
  });

  test('rejects vertical video (height > width)', () => {
    expect(isShort({ width: 1080, height: 1920 })).toBe(true);
    expect(isShort({ width: 1920, height: 1080 })).toBe(false);
    expect(isShort({ width: 1920, height: 1920 })).toBe(false); // square is not a short
  });

  test('returns false for a normal video with no signals', () => {
    expect(isShort({
      duration_seconds: 300,
      title: 'Minecraft lets play',
      tags: ['minecraft', 'gaming'],
      is_short: false,
      width: 1920,
      height: 1080
    })).toBe(false);
  });

  test('returns false when no fields present', () => {
    expect(isShort({})).toBe(false);
  });
});
