/**
 * Collection v2 : la meme collection, redistribuee avec une vignette.
 *
 * On rejoue une collection d'origine complete sur l'EVM locale (moteur,
 * mint, fermeture, revelation), puis on deploie la v2 devant elle et on
 * distribue. Ce qui doit etre prouve :
 *   - chaque piece v2 arrive chez le proprietaire de la piece d'origine,
 *     meme numero ;
 *   - le hash, donc les traits et l'animation, sont identiques a l'origine
 *     au bit pres ;
 *   - seule l'image change : une URL au lieu de l'affiche SVG ;
 *   - l'airdrop est relancable, borne, et ne peut rien creer d'autre.
 *
 * Usage : npm run kids:v2
 */

import { readFileSync } from 'node:fs';
import { createChain, ACCOUNTS } from '../../scripts/kids/chain.mjs';
import { createAddressFromString } from '@ethereumjs/util';

const DAY = 86400;
let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`);
  cond ? pass++ : fail++;
};
const section = (t) => console.log(`\n${t}`);
const decode = (uri) => JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString('utf8'));

console.log('\nCollection v2 sur EVM locale');

const chain = await createChain();
const T0 = Number(chain.now);

/* ---- Origine : moteur, mint, revelation ------------------------------ */
section('1. Collection d origine');
const engine = await chain.deploy('contracts/kids/HoodlrzKidsEngine.sol', 'HoodlrzKidsEngine');
for (const c of JSON.parse(readFileSync('kids/build/engine-pre.json', 'utf8'))) await engine.call('appendChunk', [true, c]);
for (const c of JSON.parse(readFileSync('kids/build/engine-post.json', 'utf8'))) await engine.call('appendChunk', [false, c]);
await engine.call('seal', ['0x' + readFileSync('kids/build/engine.sha256', 'utf8').split(' ')[0]]);
const renderer = await chain.deploy('contracts/kids/HoodlrzKidsRenderer.sol', 'HoodlrzKidsRenderer', [engine.address.toString()]);
const v1 = await chain.deploy('contracts/kids/HoodlrzKids.sol', 'HoodlrzKids', [renderer.address.toString(), ACCOUNTS.BOB.toString()]);

for (let i = 0; i < 3; i++) await v1.call('mintReserve', [ACCOUNTS.DEPLOYER.toString(), 100]);
await v1.call('setPhases', [T0 + DAY, T0 + DAY, T0 + 9 * DAY]);
chain.warpTo(T0 + DAY + 60);
// Des proprietaires varies : EOA de test, adresses jetables, un wallet
// qui recevra plusieurs pieces.
const holders = [ACCOUNTS.ALICE, ACCOUNTS.BOB, ACCOUNTS.CAROL];
for (let i = 0; i < 12; i++) holders.push(createAddressFromString('0x' + (i + 1).toString(16).padStart(40, '0')));
for (const h of holders) await v1.call('mintPublic', [10], { from: h });
await v1.call('closeMint');
await v1.call('startReveal');
chain.mineBlocks(11);
await v1.call('finishReveal');
const total = Number(await v1.call('totalMinted'));
const seed = await v1.call('seedBase');
ok('origine revelee', seed !== '0x' + '0'.repeat(64) && total === 450, `${total} pieces`);

/* ---- v2 ------------------------------------------------------------- */
section('2. Deploiement v2');
const IMG = 'https://hoodlrz.com/kids/img/';
const rendererV2 = await chain.deploy('contracts/kids/HoodlrzKidsRendererV2.sol', 'HoodlrzKidsRendererV2', [engine.address.toString()]);
const v2 = await chain.deploy('contracts/kids/HoodlrzKidsV2.sol', 'HoodlrzKidsV2',
  [v1.address.toString(), rendererV2.address.toString(), ACCOUNTS.BOB.toString(), IMG]);
ok('graine copiee de l origine', (await v2.call('seedBase')) === seed);
ok('supply copiee de l origine', (await v2.call('MAX_SUPPLY')) === BigInt(total));
ok('nom et symbole identiques', (await v2.call('name')) === 'Hoodlrz Gen Kids' && (await v2.call('symbol')) === 'KIDS');
ok('rien de distribue au depart', (await v2.call('airdropped')) === 0n && !(await v2.call('airdropComplete')));

// Une origine non revelee est refusee : la v2 n'a de sens qu'apres.
{
  const fresh = await chain.deploy('contracts/kids/HoodlrzKids.sol', 'HoodlrzKids', [renderer.address.toString(), ACCOUNTS.BOB.toString()]);
  let threw = false;
  try { await chain.deploy('contracts/kids/HoodlrzKidsV2.sol', 'HoodlrzKidsV2', [fresh.address.toString(), rendererV2.address.toString(), ACCOUNTS.BOB.toString(), IMG]); }
  catch { threw = true; }
  ok('origine non revelee refusee au deploiement', threw);
}

/* ---- Airdrop -------------------------------------------------------- */
section('3. Airdrop');
ok('airdrop reserve au proprietaire',
   (await v2.expectRevert('airdrop', [50], { from: ACCOUNTS.ALICE })) === 'OwnableUnauthorizedAccount');

await v2.call('airdrop', [50]);
ok('premier lot : 50 distribuees', (await v2.call('airdropped')) === 50n);
ok('tokenURI refuse avant distribution', (await v2.expectRevert('tokenURI', [60])) === 'ERC721NonexistentToken');

// Un transfert dans l'origine ENTRE deux lots est suivi : c'est le
// proprietaire au moment de l'envoi qui recoit.
await v1.call('transferFrom', [ACCOUNTS.ALICE.toString(), ACCOUNTS.CAROL.toString(), 305], { from: ACCOUNTS.ALICE });

let gasTotal = 0n;
while (!(await v2.call('airdropComplete'))) {
  await v2.call('airdrop', [50]);
  gasTotal += v2.lastGas;
}
ok('distribution complete', (await v2.call('airdropped')) === BigInt(total));
ok('un lot de plus est refuse', (await v2.expectRevert('airdrop', [1])) === 'AirdropComplete');
ok('totalSupply == origine', (await v2.call('totalMinted')) === BigInt(total));
console.log(`        gas par lot de 50 : ${(Number(gasTotal) / Math.ceil((total - 50) / 50) / 1e6).toFixed(2)} M`);

section('4. Chaque piece est chez le bon proprietaire');
let mismatch = 0;
for (let id = 0; id < total; id++) {
  const a = (await v1.call('ownerOf', [id])).toLowerCase();
  const b = (await v2.call('ownerOf', [id])).toLowerCase();
  if (a !== b) mismatch++;
}
ok('proprietaires identiques sur toutes les pieces', mismatch === 0, `${total - mismatch}/${total}`);
ok('la piece transferee pendant l airdrop est chez son nouveau proprietaire',
   (await v2.call('ownerOf', [305])).toLowerCase() === ACCOUNTS.CAROL.toString().toLowerCase());
ok('la reserve est chez le destinataire de la reserve',
   (await v2.call('balanceOf', [ACCOUNTS.DEPLOYER.toString()])) === 300n);

section('5. Meme oeuvre, autre vignette');
const id = 307;
ok('hash identique a l origine', (await v2.call('tokenHash', [id])) === (await v1.call('tokenHash', [id])));
const m1 = decode(await v1.call('tokenURI', [id]));
const m2 = decode(await v2.call('tokenURI', [id]));
ok('nom identique', m1.name === m2.name, m2.name);
ok('attributs identiques', JSON.stringify(m1.attributes) === JSON.stringify(m2.attributes));
ok('animation identique au bit pres', m1.animation_url === m2.animation_url, `${m2.animation_url.length} caracteres`);
ok('image = URL de capture', m2.image === `${IMG}${id}.png`, m2.image);
ok('l origine gardait une affiche SVG', String(m1.image).startsWith('data:image/svg+xml'));
ok('hoodlrz_hash conserve', m1.hoodlrz_hash === m2.hoodlrz_hash);
console.log(`        gas de tokenURI v2 : ${(Number(v2.lastGas) / 1e6).toFixed(2)} M`);

const c2 = decode(await v2.call('contractURI'));
ok('contractURI : image de collection', c2.image === `${IMG}collection.png`);
ok('contractURI : royalties 5 % vers le bon wallet',
   Number(c2.seller_fee_basis_points) === 500 && c2.fee_recipient.toLowerCase() === ACCOUNTS.BOB.toString().toLowerCase());
const [rcv, amt] = await v2.call('royaltyInfo', [id, 10_000n]);
ok('EIP-2981 5 %', amt === 500n && rcv.toLowerCase() === ACCOUNTS.BOB.toString().toLowerCase());
ok('interfaces 2981 et 4906 declarees',
   (await v2.call('supportsInterface', ['0x2a55205a'])) && (await v2.call('supportsInterface', ['0x49064906'])));

section('6. Pouvoirs restants');
await v2.call('setImageBase', ['https://cdn.example/kids/']);
ok('base d image modifiable', decode(await v2.call('tokenURI', [id])).image === `https://cdn.example/kids/${id}.png`);
await v2.call('setImageBase', [IMG]);
ok('setImageBase reserve au proprietaire',
   (await v2.expectRevert('setImageBase', ['x'], { from: ACCOUNTS.ALICE })) === 'OwnableUnauthorizedAccount');
ok('renounce refuse avant le verrou', (await v2.expectRevert('renounceOwnership')) === 'OwnershipStillNeeded');
await v2.call('lockRenderer');
ok('renderer verrouille', (await v2.call('rendererLocked')) === true);
ok('setRenderer refuse ensuite', (await v2.expectRevert('setRenderer', [renderer.address.toString()])) === 'Locked');
await v2.call('renounceOwnership');
ok('renonciation possible une fois distribue et verrouille',
   (await v2.call('owner')).toLowerCase() === '0x' + '0'.repeat(40));
ok('l affiche on-chain reste disponible en secours',
   (await rendererV2.call('posterFor', [await v2.call('tokenHash', [id])])).startsWith('<svg'));

console.log(`\n${'='.repeat(50)}`);
console.log(`  ${pass} OK, ${fail} FAIL`);
console.log('='.repeat(50) + '\n');
process.exit(fail === 0 ? 0 : 1);
