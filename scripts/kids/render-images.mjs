/**
 * Rend les captures de toutes les pieces, pour les vignettes des
 * marketplaces.
 *
 * Chaque piece est peinte par le moteur gele, a l'instant canonique
 * (t = 3 s, spectre nul) - le meme que le mode preview et que les
 * planches de la galerie - en PNG carre. C'est ce fichier que la v2
 * annonce dans le champ `image` de son tokenURI.
 *
 * Sorties : kids/build/images/<chain>/<id>.png (+ collection.png), non
 * versionnees ; kids:upload-images les heberge.
 *
 * Usage :
 *   npm run kids:render-images -- --mainnet [--size 800]
 */

import './env.mjs';
import { JsonRpcProvider, Contract, solidityPackedKeccak256 } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
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
const SIZE = Number(val('--size', '800'));
const OUT = `kids/build/images/${which}`;

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

let seedBase, total;
if (val('--seed')) {
  // Essai hors chaine : graine et nombre donnes a la main, rien a publier.
  seedBase = val('--seed'); total = Number(val('--total', '10'));
} else {
  const key = process.env.ALCHEMY_API_KEY;
  const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const nft = new Contract(dep.nft, ['function seedBase() view returns (bytes32)', 'function MAX_SUPPLY() view returns (uint256)', 'function tokenHash(uint256) view returns (bytes32)'], provider);
  seedBase = await nft.seedBase();
  if (seedBase === '0x' + '0'.repeat(64)) { console.error('\n  Graine non revelee.\n'); process.exit(1); }
  total = Number(await nft.MAX_SUPPLY());
  if ((await nft.tokenHash(total - 1)).toLowerCase() !== hashOf(total - 1).toLowerCase()) {
    console.error('\n  Hash local != tokenHash() du contrat. Arret.\n'); process.exit(1);
  }
}
function hashOf(id) { return solidityPackedKeccak256(['bytes32', 'uint256'], [seedBase, id]); }

console.log(`\nCaptures Hoodlrz Gen Kids — ${which}`);
console.log(`  contrat  ${dep.nft}`);
console.log(`  pieces   ${total}   ${SIZE}x${SIZE} px   -> ${OUT}/\n`);
mkdirSync(OUT, { recursive: true });

const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
await page.setContent(readFileSync('kids/engine/frozen.html', 'utf8').replace('__HASH__', '0x0'), { waitUntil: 'load' });
await page.waitForFunction(() => window.__hoodlrzFontReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(500);

const t0 = Date.now();
let made = 0, skipped = 0;
const BATCH = 25;
for (let start = 0; start < total; start += BATCH) {
  const ids = [];
  for (let id = start; id < Math.min(start + BATCH, total); id++) {
    if (existsSync(`${OUT}/${id}.png`)) skipped++; else ids.push(id);
  }
  if (!ids.length) continue;
  const pngs = await page.evaluate(({ hs, size }) => {
    const E = window.HoodlrzEngine;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const ctx = cv.getContext('2d', { alpha: false });
    return hs.map((h) => {
      E.paint(ctx, size, size, E.createToken(h), { t: 3, beat: 0, nowMs: 3000, spectrum: new Array(32).fill(0) });
      return cv.toDataURL('image/png').split(',')[1];
    });
  }, { hs: ids.map(hashOf), size: SIZE });
  ids.forEach((id, i) => writeFileSync(`${OUT}/${id}.png`, Buffer.from(pngs[i], 'base64')));
  made += ids.length;
  process.stdout.write(`\r  ${made + skipped} / ${total}   (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
}
await browser.close();

// Vignette de collection : l'icone de marque, deja produite par kids:brand.
if (existsSync('kids/brand/icon.png')) copyFileSync('kids/brand/icon.png', `${OUT}/collection.png`);

console.log(`\n\n  ${made} rendues, ${skipped} deja presentes, en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`\nEnsuite : npm run kids:upload-images -- --${which}\n`);
