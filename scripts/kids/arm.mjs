/**
 * Arme le mint : pose la racine d'allowlist et les phases sur le contrat.
 *
 * Les deux valeurs viennent de kids/config.json - la racine du snapshot
 * (ecrite par kids:snapshot), les dates de la section phases - et le
 * script ne fait qu'envoyer ce que la config dit, apres l'avoir affiche
 * en clair. Rien ne se tape a la main le jour J.
 *
 * Relancable sans risque : ce qui est deja en place n'est pas renvoye.
 * Tant que la phase allowlist n'a pas commence, racine et phases restent
 * modifiables ; ensuite le contrat refuse, et c'est voulu. On peut donc
 * armer aujourd'hui, et rearmer avec un snapshot plus recent d'ici
 * l'ouverture.
 *
 * Usage :
 *   npm run kids:arm -- --mainnet
 *   npm run kids:arm -- --testnet
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
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

const ts = (iso) => Math.floor(new Date(iso).getTime() / 1000);
const fmtParis = (t) => new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
const ZERO32 = '0x' + '0'.repeat(64);

const AL = ts(cfg.phases.allowlistStartParis);
const PUB = ts(cfg.phases.publicStartParis);
const END = ts(cfg.phases.mintEndParis);
const ROOT = cfg.snapshot.merkleRoot;

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const nft = new Contract(dep.nft, [
  'function setPhases(uint64,uint64,uint64)',
  'function setAllowlistRoot(bytes32)',
  'function allowlistRoot() view returns (bytes32)',
  'function allowlistStart() view returns (uint64)',
  'function publicStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
  'function reserveMinted() view returns (uint256)',
  'function RESERVE() view returns (uint256)',
  'function rendererLocked() view returns (bool)',
  'function seedBase() view returns (bytes32)',
  'function owner() view returns (address)',
], wallet);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settled = async (read, want) => {
  const t0 = Date.now();
  let v = await read();
  while (v !== want && Date.now() - t0 < 30_000) { await wait(2500); v = await read(); }
  return v;
};

console.log(`\nArmement du mint — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  NFT        ${dep.nft}`);
console.log(`  operateur  ${wallet.address}\n`);

/* ---- Ce que la config demande --------------------------------------- */
console.log('Ce que dit kids/config.json');
console.log(`  snapshot   ${cfg.snapshot.takenAt ? `${cfg.snapshot.holderCount} holders, bloc ${cfg.snapshot.blockNumber}, pris le ${cfg.snapshot.takenAt}` : 'AUCUN'}`);
console.log(`  racine     ${ROOT ?? 'aucune'}`);
console.log(`  allowlist  ${fmtParis(AL)}`);
console.log(`  public     ${fmtParis(PUB)}`);
console.log(`  fin        ${fmtParis(END)}`);

let bad = 0;
const check = (label, cond, hint = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${!cond && hint ? '   ' + hint : ''}`);
  if (!cond) bad++;
};

console.log('\nControles');
check('une racine de snapshot existe', /^0x[0-9a-f]{64}$/i.test(ROOT ?? '') && ROOT !== ZERO32,
      'lancer d abord : npm run kids:snapshot -- --alchemy');
check('phases coherentes', AL <= PUB && PUB < END);
const now = (await provider.getBlock('latest')).timestamp;
check('l allowlist ouvre dans le futur', AL > now + 60,
      'sinon le mint s ouvrirait a l instant, sans possibilite de corriger');
check('operateur = proprietaire du contrat', (await nft.owner()).toLowerCase() === wallet.address.toLowerCase());
check('reserve mintee en entier', (await nft.reserveMinted()) === (await nft.RESERVE()),
      'le contrat refuse tout mint tant que la reserve n est pas complete');
check('renderer verrouille', await nft.rendererLocked(), 'npm run kids:lock');
check('graine non revelee', (await nft.seedBase()) === ZERO32);
const alOnChain = Number(await nft.allowlistStart());
check('mint pas encore ouvert sur la chaine', alOnChain === 0 || now < alOnChain,
      'trop tard : racine et phases sont figees');

if (bad) {
  console.error(`\n  ${bad} controle(s) en echec. Rien n a ete envoye.\n`);
  process.exit(1);
}

/* ---- Envoi, seulement de ce qui differe ----------------------------- */
console.log('\nEnvoi');
const rootOnChain = await nft.allowlistRoot();
if (rootOnChain.toLowerCase() === ROOT.toLowerCase()) {
  console.log('  racine     deja en place');
} else {
  const rc = await (await nft.setAllowlistRoot(ROOT)).wait();
  const seen = await settled(() => nft.allowlistRoot().then((r) => r.toLowerCase()), ROOT.toLowerCase());
  console.log(`  racine     ${seen === ROOT.toLowerCase() ? 'posee' : 'ENVOYEE MAIS NON RELUE'}   ${rc.hash}`);
  if (seen !== ROOT.toLowerCase()) process.exit(1);
}

const same = Number(await nft.allowlistStart()) === AL &&
             Number(await nft.publicStart()) === PUB &&
             Number(await nft.mintEnd()) === END;
if (same) {
  console.log('  phases     deja en place');
} else {
  const rc = await (await nft.setPhases(AL, PUB, END)).wait();
  const seen = await settled(() => nft.mintEnd().then(Number), END);
  console.log(`  phases     ${seen === END ? 'posees' : 'ENVOYEES MAIS NON RELUES'}   ${rc.hash}`);
  if (seen !== END) process.exit(1);
}

/* ---- Etat final ------------------------------------------------------ */
console.log('\nEtat du contrat');
console.log(`  racine     ${await nft.allowlistRoot()}`);
console.log(`  allowlist  ${fmtParis(Number(await nft.allowlistStart()))}`);
console.log(`  public     ${fmtParis(Number(await nft.publicStart()))}`);
console.log(`  fin        ${fmtParis(Number(await nft.mintEnd()))}`);
console.log(`
  Le mint est arme. Jusqu au ${fmtParis(AL)}, racine et phases restent
  modifiables : relancer ce script apres un nouveau snapshot suffit.
  Passe cette heure, plus rien ne bouge.

  Ne pas oublier de publier l allowlist pour la page de mint :
    git add kids/config.json public/kids && git commit -m "Allowlist Gen Kids" && git push
`);
