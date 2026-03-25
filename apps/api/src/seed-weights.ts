/**
 * Seed ModuleWeight table with default weights from SPEC.
 * Run: npx tsx src/seed-weights.ts
 */
import { syncPrisma as prisma } from './lib/prisma';
import { DEFAULT_WEIGHTS } from '@apex/shared';

async function main() {
  let count = 0;
  for (const [moduleId, categoryWeights] of Object.entries(DEFAULT_WEIGHTS)) {
    for (const [category, weight] of Object.entries(categoryWeights)) {
      await prisma.moduleWeight.upsert({
        where: { moduleId_category: { moduleId, category } },
        create: { moduleId, category, weight },
        update: { weight },
      });
      count++;
    }
  }
  console.log(`Seeded ${count} module weights`);
  await prisma.$disconnect();
}

main();
