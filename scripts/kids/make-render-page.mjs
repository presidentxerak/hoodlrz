/**
 * Fabrique public/kids/render.html : le moteur gele, plus un petit
 * service de rendu a la demande pour la galerie du site.
 *
 * Les vignettes de la galerie sont ainsi peintes dans le navigateur du
 * visiteur, par le moteur lui-meme, a la taille exacte de l'ecran - nettes
 * sur un ecran Retina, sans planches d'images lourdes a telecharger. La
 * page ne fait rien tant qu'on ne lui envoie pas de message ; elle
 * repond avec l'image d'une piece a l'instant canonique (t = 3 s), le
 * meme que celui des planches et du mode preview.
 *
 * Le moteur n'est pas modifie : on ajoute un script a la fin de
 * l'artefact gele, qui reste servi tel quel par ailleurs (engine.html).
 *
 * Usage : npm run kids:render-page   (a relancer si le moteur change)
 */

import { readFileSync, writeFileSync } from 'node:fs';

const frozen = readFileSync('kids/engine/frozen.html', 'utf8');
const marker = '</body>';
if (!frozen.includes(marker)) throw new Error('frozen.html sans </body>');

const service = `<script>
/* Service de rendu pour la galerie : voir scripts/kids/make-render-page.mjs */
(function () {
  var E = window.HoodlrzEngine;
  var SILENT = new Array(32).fill(0);
  var cv = document.createElement('canvas');
  var ctx = cv.getContext('2d', { alpha: false });
  function render(hash, size) {
    cv.width = size; cv.height = size;
    var tk = E.createToken(hash);
    E.paint(ctx, size, size, tk, { t: 3, beat: 0, nowMs: 3000, spectrum: SILENT });
    return cv.toDataURL('image/webp', 0.9);
  }
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || d.type !== 'hoodlrz:render' || typeof d.hash !== 'string') return;
    var src = e.source;
    __whenFontReady(function () {
      var out = null;
      try { out = render(d.hash, d.size || 512); } catch (err) {}
      try { src.postMessage({ type: 'hoodlrz:rendered', id: d.id, hash: d.hash, dataUrl: out }, '*'); } catch (err) {}
    });
  });
  try { parent.postMessage({ type: 'hoodlrz:ready' }, '*'); } catch (err) {}
})();
</script>
`;

const out = frozen.replace(marker, service + marker);
writeFileSync('public/kids/render.html', out);
console.log(`public/kids/render.html ecrit (${(out.length / 1024).toFixed(0)} Ko)`);
