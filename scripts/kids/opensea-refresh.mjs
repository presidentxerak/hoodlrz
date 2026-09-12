/**
 * Demande a OpenSea de relire les metadonnees de chaque piece.
 *
 * OpenSea garde en cache le tokenURI lu au moment du mint - donc le
 * placeholder « graine non revelee ». Apres la revelation, il faut lui
 * demander de relire, piece par piece : c'est ce que fait le bouton
 * « Refresh metadata » d'une page d'item, et c'est ce que fait ce script
 * pour les 3 333 d'un coup, via l'API publique d'OpenSea.
 *
 * Il faut une cle d'API OpenSea (gratuite, docs.opensea.io > Get an API
 * key), a poser dans .env.local :
 *   OPENSEA_API_KEY=...
 *
 * L'API limite le debit : on envoie deux demandes par seconde, soit une
 * demi-heure pour tout relire. Relancable : --from reprend ou on en etait.
 *
 * Usage :
 *   npm run kids:opensea-refresh
 *   npm run kids:opensea-refresh -- --from 1200
 *   npm run kids:opensea-refresh -- --only 1164,1276
 */

import './env.mjs';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const CHAIN = val('--chain', 'robinhood');   // identifiant OpenSea de la chaine (celui des URL d'items)

const key = process.env.OPENSEA_API_KEY;
if (!key) {
  console.error(`
  OPENSEA_API_KEY manque dans .env.local.
  Cle gratuite : docs.opensea.io, « Get an API key ». Puis :

    OPENSEA_API_KEY=...   dans .env.local
`);
  process.exit(2);
}

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const contract = cfg.deployments?.['4663']?.nft;
if (!contract) { console.error('\n  Aucun deploiement mainnet dans kids/config.json.\n'); process.exit(2); }

let ids;
if (val('--only')) ids = val('--only').split(',').map(Number);
else {
  const from = Number(val('--from', '0'));
  const to = Number(val('--to', String(cfg.collection.maxSupply - 1)));
  ids = Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

console.log(`\nRafraichissement des metadonnees sur OpenSea`);
console.log(`  contrat  ${contract}   chaine ${CHAIN}`);
console.log(`  pieces   ${ids.length}   (~${Math.ceil(ids.length / 2 / 60)} min)\n`);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0, ko = 0;
const raisons = {};
for (let i = 0; i < ids.length; i++) {
  const id = ids[i];
  const url = `https://api.opensea.io/api/v2/chain/${CHAIN}/contract/${contract}/nfts/${id}/refresh`;
  let r;
  for (let essai = 0; ; essai++) {
    r = await fetch(url, { method: 'POST', headers: { 'x-api-key': key, accept: 'application/json' } });
    if (r.status !== 429 || essai >= 5) break;
    await wait(3000 * (essai + 1));   // debit limite : on attend puis on reessaie
  }
  if (r.ok) ok++;
  else {
    ko++;
    const m = `${r.status} ${(await r.text()).slice(0, 80).replace(/\s+/g, ' ')}`;
    raisons[m] = (raisons[m] ?? 0) + 1;
    // Une chaine ou un contrat inconnus echouent des la premiere piece :
    // inutile d'insister 3 333 fois.
    if (i === 0 && (r.status === 400 || r.status === 404)) {
      console.error(`  Refuse des la premiere piece : ${m}`);
      console.error(`  Verifier l'identifiant de chaine (--chain) : celui des URL d'items OpenSea,\n  ex. opensea.io/item/robinhood/... -> --chain robinhood\n`);
      process.exit(1);
    }
  }
  if ((i + 1) % 50 === 0 || i === ids.length - 1) {
    process.stdout.write(`\r  ${i + 1}/${ids.length}   ok ${ok}   refus ${ko}   (jusqu au #${id})   `);
  }
  await wait(500);
}
console.log('\n');
for (const [m, n] of Object.entries(raisons)) console.log(`  ${n} x ${m}`);
console.log(`
OpenSea relit les pieces en arriere-plan : compter quelques minutes a
quelques heures selon leur file. Recharger la page de la collection.
`);
process.exit(ko && !ok ? 1 : 0);
