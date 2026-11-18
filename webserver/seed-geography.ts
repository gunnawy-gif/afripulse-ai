// National geography seeder for AFRIPULSE AI.
// Source: Open Admin Data (openadmindata.org/ng/) — CC-BY-4.0.
// Seeds all 37 states (36 + FCT), all 774 LGAs, and all 8,799 wards using
// batched unnest inserts (fast over the Neon HTTP driver).
// Rafi LGA wards are skipped: its 11 wards were independently verified from
// two Nigerian sources (eduweb.com.ng + nigeria2.com) and are kept as-is.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureSchema, sql, one } from './lib/db.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
await ensureSchema();

const geo = JSON.parse(readFileSync(join(__dirname, 'data', 'nigeria-geo.json'), 'utf8'));
console.log(`Source: ${geo.source}`);
console.log(`States: ${geo.states.length}, LGAs: ${geo.lgas.length}, Wards: ${geo.wards.length}`);

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// LGAs — batched: INSERT ... SELECT FROM unnest($1::text[], $2::text[])
let lgaBatches = 0;
for (const group of chunk(geo.lgas, 400)) {
  await sql.query(
    `INSERT INTO lgas (state, name)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT DO NOTHING`,
    [group.map((g) => g.state), group.map((g) => g.name)]
  );
  lgaBatches++;
}
console.log(`LGA batches run: ${lgaBatches}`);

// Wards — batched, skipping Rafi (kept from the verified pilot seed)
const wards = geo.wards.filter((w: { state: string; lga: string }) => !(w.state === 'Niger' && w.lga === 'Rafi'));
let wardBatches = 0;
for (const group of chunk(wards, 500)) {
  await sql.query(
    `INSERT INTO wards (state, lga, name)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT DO NOTHING`,
    [group.map((g) => g.state), group.map((g) => g.lga), group.map((g) => g.name)]
  );
  wardBatches++;
}
console.log(`Ward batches run: ${wardBatches}`);

const checkW = await one<{ c: string }>('SELECT count(*)::text c FROM wards');
const checkL = await one<{ c: string }>('SELECT count(*)::text c FROM lgas');
const rafiW = await one<{ c: string }>("SELECT count(*)::text c FROM wards WHERE lga = 'Rafi'");
console.log(`Totals in DB — LGAs: ${checkL?.c}, wards: ${checkW?.c} (Rafi: ${rafiW?.c})`);
console.log('National geography seed complete.');
