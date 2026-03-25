import { createDomexAgent } from './base-agent';

export const cryptoAlphaAgent = createDomexAgent(
  'CRYPTO-ALPHA',
  'domex-crypto-alpha.md',
  ['CRYPTO']
);
