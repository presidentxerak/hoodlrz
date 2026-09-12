/**
 * Distribue la collection v2 a ses proprietaires, puis le prouve.
 *
 * Le contrat lit lui-meme le proprietaire de chaque piece dans la
 * collection d'origine au moment de l'envoi : ce script ne fait
 * qu'appeler airdrop(50) jusqu'a ce que tout soit distribue, puis relit
 * les deux contrats piece par piece et refuse de conclure en vert s'il
 * existe une seule difference.
 *
 * Relancable : le contrat sait ou il en est.
 *
 * Usage :
 *   npm run kids:airdrop -- --testnet
 *   npm run kids:airdrop -- --mainnet
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, Contract, formatEther } from 'ethers';
import { readFileSync } from 'node:fs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com' },
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];
const LOT = 50;

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.origin) { console.error(`\n  Aucune v2 enregistree pour le chain ID ${CH.id} : npm run kids:deploy-v2 d abord.\n`); process.exit(2); }

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
const ABI = [
  'function airdrop(uint256)',
  'function airdropped() view returns (uint256)',
  'function MAX_SUPPLY() view returns (uint256)',
  'function airdropComplete() view returns (bool)',
  'function ownerOf(uint256) view returns (address)',
  'function owner() view returns (address)',
];
const v2 = new Contract(dep.nft, ABI, wallet);
const v1 = new Contract(dep.origin, ['function ownerOf(uint256) view returns (address)'], provider);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`\nAirdrop Hoodlrz Gen Kids v2 — ${which}`);
console.log(`  origine    ${dep.origin}`);
console.log(`  v2         ${dep.nft}`);
console.log(`  operateur  ${wallet.address}   solde ${formatEther(await provider.getBalance(wallet.address))} ETH`);

if ((await v2.owner()).toLowerCase() !== wallet.address.toLowerCase()) {
  console.error('\n  Ce wallet n est pas le proprietaire de la v2.\n'); process.exit(1);
}
const MAX = Number(await v2.MAX_SUPPLY());
let done = Number(await v2.airdropped());
console.log(`  distribue  ${done} / ${MAX}\n`);

/* ---- Distribution ------------------------------------------------------ */
const t0 = Date.now();
let gasTotal = 0n;
while (done < MAX) {
  let rc;
  for (let i = 1; ; i++) {
    try { rc = await (await v2.airdrop(LOT)).wait(); break; }
    catch (e) {
      const msg = String(e.message ?? e);
      if (/AirdropComplete/.test(msg)) break;
      if (!(/nonce/i.test(msg) && /(already|too low|used)/i.test(msg)) || i >= 5) throw e;
      console.log(`  nonce en decalage, nouvel essai ${i}/4 dans 6 s…`);
      await wait(6000);
    }
  }
  if (rc) gasTotal += rc.gasUsed;
  // Relu sur la chaine, en laissant les noeuds se rejoindre.
  const want = Math.min(done + LOT, MAX);
  for (let i = 0; i < 12; i++) {
    done = Number(await v2.airdropped());
    if (done >= want) break;
    await wait(2500);
  }
  process.stdout.write(`\r  ${done} / ${MAX}   (${((Date.now() - t0) / 1000).toFixed(0)} s, gas ${(Number(gasTotal) / 1e6).toFixed(1)} M)   `);
}
console.log(`\n  distribution complete en ${((Date.now() - t0) / 1000).toFixed(0)} s\n`);

/* ---- Preuve : chaque piece chez le bon proprietaire --------------------- */
console.log('Verification piece par piece…');
const mismatches = [];
const CONC = 8;
for (let start = 0; start < MAX; start += CONC) {
  const ids = Array.from({ length: Math.min(CONC, MAX - start) }, (_, i) => start + i);
  const rows = await Promise.all(ids.map(async (id) => {
    const [a, b] = await Promise.all([v1.ownerOf(id), v2.ownerOf(id).catch(() => null)]);
    return [id, a, b];
  }));
  for (const [id, a, b] of rows) if (!b || a.toLowerCase() !== b.toLowerCase()) mismatches.push({ id, origine: a, v2: b });
  if ((start + CONC) % 400 < CONC) process.stdout.write(`\r  ${Math.min(start + CONC, MAX)} / ${MAX} comparees   `);
}
console.log(`\r  ${MAX} / ${MAX} comparees        `);

if (mismatches.length) {
  console.log(`\n  ${mismatches.length} difference(s) : des pieces ont change de main dans l origine`);
  console.log('  entre la distribution et cette lecture. Elles sont chez l ancien');
  console.log('  proprietaire dans la v2 ; c est attendu si une vente a eu lieu entre-temps.');
  for (const m of mismatches.slice(0, 10)) console.log(`    #${m.id}  origine ${m.origine}  v2 ${m.v2}`);
  process.exit(1);
}
console.log(`
  ${MAX} pieces, ${MAX} proprietaires identiques a l origine. Rien a la main.
  ${CH.explorer}/address/${dep.nft}
`);
