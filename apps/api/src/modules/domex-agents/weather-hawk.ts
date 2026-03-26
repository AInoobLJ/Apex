import { createDomexAgent } from './base-agent';

export const weatherHawkAgent = createDomexAgent({
  name: 'WEATHER-HAWK',
  promptFile: 'domex-weather-hawk.md',
  categories: ['SCIENCE'],
});
