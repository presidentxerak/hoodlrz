/**
 * Deploie la collection v2 devant la collection d'origine.
 *
 * Deux contrats : le renderer v2 (branche sur le MEME moteur scelle) et
 * la collection v2 (branchee sur la collection d'origine, dont elle copie
 * la graine et le nombre de pieces a la construction). Rien n'est minte
 * ici : c'est kids:airdrop qui distribue, ensuite.
 *
 * Ecrit dans kids/config.json, section deployments :
 *   nft        -> la v2 (ce que lisent le site et les scripts)
 *   renderer   -> le renderer v2
 *   origin     -> la collection d'origine
 *   rendererV1 -> l'ancien renderer, pour memoire
 *
 * Relancable : l'avancement est dans kids/build/deployment-v2-<chain>.json.
 *
 * Usage :
 *   npm run kids:deploy-v2 -- --testnet [--dry]
 *   npm run kids:deploy-v2 -- --mainnet
 */

import './env.mjs';
import { JsonRpcProvider, Wallet, ContractFactory, Contract, formatEther } from 'ethers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { compile } from './evm.mjs';

const CHAINS = {
  testnet: { id: 46630, name: 'Robinhood Chain Testnet', alchemy: 'robinhood-testnet', rpc: 'https://rpc.testnet.chain.robinhood.com', envRpc: 'RH_TESTNET_RPC', explorer: 'https://explorer.testnet.chain.robinhood.com', imgDir: 'img-testnet' },
  mainnet: { id: 4663, name: 'Robinhood Chain', alchemy: 'robinhood-mainnet', rpc: 'https://rpc.mainnet.chain.robinhood.com', envRpc: 'RH_MAINNET_RPC', explorer: 'https://robinhoodchain.blockscout.com', imgDir: 'img' },
};
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) { console.error('\n  Choisir un reseau : --testnet ou --mainnet\n'); process.exit(2); }
const CH = CHAINS[which];
const DRY = has('--dry');
const fail = (m) => { console.error('\n  ECHEC\n  ' + String(m).split('\n').join('\n  ') + '\n'); process.exit(1); };

const config = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = config.deployments?.[CH.id];
if (!dep?.nft || !dep?.engine) fail(`Aucune collection d'origine enregistree pour le chain ID ${CH.id}.`);
const royaltyTo = dep.royaltyReceiver ?? config.addresses.royaltyReceiver;
const imageBase = `${(config.v2?.siteBase ?? 'https://www.hoodlrz.com').replace(/\/$/, '')}/kids/${CH.imgDir}/`;

const key = process.env.DEPLOYER_PRIVATE_KEY;
if (!key) fail('DEPLOYER_PRIVATE_KEY manque dans .env.local');
const alchemyKey = process.env.ALCHEMY_API_KEY;
const rpc = process.env[CH.envRpc] || (alchemyKey ? `https://${CH.alchemy}.g.alchemy.com/v2/${alchemyKey}` : CH.rpc);
const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
const wallet = new Wallet(key, provider);

const net = await provider.getNetwork().catch((e) => fail(`RPC injoignable : ${e.shortMessage ?? e.message}`));
if (Number(net.chainId) !== CH.id) fail(`Ce RPC repond chain ID ${net.chainId}, attendu ${CH.id}.`);
const balance = await provider.getBalance(wallet.address);

console.log(`\nDeploiement Hoodlrz Gen Kids v2${DRY ? '   [A BLANC]' : ''}`);
console.log(`  reseau     ${CH.name}`);
console.log(`  deployeur  ${wallet.address}`);
console.log(`  solde      ${formatEther(balance)} ETH`);
console.log(`  origine    ${dep.nft}`);
console.log(`  moteur     ${dep.engine}`);
console.log(`  royalties  ${royaltyTo}`);
console.log(`  images     ${imageBase}<id>.png\n`);

/* ---- L'origine doit etre revelee et complete ------------------------ */
const origin = new Contract(dep.nft, [
  'function seedBase() view returns (bytes32)',
  'function totalMinted() view returns (uint256)',
  'function owner() view returns (address)',
], provider);
const seed = await origin.seedBase();
if (seed === '0x' + '0'.repeat(64)) fail('La collection d origine n est pas revelee : npm run kids:reveal d abord.');
const total = Number(await origin.totalMinted());
console.log(`  graine     ${seed}`);
console.log(`  pieces     ${total}\n`);
if (dep.origin) {
  console.log(`  Note : une v2 (${dep.nft}) est deja enregistree devant ${dep.origin}.`);
  fail('Ce deploiement a deja eu lieu. Pour recommencer, retirer origin/nft de kids/config.json.');
}

/* ---- Compilation ------------------------------------------------------ */
console.log('Compilation…');
const built = {};
for (const [name, file] of [
  ['HoodlrzKidsRendererV2', 'contracts/kids/HoodlrzKidsRendererV2.sol'],
  ['HoodlrzKidsV2', 'contracts/kids/HoodlrzKidsV2.sol'],
]) {
  built[name] = compile(file, name);
  console.log(`  ${name.padEnd(22)} ${built[name].deployedSize.toLocaleString('fr')} o`);
}
mkdirSync('kids/build/verify', { recursive: true });
for (const [name, art] of Object.entries(built)) {
  writeFileSync(`kids/build/verify/${name}.json`, JSON.stringify({ solcVersion: art.solcVersion, sourceName: art.sourceName, input: art.input }, null, 2));
  writeFileSync(`kids/build/verify/${name}.input.json`, JSON.stringify(art.input, null, 2));
}
if (DRY) { console.log('\nA blanc : rien n est envoye.\n'); process.exit(0); }
if (balance === 0n) fail('Solde nul.');

/* ---- Deploiement, relancable ----------------------------------------- */
const stateFile = `kids/build/deployment-v2-${CH.id}.json`;
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { chainId: CH.id };
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');

async function ensure(key, name, ctorArgs) {
  if (state[key]) { console.log(`${name.padEnd(22)} ${state[key]}   (deja deploye)`); return; }
  const f = new ContractFactory(built[name].abi, built[name].bytecode, wallet);
  for (let i = 1; ; i++) {
    try {
      const c = await f.deploy(...ctorArgs);
      await c.waitForDeployment();
      state[key] = await c.getAddress();
      break;
    } catch (e) {
      const msg = String(e.message ?? e);
      if (!(/nonce/i.test(msg) && /(already|too low|used)/i.test(msg)) || i >= 5) throw e;
      console.log(`  nonce en decalage, nouvel essai ${i}/4 dans 6 s…`);
      await new Promise((r) => setTimeout(r, 6000));
    }
  }
  save();
  console.log(`${name.padEnd(22)} ${state[key]}`);
}

console.log('');
await ensure('rendererV2', 'HoodlrzKidsRendererV2', [dep.engine]);
await ensure('nftV2', 'HoodlrzKidsV2', [dep.nft, state.rendererV2, royaltyTo, imageBase]);

// Controle : la v2 a bien copie l'origine.
const v2 = new Contract(state.nftV2, ['function seedBase() view returns (bytes32)', 'function MAX_SUPPLY() view returns (uint256)', 'function origin() view returns (address)'], provider);
if ((await v2.seedBase()) !== seed) fail('La graine de la v2 ne correspond pas a l origine.');
if (Number(await v2.MAX_SUPPLY()) !== total) fail('La supply de la v2 ne correspond pas a l origine.');
console.log('\n  graine et supply copiees, verifiees sur la chaine');

/* ---- Enregistrement ---------------------------------------------------- */
const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const d = cfg.deployments[CH.id];
d.origin = d.nft;
d.rendererV1 = d.renderer;
d.nft = state.nftV2;
d.renderer = state.rendererV2;
d.imageBase = imageBase;
d.v2DeployedAt = new Date().toISOString();
writeFileSync('kids/config.json', JSON.stringify(cfg, null, 2) + '\n');

console.log(`
Ecrit -> ${stateFile} et kids/config.json

  origine    ${d.origin}
  v2         ${d.nft}      ${CH.explorer}/address/${d.nft}
  renderer   ${d.renderer}

Reste a faire, dans cet ordre :
  1. npm run kids:render-images -- --${which}     rendre les ${total} captures
  2. npm run kids:upload-images -- --${which}     les heberger
  3. npm run kids:airdrop -- --${which}           distribuer aux proprietaires
  4. npm run kids:lock -- --${which}${which === 'mainnet' ? ' --confirmer-irreversible' : ''}
  5. npm run kids:index -- --${which}  puis  git add kids/config.json public/kids/collection && git commit -m "Gen Kids v2" && git push
  6. npm run kids:verify-contracts -- --${which}
`);
