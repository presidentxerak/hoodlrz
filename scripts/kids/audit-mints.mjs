/**
 * Audit complet du mint : toutes les transactions, par phase et par wallet.
 *
 * POURQUOI
 * Une marketplace qui n'affiche pas une piece ne prouve rien. La chaine,
 * elle, garde chaque mint sous forme d'evenement Transfer depuis l'adresse
 * nulle. Ce script les relit tous, les classe par phase d'apres les dates
 * inscrites dans le contrat, et compte par wallet. C'est la seule source
 * qui permette de dire « ce wallet a minte tant de pieces, dans telle
 * transaction, a telle heure » - ou de constater qu'il n'a rien minte.
 *
 * Le script ne modifie rien et n'a besoin d'aucune cle privee.
 *
 * Sorties : un resume a l'ecran, et kids/build/audit-<chainId>.csv avec
 * une ligne par piece, ouvrable dans un tableur.
 *
 * Usage :
 *   npm run kids:audit -- --mainnet
 *   npm run kids:audit -- --mainnet --wallet 0x…      detaille un wallet
 *   npm run kids:audit -- --mainnet --v2              audite l'airdrop v2
 *   npm run kids:audit -- --mainnet --depuis 25900000 depart force
 *   npm run kids:audit -- --mainnet --proprietaires   qui detient quoi, sans logs
 */

import './env.mjs';
import { JsonRpcProvider, Contract, ZeroAddress, id as topicId, getAddress } from 'ethers';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com' },
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }
// Par defaut on audite la collection MINTEE, c'est-a-dire l'origine quand
// une v2 l'a redistribuee : c'est la que les transactions du drop vivent.
const CONTRACT = val('--contract') ?? (has('--v2') ? dep.nft : (dep.origin ?? dep.nft));
const FOCUS = val('--wallet') ? getAddress(val('--wallet')) : null;

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, CH.id, { staticNetwork: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Relit malgre les limites de debit du fournisseur RPC. */
async function lire(fn, tries = 6) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const m = String(e.message ?? e) + JSON.stringify(e.info ?? {});
      if (!/429|rate|capacity|exceeded|too many|timeout/i.test(m) || i >= tries) throw e;
      await wait(1200 * i);
    }
  }
}

const nft = new Contract(CONTRACT, [
  'function name() view returns (string)',
  'function totalMinted() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function ownerOf(uint256) view returns (address)',
  'function allowlistStart() view returns (uint64)',
  'function publicStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
], provider);

console.log(`\nAudit du mint — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  contrat  ${CONTRACT}`);
// Quel endpoint repond : une part des surprises vient de la, et la cle
// ne doit pas s'afficher en clair dans un terminal partage.
console.log(`  rpc      ${rpc.replace(/\/v2\/[^/]+/, '/v2/***').replace(/(key=)[^&]+/, '$1***')}`);

let nom = '?';
try { nom = await lire(() => nft.name()); }
catch (e) {
  console.error(`\n  Contrat illisible : ${String(e.shortMessage ?? e.message ?? e).slice(0, 200)}`);
  console.error(`  Verifier que le RPC repond et qu'il s'agit du bon reseau.\n`);
  process.exit(1);
}
console.log(`  nom      «${nom}»`);

let minted = 0;
try { minted = Number(await lire(() => nft.totalMinted())); }
catch { try { minted = Number(await lire(() => nft.totalSupply())); } catch { /* inconnu */ } }
if (minted) console.log(`  pieces   ${minted} d apres le contrat lui-meme`);

/* ---- Les bornes de phase, lues dans le contrat ------------------------- */
// Le contrat v2 n'a pas de phases : c'est une redistribution, pas un mint.
let AL = 0, PUB = 0, END = 0;
try {
  [AL, PUB, END] = (await Promise.all([
    lire(() => nft.allowlistStart()), lire(() => nft.publicStart()), lire(() => nft.mintEnd()),
  ])).map(Number);
} catch { /* pas de phases sur ce contrat */ }
const fmt = (t) => (t ? new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'medium' }) : '—');
if (AL) {
  console.log(`  allowlist  ${fmt(AL)}`);
  console.log(`  public     ${fmt(PUB)}`);
  console.log(`  fin        ${fmt(END)}`);
}

/* ---- Trouver par ou commencer la lecture -------------------------------- */
// Balayer depuis le bloc zero couterait des milliers de requetes. Il faut
// donc un point de depart.
//
// La tentation est de chercher le bloc de deploiement en interrogeant le
// code du contrat a differentes hauteurs. C'est un piege : lire le code a
// un ancien bloc est une lecture d'ETAT PASSE, que seuls les noeuds
// d'archive servent. Un noeud ordinaire repond « vide » partout, la
// recherche conclut « deploye a l'instant », et l'audit annonce zero mint
// alors que tout va bien.
//
// On cherche donc par l'HORODATAGE, qui vit dans l'en-tete des blocs et
// que tous les noeuds servent. La date de deploiement est dans
// kids/config.json ; on part d'un jour avant, par securite.
const latest = await lire(() => provider.getBlockNumber());

async function blocALaDate(cible) {
  let lo = 1, hi = latest, res = 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const b = await lire(() => provider.getBlock(mid));
    if (!b) { hi = mid - 1; continue; }
    if (b.timestamp < cible) { res = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return res;
}

let deployBlock;
const force = val('--depuis');
if (force) {
  deployBlock = Number(force);
  console.log(`  depart force au bloc ${deployBlock.toLocaleString('fr')}`);
} else {
  const iso = has('--v2') ? dep.v2DeployedAt : dep.deployedAt;
  const cible = Math.floor(new Date(iso ?? cfg.phases.snapshotParis).getTime() / 1000) - 86_400;
  deployBlock = await blocALaDate(cible);
  console.log(`  lecture depuis le bloc ${deployBlock.toLocaleString('fr')} (${fmt(cible)})`);
}
console.log(`  chaine a ${latest.toLocaleString('fr')}\n`);

/* ---- Lire tous les mints ----------------------------------------------- */
// Un mint est un Transfer depuis l'adresse nulle. On filtre la-dessus
// plutot que de lire toutes les transactions du contrat.
const TRANSFER = topicId('Transfer(address,address,uint256)');
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const mints = [];
let span = 50_000, panne = null;
if (!has('--proprietaires')) {
  console.log('Lecture des evenements de mint…');
  try {
    for (let from = deployBlock; from <= latest; ) {
      const to = Math.min(from + span - 1, latest);
      let logs;
      try {
        logs = await lire(() => provider.getLogs({
          address: CONTRACT, fromBlock: from, toBlock: to, topics: [TRANSFER, ZERO_TOPIC],
        }), 3);
      } catch (e) {
        // Certains fournisseurs refusent les grandes plages : on reduit.
        if (span > 500) { span = Math.floor(span / 5); continue; }
        throw e;
      }
      for (const l of logs) {
        mints.push({
          block: l.blockNumber,
          tx: l.transactionHash,
          to: getAddress('0x' + l.topics[2].slice(26)),
          id: Number(BigInt(l.topics[3])),
        });
      }
      from = to + 1;
      process.stdout.write(`\r  ${mints.length} pieces mintees, jusqu au bloc ${from.toLocaleString('fr')}…   `);
    }
    console.log(`\r  ${mints.length} pieces mintees au total                      \n`);
  } catch (e) {
    panne = String(e.shortMessage ?? e.message ?? e).slice(0, 200);
    console.log(`\r  Le fournisseur RPC refuse de servir l'historique : ${panne}\n`);
  }
}

/* ---- Filet de securite : la propriete, sans historique ------------------ */
// Quand les evenements sont inaccessibles - noeud sans historique, plage
// refusee - il reste une lecture que tout noeud sert : le proprietaire
// actuel de chaque piece. On perd les heures et les transactions, on garde
// la reponse a la seule question qui compte vraiment : qui detient quoi.
if (!mints.length || has('--proprietaires')) {
  if (!minted) {
    console.log(`  Impossible de lire les evenements ET impossible de connaitre la`);
    console.log(`  supply. Reessayer avec un RPC Alchemy (ALCHEMY_API_KEY dans .env.local).\n`);
    process.exit(1);
  }
  if (!has('--proprietaires')) {
    console.log(`  Aucun evenement lisible, alors que le contrat annonce ${minted} pieces.`);
    console.log(`  On bascule sur la lecture des proprietaires actuels.\n`);
  }
  console.log(`Lecture des proprietaires de ${minted} pieces…`);
  const par = new Map();
  const LOT = 20;
  for (let i = 0; i < minted; i += LOT) {
    const ids = Array.from({ length: Math.min(LOT, minted - i) }, (_, k) => i + k);
    const res = await Promise.all(ids.map((id) => lire(() => nft.ownerOf(id)).catch(() => null)));
    res.forEach((o, k) => {
      if (!o) return;
      const a = getAddress(o);
      if (!par.has(a)) par.set(a, []);
      par.get(a).push(ids[k]);
    });
    process.stdout.write(`\r  ${Math.min(i + LOT, minted)} / ${minted}   `);
  }
  const rangs = [...par].sort((a, b) => b[1].length - a[1].length);
  console.log(`\r  ${rangs.length} detenteurs distincts                    \n`);
  console.log('  pieces   wallet                                       exemples');
  for (const [addr, ids] of rangs.slice(0, Number(val('--top', '25')))) {
    const marque = FOCUS && addr === FOCUS ? ' <<<' : '';
    console.log(`  ${String(ids.length).padStart(6)}   ${addr}   #${ids.slice(0, 5).join(' #')}${ids.length > 5 ? ' …' : ''}${marque}`);
  }
  if (FOCUS) {
    const mien = par.get(FOCUS);
    console.log(`\n  Wallet demande  ${FOCUS}`);
    console.log(mien ? `  ${mien.length} pieces : #${mien.join(' #')}\n`
                     : `  Ce wallet ne detient aucune piece de ce contrat.\n`);
  }
  mkdirSync('kids/build', { recursive: true });
  const f = `kids/build/proprietaires-${CH.id}${has('--v2') ? '-v2' : ''}.csv`;
  writeFileSync(f, ['tokenId,proprietaire']
    .concat([...par].flatMap(([a, ids]) => ids.map((id) => `${id},${a}`)).sort((x, y) => +x.split(',')[0] - +y.split(',')[0]))
    .join('\n') + '\n');
  console.log(`  Detail piece par piece -> ${f}\n`);
  if (panne) {
    console.log(`  Les heures et les transactions demandent un RPC qui sert`);
    console.log(`  l'historique. Poser ALCHEMY_API_KEY dans .env.local puis relancer.\n`);
  }
  process.exit(0);
}

/* ---- Horodater les blocs concernes ------------------------------------- */
const blocs = [...new Set(mints.map((m) => m.block))].sort((a, b) => a - b);
console.log(`Horodatage de ${blocs.length} blocs…`);
const tsOf = new Map();
const CONC = 6;
for (let i = 0; i < blocs.length; i += CONC) {
  const lot = blocs.slice(i, i + CONC);
  const res = await Promise.all(lot.map((b) => lire(() => provider.getBlock(b))));
  lot.forEach((b, j) => tsOf.set(b, res[j].timestamp));
  process.stdout.write(`\r  ${Math.min(i + CONC, blocs.length)} / ${blocs.length}   `);
}
console.log('\r' + ' '.repeat(40) + '\r');

/** La phase d'un mint se deduit de l'heure du bloc et des bornes du
 *  contrat. Avant l'allowlist, c'est la reserve du createur. */
const phaseOf = (ts) => {
  if (!AL) return 'airdrop';
  if (ts < AL) return 'reserve';
  if (ts < PUB) return 'allowlist';
  if (ts < END) return 'public';
  return 'hors fenetre';
};
for (const m of mints) { m.ts = tsOf.get(m.block); m.phase = phaseOf(m.ts); }

/* ---- Resume par phase --------------------------------------------------- */
const ordre = ['reserve', 'allowlist', 'public', 'hors fenetre', 'airdrop'];
const parPhase = new Map();
for (const m of mints) {
  if (!parPhase.has(m.phase)) parPhase.set(m.phase, { pieces: 0, txs: new Set(), wallets: new Set(), t0: Infinity, t1: 0 });
  const p = parPhase.get(m.phase);
  p.pieces++; p.txs.add(m.tx); p.wallets.add(m.to);
  p.t0 = Math.min(p.t0, m.ts); p.t1 = Math.max(p.t1, m.ts);
}
console.log('Par phase\n');
console.log('  phase          pieces    tx   wallets   premiere              derniere');
for (const ph of ordre) {
  const p = parPhase.get(ph);
  if (!p) continue;
  console.log(`  ${ph.padEnd(13)} ${String(p.pieces).padStart(6)} ${String(p.txs.size).padStart(5)} ` +
              `${String(p.wallets.size).padStart(9)}   ${fmt(p.t0).padEnd(20)}  ${fmt(p.t1)}`);
}

/* ---- Resume par wallet -------------------------------------------------- */
const parWallet = new Map();
for (const m of mints) {
  if (!parWallet.has(m.to)) parWallet.set(m.to, { total: 0, phases: {}, ids: [], txs: new Set() });
  const w = parWallet.get(m.to);
  w.total++; w.phases[m.phase] = (w.phases[m.phase] ?? 0) + 1;
  w.ids.push(m.id); w.txs.add(m.tx);
}
const classement = [...parWallet].sort((a, b) => b[1].total - a[1].total);
console.log(`\nPar wallet — ${parWallet.size} adresses distinctes\n`);
console.log('  pieces  tx   wallet                                       detail par phase');
for (const [addr, w] of classement.slice(0, Number(val('--top', '25')))) {
  const detail = ordre.filter((p) => w.phases[p]).map((p) => `${p} ${w.phases[p]}`).join(', ');
  const marque = FOCUS && addr === FOCUS ? ' <<<' : '';
  console.log(`  ${String(w.total).padStart(6)} ${String(w.txs.size).padStart(3)}   ${addr}   ${detail}${marque}`);
}
if (classement.length > Number(val('--top', '25'))) {
  console.log(`  … et ${classement.length - Number(val('--top', '25'))} autres, tous dans le CSV`);
}

/* ---- Le wallet demande -------------------------------------------------- */
if (FOCUS) {
  console.log(`\nWallet demande  ${FOCUS}`);
  const w = parWallet.get(FOCUS);
  if (!w) {
    console.log(`  Ce wallet n'a minte AUCUNE piece sur ce contrat.`);
    console.log(`  Verifier qu'il s'agit du bon contrat : cet audit porte sur`);
    console.log(`  ${CONTRACT}. Ajouter --v2 pour auditer l'autre.\n`);
  } else {
    console.log(`  ${w.total} pieces en ${w.txs.size} transaction(s)`);
    const siennes = mints.filter((m) => m.to === FOCUS).sort((a, b) => a.block - b.block);
    const parTx = new Map();
    for (const m of siennes) {
      if (!parTx.has(m.tx)) parTx.set(m.tx, { ids: [], ts: m.ts, phase: m.phase, block: m.block });
      parTx.get(m.tx).ids.push(m.id);
    }
    for (const [tx, t] of parTx) {
      console.log(`\n    ${fmt(t.ts)}   ${t.phase}   bloc ${t.block.toLocaleString('fr')}`);
      console.log(`    ${t.ids.length} pieces : #${t.ids.join(' #')}`);
      console.log(`    ${CH.explorer}/tx/${tx}`);
    }
    console.log('');
  }
}

/* ---- CSV ---------------------------------------------------------------- */
mkdirSync('kids/build', { recursive: true });
const csv = ['tokenId,wallet,phase,horodatage,bloc,transaction']
  .concat(mints.sort((a, b) => a.id - b.id).map((m) =>
    [m.id, m.to, m.phase, new Date(m.ts * 1000).toISOString(), m.block, m.tx].join(',')))
  .join('\n');
const out = `kids/build/audit-${CH.id}${has('--v2') ? '-v2' : ''}.csv`;
writeFileSync(out, csv + '\n');

console.log(`\nTotal : ${mints.length} pieces, ${new Set(mints.map((m) => m.tx)).size} transactions, ` +
            `${parWallet.size} wallets`);
console.log(`Detail piece par piece -> ${out}\n`);
