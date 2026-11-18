// Counts reports still awaiting AI analysis (ai_assessed_at IS NULL).
// Used by the health-watch workflow to decide whether waking the agent is
// worthwhile when the AI gateway recovers from a billing block.
import { one } from './lib/db.ts';

const row = await one<{ c: string }>('SELECT count(*)::text c FROM reports WHERE ai_assessed_at IS NULL');
const refs = await one<{ refs: string | null }>(
  "SELECT string_agg(ref_no, ',') refs FROM (SELECT ref_no FROM reports WHERE ai_assessed_at IS NULL ORDER BY created_at LIMIT 10) t"
);
console.log(`pending=${row?.c ?? '0'} refs=${refs?.refs ?? 'none'}`);
