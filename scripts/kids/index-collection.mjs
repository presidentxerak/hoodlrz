/**
 * Indexe la collection revelee pour la galerie du site.
 *
 * Une fois la graine posee, chaque piece est entierement determinee par
 * keccak256(seedBase, tokenId). Le site n'a donc besoin d'aucun indexeur
 * ni d'aucun appel tokenURI (21 M de gas chacun) : on calcule ici, une
 * fois, les traits des pieces mintees avec le moteur lui-meme, et on
 * peint des planches-contact pour les vignettes. La galerie lit un JSON
 * compact et des images statiques ; la piece vivante, elle, se joue dans
 * le moteur au clic.
 *
 * Sorties, dans public/kids/collection/ (versionnees, servies en statique) :
 *   index.json      graine, contrat, traits de chaque piece (indices), valeurs
 *   sheet-NN.webp   planches de perSide x perSide vignettes de `tile` px
 *
 * A relancer si d'autres pieces sont mintees apres un premier passage.
 *
 * Usage :
 *   npm run kids:index -- --mainnet
 *   npm run kids:index -- --mainnet --tile 150 --grid 20
 */

import './env.mjs';
import { JsonRpcProvider, Contract, solidityPackedKeccak256 } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { launchChromium } from './browser.mjs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC' },
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];
const TILE = Number(val('--tile', '128'));
const PER_SIDE = Number(val('--grid', '20'));
const OUT = 'public/kids/collection';

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

/* Mode hors chaine, pour tester la galerie sans revelation : une graine
 * et un nombre de pieces donnes a la main. Le resultat n'est PAS la
 * collection et ne doit pas etre publie. */
const OFFLINE_SEED = val('--seed');
const OFFLINE_TOTAL = Number(val('--total', '0'));

let seedBase, total;
if (OFFLINE_SEED) {
  seedBase = OFFLINE_SEED;
  total = OFFLINE_TOTAL || 100;
  console.log(`\nIndexation HORS CHAINE (essai) — graine de travail, ${total} pieces`);
} else {
  const key = process.env.ALCHEMY_API_KEY;
  const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const nft = new Contract(dep.nft, [
    'function seedBase() view returns (bytes32)',
    'function totalMinted() view returns (uint256)',
    'function tokenHash(uint256) view returns (bytes32)',
  ], provider);

  console.log(`\nIndexation de la collection — ${which}`);
  console.log(`  contrat  ${dep.nft}`);

  seedBase = await nft.seedBase();
  if (seedBase === '0x' + '0'.repeat(64)) {
    console.error(`\n  La graine n'est pas encore revelee : rien a indexer.\n  Reveler d'abord : npm run kids:reveal -- --${which}\n`);
    process.exit(1);
  }
  total = Number(await nft.totalMinted());
  console.log(`  graine   ${seedBase}`);
  console.log(`  pieces   ${total}`);

  // Le hash calcule ici doit etre celui du contrat, au bit pres : on le
  // verifie sur une piece avant de calculer les 3 333 autres en local.
  const check = await nft.tokenHash(total - 1);
  if (check.toLowerCase() !== hashOf(total - 1).toLowerCase()) {
    console.error('\n  Le hash local ne correspond pas a tokenHash() du contrat. Arret.\n');
    process.exit(1);
  }
  console.log('  hash local == tokenHash() du contrat, verifie sur la derniere piece');
}
function hashOf(id) { return solidityPackedKeccak256(['bytes32', 'uint256'], [seedBase, id]); }

/* ---- Traits et planches, par le moteur ------------------------------ */
mkdirSync(OUT, { recursive: true });
const frozen = readFileSync('kids/engine/frozen.html', 'utf8');
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
await page.setContent(frozen.replace('__HASH__', '0x0'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__hoodlrzFontReady === true, { timeout: 20000 })
  .catch(() => console.log('  (police : delai depasse, on continue)'));
await page.waitForTimeout(500);

const hashes = Array.from({ length: total }, (_, i) => hashOf(i));

console.log('\nTraits…');
const KEYS = ['Hat', 'Hat Color', 'Hood Color', 'Face', 'Hair', 'Backdrop', 'Palette', 'EQ Color', 'Expression'];
const traits = await page.evaluate((hs) => {
  const E = window.HoodlrzEngine;
  return hs.map((h) => {
    const t = E.createToken(h);
    return [t.hatType, t.hatColor, t.hoodColor, t.skull ? 'Skull' : 'Classic', t.hair, t.bgStyle,
            t.mono ? 'Mono' : 'Multi', t.eqColor, (E.EXPRESSIONS[t.exprIndex] || {}).name || ''];
  });
}, hashes);

// Valeurs distinctes par trait, et chaque piece encodee par indices :
// 3 333 pieces x 9 traits tiennent alors en quelques dizaines de Ko.
const values = KEYS.map((_, k) => [...new Set(traits.map((t) => String(t[k])))].sort());
const tokens = traits.map((t) => t.map((v, k) => values[k].indexOf(String(v))));
for (let k = 0; k < KEYS.length; k++) console.log(`  ${KEYS[k].padEnd(11)} ${values[k].length} valeurs`);

console.log('\nPlanches-contact…');
const perSheet = PER_SIDE * PER_SIDE;
const sheets = Math.ceil(total / perSheet);
const t0 = Date.now();
for (let s = 0; s < sheets; s++) {
  const start = s * perSheet;
  const count = Math.min(perSheet, total - start);
  const b64 = await page.evaluate(({ hs, perSide, tile }) => {
    const E = window.HoodlrzEngine;
    const S = perSide * tile;
    const sheet = document.createElement('canvas');
    sheet.width = S; sheet.height = S;
    const sctx = sheet.getContext('2d', { alpha: false });
    sctx.fillStyle = '#000'; sctx.fillRect(0, 0, S, S);
    const cell = document.createElement('canvas');
    cell.width = tile; cell.height = tile;
    const cctx = cell.getContext('2d', { alpha: false });
    hs.forEach((h, i) => {
      const token = E.createToken(h);
      // Meme instant canonique que le mode preview du moteur.
      E.paint(cctx, tile, tile, token, { t: 3.0, beat: 0, nowMs: 3000, spectrum: new Array(32).fill(0) });
      sctx.drawImage(cell, (i % perSide) * tile, Math.floor(i / perSide) * tile);
    });
    return sheet.toDataURL('image/webp', 0.78).split(',')[1];
  }, { hs: hashes.slice(start, start + count), perSide: PER_SIDE, tile: TILE });
  const file = `${OUT}/sheet-${String(s).padStart(2, '0')}.webp`;
  writeFileSync(file, Buffer.from(b64, 'base64'));
  console.log(`  planche ${s}  pieces ${start}-${start + count - 1}  ${(Buffer.byteLength(b64, 'base64') / 1024).toFixed(0)} Ko`);
}
console.log(`  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await browser.close();

const index = {
  contract: dep.nft,
  chainId: CH.id,
  explorer: dep.explorer,
  seedBase,
  total,
  indexedAt: new Date().toISOString(),
  tile: TILE,
  perSide: PER_SIDE,
  sheets,
  keys: KEYS,
  values,
  tokens,
};
writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
console.log(`\nEcrit -> ${OUT}/index.json (${(JSON.stringify(index).length / 1024).toFixed(0)} Ko) et ${sheets} planches`);
console.log(`
Publier pour le site :
  git add public/kids/collection && git commit -m "Gen Kids : collection indexee" && git push
`);
