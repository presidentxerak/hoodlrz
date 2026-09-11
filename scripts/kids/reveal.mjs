/**
 * Revelation de la graine, en deux temps.
 *
 *   startReveal()   s'engage sur un bloc parent futur (block.number + 10)
 *   finishReveal()  lit le hash de ce bloc et fige la graine
 *
 * Les deux appels sont ouverts a tous : ce script n'a rien de reserve au
 * createur, n'importe quel holder peut le lancer avec son propre wallet.
 * Il attend simplement que le bloc engage devienne lisible, ce qui prend
 * environ deux minutes, et doit se faire dans les 256 blocs parents
 * (~50 min) - au-dela, il faut recommencer.
 *
 * IRREVERSIBLE : la graine ne se pose qu'une fois et toute la collection
 * en decoule. Le contrat ne l'accepte que mint termine (fenetre close ou
 * sold-out) ; le script le verifie avant de toucher a quoi que ce soit.
 *
 * Usage :
 *   npm run kids:reveal -- --testnet
 *   npm run kids:reveal -- --mainnet
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
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) {
  console.error('\n  Choisir un reseau : --testnet ou --mainnet\n');
  process.exit(2);
}
const CH = CHAINS[which];

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) {
  console.error(`\n  Aucun deploiement enregistre pour le chain ID ${CH.id}.\n`);
  process.exit(2);
}

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

const ABI = [
  'function startReveal()',
  'function finishReveal()',
  'function revealBlock() view returns (uint256)',
  'function REVEAL_DELAY() view returns (uint256)',
  'function seedBase() view returns (bytes32)',
  'function totalMinted() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function mintEnd() view returns (uint64)',
  'function revealAfter() view returns (uint64)',
  'function soldOutAt() view returns (uint64)',
  'function MAX_REVEAL_DELAY() view returns (uint64)',
  'function tokenURI(uint256) view returns (string)',
];
const nft = new Contract(dep.nft, ABI, wallet);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ZERO32 = '0x' + '0'.repeat(64);

console.log(`\nRevelation de la graine — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  NFT        ${dep.nft}`);
console.log(`  appelant   ${wallet.address}`);

if ((await nft.seedBase()) !== ZERO32) {
  console.log(`\n  La graine est deja posee : ${await nft.seedBase()}\n  Rien a faire.\n`);
  process.exit(0);
}

/* ---- Etat de la distribution --------------------------------------- */
// Avec --watch, le script ne s'arrete pas quand ce n'est pas encore le
// moment : il attend, en relisant la chaine toutes les minutes, et part
// tout seul des que la revelation devient possible - sold-out, fin de
// fenetre, fermeture par le createur, date de revelation atteinte. Le
// contrat reste le seul juge : on ne fait que lui demander.
const WATCH = has('--watch');
const fmt = (t) => new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });

for (let tour = 0; ; tour++) {
  const minted = Number(await nft.totalMinted());
  const max = Number(await nft.MAX_SUPPLY());
  const end = Number(await nft.mintEnd());
  const chainNow = (await provider.getBlock('latest')).timestamp;
  if (tour === 0) {
    console.log(`  mintes     ${minted} / ${max}`);
    console.log(`  fenetre    ${end ? 'jusqu au ' + fmt(end) : 'non programmee'}`);
  }

  let raison = null;
  if (!end || (minted < max && chainNow < end)) {
    raison = `mint en cours (${minted}/${max}), ni sold-out ni fenetre close`;
  } else {
    // Date choisie par le createur, qui ne vaut que 30 jours au plus
    // apres la fin de la distribution.
    const revealAfter = Number(await nft.revealAfter());
    const distributionEnd = Number(await nft.soldOutAt()) || end;
    const forAll = distributionEnd + Number(await nft.MAX_REVEAL_DELAY());
    if (chainNow < revealAfter && chainNow < forAll) {
      raison = `revelation fixee au ${fmt(revealAfter)} (ouverte a tous le ${fmt(forAll)})`;
    }
  }
  if (!raison) break;

  if (!WATCH) {
    console.error(`
  Pas encore : ${raison}.
  Le contrat refuserait l'engagement, et c'est voulu.

  Pour fermer le mint maintenant : npm run kids:close -- --${which} --reveal now
  Pour attendre et reveler tout seul le moment venu : ajouter --watch
`);
    process.exit(1);
  }
  process.stdout.write(`\r  en attente : ${raison}   (${fmt(chainNow)})   `);
  await wait(60_000);
}
process.stdout.write('\r');

/* ---- 1. Engagement ------------------------------------------------- */
let rb = Number(await nft.revealBlock());
if (rb === 0) {
  console.log('\n1. Engagement sur un bloc futur');
  const rc = await (await nft.startReveal()).wait();
  rb = Number(await nft.revealBlock());
  console.log(`  transaction ${rc.hash}`);
  console.log(`  bloc parent engage : ${rb}`);
} else {
  console.log(`\n1. Un engagement existe deja : bloc parent ${rb}. On le cloture.`);
}

/* ---- 2. Cloture ---------------------------------------------------- */
// block.number est celui de la chaine parente et n'est pas expose tel
// quel par le RPC : on demande au contrat, par un appel a blanc, si la
// cloture passerait. C'est exactement le test qu'il fera pour de vrai.
console.log('\n2. Cloture, des que le hash du bloc engage est lisible');
const delay = Number(await nft.REVEAL_DELAY());
console.log(`  environ ${Math.round((delay + 1) * 12 / 60)} min apres l'engagement…`);
for (let i = 0; ; i++) {
  try {
    await nft.finishReveal.staticCall();
    break;
  } catch (e) {
    const msg = String(e.message);
    if (/RevealExpired/.test(msg)) {
      console.error(`
  La fenetre de lecture (256 blocs parents) est depassee : le hash du
  bloc ${rb} n'est plus accessible. Relancer ce script : il posera un
  nouvel engagement. Chaque engagement laisse un evenement RevealStarted
  sur la chaine - c'est voulu, une revelation retentee se voit.
`);
      process.exit(1);
    }
    if (/SeedAlreadySet/.test(msg)) {
      console.log('\n  Quelqu un d autre vient de cloturer la revelation.');
      break;
    }
    process.stdout.write(`\r  pas encore lisible (${i * 10} s)…   `);
    await wait(10_000);
  }
}
process.stdout.write('\r');

if ((await nft.seedBase()) === ZERO32) {
  const rc = await (await nft.finishReveal()).wait();
  console.log(`  transaction ${rc.hash}`);
}
const seed = await nft.seedBase();
console.log(`  graine     ${seed}`);

/* ---- 3. Preuve ------------------------------------------------------ */
console.log('\n3. Un token sort du placeholder');
const uri = await nft.tokenURI(0);
const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
const revele = Array.isArray(meta.attributes) && meta.attributes.length === 9;
console.log(`  ${revele ? 'OK  ' : 'FAIL'}  token 0 : ${revele ? '9 attributs' : 'toujours en placeholder'}`);
if (revele) for (const a of meta.attributes) console.log(`        ${String(a.trait_type).padEnd(12)} ${a.value}`);

console.log(`
  La collection est revelee.
  ${CH.explorer}/address/${dep.nft}

  Ensuite : npm run kids:verify-chain -- --${which}
`);
process.exit(revele ? 0 : 1);
