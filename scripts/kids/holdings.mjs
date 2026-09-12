/**
 * Ou sont les pieces ? Combien chaque wallet en detient, contrat par
 * contrat.
 *
 * Quatre contrats portent le nom « Hoodlrz Gen Kids » sur la chaine :
 * deux deploiements abandonnes du 9 septembre, la collection d'origine,
 * et la v2. Une marketplace qui n'a pas fini d'indexer, un profil
 * consulte avec le mauvais wallet, et on croit ses pieces disparues.
 * Ce script lit la chaine et le dit.
 *
 * Les contrats viennent de kids/config.json ; --aussi permet d'en
 * ajouter, par exemple les deploiements abandonnes qui n'y sont plus.
 *
 * Usage :
 *   npm run kids:holdings -- --mainnet
 *   npm run kids:holdings -- --mainnet --wallet 0x… --aussi 0x…,0x…
 */

import './env.mjs';
import { JsonRpcProvider, Contract } from 'ethers';
import { readFileSync } from 'node:fs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com' },
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

const contracts = [
  { label: 'collection officielle (v2)', addr: dep.nft },
  ...(dep.origin ? [{ label: 'collection d origine (v1)', addr: dep.origin }] : []),
  ...(val('--aussi') ?? '').split(',').filter(Boolean).map((a, i) => ({ label: `ajoute ${i + 1}`, addr: a.trim() })),
];

// Par defaut on regarde les deux wallets du projet : celui qui detient la
// reserve et les royalties, et celui qui deploie et ne detient rien.
const wallets = val('--wallet')
  ? [{ label: 'demande', addr: val('--wallet') }]
  : [
      { label: 'reserve / royalties', addr: dep.reserveReceiver ?? cfg.addresses.reserveReceiver },
      { label: 'deployeur', addr: cfg.addresses.deployer },
    ];

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, CH.id, { staticNetwork: true });
const ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function name() view returns (string)',
];

console.log(`\nOu sont les pieces — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}\n`);
for (const w of wallets) console.log(`  ${w.label.padEnd(22)} ${w.addr}`);
console.log('');

for (const c of contracts) {
  const nft = new Contract(c.addr, ABI, provider);
  let nom;
  try { nom = await nft.name(); } catch { console.log(`  ${c.label}\n    ${c.addr}   illisible\n`); continue; }
  console.log(`  ${c.label}  «${nom}»`);
  console.log(`    ${c.addr}`);
  for (const w of wallets) {
    if (!w.addr) continue;
    const bal = Number(await nft.balanceOf(w.addr));
    // Les pieces de reserve sont les premiers numeros, par construction :
    // elles sont mintees avant l'ouverture. On verifie donc #0 et #299,
    // ce qui distingue une reserve intacte d'un solde qui vient d'ailleurs.
    let detail = '';
    if (bal > 0) {
      const bornes = await Promise.all([nft.ownerOf(0).catch(() => null), nft.ownerOf(299).catch(() => null)]);
      const chez = bornes.map((o) => (o && o.toLowerCase() === w.addr.toLowerCase() ? 'oui' : 'non'));
      detail = `   #0 ${chez[0]}, #299 ${chez[1]}`;
    }
    console.log(`      ${w.label.padEnd(22)} ${String(bal).padStart(5)} pieces${detail}`);
  }
  console.log(`      ${CH.explorer}/token/${c.addr}\n`);
}

console.log(`  Une piece detenue par un wallet est detenue par lui, qu'une
  marketplace l'affiche ou non : l'indexation d'OpenSea peut avoir
  plusieurs heures de retard sur la chaine.\n`);
