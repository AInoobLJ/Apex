import { PrismaClient } from '@apex/db';

// Main Prisma client for API routes — keeps connections available for requests
export const prisma = new PrismaClient();

// Separate client for background sync jobs with a small connection pool.
// Uses SYNC_DATABASE_URL if set, otherwise appends connection_limit to DATABASE_URL.
const syncUrl = process.env.SYNC_DATABASE_URL
  || (process.env.DATABASE_URL
    ? (process.env.DATABASE_URL.includes('?')
      ? `${process.env.DATABASE_URL}&connection_limit=3`
      : `${process.env.DATABASE_URL}?connection_limit=3`)
    : undefined);

export const syncPrisma = new PrismaClient({
  ...(syncUrl ? { datasources: { db: { url: syncUrl } } } : {}),
});
