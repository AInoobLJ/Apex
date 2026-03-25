import { syncPrisma as prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { fetchTransferLogs, getLatestBlock, TransferEvent } from '../../services/polygon-client';

const BLOCKS_PER_BATCH = 2000;
const HIGH_WATER_MARK_KEY = 'sigint_high_water_block';

/**
 * Index wallet positions from Polygon transfer events.
 */
export async function indexWallets(): Promise<number> {
  const latestBlock = await getLatestBlock();
  if (latestBlock === 0) {
    logger.debug('Polygon RPC not available, skipping wallet indexing');
    return 0;
  }

  // Get high-water mark
  const config = await prisma.systemConfig.findUnique({ where: { key: HIGH_WATER_MARK_KEY } });
  const startBlock = config ? (config.value as any).block || latestBlock - BLOCKS_PER_BATCH : latestBlock - BLOCKS_PER_BATCH;

  let processed = 0;
  let currentBlock = startBlock;

  while (currentBlock < latestBlock) {
    const toBlock = Math.min(currentBlock + BLOCKS_PER_BATCH, latestBlock);
    const events = await fetchTransferLogs(currentBlock, toBlock);

    for (const event of events) {
      await processTransfer(event);
      processed++;
    }

    currentBlock = toBlock + 1;

    // Update high-water mark
    await prisma.systemConfig.upsert({
      where: { key: HIGH_WATER_MARK_KEY },
      create: { key: HIGH_WATER_MARK_KEY, value: { block: toBlock } },
      update: { value: { block: toBlock } },
    });
  }

  logger.info({ processed, fromBlock: startBlock, toBlock: latestBlock }, 'Wallet indexing complete');
  return processed;
}

async function processTransfer(event: TransferEvent): Promise<void> {
  const { from, to, tokenId, amount } = event;

  // Skip zero-address (mints/burns)
  if (from === '0x0000000000000000000000000000000000000000') return;
  if (to === '0x0000000000000000000000000000000000000000') return;

  // Upsert wallet for sender
  await prisma.wallet.upsert({
    where: { address: from },
    create: { address: from, lastActiveAt: new Date() },
    update: { lastActiveAt: new Date() },
  });

  // Upsert wallet for receiver
  await prisma.wallet.upsert({
    where: { address: to },
    create: { address: to, lastActiveAt: new Date() },
    update: { lastActiveAt: new Date() },
  });

  // Update receiver's position (they received tokens)
  const existingPos = await prisma.walletPosition.findFirst({
    where: { wallet: { address: to }, tokenId },
  });

  if (existingPos) {
    await prisma.walletPosition.update({
      where: { id: existingPos.id },
      data: { quantity: { increment: amount } },
    });
  } else {
    const wallet = await prisma.wallet.findUnique({ where: { address: to } });
    if (wallet) {
      await prisma.walletPosition.create({
        data: {
          walletId: wallet.id,
          marketId: '', // Will be resolved by market-matching
          tokenId,
          side: 'YES', // Default, will be resolved
          quantity: amount,
          avgPrice: 0,
        },
      });
    }
  }
}
