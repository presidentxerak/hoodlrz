/**
 * Ferme le mint et fixe la date de revelation.
 *
 *   closeMint()          ferme le mint a l'instant. Les pieces non mintees
 *                        n'existeront jamais : la supply reelle devient le
 *                        nombre de pieces deja distribuees. IRREVERSIBLE.
 *   setRevealAfter(t)    date a partir de laquelle la revelation peut etre
 *                        engagee - par n'importe qui. Au plus 30 jours
 *                        apres la fermeture (ou le sold-out).
 *
 * Les deux se font ici, dans cet ordre, en une commande. La date est
 * donnee en heure de Paris ; on la convertit et on la reaffiche en clair
 * avant d'envoyer quoi que ce soit.
 *
 * Usage :
 *   npm run kids:close -- --mainnet --reveal "2026-09-25 18:00"
 *   npm run kids:close -- --mainnet --reveal now          (revelation possible tout de suite)
 *   npm run kids:close -- --testnet --reveal "2026-09-25 18:00"
 *
 * Deja sold-out ? La fermeture n'a alors plus d'objet, seule la date est
 * posee. Deja ferme ? Idem.
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, Contract } from 'ethers';
import { readFileSync } from 'node:fs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com' },
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
const revealArg = val('--reveal');
if (!which || !revealArg) {
  console.error(`
  Usage : npm run kids:close -- --mainnet --reveal "AAAA-MM-JJ HH:MM"   (heure de Paris)
          npm run kids:close -- --mainnet --reveal now
`);
  process.exit(2);
}
const CH = CHAINS[which];

/** "2026-09-25 18:00" en heure de Paris -> timestamp UNIX. */
function parisToUnix(s) {
  if (s === 'now') return 0;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) { console.error(`\n  Date illisible : « ${s} ». Format : AAAA-MM-JJ HH:MM\n`); process.exit(2); }
  // Decalage de Paris a cette date : +2 en ete, +1 en hiver. On le
  // deduit d'Intl plutot que de le supposer.
  const guess = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
  const parisStr = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', timeZoneName: 'shortOffset' })
    .formatToParts(guess).find((p) => p.type === 'timeZoneName').value;   // "GMT+2"
  const off = Number(parisStr.replace('GMT', '')) || 0;
  return Math.floor(guess.getTime() / 1000) - off * 3600;
}
const revealAt = parisToUnix(revealArg);
const fmtParis = (t) => new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const nft = new Contract(dep.nft, [
  'function closeMint()',
  'function setRevealAfter(uint64)',
  'function revealAfter() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
  'function allowlistStart() view returns (uint64)',
  'function soldOutAt() view returns (uint64)',
  'function totalMinted() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function MAX_REVEAL_DELAY() view returns (uint64)',
  'function seedBase() view returns (bytes32)',
  'function owner() view returns (address)',
], wallet);

console.log(`\nFermeture du mint — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  NFT        ${dep.nft}`);

if ((await nft.owner()).toLowerCase() !== wallet.address.toLowerCase()) {
  console.error(`\n  Ce wallet (${wallet.address}) n est pas le proprietaire du contrat.\n`);
  process.exit(1);
}
if ((await nft.seedBase()) !== '0x' + '0'.repeat(64)) {
  console.log('\n  La graine est deja revelee : plus rien a fermer ni a dater.\n');
  process.exit(0);
}

const now = (await provider.getBlock('latest')).timestamp;
const minted = Number(await nft.totalMinted());
const max = Number(await nft.MAX_SUPPLY());
const end = Number(await nft.mintEnd());
const al = Number(await nft.allowlistStart());
const soldOut = Number(await nft.soldOutAt());
console.log(`  mintes     ${minted} / ${max}`);
console.log(`  fenetre    ${end ? 'jusqu au ' + fmtParis(end) : 'non programmee'}`);

if (!al || now < al) {
  console.error(`\n  Le mint n a pas commence : rien a fermer. Pour changer les dates avant\n  l ouverture, c est setPhases (npm run kids:phases).\n`);
  process.exit(1);
}

/* ---- 1. Fermeture --------------------------------------------------- */
console.log('\n1. Fermeture');
if (soldOut) {
  console.log(`  sold-out le ${fmtParis(soldOut)} : rien a fermer`);
} else if (now >= end) {
  console.log(`  fenetre deja close le ${fmtParis(end)} : rien a fermer`);
} else {
  console.log(`  ${max - minted} pieces ne seront jamais mintees. IRREVERSIBLE.`);
  const rc = await (await nft.closeMint()).wait();
  console.log(`  transaction ${rc.hash}`);
  console.log(`  mint ferme, supply reelle : ${minted}`);
}

/* ---- 2. Date de revelation ------------------------------------------ */
console.log('\n2. Date de revelation');
const endNow = Number(await nft.soldOutAt()) || Number(await nft.mintEnd());
const maxDelay = Number(await nft.MAX_REVEAL_DELAY());
if (revealAt && revealAt > endNow + maxDelay) {
  console.error(`  Trop loin : au plus ${maxDelay / 86400} jours apres la fin, soit le ${fmtParis(endNow + maxDelay)}.\n`);
  process.exit(1);
}
const rc = await (await nft.setRevealAfter(revealAt)).wait();
console.log(`  transaction ${rc.hash}`);
console.log(`  revelation possible ${revealAt ? 'a partir du ' + fmtParis(revealAt) : 'des maintenant'}`);
console.log(`  et de toute facon pour tous a partir du ${fmtParis(endNow + maxDelay)}`);

console.log(`
  Le jour venu : npm run kids:reveal -- --${which}
  (n importe quel wallet peut le lancer, pas seulement celui-ci)
`);
