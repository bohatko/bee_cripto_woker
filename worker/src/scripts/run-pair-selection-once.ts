/**
 * One-shot: pick up pending pair_selection_runs and execute the momentum screener.
 * Usage: npx tsx src/scripts/run-pair-selection-once.ts
 */
import { PairSelectionJob } from '../jobs/pair-selection.js';

async function main() {
  console.log('🔬 One-shot PairSelectionJob.tick()...');
  const job = new PairSelectionJob(60_000);
  await job.tick();
  console.log('✅ One-shot finished.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ One-shot failed:', err);
  process.exit(1);
});
