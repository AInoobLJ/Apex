import { Job } from 'bullmq';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../lib/logger';
import { config } from '../config';

const BACKUP_DIR = process.env.BACKUP_DIR || path.resolve(process.cwd(), '../../backups');
const MAX_BACKUPS = parseInt(process.env.MAX_BACKUPS || '7', 10); // Keep last 7 days

/**
 * Nightly Postgres backup via pg_dump.
 * Stores compressed backups in BACKUP_DIR, rotates to keep MAX_BACKUPS files.
 */
export async function handleBackup(job: Job): Promise<void> {
  logger.info({ jobId: job.id }, 'Postgres backup job started');

  // Ensure backup directory exists
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `apex-backup-${timestamp}.sql.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  try {
    // pg_dump with gzip compression
    // DATABASE_URL format: postgresql://user:pass@host:port/db
    const dbUrl = config.DATABASE_URL;
    execSync(`pg_dump "${dbUrl}" | gzip > "${filepath}"`, {
      timeout: 300000, // 5 min max
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Verify backup was created and has reasonable size
    const stats = statSync(filepath);
    if (stats.size < 100) {
      throw new Error(`Backup file suspiciously small: ${stats.size} bytes`);
    }

    logger.info({ filepath, sizeBytes: stats.size }, 'Postgres backup completed');

    // Rotate: remove oldest backups beyond MAX_BACKUPS
    const backups = readdirSync(BACKUP_DIR)
      .filter(f => f.startsWith('apex-backup-') && f.endsWith('.sql.gz'))
      .sort()
      .reverse();

    for (const old of backups.slice(MAX_BACKUPS)) {
      const oldPath = path.join(BACKUP_DIR, old);
      unlinkSync(oldPath);
      logger.info({ removed: old }, 'Rotated old backup');
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Postgres backup failed');
    throw err;
  }
}
