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
  'function allowlistStart() view returns (uint64)',
  'function publicStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
], provider);

console.log(`\nAudit du mint — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  contrat  ${CONTRACT}`);

let nom = '?';
try { nom = await lire(() => nft.name()); } catch { console.error('\n  Contrat illisible.\n'); process.exit(1); }
console.log(`  nom      «${nom}»`);

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

/* ---- Trouver le bloc de deploiement ------------------------------------ */
// Balayer depuis le bloc zero couterait des milliers de requetes. Le
// contrat n'a de code qu'a partir de son deploiement : une recherche
// dichotomique le trouve en une vingtaine de lectures.
const latest = await lire(() => provider.getBlockNumber());
let lo = 0, hi = latest;
while (lo < hi) {
  const mid = Math.floor((lo + hi) / 2);
  const code = await lire(() => provider.getCode(CONTRACT, mid));
  if (code && code !== '0x') hi = mid; else lo = mid + 1;
}
const deployBlock = lo;
console.log(`  deploye au bloc ${deployBlock.toLocaleString('fr')}, chaine a ${latest.toLocaleString('fr')}\n`);

/* ---- Lire tous les mints ----------------------------------------------- */
// Un mint est un Transfer depuis l'adresse nulle. On filtre la-dessus
// plutot que de lire toutes les transactions du contrat.
const TRANSFER = topicId('Transfer(address,address,uint256)');
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const mints = [];
let span = 50_000;
console.log('Lecture des evenements de mint…');
for (let from = deployBlock; from <= latest; ) {
  const to = Math.min(from + span - 1, latest);
  let logs;
  try {
    logs = await lire(() => provider.getLogs({
      address: CONTRACT, fromBlock: from, toBlock: to, topics: [TRANSFER, ZERO_TOPIC],
    }), 3);
  } catch (e) {
    // Certains fournisseurs refusent les grandes plages : on reduit.
    if (span > 2000) { span = Math.floor(span / 5); continue; }
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

if (!mints.length) {
  console.log('  Aucun mint sur ce contrat. Rien a analyser.\n');
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
