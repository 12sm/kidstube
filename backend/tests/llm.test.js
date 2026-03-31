const { smartSampleTranscript } = require('../src/llm');

describe('smartSampleTranscript', () => {
  test('returns empty string for null transcript', () => {
    expect(smartSampleTranscript(null, 300)).toBe('');
    expect(smartSampleTranscript(undefined, 300)).toBe('');
  });

  test('returns up to 3000 chars for short videos (under 3 min)', () => {
    const transcript = 'x'.repeat(5000);
    const result = smartSampleTranscript(transcript, 150);
    expect(result).toBe('x'.repeat(3000));
  });

  test('returns full transcript if it fits within 3000 chars', () => {
    const transcript = 'x'.repeat(500);
    const result = smartSampleTranscript(transcript, 150);
    expect(result).toBe('x'.repeat(500));
  });

  test('returns smart front+middle+end sample for long videos (over 3 min)', () => {
    // 9000 char transcript, video is 400s
    const transcript = Array.from({ length: 9000 }, (_, i) => String.fromCharCode(65 + (i % 3))).join('');
    const result = smartSampleTranscript(transcript, 400);
    // Should start with first 1000 chars
    expect(result.startsWith(transcript.slice(0, 1000))).toBe(true);
    // Should end with last 1000 chars
    expect(result.endsWith(transcript.slice(-1000))).toBe(true);
    // Length: 3000 chars + 2 separator strings '\n...\n' = 3010
    expect(result.length).toBeLessThanOrEqual(3020);
  });

  test('handles transcript shorter than 3 chunks gracefully', () => {
    const transcript = 'hello world';
    expect(smartSampleTranscript(transcript, 400)).toBe('hello world');
  });
});
