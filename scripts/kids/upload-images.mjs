/**
 * Heberge les captures sur le stockage Supabase du site.
 *
 * Bucket public `kids`, dossier `img/` (mainnet) ou `img-testnet/`. Le
 * site les sert sous hoodlrz.com/kids/img/<id>.png par une reecriture
 * Next (voir next.config.mjs) : le contrat ne connait que notre domaine,
 * et le stockage peut changer sans le toucher.
 *
 * .env.local : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
 * (les memes que le site).
 *
 * Relancable : les fichiers deja en place sont ecrases a l'identique.
 *
 * Usage :
 *   npm run kids:upload-images -- --mainnet
 */

import './env.mjs';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const DIR = `kids/build/images/${which}`;
const PREFIX = which === 'mainnet' ? 'img' : 'img-testnet';
const BUCKET = 'kids';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(`
  NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY manquent dans .env.local.
  Ce sont les valeurs du projet Supabase du site (Settings > API).
`);
  process.exit(2);
}
if (!existsSync(DIR)) { console.error(`\n  ${DIR} absent : npm run kids:render-images -- --${which} d abord.\n`); process.exit(2); }

const files = readdirSync(DIR).filter((f) => f.endsWith('.png'));
console.log(`\nHebergement des captures — ${which}`);
console.log(`  ${files.length} fichiers -> ${url}/storage/v1/object/public/${BUCKET}/${PREFIX}/\n`);

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// Le bucket doit exister et etre public : on le cree s'il manque.
const { data: buckets, error: be } = await sb.storage.listBuckets();
if (be) { console.error('  Supabase :', be.message); process.exit(1); }
if (!buckets.some((b) => b.name === BUCKET)) {
  const { error } = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: '5MB' });
  if (error) { console.error('  creation du bucket :', error.message); process.exit(1); }
  console.log(`  bucket ${BUCKET} cree (public)`);
}

const t0 = Date.now();
let ok = 0, ko = 0;
const CONC = 8;
for (let i = 0; i < files.length; i += CONC) {
  const lot = files.slice(i, i + CONC);
  const res = await Promise.all(lot.map(async (f) => {
    const { error } = await sb.storage.from(BUCKET).upload(`${PREFIX}/${f}`, readFileSync(`${DIR}/${f}`), {
      contentType: 'image/png', upsert: true, cacheControl: '31536000',
    });
    return error ? `${f}: ${error.message}` : null;
  }));
  for (const r of res) r ? (ko++, console.log(`\n  echec ${r}`)) : ok++;
  process.stdout.write(`\r  ${ok + ko} / ${files.length}   (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
}
console.log(`\n\n  ${ok} envoyes, ${ko} echecs`);

// Une lecture publique, telle que la fera OpenSea.
const probe = `${url}/storage/v1/object/public/${BUCKET}/${PREFIX}/0.png`;
const r = await fetch(probe).catch(() => null);
console.log(`  lecture publique de 0.png : ${r?.ok ? 'OK' : 'ECHEC ' + (r?.status ?? 'reseau')}`);
console.log(`
  Sur le site, une fois deploye : https://www.hoodlrz.com/kids/${PREFIX}/0.png
`);
process.exit(ko ? 1 : 0);
