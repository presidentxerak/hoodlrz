/**
 * Mint depuis le terminal, sans navigateur ni extension.
 *
 * Plan B pour quand MetaMask ne repond plus : le contrat, lui, repond.
 * Le script prend la cle d'un wallet dans .env.local (MINT_PRIVATE_KEY,
 * jamais la cle du deployeur), lit la preuve d'allowlist de ce wallet
 * dans le fichier publie par le snapshot, et envoie mintAllowlist ou
 * mintPublic selon la phase en cours sur la chaine.
 *
 * .env.local :
 *   MINT_PRIVATE_KEY=0x...   cle du wallet qui mint (export depuis MetaMask,
 *                            « Afficher la cle privee » du compte)
 *
 * Usage :
 *   npm run kids:mint -- --mainnet --qty 5
 *   npm run kids:mint -- --mainnet --qty 10 --dry     (verifie sans envoyer)
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, Contract, formatEther } from 'ethers';
import { readFileSync, existsSync } from 'node:fs';

const CHAINS = {
  testnet: { id: 46630, alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com' },
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
const qty = Number(val('--qty', '1'));
if (!which || !(qty >= 1 && qty <= 10)) {
  console.error('\n  Usage : npm run kids:mint -- --mainnet --qty <1 a 10>\n');
  process.exit(2);
}
const CH = CHAINS[which];

const keyMint = process.env.MINT_PRIVATE_KEY;
if (!keyMint || !/^0x[0-9a-fA-F]{64}$/.test(keyMint)) {
  console.error(`
  MINT_PRIVATE_KEY manque dans .env.local, ou n'a pas la forme 0x + 64 caracteres.

  C'est la cle du wallet qui mint - PAS celle du deployeur. Dans MetaMask :
  menu du compte > Details du compte > Afficher la cle privee. La coller
  dans .env.local sur une ligne :

    MINT_PRIVATE_KEY=0x...
`);
  process.exit(2);
}

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) { console.error(`\n  Aucun deploiement pour le chain ID ${CH.id}.\n`); process.exit(2); }

const key = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (key ? `https://${CH.alchemy}.g.alchemy.com/v2/${key}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(keyMint, provider);
const nft = new Contract(dep.nft, [
  'function mintAllowlist(uint256,bytes32[])',
  'function mintPublic(uint256)',
  'function totalMinted() view returns (uint256)',
  'function minted(address) view returns (uint256)',
  'function allowlistStart() view returns (uint64)',
  'function publicStart() view returns (uint64)',
  'function mintEnd() view returns (uint64)',
  'function allowlistRoot() view returns (bytes32)',
  'function MAX_PER_WALLET() view returns (uint256)',
], wallet);
const fmt = (t) => new Date(t * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', timeStyle: 'short' });

console.log(`\nMint depuis le terminal — ${CH.id === 4663 ? 'Robinhood Chain' : 'Robinhood Chain Testnet'}`);
console.log(`  contrat    ${dep.nft}`);
console.log(`  wallet     ${wallet.address}`);

/* ---- Etat --------------------------------------------------------- */
const [bal, minted, mine, al, pub, end, cap] = await Promise.all([
  provider.getBalance(wallet.address), nft.totalMinted(), nft.minted(wallet.address),
  nft.allowlistStart(), nft.publicStart(), nft.mintEnd(), nft.MAX_PER_WALLET(),
]);
const now = (await provider.getBlock('latest')).timestamp;
console.log(`  solde      ${formatEther(bal)} ETH`);
console.log(`  mintes     ${minted} / 3333, ce wallet ${mine} / ${cap}`);

const phase = now < Number(al) ? 'avant' : now < Number(pub) ? 'allowlist' : now < Number(end) ? 'public' : 'fermee';
console.log(`  phase      ${phase}   (allowlist ${fmt(Number(al))}, public ${fmt(Number(pub))})`);

if (phase === 'avant') { console.error(`\n  Le mint n'est pas ouvert. Allowlist a ${fmt(Number(al))}.\n`); process.exit(1); }
if (phase === 'fermee') { console.error('\n  Le mint est ferme.\n'); process.exit(1); }
if (Number(mine) + qty > Number(cap)) {
  console.error(`\n  Ce wallet a deja ${mine} pieces : au plus ${Number(cap) - Number(mine)} de plus.\n`);
  process.exit(1);
}
if (bal === 0n) { console.error('\n  Aucun ETH sur Robinhood Chain pour payer le gas.\n'); process.exit(1); }

/* ---- Preuve d'allowlist -------------------------------------------- */
let proof = null;
if (phase === 'allowlist') {
  const file = 'public/kids/allowlist.json';
  if (!existsSync(file)) { console.error(`\n  ${file} absent : lancer npm run kids:update.\n`); process.exit(1); }
  const al = JSON.parse(readFileSync(file, 'utf8'));
  const root = await nft.allowlistRoot();
  if (String(al.merkleRoot).toLowerCase() !== root.toLowerCase()) {
    console.error(`\n  Le fichier d'allowlist local ne correspond pas a la racine du contrat.\n  Lancer npm run kids:update, puis reessayer.\n`);
    process.exit(1);
  }
  proof = al.proofs[wallet.address.toLowerCase()] ?? null;
  if (!proof) {
    console.error(`\n  Ce wallet n'est pas dans l'allowlist (${al.holderCount} holders).\n  Le mint public ouvre a ${fmt(Number(pub))}.\n`);
    process.exit(1);
  }
  console.log(`  allowlist  oui, preuve de profondeur ${proof.length}`);
}

/* ---- Envoi ------------------------------------------------------------ */
const call = phase === 'allowlist' ? () => nft.mintAllowlist(qty, proof) : () => nft.mintPublic(qty);
const simulate = phase === 'allowlist' ? () => nft.mintAllowlist.staticCall(qty, proof) : () => nft.mintPublic.staticCall(qty);

console.log(`\n${qty} piece(s) en ${phase}…`);
try {
  await simulate();
} catch (e) {
  console.error(`\n  Le contrat refuserait : ${String(e.shortMessage ?? e.message).slice(0, 160)}\n`);
  process.exit(1);
}
if (has('--dry')) { console.log('  --dry : le contrat accepterait. Rien envoye.\n'); process.exit(0); }

const tx = await call();
console.log(`  transaction ${tx.hash}`);
const rc = await tx.wait();
console.log(`  incluse au bloc ${rc.blockNumber}, gas ${rc.gasUsed.toLocaleString('fr')}`);
console.log(`  ce wallet : ${await nft.minted(wallet.address)} / ${cap}`);
console.log(`\n  ${CH.explorer}/tx/${tx.hash}\n`);
