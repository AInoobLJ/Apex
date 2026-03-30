import { describe, it, expect } from 'vitest';
import { detectSportsMarketType } from '../modules/domex-agents/sports-edge';

describe('detectSportsMarketType', () => {
  // ── FUTURES markets ──

  describe('FUTURES detection', () => {
    it('detects "make the playoffs" as FUTURES', () => {
      expect(detectSportsMarketType('Will the Golden State Warriors make the NBA Playoffs?')).toBe('FUTURES');
    });

    it('detects championship winners as FUTURES', () => {
      expect(detectSportsMarketType('Will Napoli win Serie A?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will the Lakers win the NBA?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will the Chiefs win the NFL?')).toBe('FUTURES');
    });

    it('detects cup/tournament winners as FUTURES', () => {
      expect(detectSportsMarketType('Will Real Madrid win the Champions League?')).toBe('FUTURES');
      expect(detectSportsMarketType('Who will win the Super Bowl?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will the Oilers win the Stanley Cup?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will Duke win March Madness?')).toBe('FUTURES');
      expect(detectSportsMarketType('World Cup winner 2026')).toBe('FUTURES');
    });

    it('detects MVP / awards as FUTURES', () => {
      expect(detectSportsMarketType('Will Luka Doncic win MVP?')).toBe('FUTURES');
      expect(detectSportsMarketType('2026 NBA MVP')).toBe('FUTURES');
      expect(detectSportsMarketType('Heisman Trophy winner 2026')).toBe('FUTURES');
    });

    it('detects season-level outcomes as FUTURES', () => {
      expect(detectSportsMarketType('Will Arsenal finish in top 4?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will Leicester be relegated?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will the Celtics make the postseason?')).toBe('FUTURES');
    });

    it('detects conference/division winners as FUTURES', () => {
      expect(detectSportsMarketType('Will the Bucks win the Eastern Conference?')).toBe('FUTURES');
      expect(detectSportsMarketType('Will the 49ers win the NFC?')).toBe('FUTURES');
    });

    it('uses closesAt heuristic for far-out markets without explicit keywords', () => {
      const sixtyOneDaysOut = new Date(Date.now() + 61 * 24 * 60 * 60 * 1000);
      expect(detectSportsMarketType('Golden State Warriors season outcome', sixtyOneDaysOut)).toBe('FUTURES');
    });
  });

  // ── MATCH markets ──

  describe('MATCH detection', () => {
    it('detects "vs" head-to-head as MATCH', () => {
      expect(detectSportsMarketType('Lakers vs Celtics')).toBe('MATCH');
      expect(detectSportsMarketType('Man City vs Arsenal')).toBe('MATCH');
    });

    it('detects "beat/defeat" as MATCH', () => {
      expect(detectSportsMarketType('Will the Dodgers beat the Yankees on March 30?')).toBe('MATCH');
      expect(detectSportsMarketType('Can Liverpool defeat Man United?')).toBe('MATCH');
    });

    it('detects time-specific match indicators as MATCH', () => {
      expect(detectSportsMarketType('Warriors game tonight')).toBe('MATCH');
      expect(detectSportsMarketType('Who wins this game?')).toBe('MATCH');
      expect(detectSportsMarketType('NBA moneyline pick today')).toBe('MATCH');
    });

    it('detects betting line references as MATCH', () => {
      expect(detectSportsMarketType('Chiefs spread -7.5')).toBe('MATCH');
      expect(detectSportsMarketType('Over/under 215.5 Lakers game')).toBe('MATCH');
    });
  });

  // ── UNKNOWN markets ──

  describe('UNKNOWN (ambiguous) markets', () => {
    it('returns UNKNOWN for ambiguous sports titles without closesAt', () => {
      expect(detectSportsMarketType('Golden State Warriors')).toBe('UNKNOWN');
      expect(detectSportsMarketType('What happens with the Celtics?')).toBe('UNKNOWN');
    });

    it('returns UNKNOWN for near-term ambiguous titles', () => {
      const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      expect(detectSportsMarketType('Golden State Warriors outcome', tenDaysOut)).toBe('UNKNOWN');
    });
  });

  // ── Edge cases: futures should NOT match match-like titles ──

  describe('edge cases', () => {
    it('FUTURES patterns take priority over MATCH patterns', () => {
      // "vs" is a MATCH keyword but "win the Super Bowl" is FUTURES
      // FUTURES is checked first, so this should be FUTURES
      expect(detectSportsMarketType('Will the team that beat the Eagles win the Super Bowl?')).toBe('FUTURES');
    });

    it('closesAt within 60 days does not trigger futures heuristic', () => {
      const thirtyDaysOut = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      expect(detectSportsMarketType('Some random sports question', thirtyDaysOut)).toBe('UNKNOWN');
    });
  });
});
