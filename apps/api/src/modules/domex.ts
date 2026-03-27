import { SignalOutput, clampProbability } from '@apex/shared';
import { SignalModule, MarketWithData } from './base';
import { logger } from '../lib/logger';
import type { DomexAgent, DomexAgentResult } from './domex-agents/base-agent';
import { fedHawkAgent } from './domex-agents/fed-hawk';
import { geoIntelAgent } from './domex-agents/geo-intel';
import { cryptoAlphaAgent } from './domex-agents/crypto-alpha';
import { sportsEdgeAgent } from './domex-agents/sports-edge';
import { weatherHawkAgent } from './domex-agents/weather-hawk';
import { legalEagleAgent } from './domex-agents/legal-eagle';
import { corporateIntelAgent } from './domex-agents/corporate-intel';
import { predict, FEATURE_SCHEMA_VERSION } from '@apex/cortex';
import type { FeatureVector, FedHawkFeatures, GeoIntelFeatures, SportsEdgeFeatures, CryptoAlphaFeatures, WeatherHawkFeatures, LegalEagleFeatures, CorporateIntelFeatures } from '@apex/cortex';
import type { MarketCategory } from '@apex/db';

// ENTERTAINMENT-SCOUT removed: no data sources, zero edge potential
const ALL_AGENTS: DomexAgent[] = [
  fedHawkAgent,
  geoIntelAgent,
  cryptoAlphaAgent,
  sportsEdgeAgent,
  weatherHawkAgent,
  legalEagleAgent,
  corporateIntelAgent,
];

export class DomexModule extends SignalModule {
  readonly moduleId = 'DOMEX' as const;

  protected async analyze(market: MarketWithData): Promise<SignalOutput | null> {
    const yesContract = market.contracts.find(c => c.outcome === 'YES');
    if (!yesContract?.lastPrice) return null;
    const marketPrice = yesContract.lastPrice;

    // Select agents relevant to this market's category
    const relevantAgents = ALL_AGENTS.filter(a =>
      a.categories.includes(market.category as MarketCategory)
    );

    if (relevantAgents.length === 0) return null;

    // Run relevant agents in parallel — agents NO LONGER receive market price
    const agentResults = await Promise.all(
      relevantAgents.map(agent =>
        agent.run(market.title, market.description, market.category as MarketCategory, market.closesAt)
      )
    );

    // Filter out failures
    const validResults: { agent: DomexAgent; result: DomexAgentResult }[] = [];
    for (let i = 0; i < agentResults.length; i++) {
      if (agentResults[i] !== null) {
        validResults.push({ agent: relevantAgents[i], result: agentResults[i]! });
      }
    }
    if (validResults.length === 0) return null;

    // Build combined feature vector from all agent results
    const daysToResolution = market.closesAt
      ? Math.max(1, Math.ceil((market.closesAt.getTime() - Date.now()) / 86400000))
      : 365;

    const featureVector = this.buildFeatureVector(
      market, marketPrice, daysToResolution, validResults
    );

    // Feed into FeatureModel (logistic regression) for calibrated probability
    const prediction = predict(featureVector);

    const probability = prediction.probability;
    const confidence = prediction.confidence;

    // Build reasoning from agent outputs and feature importance
    const agentReasonings = validResults.map(({ agent, result }) =>
      `${agent.name}: ${result.reasoning.slice(0, 120)} [sources: ${result.dataSourcesUsed.join(', ') || 'LLM only'}, freshness: ${result.dataFreshness}]`
    );

    const featureReasonings = prediction.featureImportance
      .slice(0, 3)
      .map(f => `${f.feature}: ${f.contribution > 0 ? '+' : ''}${f.contribution.toFixed(3)}`);

    const reasoning = [
      `FeatureModel prediction: ${(probability * 100).toFixed(1)}% (conf: ${(confidence * 100).toFixed(0)}%)`,
      `Top features: ${featureReasonings.join(', ')}`,
      `--- Agent Reports ---`,
      ...agentReasonings,
    ].join('\n');

    return this.makeSignal(
      market.id,
      probability,
      confidence,
      reasoning,
      {
        agentCount: validResults.length,
        featureSchemaVersion: FEATURE_SCHEMA_VERSION,
        featureVector: this.serializeFeatureVector(featureVector),
        featureImportance: prediction.featureImportance,
        agents: validResults.map(({ agent, result }) => ({
          name: agent.name,
          dataFreshness: result.dataFreshness,
          dataSourcesUsed: result.dataSourcesUsed,
          featureCount: Object.keys(result.features).length,
        })),
      },
      360 // 6 hours
    );
  }

  /**
   * Build a FeatureVector from agent-extracted features.
   * Maps agent-specific features to the FeatureModel's typed schemas.
   */
  private buildFeatureVector(
    market: MarketWithData,
    marketPrice: number,
    daysToResolution: number,
    agentResults: { agent: DomexAgent; result: DomexAgentResult }[]
  ): FeatureVector {
    const fv: FeatureVector = {
      marketId: market.id,
      marketPrice,
      daysToResolution,
      category: market.category,
      volume: market.volume ?? 0,
      priceLevel: marketPrice,
      bidAskSpread: 0, // filled from orderbook if available
      volumeRank: 0.5,  // default median
      timeToResolutionBucket: daysToResolution < 1 ? 0 : daysToResolution < 7 ? 1 : daysToResolution < 30 ? 2 : 3,
    };

    // Map each agent's features to the typed FeatureVector
    for (const { agent, result } of agentResults) {
      const f = result.features;

      switch (agent.name) {
        case 'FED-HAWK':
          fv.fedHawk = {
            fedFundsRate: toNum(f.fedFundsRate, 5.25),
            cpiTrend: toNum(f.cpiTrend, 0),
            dotPlotDirection: toNum(f.dotPlotDirection, 0),
            fedSpeechTone: toNum(f.fedSpeechTone, 0),
            marketImpliedRate: toNum(f.marketImpliedRate, 5.0),
            yieldCurveSpread: toNum(f.yieldCurveSpread, 0),
          };
          break;

        case 'GEO-INTEL':
          fv.geoIntel = {
            incumbentApproval: toNum(f.incumbentApproval, 45),
            pollingSpread: toNum(f.pollingSpread, 0),
            legislativeStatus: toNum(f.legislativeStatus ?? f.billStage, 0),
            keyDatesAhead: toNum(f.keyDatesAhead, 30),
            escalationLevel: toNum(f.escalationLevel ?? f.conflictIntensity, 0),
            sanctionIntensity: toNum(f.sanctionIntensity, 0),
          };
          break;

        case 'SPORTS-EDGE':
          fv.sportsEdge = {
            homeAway: toNum(f.homeAway, 0.5),
            restDays: toNum(f.restDays, 2),
            injuryImpact: toNum(f.injuryImpact, 0),
            recentForm: toNum(f.recentFormLast10 ?? f.recentForm, 0.5),
            headToHeadRecord: toNum(f.headToHeadRecord, 0.5),
            eloRating: toNum(f.eloRating, 1500),
            lineMovement: toNum(f.lineMovement, 0),
            // NaN default: when bookmaker odds are unavailable, the feature is silently
            // skipped by flattenFeatures (line 270: isNaN check). No bias when missing.
            bookmakerImpliedProb: toNum(f.bookmakerImpliedProb, NaN),
          };
          break;

        case 'CRYPTO-ALPHA':
          fv.cryptoAlpha = {
            fundingRate: toNum(f.fundingRate, 0),
            exchangeFlows: toNum(f.exchangeNetFlow ?? f.exchangeFlows, 0),
            protocolTVL: toNum(f.protocolTVLTrend ?? f.protocolTVL, 0),
            regulatoryNews: toNum(f.regulatoryAction ?? f.regulatoryNews, 0),
            volatilityRatio: toNum(f.volatilityRatio ?? f.priceVs30dAvg, 1.0),
            orderBookImbalance: toNum(f.orderBookImbalance, 1.0),
          };
          break;

        case 'WEATHER-HAWK':
          fv.weatherHawk = {
            temperatureAnomaly: toNum(f.temperatureAnomaly, 0),
            precipitationChance: toNum(f.precipitationChance ?? f.precipitation, 0.5),
            forecastConfidence: toNum(f.forecastConfidence ?? f.confidence, 0.5),
            severeWeatherRisk: toNum(f.severeWeatherRisk ?? f.severeRisk, 0),
            forecastHorizonDays: toNum(f.forecastHorizonDays ?? f.horizonDays, 7),
          };
          break;

        case 'LEGAL-EAGLE':
          fv.legalEagle = {
            precedentStrength: toNum(f.precedentStrength ?? f.precedent, 0.5),
            courtLevel: toNum(f.courtLevel, 0),
            rulingLikelihood: toNum(f.rulingLikelihood ?? f.likelihood, 0.5),
            caseAgeMonths: toNum(f.caseAgeMonths ?? f.caseAge, 6),
            amicusBriefs: toNum(f.amicusBriefs ?? f.amicus, 0),
          };
          break;

        case 'CORPORATE-INTEL':
          fv.corporateIntel = {
            earningsSurprise: toNum(f.earningsSurprise ?? f.earningsBeat, 0),
            analystConsensus: toNum(f.analystConsensus ?? f.consensus, 0),
            filingActivity: toNum(f.filingActivity ?? f.secFilings, 0),
            approvalPrecedent: toNum(f.approvalPrecedent ?? f.historicalApproval, 0.5),
            insiderActivity: toNum(f.insiderActivity ?? f.insiderTrading, 0),
          };
          break;

        default:
          break;
      }
    }

    return fv;
  }

  /**
   * Serialize the FULL feature vector for storage in signal metadata.
   * The weekly learning loop uses this to retrain the FeatureModel on all 40+ domain features,
   * not just base features. Without this, training data is sparse and the model can't learn
   * which domain-specific features actually predict outcomes.
   */
  private serializeFeatureVector(fv: FeatureVector): Record<string, unknown> {
    const serialized: Record<string, unknown> = {
      marketId: fv.marketId,
      marketPrice: fv.marketPrice,
      daysToResolution: fv.daysToResolution,
      category: fv.category,
      volume: fv.volume,
      priceLevel: fv.priceLevel,
      bidAskSpread: fv.bidAskSpread,
      volumeRank: fv.volumeRank,
      timeToResolutionBucket: fv.timeToResolutionBucket,
    };
    if (fv.fedHawk) serialized.fedHawk = fv.fedHawk;
    if (fv.geoIntel) serialized.geoIntel = fv.geoIntel;
    if (fv.sportsEdge) serialized.sportsEdge = fv.sportsEdge;
    if (fv.cryptoAlpha) serialized.cryptoAlpha = fv.cryptoAlpha;
    if (fv.legex) serialized.legex = fv.legex;
    if (fv.altex) serialized.altex = fv.altex;
    if (fv.weatherHawk) serialized.weatherHawk = fv.weatherHawk;
    if (fv.legalEagle) serialized.legalEagle = fv.legalEagle;
    if (fv.corporateIntel) serialized.corporateIntel = fv.corporateIntel;
    return serialized;
  }
}

/** Safe number extraction with default */
function toNum(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !isNaN(val)) return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    if (!isNaN(n)) return n;
  }
  return fallback;
}

export const domexModule = new DomexModule();
