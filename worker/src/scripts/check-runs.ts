import { supabase } from '../config.js';

async function main() {
  const { data: runs } = await supabase
    .from('pair_selection_runs')
    .select('id, status, trigger_source, universe_size, candidates, created_at, finished_at, error')
    .order('created_at', { ascending: false })
    .limit(3);

  console.log('Latest 3 Pair Selection Runs:');
  for (const r of runs || []) {
    const candList = Array.isArray(r.candidates) ? r.candidates : [];
    const validCount = candList.filter((c: any) => c.valid).length;
    console.log(`- ID: ${r.id} | Status: ${r.status} | Trigger: ${r.trigger_source} | Universe: ${r.universe_size} | Candidates: ${candList.length} (Valid: ${validCount}) | Created: ${r.created_at} | Error: ${r.error || 'none'}`);
    if (candList.length > 0) {
      console.log('  Top 3 candidates:');
      for (const c of candList.slice(0, 3)) {
        console.log(`    * ${c.pair_symbol}: score=${c.score}, valid=${c.valid}, rejects=${JSON.stringify(c.reject_reasons)}, IS PF=${c.metrics?.sim_insample?.profitFactor}`);
      }
    }
  }
}

main().catch(console.error);
