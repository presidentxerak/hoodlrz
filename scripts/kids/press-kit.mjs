/**
 * Press kit PDF, a l'attention de l'equipe OpenSea.
 *
 * Reprend la charte du site : fond noir, police hoodlrz pour les titres,
 * degrade rouge-magenta des appels a l'action, gris de texte identiques
 * aux variables CSS. Un dossier de presse qui ne ressemble pas au site
 * qu'il presente commence par se contredire.
 *
 * Les visuels sont ceux de kids/brand/, donc produits par le moteur de la
 * collection : le document montre l'oeuvre, il ne la decrit pas seulement.
 *
 * Le PDF est imprime par le navigateur plutot qu'assemble par une
 * bibliotheque : la mise en page est du HTML, ce qui la rend relisible et
 * modifiable sans outil special.
 *
 * Usage : npm run kids:presskit
 */

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { launchChromium } from './browser.mjs';

const OUT = 'kids/brand';
mkdirSync(OUT, { recursive: true });

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const K = cfg.collection;
const P = cfg.phases;

const fontB64 = readFileSync('public/fonts/hoodlrz-font.ttf').toString('base64');
const b64 = (p) => readFileSync(p).toString('base64');
const png = (name) => `data:image/png;base64,${b64(`${OUT}/${name}.png`)}`;

for (const f of ['banner', 'icon', 'social', 'featured', 'header']) {
  if (!existsSync(`${OUT}/${f}.png`)) {
    console.error(`\n  ${OUT}/${f}.png absent.\n  Lancer d'abord : npm run kids:brand\n`);
    process.exit(2);
  }
}

const fmt = (iso) =>
  new Date(iso).toLocaleDateString('en-GB', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric',
  });
const fmtT = (iso) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Europe/Paris', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }) + ' CET';

/* ------------------------------------------------------------------ *
 * Rendu de pieces isolees pour la planche « The art »
 * ------------------------------------------------------------------ */
const frozen = readFileSync('kids/engine/frozen.html', 'utf8');
const GRID_HASHES = [
  '0x2b0565f54830c4ff9d1c17e5eddc1a3b8cd77e3b3a97dcbe1c1cbfa2a0d21a37',
  '0xcec6b439f1f05cabf1d5e3f0e0bbb6ba53c9f30c1a4b5ee3fd0bb8a1e2f00c11',
  '0x0c79f13992e3ad3b7a6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f00112233445566',
  '0x7de70466bd62aa11223344556677889900aabbccddeeff00112233445566778a',
  '0x6939bd4f8db4cc00112233445566778899aabbccddeeff00112233445566778b',
  '0xe588e6f2a42be2b1c86a0eb1f2b1c2e3f4a5b6c7d8e9f00112233445566778899',
];

const browser = await launchChromium();

console.log('\nPress kit Hoodlrz Gen Kids\n');
console.log('Rendu des pieces de la planche…');
const grid = [];
for (const h of GRID_HASHES) {
  // Page neuve par piece : reutiliser la meme renverrait les traits du
  // premier hash pour tous les suivants.
  const page = await browser.newPage({ viewport: { width: 640, height: 640 } });
  await page.setContent(frozen.replace('__HASH__', h), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hoodlrzFontReady === true, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2600);
  const img = await page.evaluate(() =>
    document.querySelector('canvas').toDataURL('image/png'));
  const t = await page.evaluate(() => window.HOODLRZ_FEATURES ?? null);
  await page.close();
  grid.push({ img, t });
  console.log(`  ${h.slice(0, 12)}…  ${t ? `${t.Hat}/${t.Face}/${t.Backdrop}` : '?'}`);
}

/* ------------------------------------------------------------------ *
 * Document
 * ------------------------------------------------------------------ */

const facts = [
  ['Collection', 'Hoodlrz Gen Kids'],
  ['Artist', 'XERAK'],
  ['Supply', K.maxSupply.toLocaleString('en-GB')],
  ['Price', 'Free — network gas only'],
  ['Per wallet', String(K.maxPerWallet)],
  ['Creator reserve', `${K.reserve}, minted before the public window opens`],
  ['Allowlist', 'OG Hoodlrz holders, by snapshot, Merkle proof'],
  ['Chain', 'Robinhood Chain (Arbitrum Orbit)'],
  ['Standard', 'ERC-721, EIP-2981'],
  ['Storage', 'Fully on-chain — SSTORE2'],
  ['Metadata', 'Built on-chain, base64 data URI'],
  ['Artwork', 'Animated HTML canvas engine, stored in the contract'],
  ['Royalties', `${K.royaltyBps / 100}%`],
];

const schedule = [
  ['Holder snapshot', fmtT(P.snapshotParis), 'Every wallet holding an OG Hoodlrz at this block enters the allowlist.'],
  ['Allowlist mint', fmtT(P.allowlistStartParis), 'One hour, reserved for the snapshot. Free, capped at 10.'],
  ['Public mint', fmtT(P.publicStartParis), 'Open to anyone. Same price, same cap.'],
  ['Window closes', fmt(P.mintEndParis), 'A long backstop. The mint ends on sell-out or when the creator closes it; the reveal follows within thirty days.'],
];

const traitRow = (g) => g.t
  ? `<div class="tr">${['Hat', 'Face', 'Backdrop', 'Expression']
      .map((k) => `<span><b>${k}</b> ${g.t[k]}</span>`).join('')}</div>`
  : '';

const html = `<!doctype html><meta charset="utf-8">
<style>
  @font-face { font-family:"hoodlrz"; src:url("data:font/ttf;base64,${fontB64}") format("truetype") }
  @page { size: A4; margin: 0 }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact }

  /* Charte du site : memes variables que src/app/globals.css, theme sombre. */
  :root {
    --bg:#000; --fg:#fafafa; --surface:#111; --muted:#a3a3a3; --border:#262626;
    --cta-from:#e53e3e; --cta-to:#d53f8c; --chain:#c6f24e;
  }
  body { background:var(--bg); color:var(--fg);
         font:11pt/1.62 "Helvetica Neue", Helvetica, Arial, sans-serif }
  .page { width:210mm; height:297mm; padding:18mm 17mm; position:relative;
          page-break-after:always; overflow:hidden; display:flex; flex-direction:column }
  .page:last-child { page-break-after:auto }

  h1,h2,.brand { font-family:"hoodlrz", sans-serif; font-weight:400; letter-spacing:.03em }
  h1 { font-size:40pt; line-height:1.02 }
  h2 { font-size:21pt; margin-bottom:5mm }
  .kicker { font-size:7.5pt; letter-spacing:.26em; text-transform:uppercase;
            color:var(--muted); margin-bottom:3mm }
  table + .kicker { margin-top:4mm }
  p { margin-bottom:3.6mm; color:#e2e2e2 }
  p.lead { font-size:13pt; line-height:1.5; color:#fff }
  strong { color:#fff; font-weight:600 }
  .muted { color:var(--muted) }
  a { color:#e0708f; text-decoration:none }

  .rule { height:1px; background:var(--border); margin:6mm 0 }
  .grow { flex:1 }
  .foot { display:flex; justify-content:space-between; font-size:7.5pt;
          letter-spacing:.14em; text-transform:uppercase; color:#555;
          border-top:1px solid var(--border); padding-top:3mm }

  .chip { display:inline-block; font-size:7.5pt; letter-spacing:.18em;
          text-transform:uppercase; color:var(--chain);
          border:1px solid rgba(198,242,78,.42); background:rgba(198,242,78,.10);
          padding:1.6mm 3.4mm }
  .cta { display:inline-block; font-size:8pt; letter-spacing:.18em;
         text-transform:uppercase; color:#fff; padding:2mm 4mm;
         background:linear-gradient(90deg,var(--cta-from),var(--cta-to)) }

  .card { border:1px solid var(--border); background:var(--surface); padding:6mm }
  .card + .card { margin-top:4mm }
  .card h3 { font-size:11pt; color:#fff; margin-bottom:2mm }
  .card p { margin:0; font-size:10pt; color:#cfcfcf }
  .accent { border-left:2px solid #627eea }

  table { width:100%; border-collapse:collapse; font-size:9.5pt }
  td { padding:2.2mm 0; border-bottom:1px solid var(--border); vertical-align:top }
  td:first-child { color:var(--muted); width:38mm; text-transform:uppercase;
                   letter-spacing:.1em; font-size:7.5pt; padding-top:3.4mm }
  td:last-child { color:#fff }

  .art { display:grid; grid-template-columns:1fr 1fr 1fr; gap:4mm }
  .art figure { margin:0 }
  .art img { width:100%; display:block; border:1px solid var(--border) }
  .tr { display:flex; flex-wrap:wrap; gap:1mm 3mm; margin-top:1.6mm;
        font-size:6.6pt; color:var(--muted) }
  .tr b { color:#666; font-weight:500; text-transform:uppercase; letter-spacing:.08em }

  .cap { font-size:7.5pt; color:var(--muted); margin-top:1.6mm;
         letter-spacing:.1em; text-transform:uppercase }
  .page img { max-width:100%; display:block; border:1px solid var(--border) }
</style>

<!-- ── 1. Couverture ─────────────────────────────────────────────── -->
<section class="page" style="padding:0">
  <img src="${png('banner')}" style="width:100%; height:88mm; object-fit:cover">
  <div style="padding:16mm 17mm 0; flex:1; display:flex; flex-direction:column">
    <div class="kicker">Press kit · ${fmt(P.publicStartParis)}</div>
    <h1>Hoodlrz<br>Gen Kids</h1>
    <p class="lead" style="margin-top:7mm; max-width:130mm">
      ${K.maxSupply.toLocaleString('en-GB')} generative pieces whose rendering
      engine lives inside the blockchain. Not an image stored on-chain —
      the program that draws it.
    </p>
    <div style="margin-top:5mm">
      <span class="chip">Robinhood Chain</span>
      <span class="chip" style="color:#fff; border-color:var(--border); background:var(--surface)">Free mint</span>
      <span class="chip" style="color:#fff; border-color:var(--border); background:var(--surface)">ERC-721</span>
    </div>
    <div class="grow"></div>
    <div style="display:flex; align-items:center; gap:6mm; margin-bottom:14mm">
      <img src="${png('icon')}" style="width:26mm; height:26mm; border-radius:50%; object-fit:cover">
      <div>
        <div class="brand" style="font-size:15pt">XERAK</div>
        <div class="muted" style="font-size:9pt">hoodlrz.com/kids</div>
      </div>
    </div>
  </div>
</section>

<!-- ── 2. L'idee ─────────────────────────────────────────────────── -->
<section class="page">
  <div class="kicker">The idea</div>
  <h2>Not a set of pictures.<br>A program.</h2>

  <p class="lead">Most on-chain collections store an image, or a link to one.
  Here the rendering engine itself — 116 KB of it — is written into the contract.</p>

  <p>When a marketplace asks for a token, the contract reassembles that program,
  injects the token's hash into it, and hands back a complete, animated page.
  No IPFS. No server of ours. Nothing to keep paying for. If our site disappears,
  every Kid still renders.</p>

  <p>Every piece draws itself, live, from its own seed. The hood, the face, the hat,
  the backdrop, the equaliser, the punchline — all of it is code running in the
  viewer's browser, not pixels fetched from somewhere.</p>

  <div class="rule"></div>

  <div class="card accent">
    <h3>Traits are computed, never stored</h3>
    <p>The contract derives all nine traits from the token hash using the same
    arithmetic the JavaScript engine uses — the same pseudo-random generator,
    reproduced in Solidity down to its 32-bit overflow behaviour. Both sides were
    run over all ${K.maxSupply.toLocaleString('en-GB')} pieces and compared one by
    one before anything was deployed.</p>
  </div>

  <div class="card accent">
    <h3>Nobody knows what they are minting</h3>
    <p>Token hashes come from a single seed that does not exist while minting is
    open. It is set once, irreversibly, after the pieces have already found their
    owners, and the mint cannot reopen afterwards. The reveal is a two-step call
    anyone can make — commit to a block that does not exist yet, then read its
    hash — so nobody, the creator included, picks the seed or the tokens.</p>
  </div>

  <div class="card accent">
    <h3>The renderer is locked</h3>
    <p>Once the output has been verified from the chain, the renderer address is
    frozen by an irreversible call. After that, nobody can change how an already
    sold piece looks — not even us.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>The idea</span></div>
</section>

<!-- ── 3. L'art ──────────────────────────────────────────────────── -->
<section class="page">
  <div class="kicker">The art</div>
  <h2>Nine traits, drawn by code</h2>
  <p class="muted" style="margin-bottom:6mm; font-size:10pt">
    Hat · Hat Color · Hood Color · Face · Hair · Backdrop · Palette · EQ Color ·
    Expression. All derived on-chain from the token hash. The pieces below are
    live renders from arbitrary hashes — they are not part of the collection.
  </p>

  <div class="art">
    ${grid.map((g) => `<figure><img src="${g.img}">${traitRow(g)}</figure>`).join('')}
  </div>

  <div class="rule"></div>
  <p style="font-size:10pt">Each piece is animated: the backdrop scrolls, the
  equaliser reacts, and the punchline changes when the artwork is touched. A still
  frame is a poster of the work, not the work.</p>

  <div class="grow"></div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>The art</span></div>
</section>

<!-- ── 4. Faits et calendrier ────────────────────────────────────── -->
<section class="page">
  <div class="kicker">Facts</div>
  <h2>Collection</h2>
  <table>${facts.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>

  <div style="height:13mm"></div>
  <div class="kicker">Schedule — Paris time</div>
  <h2>Mint</h2>
  <table>${schedule.map(([a, b, c]) =>
    `<tr><td>${a}</td><td><span style="color:#fff">${b}</span>
     <div class="muted" style="font-size:8.6pt; margin-top:.8mm">${c}</div></td></tr>`).join('')}
  </table>

  <p style="margin-top:6mm; font-size:9.5pt" class="muted">
    The contract compares against block timestamps in UTC; the times above are the
    same instants, written for humans.
  </p>

  <div class="grow"></div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>Facts</span></div>
</section>

<!-- ── 5. Ce qui est verifiable ──────────────────────────────────── -->
<section class="page">
  <div class="kicker">Verifiability</div>
  <h2>What anyone can check</h2>

  <p>We say <strong>fully on-chain</strong>, and never <em>immutable forever</em>.
  The first is true and verifiable by anyone. The second would not be honest on a
  chain whose sequencer is centralised and whose system contracts remain upgradable
  by its operator. We would rather make the claim that survives scrutiny.</p>

  <div class="rule"></div>

  <table>
    <tr><td>Engine bytes</td><td>Read the chunks back from the contract, concatenate,
      and compare the SHA-256 against the published fingerprint.</td></tr>
    <tr><td>Trait derivation</td><td>Both implementations — JavaScript and Solidity —
      were run over all ${K.maxSupply.toLocaleString('en-GB')} pieces and compared
      trait by trait.</td></tr>
    <tr><td>Metadata vs image</td><td>Render the HTML the contract returns and compare
      the traits it draws with the attributes it declares.</td></tr>
    <tr><td>Allowlist</td><td>The snapshot is published as a file. Anyone can rebuild
      the Merkle root and check their own wallet is in it.</td></tr>
    <tr><td>Contracts</td><td>Source published and verified on the block explorer, from
      the same pinned compiler that produced the deployed bytecode.</td></tr>
  </table>

  <div class="card" style="margin-top:8mm">
    <h3>Before anything was deployed</h3>
    <p>The full suite runs on every change: engine integrity, Merkle compatibility with
    OpenZeppelin, trait parity over the whole collection, an end-to-end pass through
    the real contract call path, reveal-on-sell-out, deployment resume, and an
    on-chain verifier that renders a token in a real browser. All green.</p>
  </div>

  <div class="grow"></div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>Verifiability</span></div>
</section>

<!-- ── 6. Le contexte ────────────────────────────────────────────── -->
<section class="page">
  <div class="kicker">Context</div>
  <h2>Where it comes from</h2>

  <p class="lead">Hoodlrz is not a PFP collection. It is a universe of hooded
  alter-egos born from the streets and the walls — handmade art, underground culture,
  animated storytelling and internet rebellion fused into collectible identities.</p>

  <p>The influences run deep. XCOPY, Rektguy and CryptoSkulls for the hypnotic loops
  and emotional distortion. Basquiat for raw symbolic expression and graffiti energy.
  KAWS for iconic collectible character identity. Banksy for the anonymous,
  anti-establishment spirit that runs through every piece. Musically and culturally
  shaped by Aphex Twin, Travis Scott, Wu-Tang Clan and MF DOOM.</p>

  <div class="rule"></div>

  <table>
    <tr><td>OG Hoodlrz</td><td>333 hand-drawn hooded identities on Ethereum. The origin
      of everything else — holding one is what puts a wallet on the Gen Kids
      allowlist.</td></tr>
    <tr><td>Gen Kids</td><td>${K.maxSupply.toLocaleString('en-GB')} generative pieces on
      Robinhood Chain. The subject of this document.</td></tr>
    <tr><td>Genesis Vinyl</td><td>25 hand-crafted vinyl artworks across three editions,
      with tracks chosen by the collector.</td></tr>
    <tr><td>Hoodlrz City</td><td>A playable city where holders explore, earn, and claim
      rewards. Gen Kids will appear inside the buildings of their holders.</td></tr>
  </table>

  <div class="grow"></div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>Context</span></div>
</section>

<!-- ── 7. Assets ─────────────────────────────────────────────────── -->
<section class="page">
  <div class="kicker">Assets</div>
  <h2>Brand files</h2>
  <p class="muted" style="font-size:10pt; margin-bottom:6mm">
    All generated by the collection's own engine from fixed hashes — reproducible,
    and revealing nothing about the collection. No text is burned into any of them.
  </p>

  <!-- Les fichiers ont des proportions tres differentes : les mettre dans
       une grille reguliere gaspillait la moitie de la page en vide et
       poussait le bloc contact hors du cadre. Les deux formats larges
       prennent donc toute la largeur, les trois autres se partagent une
       rangee. -->
  <div><img src="${png('banner')}" style="width:100%; display:block; border:1px solid var(--border)">
    <div class="cap">banner · 1400×400</div></div>

  <div style="margin-top:4mm"><img src="${png('header')}" style="width:100%; display:block; border:1px solid var(--border)">
    <div class="cap">header · 1500×500</div></div>

  <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr; gap:4mm; margin-top:4mm">
    <div><img src="${png('featured')}"><div class="cap">featured · 600×400</div></div>
    <div><img src="${png('social')}"><div class="cap">social · 1200×1200</div></div>
    <div><img src="${png('icon')}"><div class="cap">icon · 1000×1000</div></div>
  </div>

  <div class="grow"></div>
  <div style="display:flex; align-items:flex-end; justify-content:space-between; margin:8mm 0 6mm">
    <div>
      <div class="kicker" style="margin-bottom:2mm">Contact</div>
      <div class="brand" style="font-size:17pt">XERAK</div>
      <div class="muted" style="font-size:9.5pt">hoodlrz.com/kids · x.com/hoodlrz</div>
    </div>
    <span class="cta">Hoodlrz Gen Kids</span>
  </div>
  <div class="foot"><span>Hoodlrz Gen Kids</span><span>Assets &amp; contact</span></div>
</section>`;

console.log('\nImpression…');
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);

const file = `${OUT}/hoodlrz-gen-kids-presskit.pdf`;
await page.pdf({
  path: file,
  format: 'A4',
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});
await browser.close();

const ko = (readFileSync(file).length / 1024).toFixed(0);
console.log(`\n  ${file}   ${ko} Ko\n`);
