import { createDomexAgent } from './base-agent';
import { logger } from '../../lib/logger';

/**
 * Weather context from NWS API (free, no key required).
 * For weather/climate markets, the NWS forecast IS the answer.
 */
async function getWeatherContext(title: string): Promise<{ context: string; freshness: 'live' | 'cached' | 'stale' | 'none'; sources: string[] }> {
  const sources: string[] = [];
  const parts: string[] = [];

  try {
    // Extract location clues from market title
    const axios = require('axios');

    // NWS forecast for major US cities that commonly appear in prediction markets
    // We use the NWS points API: https://api.weather.gov/points/{lat},{lon}
    const locationPatterns: Record<string, [number, number]> = {
      'new york': [40.7128, -74.0060],
      'los angeles': [34.0522, -118.2437],
      'chicago': [41.8781, -87.6298],
      'houston': [29.7604, -95.3698],
      'phoenix': [33.4484, -112.0740],
      'miami': [25.7617, -80.1918],
      'washington': [38.9072, -77.0369],
      'dc': [38.9072, -77.0369],
    };

    const titleLower = title.toLowerCase();
    let coords: [number, number] | null = null;
    let locationName = '';
    for (const [name, c] of Object.entries(locationPatterns)) {
      if (titleLower.includes(name)) {
        coords = c;
        locationName = name;
        break;
      }
    }

    if (coords) {
      const pointResp = await axios.get(`https://api.weather.gov/points/${coords[0]},${coords[1]}`, {
        headers: { 'User-Agent': 'APEX-Weather/1.0' },
        timeout: 5000,
      });

      if (pointResp.data?.properties?.forecast) {
        const forecastResp = await axios.get(pointResp.data.properties.forecast, {
          headers: { 'User-Agent': 'APEX-Weather/1.0' },
          timeout: 5000,
        });

        const periods = forecastResp.data?.properties?.periods?.slice(0, 7) || [];
        if (periods.length > 0) {
          parts.push(`## NWS Forecast for ${locationName.toUpperCase()}`);
          for (const p of periods) {
            parts.push(`- **${p.name}**: ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast} (wind: ${p.windSpeed} ${p.windDirection})`);
          }
          sources.push('NWS API');
        }
      }
    }
  } catch (err: any) {
    logger.debug({ err: err.message }, 'NWS weather fetch failed');
  }

  return {
    context: parts.join('\n'),
    freshness: sources.length > 0 ? 'live' as const : 'none' as const,
    sources,
  };
}

export const weatherHawkAgent = createDomexAgent({
  name: 'WEATHER-HAWK',
  promptFile: 'domex-weather-hawk.md',
  categories: ['SCIENCE'],
  task: 'DOMEX_FEATURE_EXTRACT',
  contextProvider: getWeatherContext,
});
