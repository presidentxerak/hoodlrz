/**
 * Ce qu'OpenSea croit qu'un wallet possede, contrat par contrat.
 *
 * POURQUOI
 * Quand des pieces n'apparaissent pas dans un profil, deux causes tres
 * differentes se ressemblent a l'ecran : ou bien l'index d'OpenSea ne
 * les connait pas encore, ou bien il les connait et c'est l'affichage
 * qui les cache - filtre, pieces masquees, pagination. La chaine ne
 * departage pas les deux, l'API d'OpenSea si.
 *
 * Le script demande a OpenSea la liste des pieces du wallet, et la
 * compare aux contrats du projet. Il ne modifie rien.
 *
 * .env.local : OPENSEA_API_KEY
 *
 * Usage :
 *   npm run kids:opensea-check
 *   npm run kids:opensea-check -- --wallet 0x…
 */

import './env.mjs';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CHAIN = val('--chain', 'robinhood');

const key = process.env.OPENSEA_API_KEY;
if (!key) { console.error('\n  OPENSEA_API_KEY manque dans .env.local.\n'); process.exit(2); }

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.['4663'] ?? {};
const wallet = val('--wallet', dep.reserveReceiver ?? cfg.addresses.reserveReceiver);
if (!wallet) { console.error('\n  Aucun wallet a interroger.\n'); process.exit(2); }

// Les contrats connus, pour nommer ce qu'on trouve. Tout contrat inconnu
// est affiche tel quel : ce sont les deploiements abandonnes.
const connus = new Map([
  [String(dep.nft).toLowerCase(), 'collection officielle (v2)'],
  [String(dep.origin).toLowerCase(), 'collection d origine (v1)'],
]);

console.log(`\nCe qu'OpenSea sait du wallet`);
console.log(`  ${wallet}`);
console.log(`  chaine ${CHAIN}\n`);

const parContrat = new Map();
let next = null, pages = 0, total = 0;
do {
  const u = new URL(`https://api.opensea.io/api/v2/chain/${CHAIN}/account/${wallet}/nfts`);
  u.searchParams.set('limit', '200');
  if (next) u.searchParams.set('next', next);
  const r = await fetch(u, { headers: { 'x-api-key': key, accept: 'application/json' } });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 200).replace(/\s+/g, ' ');
    console.error(`\n  OpenSea a refuse : HTTP ${r.status}  ${txt}`);
    if (r.status === 400 || r.status === 404) {
      console.error(`  Verifier l'identifiant de chaine : celui des URL d'items OpenSea,`);
      console.error(`  ex. opensea.io/item/robinhood/... -> --chain robinhood\n`);
    }
    process.exit(1);
  }
  const j = await r.json();
  for (const n of j.nfts ?? []) {
    const c = String(n.contract).toLowerCase();
    if (!parContrat.has(c)) parContrat.set(c, { n: 0, exemples: [], collection: n.collection });
    const e = parContrat.get(c);
    e.n++;
    if (e.exemples.length < 3) e.exemples.push(n.identifier);
    total++;
  }
  next = j.next ?? null;
  pages++;
  process.stdout.write(`\r  ${total} pieces lues (${pages} page${pages > 1 ? 's' : ''})…   `);
} while (next && pages < 40);
console.log(`\r  ${total} pieces au total, vues par OpenSea        \n`);

for (const [addr, e] of [...parContrat].sort((a, b) => b[1].n - a[1].n)) {
  const label = connus.get(addr) ?? 'contrat abandonne ou inconnu';
  console.log(`  ${String(e.n).padStart(5)} pieces   ${label}`);
  console.log(`               ${addr}`);
  console.log(`               collection OpenSea « ${e.collection} »   ex. #${e.exemples.join(' #')}\n`);
}

// Le point qui tranche : la v2 est-elle vue par OpenSea pour ce wallet ?
const v2 = parContrat.get(String(dep.nft).toLowerCase());
if (v2) {
  console.log(`  La v2 est bien indexee pour ce wallet : ${v2.n} pieces.`);
  console.log(`  Si le profil ne les montre pas, c'est l'affichage - filtre de`);
  console.log(`  chaine, pieces masquees, ou onglet « Hidden ».\n`);
} else {
  console.log(`  OpenSea ne rattache AUCUNE piece de la v2 a ce wallet pour l'instant.`);
  console.log(`  L'indexation d'un contrat neuf peut prendre plusieurs heures ;`);
  console.log(`  npm run kids:opensea-refresh la pousse piece par piece.\n`);
}
