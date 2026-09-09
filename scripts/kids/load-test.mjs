/**
 * Test de charge sur testnet : beaucoup de mints en meme temps.
 *
 * Le contrat tient la charge par construction - l'EVM execute une
 * transaction a la fois. Ce qui peut lacher le jour J, c'est autour :
 * le RPC public que la doc dit limite en debit, le sequenceur qui doit
 * absorber une rafale a l'ouverture, et la page qui interroge la chaine
 * pour chaque visiteur. Ce script mesure ces trois choses pour de vrai,
 * sur la chaine de test, avec de vraies transactions.
 *
 * Ce qu'il fait :
 *   1. cree N wallets jetables et les approvisionne en gas depuis le
 *      deployeur (N transactions, envoyees en parallele)
 *   2. ouvre une phase publique immediate sur le deploiement testnet
 *   3. fait minter les N wallets AU MEME INSTANT, 10 pieces chacun,
 *      et mesure le delai d'inclusion et les echecs
 *   4. bombarde le RPC en lecture, comme le feraient des centaines
 *      d'onglets ouverts sur la page de mint, et compte les refus
 *
 * Testnet seulement : sur mainnet, ces mints seraient de vraies pieces.
 * Le deploiement testnet doit etre neuf (graine non revelee) : la
 * repetition en consomme un, ce test aussi.
 *
 * Usage :
 *   npm run kids:load-test                 40 wallets
 *   npm run kids:load-test -- --wallets 80
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, Contract, parseEther, formatEther } from 'ethers';
import { readFileSync } from 'node:fs';

const CH = { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC' };

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const N = Math.max(2, Number(val('--wallets', '40')));
const PER = 10;

if (args.includes('--mainnet')) {
  console.error('\n  Refuse : ce test mint pour de vrai. Testnet seulement.\n');
  process.exit(2);
}

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) {
  console.error('\n  Aucun deploiement testnet. Lancer : npm run kids:deploy -- --testnet\n');
  process.exit(2);
}

const key = process.env.ALCHEMY_API_KEY;
const alchemyUrl = key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : null;
const rpc = process.env[CH.envRpc] || alchemyUrl || CH.rpc;
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const deployer = new Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

const ABI = [
  'function setPhases(uint64,uint64,uint64)',
  'function mintPublic(uint256)',
  'function totalMinted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
  'function seedBase() view returns (bytes32)',
  'function allowlistStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
];
const nft = new Contract(dep.nft, ABI, deployer);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (u) => (key && u.includes(key) ? u.split(key).join('***') : u);

console.log(`\nTest de charge — Robinhood Chain Testnet`);
console.log(`  NFT        ${dep.nft}`);
console.log(`  rpc        ${mask(rpc)}`);
console.log(`  wallets    ${N} x ${PER} pieces = ${N * PER} mints`);

if ((await nft.seedBase()) !== '0x' + '0'.repeat(64)) {
  console.error(`
  Graine deja revelee sur ce deploiement : le mint y est clos pour de
  bon. Redeployer un testnet neuf :

    rm kids/build/deployment-46630.json
    npm run kids:deploy -- --testnet
`);
  process.exit(2);
}

/* ---- 1. Wallets jetables ------------------------------------------- */
console.log('\n1. Approvisionnement des wallets');
const wallets = Array.from({ length: N }, () => Wallet.createRandom().connect(provider));

// Assez pour un mint de 10 avec une large marge, a un prix de gas de
// testnet. Relu sur la chaine plutot que devine.
const fee = await provider.getFeeData();
const gasPrice = fee.gasPrice ?? 100_000_000n;
const perWallet = gasPrice * 1_500_000n * 3n;   // 3x le gas d'un mint de 10
const total = perWallet * BigInt(N);
const solde = await provider.getBalance(deployer.address);
console.log(`  prix du gas   ${formatEther(gasPrice * 1_000_000_000n)} ETH / Mgas`);
console.log(`  par wallet    ${formatEther(perWallet)} ETH`);
console.log(`  total         ${formatEther(total)} ETH   (solde deployeur ${formatEther(solde)})`);
if (solde < total * 2n) {
  console.error('\n  Solde testnet insuffisant pour approvisionner les wallets.\n');
  process.exit(1);
}

// Nonces explicites : N transferts partent d'un coup, sans attendre que
// les noeuds du fournisseur se mettent d'accord entre chaque.
const base = await provider.getTransactionCount(deployer.address, 'pending');
const t0 = Date.now();
const funding = await Promise.allSettled(wallets.map((w, i) =>
  deployer.sendTransaction({ to: w.address, value: perWallet, nonce: base + i }).then((tx) => tx.wait())));
const fundOk = funding.filter((r) => r.status === 'fulfilled').length;
console.log(`  ${fundOk}/${N} wallets approvisionnes en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const r of funding.filter((r) => r.status === 'rejected').slice(0, 3)) {
  console.log(`    echec : ${String(r.reason?.message ?? r.reason).slice(0, 100)}`);
}
if (fundOk < N) {
  console.error('\n  Approvisionnement incomplet : on s arrete la plutot que de fausser la mesure.\n');
  process.exit(1);
}

/* ---- 2. Phase publique immediate ----------------------------------- */
console.log('\n2. Ouverture de la phase publique');
const now = (await provider.getBlock('latest')).timestamp;
if (Number(await nft.allowlistStart()) !== 0 && now >= Number(await nft.allowlistStart())) {
  console.log('  phases deja ouvertes sur ce deploiement, on les garde');
} else {
  await (await nft.setPhases(now + 20, now + 20, now + 3600)).wait();
  console.log('  public dans 20 s, fenetre d une heure');
  await wait(25_000);
}

/* ---- 3. La rafale -------------------------------------------------- */
console.log(`\n3. ${N} mints simultanes`);
const before = Number(await nft.totalMinted());
const t1 = Date.now();
const results = await Promise.allSettled(wallets.map(async (w) => {
  const c = new Contract(dep.nft, ABI, w);
  const sent = Date.now();
  const tx = await c.mintPublic(PER);
  const rc = await tx.wait();
  return { sent: sent - t1, mined: Date.now() - t1, block: rc.blockNumber, gas: rc.gasUsed };
}));
const okR = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
const ko = results.filter((r) => r.status === 'rejected');
const elapsed = (Date.now() - t1) / 1000;

await wait(3000);
const after = Number(await nft.totalMinted());
console.log(`  reussis        ${okR.length}/${N}`);
console.log(`  echoues        ${ko.length}`);
console.log(`  pieces mintees ${after - before}   (attendu ${okR.length * PER})`);
if (okR.length) {
  const mined = okR.map((r) => r.mined).sort((a, b) => a - b);
  const blocks = new Set(okR.map((r) => r.block));
  console.log(`  inclusion      premiere ${(mined[0] / 1000).toFixed(1)} s · mediane ${(mined[Math.floor(mined.length / 2)] / 1000).toFixed(1)} s · derniere ${(mined[mined.length - 1] / 1000).toFixed(1)} s`);
  console.log(`  blocs          ${blocks.size} bloc(s) pour ${okR.length} transactions`);
  console.log(`  gas par mint   ${okR[0].gas.toLocaleString('fr')}`);
}
console.log(`  duree totale   ${elapsed.toFixed(1)} s`);
const raisons = {};
for (const r of ko) {
  const m = String(r.reason?.shortMessage ?? r.reason?.message ?? r.reason).slice(0, 80);
  raisons[m] = (raisons[m] ?? 0) + 1;
}
for (const [m, n] of Object.entries(raisons)) console.log(`    ${n} x ${m}`);

/* ---- 4. Lectures en rafale, comme la page de mint ------------------ */
// La page relit totalMinted toutes les 15 s par visiteur. 300 visiteurs
// font 20 lectures par seconde. On envoie 200 lectures d'un coup sur
// chaque RPC disponible et on compte les refus.
console.log('\n4. Lectures en rafale (ce que fait la page de mint)');
const READS = 200;
const cibles = [['RPC public', CH.rpc]];
if (alchemyUrl) cibles.push(['Alchemy', alchemyUrl]);
for (const [label, url] of cibles) {
  const p = new JsonRpcProvider(url, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const c = new Contract(dep.nft, ABI, p);
  const t2 = Date.now();
  const rs = await Promise.allSettled(Array.from({ length: READS }, () => c.totalMinted()));
  const good = rs.filter((r) => r.status === 'fulfilled').length;
  const errs = {};
  for (const r of rs.filter((r) => r.status === 'rejected')) {
    const m = /429|rate|limit|too many/i.test(String(r.reason?.message)) ? 'debit limite (429)'
      : String(r.reason?.shortMessage ?? r.reason?.message).slice(0, 60);
    errs[m] = (errs[m] ?? 0) + 1;
  }
  console.log(`  ${label.padEnd(12)} ${good}/${READS} reponses en ${((Date.now() - t2) / 1000).toFixed(1)} s` +
              (good === READS ? '' : '   ' + Object.entries(errs).map(([m, n]) => `${n} x ${m}`).join(', ')));
}

/* ---- Verdict --------------------------------------------------------- */
console.log(`
Lecture du resultat :
  - ${okR.length}/${N} mints reussis et ${after - before} pieces comptees : le sequenceur
    a absorbe la rafale${ko.length ? ' avec des echecs, a regarder ci-dessus' : ''}.
  - Les lectures disent si le RPC public tient la page de mint. S'il
    refuse, poser NEXT_PUBLIC_KIDS_RPC_URL (Alchemy, cle restreinte au
    domaine) sur Vercel avant le jour J.
  - Les mints eux-memes passent par le RPC du wallet de chaque visiteur,
    pas par la page : ce test l'a emprunte aussi.
`);
process.exit(ko.length ? 1 : 0);
