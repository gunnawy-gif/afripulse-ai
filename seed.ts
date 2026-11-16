// AFRIPULSE AI seeder: verified ward geography, demo admin accounts, and
// clearly-flagged demonstration reports (each run through the real AI engine).
import { ensureSchema, sql, one } from './lib/db.ts';
import { hashPassword } from './lib/auth.ts';
import { analyzeReport } from './lib/ai.ts';

await ensureSchema();

// --- Verified ward geography: the 11 wards of Rafi LGA, Niger State.
// Sources: nigeria2.com/lga/261-rafi and eduweb.com.ng Rafi LGA ward list
// (independent sources, identical lists).
const WARDS = [
  'Kagara Gari', 'Kakuri', 'Kongoma Central', 'Kongoma West', 'Kusherki North',
  'Kusherki South', 'Kundu', 'Sabon Gari', 'Tegina Gari', 'Tegina West', 'Yakila',
];
for (const w of WARDS) {
  await sql.query('INSERT INTO wards (state, lga, name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', ['Niger', 'Rafi', w]);
}

// --- Demo accounts (production must replace these before any real rollout).
const ACCOUNTS: [string, string, string, string, string | null][] = [
  ['Usman Musa (Demo Super Admin)', 'super@afripulse.ai', 'super_admin', 'AfriPulse#2026', null],
  ['Hauwa Ibrahim (Demo LGA Admin)', 'lga@afripulse.ai', 'lga_admin', 'AfriPulse#2026', 'Rafi'],
  ['Musa Sani (Demo Reviewer)', 'reviewer@afripulse.ai', 'reviewer', 'AfriPulse#2026', 'Rafi'],
  ['Aisha Bello (Demo Analyst)', 'analyst@afripulse.ai', 'analyst', 'AfriPulse#2026', null],
];
for (const [name, email, role, pass, lga] of ACCOUNTS) {
  const existing = await one<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  if (!existing) {
    await sql.query('INSERT INTO users (name, email, password_hash, role, lga) VALUES ($1,$2,$3,$4,$5)',
      [name, email, hashPassword(pass), role, lga]);
  }
}

// --- Demonstration reports (flagged is_demo = TRUE everywhere they appear).
type Demo = { title: string; body: string; ward: string; community: string; location: string; lang: 'en' | 'ha' | 'mixed'; gps?: [number, number] };
const DEMOS: Demo[] = [
  { title: 'Broken borehole has left Kashari ward without clean water', body: 'The only working borehole in our community broke down three weeks ago. Women and children now walk over four kilometres to the stream to fetch water, and some children have started showing signs of stomach problems. We have reported to the ward head but nothing has happened yet.', ward: 'Kusherki North', community: 'Kusherki', location: 'Behind the primary school, Kusherki', lang: 'en', gps: [10.0312, 6.1284] },
  { title: 'Rafin yara makaranta ba rufi ba', body: 'Makarantar firamare da ke kauyarmu babu rufi a hukumomi uku na aji. Yara suna zaune a kasa kuma lokacin da ruwan sama ya sauko ake rufe makaranta har tsawon mako. Muna rokan hukumar ilimi da ta taimaka mana.', ward: 'Kagara Gari', community: 'Kagara', location: 'Near the central mosque, Kagara', lang: 'ha' },
  { title: 'Road to Tegina market cut off by erosion', body: 'The laterite road linking our village to the Tegina market has been washed away by erosion at two points. Farmers cannot bring produce to market and a pregnant woman in labour was carried on a motorbike through the bush track last week because vehicles could not pass.', ward: 'Tegina West', community: 'Tegina', location: 'Along the village road to Tegina market', lang: 'en' },
  { title: 'Health centre has no drugs or night staff', body: 'Our primary healthcare centre opens only in the morning and there are no essential medicines. Women in the community deliver at home because there is no nurse at night. Last month a child with malaria was referred to Kagara because there was no ACT medicine here.', ward: 'Kongoma Central', community: 'Kongoma', location: 'PHC building, Kongoma', lang: 'en' },
  { title: 'Yan fashi na kai hari kan hanyar Yakila', body: 'Bayan hasken wata, mutane da dama na fuskantar hari a kan hanyar Yakila da allawa. An yi wasu hari biyu a wannan watan, an yanke wa mutane hanya sannan aka dauke da motarsu. Muna rokan a tura yan tsaro zuwa yankin.', ward: 'Yakila', community: 'Yakila', location: 'Along the Yakila road', lang: 'ha' },
  { title: 'Transformer fault: 40 days without electricity', body: 'Our transformer failed over a month ago and the whole area has been in darkness. Cold-storage sellers are losing goods, students cannot study at night, and the grinding machine owners have lost their means of livelihood.', ward: 'Sabon Gari', community: 'Sabon Gari', location: 'Near the central transformer, Sabon Gari', lang: 'en' },
  { title: 'Blocked drainage causing flooding of homes', body: 'Every time it rains heavily, the blocked drainage channel overflows and water enters houses along the low side of our street. Three families have lost mattresses and foodstuffs this season. Mosquito breeding has also increased.', ward: 'Tegina Gari', community: 'Tegina', location: 'Behind the motor park, Tegina', lang: 'en' },
  { title: 'School has only two teachers for six classes', body: 'Our community primary school has six classes but only two teachers posted there. Pupils in primary four to six sit in one room. Enrollment is falling because parents are sending children to distant towns.', ward: 'Kundu', community: 'Kundu', location: 'Community primary school, Kundu', lang: 'en' },
  { title: 'Youths need skills centre, many are idle', body: 'After secondary school there is nothing for young people here. No skills acquisition centre, no workshops. Many of us are willing to learn tailoring, welding or phone repairs but there is no facility or trainer.', ward: 'Kagara Gari', community: 'Kagara', location: 'Ward secretariat area, Kagara', lang: 'en' },
  { title: 'Gawawwin dabbobi da zazzabin cizon sauro', body: 'A wajen mu akwai gawawwin dabbobi da ba a binne su ba kusa da ramin ruwan sha. Yanayin yana jawo kuwa da sauro, kuma masifa na gargada mu game da zazzabin cizon sauro. Muna neman tsaftacewa da ramuwa.', ward: 'Kakuri', community: 'Kakuri', location: 'Near the water point, Kakuri', lang: 'ha' },
  { title: 'Clinic building roof blown off by windstorm', body: 'The windstorm last month removed the roof of our dispensary building. All the drugs and furniture were damaged. Patients are now attended to under a tree.', ward: 'Kusherki South', community: 'Kusherki', location: 'Dispensary building, Kusherki', lang: 'en' },
  { title: 'Irrigation pumps and fuel subsidy for dry season farmers', body: 'Dry-season farmers in our fadama area depend on petrol pumps but fuel cost has tripled. Half the pumps are broken and there is no mechanic in the ward. Last season many of us left half of our farms unwatered.', ward: 'Kongoma West', community: 'Kongoma', location: 'Fadama irrigation site, Kongoma', lang: 'en' },
];

console.log('Seeding demonstration reports through the live AI engine...');
for (const d of DEMOS) {
  const existing = await one<{ id: number }>('SELECT id FROM reports WHERE title = $1', [d.title]);
  if (existing) { console.log('  skip (exists):', d.title.slice(0, 40)); continue; }
  const refRow = await one<{ v: string }>(`SELECT 'AFR-' || to_char(now(),'YYYY') || '-' || lpad(nextval('ref_seq')::text, 5, '0') AS v`, []);
  const analysis = await analyzeReport(d.title, d.body);
  const ins = await one<{ id: number }>(
    `INSERT INTO reports (ref_no, title, description, category, state, lga, ward, community, specific_location,
       latitude, longitude, coords_source, language, status, priority, is_demo,
       ai_category, ai_priority, ai_summary, ai_actions, ai_language_detected, ai_confidence, ai_assessed_at)
     VALUES ($1,$2,$3,$4,'Niger','Rafi',$5,$6,$7,$8,$9,'citizen_gps',$10,$11,$12,TRUE,$13,$14,$15,$16,$17,$18,now()) RETURNING id`,
    [refRow!.v, d.title, d.body, analysis.category, d.ward, d.community, d.location,
     d.gps?.[0] ?? null, d.gps?.[1] ?? null, d.lang,
     'verified', analysis.priority, // demo reports sit at different workflow stages
     analysis.category, analysis.priority, analysis.summary,
     JSON.stringify({ urgency_reason: analysis.urgency_reason, actions: analysis.recommended_actions }),
     analysis.language_detected, analysis.confidence]
  );
  await sql.query('INSERT INTO status_history (report_id, new_status, note, changed_by) VALUES ($1,$2,$3,$4)',
    [ins!.id, 'submitted', 'Report received from citizen (demonstration data)', 'Seed: demonstration data']);
  await sql.query('INSERT INTO status_history (report_id, old_status, new_status, note, changed_by) VALUES ($1,$2,$3,$4,$5)',
    [ins!.id, 'submitted', 'verified', 'Demo workflow: location and facts confirmed', 'Musa Sani (Demo Reviewer)']);
  console.log(`  ${refRow!.v} [${analysis.priority}] ${d.title.slice(0, 52)} (${analysis.language_detected})`);
}

console.log('Seed complete.');
