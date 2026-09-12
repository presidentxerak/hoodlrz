/**
 * Banniere OpenSea : une foule de Hoodlrz devant le mur de briques.
 *
 * Les pieces ne sont pas choisies au hasard parmi des hashs inventes :
 * ce sont de VRAIES pieces de la collection, prises dans l'index, et
 * filtrees sur le fond « bricks ». La banniere montre donc ce que la
 * collection contient reellement, et le mur court d'un bout a l'autre
 * parce que chaque piece porte le meme decor.
 *
 * Les pieces sont montrees ENTIERES, sur deux rangees. Un cadrage serre
 * sur les visages remplissait le cadre et faisait disparaitre le mur -
 * or c'est lui qu'on veut voir. En entier, chaque piece apporte sa
 * portion de mur, et les punchlines se lisent comme des tags dessus.
 *
 * Aucun texte grave dans l'image : OpenSea affiche deja le nom de la
 * collection par-dessus.
 *
 * Usage :
 *   npm run kids:banner
 *   npm run kids:banner -- --rows 2 --cols 7
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { solidityPackedKeccak256 } from 'ethers';
import { launchChromium } from './browser.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ROWS = Number(val('--rows', '2'));
const COLS = Number(val('--cols', '7'));
const COUNT = ROWS * COLS;
const SCALE = Number(val('--scale', '1'));
const SHIFT = Number(val('--shift', '0'));       // % ; negatif = remonte l'image
const W = 1400, H = 400;
const OUT = 'kids/brand';
const NAME = val('--name', 'banner-bricks');

const index = JSON.parse(readFileSync('public/kids/collection/index.json', 'utf8'));
const col = (k) => index.keys.indexOf(k);
const K_BACK = col('Backdrop'), K_HATC = col('Hat Color'), K_EXPR = col('Expression'),
      K_FACE = col('Face'), K_HAT = col('Hat');
const BRICKS = index.values[K_BACK].indexOf('bricks');
if (BRICKS < 0) { console.error('\n  Pas de fond « bricks » dans l index.\n'); process.exit(2); }

/**
 * Choisit des pieces variees parmi celles au mur de briques.
 *
 * Une banniere faite de huit pieces qui se ressemblent vend mal une
 * collection generative : on impose donc une couleur de chapeau et une
 * expression differentes a chaque fois, et on alterne les visages.
 */
const pool = index.tokens
  .map((t, id) => ({ id, t }))
  .filter(({ t }) => t[K_BACK] === BRICKS);

// La punchline n'est pas dans l'index des traits : elle se lit sur le
// token, donc dans le moteur. On ouvre la page une fois pour toutes et on
// laisse la selection s'y faire, plutot que de rendre 688 pieces pour en
// garder quatorze.
const hashOf = (id) => solidityPackedKeccak256(['bytes32', 'uint256'], [index.seedBase, id]);
const browser = await launchChromium();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
await page.setContent(readFileSync('kids/engine/frozen.html', 'utf8').replace('__HASH__', '0x0'),
                      { waitUntil: 'load' });
await page.waitForFunction(() => window.__hoodlrzFontReady === true, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(500);

const quotes = await page.evaluate((hs) => {
  const E = window.HoodlrzEngine;
  return hs.map((h) => E.QUOTES[E.createToken(h).quoteIndex]);
}, pool.map((p) => hashOf(p.id)));
pool.forEach((p, i) => { p.quote = quotes[i]; });

const picked = [];
const used = { hatColor: new Set(), expr: new Set(), hat: new Set(), quote: new Set() };
for (const cand of pool) {
  if (picked.length >= COUNT) break;
  const { t, quote } = cand;
  // Chaque piece apporte une couleur de chapeau, une expression et une
  // punchline qu'aucune autre n'a : une banniere ou trois pieces disent
  // « GAS IS PAIN » vend mal une collection de 3 333.
  if (used.hatColor.has(t[K_HATC]) || used.expr.has(t[K_EXPR]) || used.quote.has(quote)) continue;
  const wantSkull = picked.length % 2 === 1;   // alterne Skull et Classic
  if ((index.values[K_FACE][t[K_FACE]] === 'Skull') !== wantSkull) continue;
  if (used.hat.has(t[K_HAT]) && picked.length < index.values[K_HAT].length) continue;
  used.hatColor.add(t[K_HATC]); used.expr.add(t[K_EXPR]);
  used.hat.add(t[K_HAT]); used.quote.add(quote);
  picked.push(cand);
}
// Contraintes trop serrees pour le nombre demande : on relache la couleur
// et l'expression, jamais la punchline.
for (const cand of pool) {
  if (picked.length >= COUNT) break;
  if (used.quote.has(cand.quote)) continue;
  used.quote.add(cand.quote);
  picked.push(cand);
}

console.log(`\nBanniere Hoodlrz Gen Kids — mur de briques`);
console.log(`  ${pool.length} pieces au mur de briques dans la collection`);
console.log(`  ${picked.length} retenues (${ROWS} x ${COLS}), ${W}x${H}\n`);
for (const { id, t } of picked) {
  console.log(`  #${String(id).padStart(4)}  ${index.values[K_HAT][t[K_HAT]].padEnd(10)} ` +
              `${index.values[K_HATC][t[K_HATC]].padEnd(8)} ${index.values[K_FACE][t[K_FACE]].padEnd(8)} ` +
              index.values[K_EXPR][t[K_EXPR]].padEnd(8) + '  ' + picked.find((p) => p.t === t).quote);
}

/* ---- Rendu des pieces ------------------------------------------------- */
console.log('\nRendu…');
const tiles = await page.evaluate(({ hs, size }) => {
  const E = window.HoodlrzEngine;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d', { alpha: false });
  return hs.map((h) => {
    E.paint(ctx, size, size, E.createToken(h), { t: 3, beat: 0, nowMs: 3000, spectrum: new Array(32).fill(0) });
    return cv.toDataURL('image/png').split(',')[1];
  });
}, { hs: picked.map((p) => hashOf(p.id)), size: Math.max(400, Math.round((H / ROWS) * 2)) });

/* ---- Composition ------------------------------------------------------ */
// Le montage se fait en HTML : object-fit et transform y sont plus surs
// qu'une arithmetique de drawImage refaite a la main.
const cellOf = (b64) => `
  <span><img style="transform:translate(-50%,-50%) scale(${SCALE}) translateY(${SHIFT}%)"
       src="data:image/png;base64,${b64}"></span>`;
const rows = Array.from({ length: ROWS }, (_, r) =>
  `<div class="row">${tiles.slice(r * COLS, (r + 1) * COLS).map(cellOf).join('')}</div>`).join('');

const shot = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await shot.setContent(`<!doctype html><meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#000 }
  .tiles { position:absolute; inset:0; display:flex; flex-direction:column }
  .row { flex:1; min-height:0; display:flex }
  .row span { flex:1; min-width:0; height:100%; overflow:hidden; display:block; position:relative }
  .row img { position:absolute; left:50%; top:50%; width:auto; height:100%;
             min-width:100%; object-fit:cover }
</style>
<div class="tiles">${rows}</div>`, { waitUntil: 'load' });
await shot.waitForTimeout(300);
const file = `${OUT}/${NAME}.png`;
mkdirSync(OUT, { recursive: true });
await shot.screenshot({ path: file });
await browser.close();

const ko = (readFileSync(file).length / 1024).toFixed(0);
console.log(`\n  ${file}   ${W}x${H}   ${ko} Ko`);
console.log(`
  Pieces reelles de la collection, fond mur de briques, sans texte
  grave : OpenSea superpose deja le nom par-dessus.
`);
