import IORedis from 'ioredis';
import { config } from '../config';

export const redis = new IORedis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ
});

// BullMQ connection config — pass this to Queue/Worker constructors
export const bullmqConnection = {
  host: new URL(config.REDIS_URL).hostname || 'localhost',
  port: parseInt(new URL(config.REDIS_URL).port || '6379'),
};
