import { syncPrisma as prisma } from '../lib/prisma';
import { logger } from '../lib/logger';

export interface ApiCallResult<T> {
  data: T;
  latencyMs: number;
  statusCode: number;
}

export async function logApiUsage(params: {
  service: string;
  endpoint: string;
  latencyMs: number;
  statusCode: number;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number;
}): Promise<void> {
  try {
    await prisma.apiUsageLog.create({
      data: {
        service: params.service,
        endpoint: params.endpoint,
        latencyMs: params.latencyMs,
        statusCode: params.statusCode,
        tokensIn: params.tokensIn ?? null,
        tokensOut: params.tokensOut ?? null,
        cost: params.cost ?? null,
      },
    });
  } catch (err) {
    logger.error(err, 'Failed to log API usage');
  }
}

export async function timedFetch<T>(
  service: string,
  endpoint: string,
  fn: () => Promise<{ data: T; statusCode: number }>
): Promise<ApiCallResult<T>> {
  const start = Date.now();
  try {
    const result = await fn();
    const latencyMs = Date.now() - start;
    await logApiUsage({ service, endpoint, latencyMs, statusCode: result.statusCode });
    return { data: result.data, latencyMs, statusCode: result.statusCode };
  } catch (err) {
    const latencyMs = Date.now() - start;
    await logApiUsage({ service, endpoint, latencyMs, statusCode: 0 });
    throw err;
  }
}
