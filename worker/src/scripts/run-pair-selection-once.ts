/**
 * One-shot: trigger and execute the momentum screener immediately.
 * Usage: npx tsx src/scripts/run-pair-selection-once.ts
 */
import { supabase } from '../config.js';
import { PairSelectionJob } from '../jobs/pair-selection-engine-aware.js';

async function main() {
  console.log('🔬 One-shot PairSelectionJob run...');
  const job = new PairSelectionJob(60_000);
  let targetRun: any = null;

  const { data: existingPending } = await supabase
    .from('pair_selection_runs')
    .select('*')
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle();

  if (!existingPending) {
    console.log('📝 Creating a pending manual pair_selection_run for one-shot execution...');
    const { data: created } = await supabase
      .from('pair_selection_runs')
      .insert({
        status: 'pending',
        trigger_source: 'admin',
      })
      .select()
      .single();
    targetRun = created;
  } else {
    targetRun = existingPending;
  }

  if (targetRun) {
    console.log(`🎯 Executing target run: ${targetRun.id}`);
    await (job as any).executeRun(targetRun);
  } else {
    await job.tick();
  }
  console.log('✅ One-shot finished.');
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ One-shot failed:', err);
  process.exit(1);
});
