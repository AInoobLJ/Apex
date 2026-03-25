import { describe, it, expect } from 'vitest';
import {
  formatArbAlert,
  formatNewEdgeAlert,
  formatModuleFailureAlert,
  formatEdgeEvaporationAlert,
} from '../services/alert-templates';
import type { ArbOpportunity } from '../modules/arbex';

describe('Alert Templates', () => {
  describe('formatArbAlert', () => {
    it('formats intra-platform arb with URGENT flag', () => {
      const arb: ArbOpportunity = {
        type: 'INTRA_PLATFORM',
        urgency: 'URGENT',
        marketId: 'mkt-1',
        marketTitle: 'Will BTC hit $100K?',
        platform: 'KALSHI',
        yesPrice: 0.40,
        noPrice: 0.40,
        grossSpread: 0.20,
        totalFees: 0.05,
        netProfit: 0.015,
        contracts: 10,
      };

      const msg = formatArbAlert(arb);
      expect(msg).toContain('ARB ALERT');
      expect(msg).toContain('URGENT');
      expect(msg).toContain('Intra-Platform');
      expect(msg).toContain('KALSHI');
      expect(msg).toContain('$0.40');
      expect(msg).toContain('Execute immediately');
    });

    it('formats cross-platform arb with platform details', () => {
      const arb: ArbOpportunity = {
        type: 'CROSS_PLATFORM',
        urgency: 'URGENT',
        marketId: 'mkt-1',
        marketTitle: 'Fed rate cut?',
        platform: 'KALSHI',
        yesPrice: 0.45,
        noPrice: 0.48,
        grossSpread: 0.07,
        totalFees: 0.02,
        netProfit: 0.005,
        contracts: 10,
        crossPlatformMarketId: 'mkt-2',
        crossPlatformTitle: 'Will Fed cut rates?',
        yesPlatform: 'KALSHI',
        noPlatform: 'POLYMARKET',
        similarity: 0.72,
      };

      const msg = formatArbAlert(arb);
      expect(msg).toContain('Cross-Platform');
      expect(msg).toContain('KALSHI');
      expect(msg).toContain('POLYMARKET');
      expect(msg).toContain('72% similarity');
    });

    it('formats NORMAL urgency without execute warning', () => {
      const arb: ArbOpportunity = {
        type: 'INTRA_PLATFORM',
        urgency: 'NORMAL',
        marketId: 'mkt-1',
        marketTitle: 'Test Market',
        platform: 'POLYMARKET',
        yesPrice: 0.45,
        noPrice: 0.45,
        grossSpread: 0.10,
        totalFees: 0,
        netProfit: 0.01,
        contracts: 10,
      };

      const msg = formatArbAlert(arb);
      expect(msg).not.toContain('Execute immediately');
      expect(msg).toContain('NORMAL');
    });
  });

  describe('formatNewEdgeAlert', () => {
    it('formats edge alert with paper prefix', () => {
      const msg = formatNewEdgeAlert({
        marketTitle: 'Test Market',
        platform: 'KALSHI',
        cortexProbability: 0.65,
        marketPrice: 0.50,
        edgeMagnitude: 0.15,
        direction: 'BUY_YES',
        confidence: 0.80,
        kellySize: 0.05,
        topReasoning: 'COGEX detected anchoring bias',
        isPaperOnly: true,
      });

      expect(msg).toContain('NEW EDGE');
      expect(msg).toMatch(/📝/);
      expect(msg).toContain('65.0%');
      expect(msg).toContain('50.0%');
      expect(msg).toContain('15.0%');
    });
  });

  describe('formatModuleFailureAlert', () => {
    it('formats module failure', () => {
      const msg = formatModuleFailureAlert({
        moduleId: 'COGEX',
        consecutiveFailures: 3,
        lastError: 'Connection timeout',
      });

      expect(msg).toContain('MODULE FAILURE');
      expect(msg).toContain('COGEX');
      expect(msg).toContain('3');
      expect(msg).toContain('Connection timeout');
    });
  });

  describe('formatEdgeEvaporationAlert', () => {
    it('formats edge evaporation', () => {
      const msg = formatEdgeEvaporationAlert({
        marketTitle: 'Test Market',
        previousEdge: 0.08,
        reason: 'Price moved toward CORTEX estimate',
      });

      expect(msg).toContain('EDGE EVAPORATED');
      expect(msg).toContain('8.0%');
      expect(msg).toContain('Price moved toward CORTEX estimate');
    });
  });
});
