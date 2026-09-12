/**
 * Banniere OpenSea de la collection Hoodlrz on-chain : une foule de
 * Hoodlrz devant un mur de briques continu.
 *
 * POURQUOI CE SCRIPT EST DIFFERENT DE kids:banner
 * Pour Gen Kids, le moteur peint fond et personnage ensemble : on ne peut
 * qu'aligner des carres. Ici l'oeuvre est composee de couches SVG
 * separees - mur, tag, hoodie, yeux, bouche, accessoire - et le mur est
 * la seule couche opaque. On peut donc etaler un vrai mur sur toute la
 * largeur, y poser des tags, et faire tenir devant une foule de
 * personnages qui se chevauchent. C'est une scene, pas une planche.
 *
 * Les couches sont celles du generateur du site (public/layers), donc le
 * dessin est exactement celui de la collection.
 *
 * Usage :
 *   npm run kids:banner-og
 *   npm run kids:banner-og -- --chars 11 --seed hoodlrz-2
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { launchChromium } from './browser.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const W = Number(val('--width', '1400'));
const H = Number(val('--height', '400'));
const CHARS = Number(val('--chars', '9'));
const TAGS = Number(val('--tags', '4'));
// Un personnage occupe environ les deux tiers de la largeur de son cadre
// et commence a 22 % de sa hauteur. Le cadre est donc bien plus grand que
// le personnage : c'est en le reglant qu'on decide combien de mur reste
// visible au-dessus des tetes.
const FRAME = Number(val('--frame', '430'));     // cadre 600x600 rendu, en px
const TOP = Number(val('--top', '46'));          // hauteur du haut du cadre
const TAG_TOP = Number(val('--tagtop', '6'));    // idem pour les tags
const SEED = val('--seed', 'hoodlrz-bricks');
const VARIANT = val('--variant', 'dark');        // dark = mur noir, briques claires
const OUT = 'kids/brand';
const NAME = val('--name', 'banner-og-bricks');

const DIR = `public/layers/${VARIANT === 'light' ? '01-layers-light' : '02-layers-dark'}`;
const listing = (folder) => readdirSync(`${DIR}/${folder}`).filter((f) => f.endsWith('.svg')).sort();
const LAYERS = {
  walls: listing('07-walls'),
  graffitis: listing('06-graffitis'),
  hoodies: listing('05-hoodies'),
  eyes: listing('02-eyes'),
  mouths: listing('04-mouths'),
  accessories: listing('03-accessories'),
};

/** Meme generateur pseudo-aleatoire que le site : la banniere se refait
 *  a l'identique tant que la graine ne change pas. */
function mulberry32(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let h = 2166136261;
for (const c of SEED) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
const rand = mulberry32(h);
const pick = (arr) => arr[(rand() * arr.length) | 0];
/** Tire sans remise tant qu'il reste du choix : une foule de dix
 *  personnages identiques ne montrerait pas la collection. */
function drawN(arr, n) {
  const rest = [...arr], out = [];
  for (let i = 0; i < n; i++) {
    if (!rest.length) rest.push(...arr);
    out.push(rest.splice((rand() * rest.length) | 0, 1)[0]);
  }
  return out;
}

// Les SVG sont inlines en data URI : une page construite par setContent
// a pour origine about:blank, et le navigateur y refuse les file://.
const cache = new Map();
const url = (folder, file) => {
  const key = `${folder}/${file}`;
  if (!cache.has(key)) {
    cache.set(key, 'data:image/svg+xml;base64,' +
      readFileSync(`${DIR}/${key}`).toString('base64'));
  }
  return cache.get(key);
};

/* ---- Le mur ----------------------------------------------------------- */
// Toutes les dalles de la categorie « wall » ne sont pas des murs : sur
// dix, quatre ne portent que quelques marques. Les nommer en dur casserait
// des que les couches changent, alors on les mesure - on rend chacune et
// on garde celles qui couvrent assez de surface.
const browser = await launchChromium();
const probe = await browser.newPage({ viewport: { width: 200, height: 200 } });
const density = await probe.evaluate(async (srcs) => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 200;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const out = [];
  for (const src of srcs) {
    const img = new Image();
    await new Promise((r) => { img.onload = img.onerror = r; img.src = src; });
    ctx.clearRect(0, 0, 200, 200);
    ctx.drawImage(img, 0, 0, 200, 200);
    const d = ctx.getImageData(0, 0, 200, 200).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) ink++;
    out.push(ink / (200 * 200));
  }
  return out;
}, LAYERS.walls.map((f) => url('07-walls', f)));
await probe.close();

// Seuil relatif plutot qu'absolu : ce qui compte est l'ecart entre les
// vraies dalles et les autres, pas une valeur choisie a la main.
const maxInk = Math.max(...density);
const measured = LAYERS.walls.map((f, i) => ({ f, ink: density[i] }));
const bricks = measured.filter((w) => w.ink >= maxInk * 0.45).map((w) => w.f);
if (!bricks.length) { console.error('\n  Aucune dalle de mur assez dense.\n'); process.exit(1); }

const tilesNeeded = Math.ceil(W / H) + 1;
const wallTiles = drawN(bricks, tilesNeeded)
  .map((f, i) => `<img class="wall" style="left:${i * H}px" src="${url('07-walls', f)}">`).join('');

/* ---- Les tags --------------------------------------------------------- */
// Poses sur le mur, derriere la foule, a des hauteurs legerement
// differentes : un alignement parfait ferait affiche publicitaire.
const tagFiles = drawN(LAYERS.graffitis, TAGS);
const tags = tagFiles.map((f, i) => {
  const x = (W / TAGS) * (i + 0.5) - FRAME / 2 + (rand() - 0.5) * 110;
  // Le tremblement ne va que vers le bas : un tag remonte serait ampute
  // par le bord, et un mot coupe en haut de banniere se voit tout de suite.
  const y = TAG_TOP + rand() * 26;
  return `<img class="tag" style="left:${Math.round(x)}px; top:${Math.round(y)}px" src="${url('06-graffitis', f)}">`;
}).join('');

/* ---- La foule --------------------------------------------------------- */
const hoodies = drawN(LAYERS.hoodies, CHARS);
const eyes = drawN(LAYERS.eyes, CHARS);
const mouths = drawN(LAYERS.mouths, CHARS);
const accessories = drawN(LAYERS.accessories, CHARS);

// Les personnages sont poses de gauche a droite, en depassant des deux
// cotes : une foule qui s'arrete net aux bords est un alignement, pas une
// foule. Chacun monte ou descend un peu, pour la meme raison.
const step = (W + FRAME * 0.5) / CHARS;
const crowd = Array.from({ length: CHARS }, (_, i) => {
  // Une taille legerement variable donne de la profondeur : sans elle,
  // dix personnages de meme hauteur font une frise, pas une foule.
  const sc = 0.94 + rand() * 0.14;
  const x = -FRAME * 0.25 + step * i + (rand() - 0.5) * 24;
  const y = TOP + (rand() - 0.5) * 30 + (1 - sc) * FRAME * 0.4;
  const parts = [
    ['05-hoodies', hoodies[i]],
    ['02-eyes', eyes[i]],
    ['04-mouths', mouths[i]],
    ['03-accessories', accessories[i]],
  ];
  return `<div class="char" style="left:${Math.round(x)}px; top:${Math.round(y)}px;` +
    ` width:${Math.round(FRAME * sc)}px; height:${Math.round(FRAME * sc)}px">` +
    parts.map(([d, f]) => `<img src="${url(d, f)}">`).join('') + '</div>';
}).join('');

console.log(`\nBanniere Hoodlrz on-chain — mur de briques`);
console.log(`  ${W}x${H}   ${CHARS} personnages, ${TAGS} tags, variante ${VARIANT}`);
console.log(`  graine « ${SEED} » : le meme appel refait la meme banniere`);
console.log(`  murs   ${bricks.length} dalles pleines sur ${LAYERS.walls.length}, ${tilesNeeded} posees`);
console.log('         ' + measured.map((w) => `${w.f.replace('wall-', '').replace('.svg', '')}:${(w.ink * 100).toFixed(1)}%${bricks.includes(w.f) ? '*' : ''}`).join(' '));
console.log(`  tags   ${tagFiles.join(' ')}`);
console.log(`  hoods  ${hoodies.join(' ')}\n`);

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><meta charset="utf-8">
<style>
  * { margin:0; padding:0 }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#000 }
  .scene { position:absolute; inset:0 }
  .wall { position:absolute; top:0; width:${H}px; height:${H}px }
  .tag { position:absolute; width:${FRAME}px; height:${FRAME}px }
  .char { position:absolute }
  .char img { position:absolute; left:0; top:0; width:100%; height:100% }
  /* Les tags sont sur le mur, pas dessus : on les recule un peu. */
  .tag { opacity:.85 }
</style>
<div class="scene">${wallTiles}${tags}${crowd}</div>`, { waitUntil: 'load' });
await page.waitForTimeout(600);

mkdirSync(OUT, { recursive: true });
const file = `${OUT}/${NAME}.png`;
await page.screenshot({ path: file });
await browser.close();

console.log(`  ${file}   ${W}x${H}   ${(readFileSync(file).length / 1024).toFixed(0)} Ko\n`);
