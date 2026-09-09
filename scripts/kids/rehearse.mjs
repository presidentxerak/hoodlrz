/**
 * Repetition generale sur testnet : le cycle de mint en entier.
 *
 * Le deploiement prouve que les contrats existent. Il ne prouve pas que
 * la sequence du jour J fonctionne - poser une racine d'allowlist, ouvrir
 * les phases, minter par les deux portes, reveler la graine, et obtenir
 * enfin des metadonnees qui correspondent a l'image.
 *
 * Ce script joue cette sequence avec des fenetres de quelques minutes au
 * lieu de plusieurs jours. Tout ce qui casserait le 11 septembre casse
 * ici, ou ca ne coute rien.
 *
 * IRREVERSIBLE sur le deploiement vise : la revelation ne se joue qu'une
 * fois. Le script refuse donc le mainnet, categoriquement. La repetition
 * consomme le deploiement testnet ; en refaire un autre coute six
 * transactions de moteur, ce qui est precisement le prix a payer pour ne
 * pas repeter sur la vraie collection.
 *
 * Usage :
 *   npm run kids:rehearse
 *   npm run kids:rehearse -- --minutes 2     (fenetres plus courtes)
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes } from 'ethers';
import { readFileSync } from 'node:fs';
import { buildTree, proofFor, leafOf } from './merkle.mjs';

const CH = { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC' };

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const STEP = Math.max(1, Number(val('--minutes', '2'))) * 60;   // duree d'une phase

if (args.includes('--mainnet')) {
  console.error(`
  Refuse. Cette repetition revele la graine, ce qui est irreversible :
  la graine se pose une seule fois, et toute la collection en decoule.
  Sur mainnet, cela figerait 3333 pieces avant meme le mint.
`);
  process.exit(2);
}

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  cond ? pass++ : fail++;
  return cond;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lecture qui laisse au fournisseur RPC le temps de se mettre d'accord
 * avec lui-meme. Derriere une seule URL, Alchemy repartit les requetes
 * sur plusieurs noeuds, et l'un d'eux peut ne pas avoir encore vu la
 * transaction dont on vient pourtant d'attendre le recu. Lire une fois et
 * conclure ferait passer ce retard pour un bug de contrat. On relit donc
 * jusqu'a obtenir la valeur attendue, avec une limite : au-dela, c'est un
 * vrai desaccord et on le rapporte tel quel.
 */
async function settled(read, want, timeoutMs = 20_000) {
  const t0 = Date.now();
  let seen = await read();
  while (seen !== want && Date.now() - t0 < timeoutMs) {
    await wait(2000);
    seen = await read();
  }
  return seen;
}

/* ---- Connexion ---------------------------------------------------- */
const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) {
  console.error(`\n  Aucun deploiement testnet enregistre.\n  Lancer : npm run kids:deploy -- --testnet\n`);
  process.exit(2);
}

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

const ABI = [
  'function setPhases(uint64,uint64,uint64)',
  'function setAllowlistRoot(bytes32)',
  'function allowlistRoot() view returns (bytes32)',
  'function mintAllowlist(uint256,bytes32[])',
  'function mintPublic(uint256)',
  'function startReveal()',
  'function finishReveal()',
  'function closeMint()',
  'function setRevealAfter(uint64)',
  'function revealAfter() view returns (uint64)',
  'function revealBlock() view returns (uint256)',
  'function REVEAL_DELAY() view returns (uint256)',
  'function lockRenderer()',
  'function seedBase() view returns (bytes32)',
  'function setRoyaltyReceiver(address)',
  'function tokenHash(uint256) view returns (bytes32)',
  'function tokenURI(uint256) view returns (string)',
  'function totalMinted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
  'function allowlistStart() view returns (uint64)',
  'function publicStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
  'function rendererLocked() view returns (bool)',
];
const nft = new Contract(dep.nft, ABI, wallet);

console.log(`\nRepetition generale — Robinhood Chain Testnet`);
console.log(`  NFT        ${dep.nft}`);
console.log(`  operateur  ${wallet.address}`);
console.log(`  fenetres   ${STEP / 60} min par phase\n`);

// Un deploiement anterieur a la revue de securite n'a pas la revelation
// en deux temps : la repetition echouerait a mi-parcours, graine posee
// ou non. On le dit avant de toucher a quoi que ce soit.
try {
  await nft.REVEAL_DELAY();
} catch {
  console.error(`  Ce deploiement date d'avant la revue de securite (pas de
  startReveal/finishReveal). Redeployer un testnet neuf :

    rm kids/build/deployment-46630.json
    npm run kids:deploy -- --testnet
`);
  process.exit(2);
}

if ((await nft.seedBase()) !== '0x' + '0'.repeat(64)) {
  console.error(`  La graine est deja revelee sur ce deploiement : la repetition
  a deja eu lieu. Pour recommencer, redeployer un testnet neuf :

    rm kids/build/deployment-46630.json
    npm run kids:deploy -- --testnet
`);
  process.exit(2);
}

/* ---- 1. Allowlist -------------------------------------------------- */
// Le wallet operateur est mis dans l'arbre pour pouvoir emprunter la
// porte allowlist. Les autres adresses ne servent qu'a donner a l'arbre
// une profondeur realiste : une preuve dans un arbre de deux feuilles ne
// prouverait pas grand-chose.
console.log('1. Racine d allowlist');
const others = Array.from({ length: 116 }, (_, i) =>
  '0x' + keccak256(toUtf8Bytes(`holder-de-test-${i}`)).slice(26));
const tree = buildTree([wallet.address, ...others]);
await (await nft.setAllowlistRoot(tree.root)).wait();
ok('racine posee', (await settled(() => nft.allowlistRoot(), tree.root)) === tree.root,
   `${tree.addresses.length} adresses`);

const proof = proofFor(tree, leafOf(wallet.address));
ok('preuve calculee', proof.length > 0, `profondeur ${proof.length}`);

/* ---- 2. Phases ----------------------------------------------------- */
console.log('\n2. Phases de mint');
const now = Math.floor(Date.now() / 1000);
const AL = now + 45, PUB = AL + STEP, END = PUB + STEP;
await (await nft.setPhases(AL, PUB, END)).wait();
ok('phases posees',
   (await settled(() => nft.mintEnd(), BigInt(END))) === BigInt(END) &&
   Number(await nft.allowlistStart()) === AL,
   `allowlist +45 s, public +${(PUB - now) / 60} min, fin +${(END - now) / 60} min`);

const until = async (ts, label) => {
  // On se cale sur l'horloge de la CHAINE, pas celle du poste : c'est
  // block.timestamp qui arbitre, et les deux peuvent deriver.
  for (;;) {
    const b = await provider.getBlock('latest');
    const left = ts - b.timestamp;
    if (left <= 0) return;
    process.stdout.write(`\r  ${label} dans ${left} s…   `);
    await wait(Math.min(10, left) * 1000);
  }
};

/* ---- 3. Mint allowlist --------------------------------------------- */
console.log('\n3. Mint allowlist');
ok('mint refuse avant l ouverture',
   await refuses(() => nft.mintAllowlist(2, proof)));
await until(AL + 5, 'ouverture allowlist');
process.stdout.write('\r');

const before = Number(await nft.totalMinted());
await (await nft.mintAllowlist(2, proof)).wait();
ok('2 pieces mintees en allowlist',
   (await settled(() => nft.totalMinted(), BigInt(before + 2))) === BigInt(before + 2));
ok('une preuve invalide est refusee',
   await refuses(() => nft.mintAllowlist(1, proof.slice(1))));

/* ---- 4. Mint public ------------------------------------------------ */
console.log('\n4. Mint public');
await until(PUB + 5, 'ouverture publique');
process.stdout.write('\r');
await (await nft.mintPublic(3)).wait();
ok('3 pieces mintees en public',
   (await settled(() => nft.totalMinted(), BigInt(before + 5))) === BigInt(before + 5));
const perWallet = await settled(() => nft.minted(wallet.address), 5n);
ok('plafond de 10 par wallet respecte', perWallet === 5n, `${perWallet} / 10`);
ok('un 6e lot depassant le plafond est refuse',
   await refuses(() => nft.mintPublic(6)));

/* ---- 4 bis. Ce qui doit etre fige pendant le mint ------------------ */
// Ces refus sont ceux de la revue de securite : un mint ouvert ne se
// reprogramme pas, et sa liste ne change pas.
console.log('\n4 bis. Verrous pendant le mint');
ok('setPhases refuse pendant le mint', await refuses(() => nft.setPhases(AL, PUB, END + 60)));
ok('setAllowlistRoot refuse pendant le mint', await refuses(() => nft.setAllowlistRoot(tree.root)));

/* ---- 5. Revelation, en deux temps ---------------------------------- */
console.log('\n5. Fermeture par le createur, puis date de revelation');
ok('engagement refuse pendant le mint', await refuses(() => nft.startReveal()));
// Plutot que d'attendre la fin de fenetre, on ferme : c'est le geste
// que fera le createur si la collection ne part pas entierement.
await (await nft.closeMint()).wait();
let closedEnd = END;
for (let i = 0; i < 10 && closedEnd >= END; i++) {
  closedEnd = Number(await nft.mintEnd());
  if (closedEnd >= END) await wait(2000);
}
ok('mint ferme a l instant', closedEnd <= Math.floor(Date.now() / 1000) + 60 && closedEnd < END, `mintEnd ${closedEnd}`);
ok('mint refuse apres fermeture', await refuses(() => nft.mintPublic(1)));

const revealAt = Math.floor(Date.now() / 1000) + 45;
await (await nft.setRevealAfter(revealAt)).wait();
ok('date de revelation posee', Number(await settled(() => nft.revealAfter(), BigInt(revealAt))) === revealAt);
ok('engagement refuse avant la date', await refuses(() => nft.startReveal()));
await until(revealAt + 5, 'date de revelation');
process.stdout.write('\r');

await (await nft.startReveal()).wait();
// Ici on ne connait pas la valeur attendue : on attend seulement qu'elle
// cesse d'etre nulle.
let rb = 0;
for (let i = 0; i < 10 && rb === 0; i++) {
  rb = Number(await nft.revealBlock());
  if (rb === 0) await wait(2000);
}
ok('engagement pose sur un bloc futur', rb > 0, `bloc parent ${rb}`);
ok('cloture refusee tant que le bloc n existe pas', await refuses(() => nft.finishReveal()));

// block.number est ici celui de la chaine PARENTE, qui avance toutes
// les ~12 s : le seul moyen fiable de savoir si le hash est lisible est
// de demander au contrat lui-meme, par un appel a blanc.
const delay = Number(await nft.REVEAL_DELAY());
console.log(`  attente de ${delay + 1} blocs parents (~${Math.round((delay + 1) * 12 / 60)} min)…`);
for (let i = 0; ; i++) {
  try { await nft.finishReveal.staticCall(); break; }
  catch (e) {
    if (/RevealExpired/.test(String(e.message))) {
      console.error('  fenetre de lecture depassee : relancer startReveal()');
      process.exit(1);
    }
    process.stdout.write(`\r  bloc ${rb} pas encore lisible (${i * 10} s)…   `);
    await wait(10_000);
  }
}
process.stdout.write('\r');
await (await nft.finishReveal()).wait();
let seed = '0x' + '0'.repeat(64);
for (let i = 0; i < 10 && /^0x0+$/.test(seed); i++) {
  seed = await nft.seedBase();
  if (/^0x0+$/.test(seed)) await wait(2000);
}
ok('graine posee', /^0x[0-9a-f]{64}$/.test(seed) && seed !== '0x' + '0'.repeat(64), seed.slice(0, 18) + '…');
ok('seconde cloture refusee', await refuses(() => nft.finishReveal()));
ok('second engagement refuse', await refuses(() => nft.startReveal()));

/* ---- 6. Metadonnees reelles ---------------------------------------- */
console.log('\n6. Metadonnees apres revelation');
const uri = await nft.tokenURI(0);
const meta = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));
ok('nom du token', meta.name === 'Hoodlrz Gen Kid #0', meta.name);
ok('9 attributs', Array.isArray(meta.attributes) && meta.attributes.length === 9);
ok('image SVG on-chain', String(meta.image).startsWith('data:image/svg+xml;base64,'));
ok('animation HTML on-chain', String(meta.animation_url).startsWith('data:text/html;base64,'));

const html = Buffer.from(meta.animation_url.split(',')[1], 'base64').toString('utf8');
const th = await nft.tokenHash(0);
ok('le HTML porte le hash du token', html.includes(th));

console.log('\n  Traits du token 0, lus depuis la chaine :');
for (const a of meta.attributes) console.log(`    ${String(a.trait_type).padEnd(12)} ${a.value}`);

console.log(`\n==================================================`);
console.log(`  ${pass} OK, ${fail} FAIL`);
console.log(`==================================================`);
console.log(`
Le cycle complet a tourne. Reste, quand le rendu est valide :

  npm run kids:verify-chain -- --testnet     doit passer tout au vert
  npm run kids:preview-chain -- --testnet    voir une piece dessinee

Puis lockRenderer(), qui est le dernier geste irreversible et n'est
volontairement pas joue ici : il se pose apres avoir regarde les
pieces, pas avant.
`);
process.exit(fail ? 1 : 0);

/** Vrai si l'appel echoue, quelle qu'en soit la raison de revert. */
async function refuses(fn) {
  try { await (await fn()).wait(); return false; }
  catch { return true; }
}
