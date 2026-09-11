/**
 * Attend une heure donnee (Paris), puis enchaine snapshot, armement et
 * publication de l'allowlist. S'arrete a la premiere etape qui echoue.
 *
 * Pour tenir l'heure annoncee du snapshot sans etre devant le clavier.
 * Le Mac doit rester allume : lancer avec caffeinate, qui empeche la
 * mise en veille tant que la commande tourne.
 *
 * Usage :
 *   caffeinate -i npm run kids:schedule -- --at 16:00 --mainnet
 *   caffeinate -i npm run kids:schedule -- --at 16:00 --mainnet --dry   (affiche sans executer)
 */

import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
const at = val('--at');
if (!which || !/^\d{2}:\d{2}$/.test(at ?? '')) {
  console.error('\n  Usage : npm run kids:schedule -- --at HH:MM --mainnet   (heure de Paris, aujourd hui)\n');
  process.exit(2);
}

/** Prochain instant ou il sera HH:MM a Paris (aujourd'hui, sinon demain). */
function nextParis(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const now = new Date();
  const parisNow = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const target = new Date(parisNow);
  target.setHours(h, m, 0, 0);
  if (target <= parisNow) target.setDate(target.getDate() + 1);
  // Reconvertit l'heure locale de Paris en instant reel.
  const offset = now.getTime() - parisNow.getTime();
  return new Date(target.getTime() + offset);
}

const fireAt = nextParis(at);
const fmt = (d) => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'medium' });

const STEPS = [
  ['snapshot', ['npm', 'run', 'kids:snapshot', '--', '--alchemy']],
  ['armement', ['npm', 'run', 'kids:arm', '--', `--${which}`]],
  ['git add', ['git', 'add', 'kids/config.json', 'public/kids']],
  ['git commit', ['git', 'commit', '-m', `Allowlist Gen Kids, snapshot ${at}`]],
  ['git push', ['git', 'push']],
];

console.log(`\nProgramme pour le ${fmt(fireAt)}`);
console.log('Etapes, dans l ordre :');
for (const [label, cmd] of STEPS) console.log(`  ${label.padEnd(11)} ${cmd.join(' ')}`);
if (has('--dry')) { console.log('\n--dry : rien n est lance.\n'); process.exit(0); }
console.log('\nLaisser cette fenetre ouverte. Ctrl+C pour annuler.\n');

for (;;) {
  const left = fireAt.getTime() - Date.now();
  if (left <= 0) break;
  const s = Math.ceil(left / 1000);
  process.stdout.write(`\r  dans ${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')} min ${String(s % 60).padStart(2, '0')} s   `);
  await new Promise((r) => setTimeout(r, Math.min(1000, left)));
}
process.stdout.write('\r' + ' '.repeat(40) + '\r');
console.log(`Il est ${fmt(new Date())} - c est parti.\n`);

for (const [label, [cmd, ...rest]] of STEPS) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(cmd, rest, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`\n  ECHEC a l etape « ${label} » (code ${r.status}). Les etapes suivantes n ont pas ete lancees.`);
    console.error(`  Corriger, puis relancer a la main les etapes restantes.\n`);
    process.exit(r.status ?? 1);
  }
}

console.log(`\nTermine a ${fmt(new Date())}. Snapshot pris, contrat arme, allowlist publiee.\n`);
