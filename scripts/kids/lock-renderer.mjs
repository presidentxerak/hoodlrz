/**
 * Pose le verrou du renderer. IRREVERSIBLE.
 *
 * Tant qu'il n'est pas pose, le proprietaire peut remplacer le renderer -
 * donc changer l'apparence de pieces deja vendues. C'est le dernier
 * pouvoir discretionnaire du contrat, et le renoncer est ce qui rend la
 * collection reellement figee.
 *
 * Il se pose APRES avoir verifie le rendu depuis la chaine, jamais avant :
 * verrouiller sur un renderer fautif serait definitif. Le script refuse
 * donc de continuer si le rendu n'a pas ete controle.
 *
 * Usage :
 *   npm run kids:lock -- --testnet
 *   npm run kids:lock -- --mainnet --confirmer-irreversible
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

// Sur mainnet, le geste est definitif pour de bon : on exige un drapeau
// explicite plutot qu'une confirmation au clavier, qu'un script
// automatise pourrait franchir sans y penser.
if (which === 'mainnet' && !has('--confirmer-irreversible')) {
  console.error(`
  Refuse. lockRenderer() sur mainnet est DEFINITIF : l'adresse du
  renderer ne pourra plus jamais changer, y compris pour corriger un
  defaut de rendu.

  Ne le poser qu'apres avoir vu les pieces s'afficher correctement sur
  une marketplace. Puis relancer avec :

    npm run kids:lock -- --mainnet --confirmer-irreversible
`);
  process.exit(2);
}

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
  'function renderer() view returns (address)',
  'function rendererLocked() view returns (bool)',
  'function lockRenderer()',
  'function setRenderer(address)',
  'function tokenURI(uint256) view returns (string)',
  'function totalMinted() view returns (uint256)',
  'function contractURI() view returns (string)',
];
const nft = new Contract(dep.nft, ABI, wallet);

console.log(`\nVerrou du renderer — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  NFT       ${dep.nft}`);
console.log(`  renderer  ${await nft.renderer()}`);

if (await nft.rendererLocked()) {
  console.log(`\n  Deja verrouille. Rien a faire.\n`);
  process.exit(0);
}

/* ---- Controles avant le point de non-retour ----------------------- */
// Verrouiller sur un renderer qui ne rend pas serait definitif. On relit
// donc ce que la chaine produit reellement, plutot que de faire confiance
// a l'etape precedente.
console.log('\nControles avant le verrou');
let bad = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  if (!cond) bad++;
};

const onchainRenderer = await nft.renderer();
ok('renderer identique au deploiement enregistre',
   onchainRenderer.toLowerCase() === String(dep.renderer).toLowerCase(),
   onchainRenderer);

const minted = Number(await nft.totalMinted());
ok('au moins un token existe', minted > 0, `${minted} mintes`);

if (minted > 0) {
  const uri = await nft.tokenURI(0);
  ok('tokenURI repond en data URI', uri.startsWith('data:application/json;base64,'));
  const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
  ok('le token a un nom', typeof meta.name === 'string' && meta.name.length > 0, meta.name);
  // v1 : l'image est une affiche encodee dans les metadonnees. v2 : une
  // URL vers la capture servie par le site - alors on va la chercher,
  // parce que verrouiller sur une image qui ne repond pas serait definitif.
  if (typeof meta.image === 'string' && /^https?:\/\//.test(meta.image)) {
    const r = await fetch(meta.image, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    const type = r?.headers.get('content-type') ?? '';
    ok('l image repond depuis le site', !!r?.ok && /^image\//.test(type),
       r ? `${r.status} ${type}   ${meta.image}` : `injoignable   ${meta.image}`);
  } else {
    ok('une image est presente', typeof meta.image === 'string' && meta.image.length > 200);
  }
  // Un token revele doit porter ses attributs ; un placeholder n'en a pas,
  // et c'est legitime avant revelation.
  const revele = Array.isArray(meta.attributes) && meta.attributes.length === 9;
  console.log(`  ${revele ? 'OK  ' : '--  '}  ${revele ? '9 attributs' : 'placeholder : graine non revelee'}`);
}

const cUri = await nft.contractURI();
ok('contractURI repond', cUri.startsWith('data:application/json;base64,'));
const coll = JSON.parse(Buffer.from(cUri.split(',')[1], 'base64').toString('utf8'));
ok('la collection a un nom', typeof coll.name === 'string' && coll.name.length > 0, coll.name);

if (bad) {
  console.error(`\n  ${bad} controle(s) en echec. Le verrou N'A PAS ete pose.`);
  console.error(`  Corriger d'abord : setRenderer() est encore possible.\n`);
  process.exit(1);
}

/* ---- Point de non-retour ------------------------------------------ */
console.log('\nPose du verrou…');
const rc = await (await nft.lockRenderer()).wait();
console.log(`  transaction ${rc.hash}`);
console.log(`  gas ${rc.gasUsed.toLocaleString('fr')}`);

const verrouille = await nft.rendererLocked();
console.log(`\n  rendererLocked = ${verrouille}`);
if (!verrouille) {
  console.error('  ANOMALIE : la transaction est passee mais le verrou n est pas pose.\n');
  process.exit(1);
}

// On prouve le verrou plutot que de le croire : setRenderer doit
// desormais echouer, y compris pour le proprietaire.
process.stdout.write('  setRenderer doit maintenant echouer… ');
try {
  await nft.setRenderer.staticCall(dep.renderer);
  console.log('\n  ANOMALIE : setRenderer est toujours accepte.\n');
  process.exit(1);
} catch {
  console.log('refuse, comme attendu.');
}

console.log(`
  Le renderer est fige definitivement.
  ${CH.explorer}/address/${dep.nft}
`);
