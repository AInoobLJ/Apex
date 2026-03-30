import { describe, it, expect } from 'vitest';
import { jaccardSimilarity, normalizeText } from '../services/market-matcher';

describe('Market Matcher — Pure Functions', () => {
  describe('normalizeText', () => {
    it('lowercases and strips punctuation', () => {
      expect(normalizeText('Fed Rate Cut: June 2025!')).toBe('fed rate cut june 2025');
    });

    it('collapses multiple spaces', () => {
      expect(normalizeText('  hello   world  ')).toBe('hello world');
    });
  });

  describe('jaccardSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
      expect(jaccardSimilarity('Fed rate cut June', 'Fed rate cut June')).toBe(1.0);
    });

    it('returns high similarity for overlapping market titles', () => {
      const sim = jaccardSimilarity(
        'Fed rate cut June 2025',
        'Fed rate cut June 2025 decision'
      );
      // 5 out of 6 unique words overlap → 5/6 ≈ 0.83
      expect(sim).toBeGreaterThan(0.7);
    });

    it('returns low similarity for unrelated titles', () => {
      const sim = jaccardSimilarity(
        'Will Bitcoin exceed $200K?',
        'Will the Lakers win the NBA championship?'
      );
      // Only "will" and "the" overlap
      expect(sim).toBeLessThan(0.3);
    });

    it('returns 0 for completely disjoint strings', () => {
      const sim = jaccardSimilarity('alpha beta', 'gamma delta');
      expect(sim).toBe(0);
    });

    it('is case-insensitive', () => {
      expect(jaccardSimilarity('HELLO WORLD', 'hello world')).toBe(1.0);
    });

    it('ignores punctuation differences', () => {
      expect(jaccardSimilarity('Rate cut, June!', 'Rate cut June')).toBe(1.0);
    });
  });
});
