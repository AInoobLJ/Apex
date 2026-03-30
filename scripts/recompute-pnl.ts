/**
 * Recompute P&L for all paper positions using resolution outcomes.
 * Fixes the three P&L bugs:
 *   1. Missing kellySize multiplier
 *   2. Stale price on expired close
 *   3. Timing race (expired before resolved)
 *
 * Usage: npx tsx scripts/recompute-pnl.ts
 */
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env', override: true });

const prisma = new PrismaClient();

async function main() {
  const positions = await prisma.paperPosition.findMany({
    include: {
      market: { select: { title: true, resolution: true, closesAt: true, platformMarketId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n=== P&L RECOMPUTATION — ${positions.length} positions ===\n`);

  let totalOldPnl = 0;
  let totalNewPnl = 0;
  let wins = 0;
  let losses = 0;
  let unresolved = 0;
  const changes: { title: string; dir: string; old: number; new_: number; delta: number; won: boolean }[] = [];

  for (const pos of positions) {
    const oldPnl = pos.paperPnl || 0;
    totalOldPnl += oldPnl;

    const contracts = pos.kellySize || 0;
    const resolution = pos.market.resolution;

    if (!resolution) {
      // No resolution — keep existing mark-to-market P&L for open positions
      totalNewPnl += oldPnl;
      unresolved++;
      continue;
    }

    const resolvedYes = resolution === 'YES';
    const won = (pos.direction === 'BUY_YES' && resolvedYes) || (pos.direction === 'BUY_NO' && !resolvedYes);

    let newPnl: number;
    if (pos.direction === 'BUY_YES') {
      const settlement = resolvedYes ? 1.0 : 0.0;
      newPnl = (settlement - pos.entryPrice) * contracts;
    } else {
      const cost = 1 - pos.entryPrice;
      const payout = resolvedYes ? 0.0 : 1.0;
      newPnl = (payout - cost) * contracts;
    }

    totalNewPnl += newPnl;
    if (won) wins++;
    else losses++;

    const delta = newPnl - oldPnl;
    changes.push({
      title: pos.market.title.slice(0, 50),
      dir: pos.direction,
      old: oldPnl,
      new_: newPnl,
      delta,
      won,
    });

    // Update the DB
    await prisma.paperPosition.update({
      where: { id: pos.id },
      data: {
        paperPnl: newPnl,
        closeReason: 'RESOLVED',
        isOpen: false,
        closedAt: pos.closedAt ?? new Date(),
        currentPrice: resolvedYes ? 1.0 : 0.0,
      },
    });
  }

  // Print per-position changes
  console.log('POS | DIR     | OLD P&L    | NEW P&L    | DELTA      | WON | MARKET');
  console.log('-'.repeat(110));
  for (const c of changes) {
    const wonStr = c.won ? ' WIN' : 'LOSS';
    console.log(
      `    | ${c.dir.padEnd(7)} | $${c.old.toFixed(2).padStart(9)} | $${c.new_.toFixed(2).padStart(9)} | $${c.delta.toFixed(2).padStart(9)} | ${wonStr} | ${c.title}`
    );
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total positions:    ${positions.length}`);
  console.log(`Resolved:           ${wins + losses}`);
  console.log(`Unresolved (open):  ${unresolved}`);
  console.log(`Wins:               ${wins}`);
  console.log(`Losses:             ${losses}`);
  console.log(`Win rate:           ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
  console.log(`Old total P&L:      $${totalOldPnl.toFixed(2)}`);
  console.log(`New total P&L:      $${totalNewPnl.toFixed(2)}`);
  console.log(`Correction:         $${(totalNewPnl - totalOldPnl).toFixed(2)}`);

  // Biggest winners and losers
  const sorted = [...changes].sort((a, b) => b.new_ - a.new_);
  console.log('\nTOP 5 WINNERS:');
  for (const c of sorted.slice(0, 5)) {
    console.log(`  $${c.new_.toFixed(2).padStart(10)} | ${c.dir.padEnd(7)} | ${c.title}`);
  }
  console.log('\nTOP 5 LOSERS:');
  for (const c of sorted.slice(-5).reverse()) {
    console.log(`  $${c.new_.toFixed(2).padStart(10)} | ${c.dir.padEnd(7)} | ${c.title}`);
  }

  // BUY_YES vs BUY_NO breakdown
  const buyYes = changes.filter(c => c.dir === 'BUY_YES');
  const buyNo = changes.filter(c => c.dir === 'BUY_NO');
  console.log('\nBY DIRECTION:');
  console.log(`  BUY_YES: ${buyYes.length} trades, P&L=$${buyYes.reduce((s, c) => s + c.new_, 0).toFixed(2)}, wins=${buyYes.filter(c => c.won).length}`);
  console.log(`  BUY_NO:  ${buyNo.length} trades, P&L=$${buyNo.reduce((s, c) => s + c.new_, 0).toFixed(2)}, wins=${buyNo.filter(c => c.won).length}`);

  console.log('\nDone. All positions updated in database.');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('Failed:', err);
  process.exit(1);
});
