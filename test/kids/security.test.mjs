/**
 * Revue de securite - les findings, rejoues un par un.
 *
 * Chaque section correspond a un point du rapport kids/SECURITY-REVIEW.md
 * et prouve que le correctif tient sur l'EVM, pas seulement dans le code.
 * Quand c'est possible, on rejoue d'abord l'ATTAQUE pour verifier qu'elle
 * est bien refusee - un test qui ne sait pas echouer ne protege de rien.
 *
 * Usage : npm run kids:security
 */

import { readFileSync } from 'node:fs';
import { createChain, ACCOUNTS, blockHashOf } from '../../scripts/kids/chain.mjs';
import { buildTree, proofFor, leafOf } from '../../scripts/kids/merkle.mjs';
import { keccak256, solidityPacked, id } from 'ethers';
import { bytesToHex } from '@ethereumjs/util';

const DAY = 86400;
const ZERO32 = '0x' + '0'.repeat(64);
const ZERO_ADDR = '0x' + '0'.repeat(40);

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const section = (t) => console.log(`\n${t}`);

/** Deploie moteur + renderer + NFT, moteur televerse et scelle. */
async function fresh(chain) {
  const engine = await chain.deploy('contracts/kids/HoodlrzKidsEngine.sol', 'HoodlrzKidsEngine');
  const pre = JSON.parse(readFileSync('kids/build/engine-pre.json', 'utf8'));
  const post = JSON.parse(readFileSync('kids/build/engine-post.json', 'utf8'));
  for (const c of pre) await engine.call('appendChunk', [true, c]);
  for (const c of post) await engine.call('appendChunk', [false, c]);
  const sha = '0x' + readFileSync('kids/build/engine.sha256', 'utf8').split(' ')[0];
  await engine.call('seal', [sha]);
  const renderer = await chain.deploy('contracts/kids/HoodlrzKidsRenderer.sol', 'HoodlrzKidsRenderer',
    [engine.address.toString()]);
  const nft = await chain.deploy('contracts/kids/HoodlrzKids.sol', 'HoodlrzKids',
    [renderer.address.toString(), ACCOUNTS.DEPLOYER.toString()]);
  return { engine, renderer, nft, sha };
}

/** Reserve complete, phases posees, allowlist a une feuille (Alice). */
async function openMint(chain, nft, T0) {
  const AL = T0 + DAY, PUB = T0 + 2 * DAY, END = T0 + 9 * DAY;
  for (let i = 0; i < 3; i++) await nft.call('mintReserve', [ACCOUNTS.DEPLOYER.toString(), 100]);
  const tree = buildTree([ACCOUNTS.ALICE.toString(), ACCOUNTS.BOB.toString()]);
  await nft.call('setAllowlistRoot', [tree.root]);
  await nft.call('setPhases', [AL, PUB, END]);
  return { AL, PUB, END, tree };
}

const DELAY = 10;

console.log('\nRevue de securite : les findings, rejoues sur EVM locale');

/* ================================================================== *
 * C-1  Rouvrir le mint apres la graine
 * ================================================================== */
section('C-1. Le mint ne peut pas rouvrir une fois la graine posee');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { PUB, END } = await openMint(chain, nft, T0);

  chain.warpTo(PUB + 60);
  await nft.call('mintPublic', [3], { from: ACCOUNTS.ALICE });

  // L'attaque : avancer la fin, reveler, rouvrir. Premiere marche refusee.
  ok('setPhases refuse une fois le mint commence',
     (await nft.expectRevert('setPhases', [T0 + DAY, PUB, PUB + 1])) === 'PhasesLocked');

  chain.warpTo(END + 60);
  await nft.call('startReveal');
  chain.mineBlocks(DELAY + 1);
  await nft.call('finishReveal');
  ok('graine posee', (await nft.call('seedBase')) !== ZERO32);

  ok('setPhases refuse apres la graine',
     (await nft.expectRevert('setPhases', [END + 100, END + 200, END + 99999])) === 'PhasesLocked');
  ok('mintPublic refuse apres la graine (fenetre close)',
     (await nft.expectRevert('mintPublic', [1], { from: ACCOUNTS.BOB })) === 'MintClosed');
  ok('mintReserve refuse apres la graine',
     (await nft.expectRevert('mintReserve', [ACCOUNTS.DEPLOYER.toString(), 1])) !== null);
}

{
  // Variante : sold-out AVANT mintEnd, graine posee, fenetre encore
  // ouverte selon l'horloge. Le mint doit quand meme etre clos.
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { PUB } = await openMint(chain, nft, T0);
  chain.warpTo(PUB + 60);
  // On force l'epuisement par des adresses jetables, sans passer par un
  // contrat (le mint public les refuse : voir H-3).
  const publicSupply = 3333 - 300;
  const { createAddressFromString } = await import('@ethereumjs/util');
  for (let i = 0; i * 10 < publicSupply; i++) {
    const a = createAddressFromString('0x' + (i + 1).toString(16).padStart(40, '0'));
    await nft.call('mintPublic', [Math.min(10, publicSupply - i * 10)], { from: a });
  }
  ok('sold-out', (await nft.call('totalMinted')) === 3333n);
  await nft.call('startReveal', [], { from: ACCOUNTS.BOB });
  chain.mineBlocks(DELAY + 1);
  await nft.call('finishReveal', [], { from: ACCOUNTS.BOB });
  ok('graine posee alors que la fenetre est encore ouverte', (await nft.call('seedBase')) !== ZERO32);
  ok('un mint de plus est refuse par la graine, pas seulement par la supply',
     (await nft.expectRevert('mintPublic', [1], { from: ACCOUNTS.CAROL })) === 'MintClosed');
}

/* ================================================================== *
 * H-1  Grinding de la graine
 * ================================================================== */
section('H-1. La graine vient d un bloc futur et n appartient a personne');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { END } = await openMint(chain, nft, T0);
  chain.warpTo(END + 60);

  ok('le proprietaire ne peut pas cloturer sans engagement',
     (await nft.expectRevert('finishReveal')) === 'RevealNotReady');

  const b0 = chain.blockNumber;
  await nft.call('startReveal', [], { from: ACCOUNTS.ALICE });
  const rb = await nft.call('revealBlock');
  ok('engagement sur un bloc futur, par un tiers', rb === b0 + BigInt(DELAY), `bloc ${rb}`);

  // Tant que le hash est lisible, personne ne peut re-tirer.
  ok('re-engagement refuse par le proprietaire pendant la fenetre',
     (await nft.expectRevert('startReveal')) === 'RevealPending');
  chain.mineBlocks(DELAY);
  ok('cloture refusee au bloc engage lui-meme (hash pas encore lisible)',
     (await nft.expectRevert('finishReveal')) === 'RevealNotReady');
  chain.mineBlocks(1);
  ok('re-engagement toujours refuse une fois le hash lisible',
     (await nft.expectRevert('startReveal')) === 'RevealPending');

  // La graine est exactement celle que le hash du bloc engage impose :
  // aucun autre parametre ne depend de l'appelant ou de l'instant.
  await nft.call('finishReveal', [], { from: ACCOUNTS.CAROL });
  const expected = keccak256(solidityPacked(
    ['bytes32', 'address', 'uint256'],
    [bytesToHex(blockHashOf(rb)), nft.address.toString(), await nft.call('totalMinted')]));
  ok('graine == keccak(blockhash(revealBlock), contrat, totalMinted)',
     (await nft.call('seedBase')) === expected);
  ok('ni le timestamp ni l appelant n entrent dans la graine', true, 'par construction, voir ci-dessus');
}

{
  // Fenetre manquee : le hash n'est plus lisible, la cloture le dit, et
  // un nouvel engagement est possible - par n'importe qui.
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { END } = await openMint(chain, nft, T0);
  chain.warpTo(END + 60);
  await nft.call('startReveal');
  const rb1 = await nft.call('revealBlock');
  chain.mineBlocks(DELAY + 257);
  ok('cloture refusee apres 256 blocs', (await nft.expectRevert('finishReveal')) === 'RevealExpired');
  await nft.call('startReveal', [], { from: ACCOUNTS.BOB });
  const rb2 = await nft.call('revealBlock');
  ok('nouvel engagement possible apres expiration', rb2 > rb1, `${rb1} -> ${rb2}`);
  chain.mineBlocks(DELAY + 1);
  await nft.call('finishReveal', [], { from: ACCOUNTS.ALICE });
  ok('graine posee au second essai', (await nft.call('seedBase')) !== ZERO32);
}

/* ================================================================== *
 * H-2  Perte de cle / renonciation
 * ================================================================== */
section('H-2. La collection ne depend plus d une cle pour se reveler');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { END } = await openMint(chain, nft, T0);

  ok('renounceOwnership refuse avant la graine',
     (await nft.expectRevert('renounceOwnership')) === 'OwnershipStillNeeded');

  // Transfert en deux temps : une faute de frappe ne perd plus le contrat.
  await nft.call('transferOwnership', [ACCOUNTS.ALICE.toString()]);
  ok('le proprietaire ne change pas avant acceptation',
     (await nft.call('owner')).toLowerCase() === ACCOUNTS.DEPLOYER.toString().toLowerCase());
  ok('un tiers ne peut pas accepter a la place',
     (await nft.expectRevert('acceptOwnership', [], { from: ACCOUNTS.BOB })) === 'OwnableUnauthorizedAccount');
  await nft.call('acceptOwnership', [], { from: ACCOUNTS.ALICE });
  ok('propriete transferee apres acceptation',
     (await nft.call('owner')).toLowerCase() === ACCOUNTS.ALICE.toString().toLowerCase());

  // Le proprietaire disparait (on ne l'utilise plus) : la revelation
  // passe quand meme, par Carol.
  chain.warpTo(END + 60);
  await nft.call('startReveal', [], { from: ACCOUNTS.CAROL });
  chain.mineBlocks(DELAY + 1);
  await nft.call('finishReveal', [], { from: ACCOUNTS.CAROL });
  ok('revelation sans le proprietaire', (await nft.call('seedBase')) !== ZERO32);

  ok('renounceOwnership refuse tant que le renderer n est pas verrouille',
     (await nft.expectRevert('renounceOwnership', [], { from: ACCOUNTS.ALICE })) === 'OwnershipStillNeeded');
  await nft.call('lockRenderer', [], { from: ACCOUNTS.ALICE });
  await nft.call('renounceOwnership', [], { from: ACCOUNTS.ALICE });
  ok('renonciation possible une fois la collection achevee',
     (await nft.call('owner')).toLowerCase() === ZERO_ADDR);
  ok('tokenURI fonctionne sans proprietaire',
     (await nft.call('tokenURI', [0])).startsWith('data:application/json;base64,'));
}

/* ================================================================== *
 * H-3  Sybil par contrats
 * ================================================================== */
section('H-3. Le mint public refuse les contrats');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { PUB } = await openMint(chain, nft, T0);
  chain.warpTo(PUB + 60);

  // Un contrat jetable qui appelle mintPublic pour le compte de son
  // deployeur : c'est la brique de l'attaque a 304 wallets en une
  // transaction.
  const Sybil = await chain.deploy('test/kids/fixtures/Sybil.sol', 'Sybil', [nft.address.toString()],
    ACCOUNTS.CAROL);
  // L'erreur remonte du NFT a travers Sybil : on la reconnait a son
  // selecteur, l'ABI de Sybil ne la connaissant pas.
  let selector = null;
  try { await Sybil.call('grab', [10], { from: ACCOUNTS.CAROL }); }
  catch (e) { selector = e.revertData?.slice(0, 10); }
  ok('mint via un contrat refuse', selector === id('ContractsNotAllowed()').slice(0, 10), selector ?? 'pas de revert');
  ok('rien n a ete minte par ce chemin', (await nft.call('totalMinted')) === 300n);
  await nft.call('mintPublic', [10], { from: ACCOUNTS.CAROL });
  ok('la meme personne mint normalement depuis son EOA',
     (await nft.call('balanceOf', [ACCOUNTS.CAROL.toString()])) === 10n);
  ok('mintPublic(0) refuse', (await nft.expectRevert('mintPublic', [0], { from: ACCOUNTS.BOB })) === 'ZeroQuantity');
}

/* ================================================================== *
 * M-1  Phases et racine figees a l ouverture
 * ================================================================== */
section('M-1. Phases et racine ne bougent plus une fois le mint ouvert');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { AL, PUB, END, tree } = await openMint(chain, nft, T0);

  // Avant l'ouverture : tout est encore corrigeable. C'est voulu.
  await nft.call('setPhases', [AL + 10, PUB, END]);
  ok('phases modifiables avant l ouverture', (await nft.call('allowlistStart')) === BigInt(AL + 10));
  await nft.call('setPhases', [AL, PUB, END]);
  const other = buildTree([ACCOUNTS.CAROL.toString(), ACCOUNTS.BOB.toString()]);
  await nft.call('setAllowlistRoot', [other.root]);
  await nft.call('setAllowlistRoot', [tree.root]);
  ok('racine modifiable avant l ouverture', (await nft.call('allowlistRoot')) === tree.root);

  chain.warpTo(AL + 1);
  ok('setPhases refuse pendant l allowlist',
     (await nft.expectRevert('setPhases', [AL, PUB + 3600, END])) === 'PhasesLocked');
  ok('setAllowlistRoot refuse pendant l allowlist',
     (await nft.expectRevert('setAllowlistRoot', [other.root])) === 'PhasesLocked');
  await nft.call('mintAllowlist', [1, proofFor(tree, leafOf(ACCOUNTS.ALICE.toString()))], { from: ACCOUNTS.ALICE });
  ok('l allowlist posee avant l ouverture fonctionne',
     (await nft.call('balanceOf', [ACCOUNTS.ALICE.toString()])) === 1n);
  ok('mintAllowlist(0) refuse',
     (await nft.expectRevert('mintAllowlist', [0, proofFor(tree, leafOf(ACCOUNTS.ALICE.toString()))],
       { from: ACCOUNTS.ALICE })) === 'ZeroQuantity');
}

{
  // La reserve, elle, se ferme a l'ouverture : une reserve laissee
  // incomplete ne se rattrape pas apres coup.
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  await nft.call('mintReserve', [ACCOUNTS.DEPLOYER.toString(), 299]);
  await nft.call('setPhases', [T0 + DAY, T0 + 2 * DAY, T0 + 9 * DAY]);
  chain.warpTo(T0 + DAY + 1);
  ok('la derniere piece de reserve ne se mint plus apres l ouverture',
     ['revert', 'Error'].includes(await nft.expectRevert('mintReserve', [ACCOUNTS.DEPLOYER.toString(), 1])));
  ok('et le mint public reste ferme tant que la reserve est incomplete',
     (await nft.expectRevert('mintAllowlist', [1, []], { from: ACCOUNTS.ALICE })) === 'ReserveFirst');
}

/* ================================================================== *
 * Pouvoirs du createur ajoutes apres la revue : fermer, dater
 * ================================================================== */
section('Fermeture anticipee et date de revelation, sans prise sur la graine');
{
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { AL, PUB, END } = await openMint(chain, nft, T0);

  ok('closeMint refuse avant l ouverture', (await nft.expectRevert('closeMint')) === 'PhasesLocked');
  chain.warpTo(PUB + 60);
  await nft.call('mintPublic', [10], { from: ACCOUNTS.ALICE });
  ok('closeMint refuse a un tiers',
     (await nft.expectRevert('closeMint', [], { from: ACCOUNTS.ALICE })) === 'OwnableUnauthorizedAccount');

  // La date de revelation se pose avant la fermeture, bornee a 30 jours
  // apres la fin de fenetre encore prevue.
  ok('date de revelation trop lointaine refusee',
     (await nft.expectRevert('setRevealAfter', [END + 31 * DAY])) === 'RevealDateTooFar');

  // Fermeture : le mint s'arrete a l'instant, la supply est reduite de fait.
  await nft.call('closeMint');
  ok('mintEnd ramene a maintenant', (await nft.call('mintEnd')) === chain.now);
  ok('mint refuse des la fermeture',
     (await nft.expectRevert('mintPublic', [1], { from: ACCOUNTS.BOB })) === 'MintClosed');
  ok('supply reelle = pieces mintees', (await nft.call('totalMinted')) === 310n);
  ok('closeMint ne rouvre rien : setPhases toujours refuse',
     (await nft.expectRevert('setPhases', [AL, PUB, END])) === 'PhasesLocked');

  // Le createur choisit le jour : avant, personne ne peut engager.
  const revealAt = Number(chain.now) + 7 * DAY;
  await nft.call('setRevealAfter', [revealAt]);
  ok('engagement refuse avant la date choisie',
     (await nft.expectRevert('startReveal', [], { from: ACCOUNTS.CAROL })) === 'RevealTooEarly');
  ok('...y compris par le createur', (await nft.expectRevert('startReveal')) === 'RevealTooEarly');
  chain.warpTo(revealAt);
  await nft.call('startReveal', [], { from: ACCOUNTS.CAROL });
  ok('engagement ouvert a tous des la date', (await nft.call('revealBlock')) > 0n);
  ok('la date ne se change plus une fois engage',
     (await nft.expectRevert('setRevealAfter', [revealAt + DAY])) === 'SeedAlreadySet');
  chain.mineBlocks(DELAY + 1);
  await nft.call('finishReveal', [], { from: ACCOUNTS.BOB });
  ok('graine posee', (await nft.call('seedBase')) !== ZERO32);
}

{
  // Le createur ne peut pas retenir la collection : passe 30 jours apres
  // la fin, la date qu'il a choisie ne compte plus.
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { PUB, END } = await openMint(chain, nft, T0);
  chain.warpTo(PUB + 60);
  await nft.call('closeMint');
  const closedAt = Number(chain.now);
  await nft.call('setRevealAfter', [closedAt + 30 * DAY]);   // le maximum
  chain.warpTo(closedAt + 30 * DAY - 10);
  ok('encore refuse juste avant', (await nft.expectRevert('startReveal', [], { from: ACCOUNTS.BOB })) === 'RevealTooEarly');
  chain.warpTo(closedAt + 30 * DAY);
  await nft.call('startReveal', [], { from: ACCOUNTS.BOB });
  ok('30 jours apres la fermeture, n importe qui engage', (await nft.call('revealBlock')) > 0n);
  ok('END d origine sans effet : la fermeture fait foi', END > closedAt);
}

{
  // Sold-out avant la fin de fenetre : le delai court depuis le sold-out.
  const chain = await createChain();
  const T0 = Number(chain.now);
  const { nft } = await fresh(chain);
  const { PUB } = await openMint(chain, nft, T0);
  chain.warpTo(PUB + 60);
  const { createAddressFromString } = await import('@ethereumjs/util');
  for (let i = 0; i * 10 < 3033; i++) {
    const a = createAddressFromString('0x' + (i + 1).toString(16).padStart(40, '0'));
    await nft.call('mintPublic', [Math.min(10, 3033 - i * 10)], { from: a });
  }
  ok('soldOutAt enregistre', (await nft.call('soldOutAt')) === chain.now);
  ok('date de revelation bornee depuis le sold-out',
     (await nft.expectRevert('setRevealAfter', [Number(chain.now) + 31 * DAY])) === 'RevealDateTooFar');
  await nft.call('setRevealAfter', [Number(chain.now) + 3 * DAY]);
  ok('refuse avant', (await nft.expectRevert('startReveal')) === 'RevealTooEarly');
  chain.warpTo(Number(chain.now) + 3 * DAY);
  await nft.call('startReveal');
  ok('accepte a la date', (await nft.call('revealBlock')) > 0n);
}

/* ================================================================== *
 * M-2  Verrou du renderer conditionne au moteur scelle
 * ================================================================== */
section('M-2. lockRenderer exige un moteur scelle et un renderer reel');
{
  const chain = await createChain();
  const engine = await chain.deploy('contracts/kids/HoodlrzKidsEngine.sol', 'HoodlrzKidsEngine');
  const renderer = await chain.deploy('contracts/kids/HoodlrzKidsRenderer.sol', 'HoodlrzKidsRenderer',
    [engine.address.toString()]);
  const nft = await chain.deploy('contracts/kids/HoodlrzKids.sol', 'HoodlrzKids',
    [renderer.address.toString(), ACCOUNTS.DEPLOYER.toString()]);

  ok('verrou refuse sur un moteur non scelle',
     (await nft.expectRevert('lockRenderer')) === 'EngineNotSealed');
  ok('setRenderer(0) refuse', (await nft.expectRevert('setRenderer', [ZERO_ADDR])) === 'ZeroAddress');
  await nft.call('setRenderer', [ACCOUNTS.BOB.toString()]);
  ok('verrou refuse sur une adresse sans code',
     (await nft.expectRevert('lockRenderer')) === 'ZeroAddress');
  await nft.call('setRenderer', [renderer.address.toString()]);

  const pre = JSON.parse(readFileSync('kids/build/engine-pre.json', 'utf8'));
  const post = JSON.parse(readFileSync('kids/build/engine-post.json', 'utf8'));
  for (const c of pre) await engine.call('appendChunk', [true, c]);
  for (const c of post) await engine.call('appendChunk', [false, c]);
  const sha = '0x' + readFileSync('kids/build/engine.sha256', 'utf8').split(' ')[0];
  await engine.call('seal', [sha]);
  await nft.call('lockRenderer');
  ok('verrou pose une fois le moteur scelle', (await nft.call('rendererLocked')) === true);
}

/* ================================================================== *
 * L-1 / L-2  Moteur : hash verifie au scellement, taille des morceaux
 * ================================================================== */
section('L-1 / L-2. Le moteur refuse un mauvais hash et un morceau trop gros');
{
  const chain = await createChain();
  const engine = await chain.deploy('contracts/kids/HoodlrzKidsEngine.sol', 'HoodlrzKidsEngine');
  const pre = JSON.parse(readFileSync('kids/build/engine-pre.json', 'utf8'));
  const post = JSON.parse(readFileSync('kids/build/engine-post.json', 'utf8'));
  const sha = '0x' + readFileSync('kids/build/engine.sha256', 'utf8').split(' ')[0];

  ok('MAX_CHUNK = 24 575', (await engine.call('MAX_CHUNK')) === 24_575n);
  await engine.call('appendChunk', [true, '0x' + '41'.repeat(24_575)]);
  ok('morceau de 24 575 o accepte', Number((await engine.call('chunkCounts'))[0]) === 1);
  ok('morceau de 24 576 o refuse',
     (await engine.expectRevert('appendChunk', [true, '0x' + '41'.repeat(24_576)])) === 'ChunkTooLarge');

  // Ce premier morceau de test est faux : le scellement doit le voir.
  for (const c of post) await engine.call('appendChunk', [false, c]);
  ok('scellement refuse si le contenu ne correspond pas au hash',
     (await engine.expectRevert('seal', [sha])) === 'HashMismatch');

  const engine2 = await chain.deploy('contracts/kids/HoodlrzKidsEngine.sol', 'HoodlrzKidsEngine');
  for (const c of pre) await engine2.call('appendChunk', [true, c]);
  for (const c of post.slice(0, -1)) await engine2.call('appendChunk', [false, c]);
  ok('scellement refuse sur un moteur incomplet',
     (await engine2.expectRevert('seal', [sha])) === 'HashMismatch');
  await engine2.call('appendChunk', [false, post[post.length - 1]]);
  ok('scellement refuse avec un hash faux',
     (await engine2.expectRevert('seal', ['0x' + 'ff'.repeat(32)])) === 'HashMismatch');
  await engine2.call('seal', [sha]);
  const sealGas = engine2.lastGas;
  ok('scellement accepte quand tout correspond', (await engine2.call('sealed_')) === true);
  console.log(`        gas du scellement : ${(Number(sealGas) / 1e6).toFixed(2)} M`);
}

/* ================================================================== *
 * L-3  Adresses nulles
 * ================================================================== */
section('L-3. Aucune adresse nulle ne passe');
{
  const chain = await createChain();
  const { renderer, nft } = await fresh(chain);
  ok('setRoyaltyReceiver(0) refuse', (await nft.expectRevert('setRoyaltyReceiver', [ZERO_ADDR])) === 'ZeroAddress');
  let threw = false;
  try {
    await chain.deploy('contracts/kids/HoodlrzKids.sol', 'HoodlrzKids', [renderer.address.toString(), ZERO_ADDR]);
  } catch { threw = true; }
  ok('constructeur refuse un beneficiaire nul', threw);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${pass} OK, ${fail} FAIL`);
console.log('='.repeat(50) + '\n');
process.exit(fail === 0 ? 0 : 1);
