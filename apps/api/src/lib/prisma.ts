import { PrismaClient } from '@apex/db';

// Main Prisma client for API routes — keeps connections available for requests
export const prisma = new PrismaClient();

// Separate client for background sync jobs with a small pool
// Ensures sync can't starve API requests of DB connections
export const syncPrisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL?.replace(/connection_limit=\d+/, 'connection_limit=3') ||
           process.env.DATABASE_URL + '?connection_limit=3',
    },
  },
});
