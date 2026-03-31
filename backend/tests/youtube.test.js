const { parseTopicCategories } = require('../src/youtube');

describe('parseTopicCategories', () => {
  test('extracts article slugs from Wikipedia URLs', () => {
    const input = [
      'https://en.wikipedia.org/wiki/Minecraft',
      'https://en.wikipedia.org/wiki/Video_game'
    ];
    expect(parseTopicCategories(input)).toEqual(['Minecraft', 'Video game']);
  });

  test('converts underscores to spaces', () => {
    expect(parseTopicCategories(['https://en.wikipedia.org/wiki/Outer_space'])).toEqual(['Outer space']);
  });

  test('decodes percent-encoded characters', () => {
    expect(parseTopicCategories(['https://en.wikipedia.org/wiki/Science_%26_Technology'])).toEqual(['Science & Technology']);
  });

  test('skips malformed URLs', () => {
    expect(parseTopicCategories(['https://example.com/notawiki', 'https://en.wikipedia.org/wiki/Cats'])).toEqual(['Cats']);
  });

  test('returns empty array for non-array input', () => {
    expect(parseTopicCategories(null)).toEqual([]);
    expect(parseTopicCategories(undefined)).toEqual([]);
    expect(parseTopicCategories('string')).toEqual([]);
  });

  test('returns empty array for empty array', () => {
    expect(parseTopicCategories([])).toEqual([]);
  });
});
