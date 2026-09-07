/**
 * Deploiement sur une chaine reelle.
 *
 * POURQUOI PAS HARDHAT
 * Le projet est en Hardhat 3, dont l'API a change, et il faudrait y
 * ajouter le plugin ethers puis suivre ses migrations. Surtout : hardhat
 * telecharge son propre solc. Ici on compile avec scripts/kids/evm.mjs -
 * le paquet npm solc epingle a 0.8.28, reglages identiques a
 * hardhat.config.ts - c'est-a-dire avec le compilateur qui a produit le
 * bytecode des 118 controles de kids:test. Le code deploye est alors
 * exactement celui qui a ete verifie, pas son cousin.
 *
 * SEQUENCE, identique a celle validee sur EVM locale par e2e.test.mjs :
 *   1. deploie le moteur, le renderer, le NFT
 *   2. televerse les morceaux du moteur, une transaction chacun
 *   3. relit le document depuis la chaine et le compare a l'artefact local
 *   4. scelle le moteur   <- IRREVERSIBLE
 *   5. mint la reserve
 *
 * REPRISE
 * Six transactions de 24 Ko sur un RPC que Robinhood dit lui-meme
 * rate-limited : l'interruption n'est pas une hypothese d'ecole. Le
 * script lit son avancement SUR LA CHAINE - chunkCounts(), sealed_(),
 * reserveMinted() - et non dans un fichier local qui pourrait mentir.
 * Relancer la meme commande reprend ou ca s'est arrete.
 * Prouve par test/kids/resume.test.mjs.
 *
 * Ce script ne fixe PAS les phases et n'appelle PAS lockRenderer().
 * Ces gestes se font apres avoir verifie le rendu depuis la chaine.
 *
 * Usage :
 *   npm run kids:deploy -- --testnet
 *   npm run kids:deploy -- --mainnet
 *   npm run kids:deploy -- --testnet --dry    (compile et controle, sans rien envoyer)
 */

import { need } from './env.mjs';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { JsonRpcProvider, Wallet, ContractFactory, Contract, isAddress, formatEther } from 'ethers';
import { compile } from './evm.mjs';

/** Confirme sur docs.robinhood.com/chain le 22/08/2026. */
const CHAINS = {
  testnet: {
    id: 46630, name: 'Robinhood Chain Testnet',
    rpc: 'https://rpc.testnet.chain.robinhood.com',
    explorer: 'https://explorer.testnet.chain.robinhood.com',
    envRpc: 'RH_TESTNET_RPC', alchemy: 'robinhood-testnet',
  },
  mainnet: {
    id: 4663, name: 'Robinhood Chain',
    rpc: 'https://rpc.mainnet.chain.robinhood.com',
    explorer: 'https://robinhoodchain.blockscout.com',
    envRpc: 'RH_MAINNET_RPC', alchemy: 'robinhood-mainnet',
  },
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const DRY = has('--dry');

const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) {
  console.error('\n  Choisir un reseau : --testnet ou --mainnet\n');
  process.exit(2);
}
const CH = CHAINS[which];

const fail = (msg) => { throw new Error(msg); };

/** Chemin relatif au depot, quelle que soit la machine. */
const relPath = (p) => p.replace(process.cwd() + '/', '');

/**
 * Remplace les chemins ABSOLUS par des chemins relatifs au depot dans
 * l'entree standard JSON.
 *
 * evm.mjs reecrit tous les imports en chemins absolus pour que solc n'ait
 * rien a resoudre. Utile a la compilation, genant a la publication : les
 * cles porteraient alors l'arborescence de la machine qui a compile, ce
 * qui est a la fois inutile et indiscret sur un explorateur public.
 *
 * Les cles ET les imports sont reecrits ensemble : les seconds doivent
 * continuer a designer les premieres, sinon l'explorateur ne recompile
 * plus rien.
 */
function normaliseInput(input) {
  const map = Object.fromEntries(Object.keys(input.sources).map((k) => [k, relPath(k)]));
  const sources = {};
  for (const [abs, rel] of Object.entries(map)) {
    let content = input.sources[abs].content;
    for (const [a, r] of Object.entries(map)) content = content.split(a).join(r);
    sources[rel] = { content };
  }
  return { ...input, sources };
}

/**
 * Interroge le RPC une fois, a la main, avant de laisser ethers s'en
 * saisir. ethers resume tout echec en « failed to detect network », ce
 * qui ne distingue pas une cle sans acces d'un service en panne - or ce
 * ne sont pas du tout les memes gestes pour s'en sortir.
 */
async function probeRpc(url, masked, viaAlchemy) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    fail(`RPC injoignable : ${masked}\n${e.message}\n` +
         `Verifier la connexion, ou un pare-feu qui filtrerait cet hote.`);
  }

  if (r.ok) return;

  const why = (r.status === 401 || r.status === 403)
    ? (viaAlchemy
        ? `La cle Alchemy existe mais n'a pas acces a ce reseau.\n` +
          `Creer une app « Robinhood Chain » dans le dashboard Alchemy :\n` +
          `l'app est par reseau, la cle seule ne suffit pas.`
        : `Acces refuse par le fournisseur.`)
    : r.status === 404
      ? `Endpoint inconnu. L'URL a peut-etre change.`
      : r.status === 429
        ? `Debit limite. C'est exactement ce que la doc Robinhood annonce\n` +
          `pour l'endpoint public : passer par Alchemy.`
        : `Le fournisseur a refuse la requete.`;

  fail(`RPC refuse (HTTP ${r.status}) : ${masked}\n${why}`);
}

async function main() {
  const config = JSON.parse(readFileSync('kids/config.json', 'utf8'));

  /* ---- 0. Verifications prealables --------------------------------- */
  // Tout ce qui suit depense du gas et devient irreversible a l'etape 4.
  // Mieux vaut dix controles ici qu'un contrat oublie sur la mauvaise
  // chaine, ou 300 pieces envoyees au mauvais wallet.

  const key = need('DEPLOYER_PRIVATE_KEY', 'Voir .env.local.example.');
  const royaltyTo = process.env.ROYALTY_RECEIVER || '';
  const reserveTo = process.env.RESERVE_RECEIVER || '';
  // Pas de repli silencieux sur l'adresse du deployeur : ce serait
  // envoyer 300 pieces sur le wallet chaud sans que personne l'ait
  // demande.
  if (!isAddress(royaltyTo)) fail('ROYALTY_RECEIVER absent ou invalide  ->  npm run kids:sync-env');
  if (!isAddress(reserveTo)) fail('RESERVE_RECEIVER absent ou invalide  ->  npm run kids:sync-env');

  const alchemyKey = process.env.ALCHEMY_API_KEY;
  const forced = process.env[CH.envRpc] || '';
  const rpc = forced ||
    (alchemyKey ? `https://${CH.alchemy}.g.alchemy.com/v2/${alchemyKey}` : CH.rpc);
  const viaAlchemy = rpc.includes('alchemy.com');
  // Savoir QUE l'endpoint est public ne suffit pas : encore faut-il
  // savoir pourquoi, sinon on renseigne une cle Alchemy qui ne sera
  // jamais utilisee parce qu'une autre ligne la court-circuite.
  const publicBecause = viaAlchemy ? null
    : forced ? `${CH.envRpc} est renseigne dans .env.local et l'impose`
    : 'ALCHEMY_API_KEY est absent';

  const provider = new JsonRpcProvider(rpc, undefined, { staticNetwork: true });
  const wallet = new Wallet(key, provider);

  // ethers resume tout echec reseau en « failed to detect network »,
  // ce qui ne distingue pas une cle sans acces d un service en panne.
  // On interroge donc une fois a la main pour lire le vrai motif.
  const masked = alchemyKey ? rpc.split(alchemyKey).join('***') : rpc;
  await probeRpc(rpc, masked, viaAlchemy);

  const net = await provider.getNetwork().catch((e) => fail(
    `RPC injoignable : ${masked}\n${e.shortMessage ?? e.message}`));
  const chainId = Number(net.chainId);
  if (chainId !== CH.id) {
    fail(`Ce RPC repond chain ID ${chainId}, or ${CH.name} est ${CH.id}.\n` +
         `Verifier ${CH.envRpc} dans .env.local.`);
  }

  const declared = config.addresses?.deployer ?? '';
  if (declared && wallet.address.toLowerCase() !== declared.toLowerCase()) {
    fail(`La cle signe avec ${wallet.address},\n` +
         `or kids/config.json declare ${declared} comme deployeur.\n` +
         `Les contrats appartiendraient a une adresse non declaree.`);
  }

  const balance = await provider.getBalance(wallet.address);

  console.log(`\nDeploiement Hoodlrz Gen Kids${DRY ? '   [A BLANC]' : ''}`);
  console.log(`  reseau     ${CH.name}  (chainId ${chainId})`);
  console.log(`  rpc        ${viaAlchemy ? 'Alchemy' : 'endpoint public (rate-limited)'}`);
  console.log(`  deployeur  ${wallet.address}`);
  console.log(`  solde      ${formatEther(balance)} ETH`);
  console.log(`  reserve -> ${reserveTo}`);
  console.log(`  royalties  ${royaltyTo}\n`);

  if (!viaAlchemy) {
    console.log('  Note : la doc Robinhood deconseille l endpoint public en production.');
    console.log('  Six transactions de 24 Ko, c est le profil qui se fait limiter.');
    console.log(`  Cause ici : ${publicBecause}.`);
    console.log(forced
      ? `  Vider la ligne ${CH.envRpc}= dans .env.local pour passer par Alchemy.\n`
      : '  Renseigner ALCHEMY_API_KEY pour passer par Alchemy.\n');
  }
  if (balance === 0n && !DRY) fail('Solde nul. Alimenter le wallet avant de continuer.');

  /* ---- Compilation ------------------------------------------------- */
  console.log('Compilation…');
  const built = {};
  for (const [name, file] of [
    ['HoodlrzKidsEngine', 'contracts/kids/HoodlrzKidsEngine.sol'],
    ['HoodlrzKidsRenderer', 'contracts/kids/HoodlrzKidsRenderer.sol'],
    ['HoodlrzKids', 'contracts/kids/HoodlrzKids.sol'],
  ]) {
    built[name] = compile(file, name);
    console.log(`  ${name.padEnd(22)} ${built[name].deployedSize.toLocaleString('fr')} o`);
  }
  console.log(`  solc ${built.HoodlrzKids.solcVersion}\n`);

  // L'entree standard JSON, gardee des maintenant : c'est ce que
  // reclamera l'explorateur pour verifier les contrats, et la
  // reconstituer plus tard de memoire est le meilleur moyen de ne
  // jamais y arriver.
  mkdirSync('kids/build/verify', { recursive: true });
  for (const [name, art] of Object.entries(built)) {
    writeFileSync(`kids/build/verify/${name}.json`, JSON.stringify({
      solcVersion: art.solcVersion,
      sourceName: relPath(art.sourceName),
      input: normaliseInput(art.input),
    }, null, 2));
  }

  const manifest = JSON.parse(readFileSync('kids/build/engine-manifest.json', 'utf8'));
  const preChunks = JSON.parse(readFileSync('kids/build/engine-pre.json', 'utf8'));
  const postChunks = JSON.parse(readFileSync('kids/build/engine-post.json', 'utf8'));
  const artifactSha = '0x' + readFileSync('kids/build/engine.sha256', 'utf8').split(' ')[0];

  if (DRY) {
    console.log('A blanc : tous les controles passent, rien n a ete envoye.');
    console.log(`Relancer sans --dry pour deployer sur ${CH.name}.\n`);
    return;
  }

  /* ---- 1. Deploiement, ou reprise ---------------------------------- */
  const stateFile = `kids/build/deployment-${chainId}.json`;
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { chainId };
  if (state.engine) console.log(`Deploiement precedent trouve dans ${stateFile} — reprise\n`);

  // Deux ecritures, deux usages. Le fichier de build sert a la reprise et
  // n'est pas versionne. kids/config.json, lui, est public et suivi : des
  // adresses de contrats y ont leur place, c'est ce qu'on donnera a qui
  // veut verifier la collection.
  const save = () => {
    writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n');
    const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
    cfg.deployments ??= {
      _note: 'Adresses des contrats deployes, par chain ID. Ecrit par kids:deploy.',
    };
    cfg.deployments[chainId] = {
      network: CH.name,
      explorer: CH.explorer,
      engine: state.engine ?? null,
      renderer: state.renderer ?? null,
      nft: state.nft ?? null,
      // Les destinataires font partie du deploiement, pas de la config :
      // ils ont ete passes au constructeur et sont donc necessaires pour
      // reencoder ses arguments a la verification. Les relire dans
      // addresses supposerait qu'ils n'ont pas change depuis, ce qui est
      // faux des qu'on redeploie apres les avoir modifies.
      royaltyReceiver: royaltyTo,
      reserveReceiver: reserveTo,
      artifactSha256: state.artifactSha256 ?? null,
      deployedAt: state.deployedAt ?? null,
    };
    writeFileSync('kids/config.json', JSON.stringify(cfg, null, 2) + '\n');
  };

  const at = (name, addr) => new Contract(addr, built[name].abi, wallet);

  async function ensure(key, name, ctorArgs) {
    if (state[key]) {
      console.log(`${name.padEnd(22)} ${state[key]}   (deja deploye)`);
      return at(name, state[key]);
    }
    const f = new ContractFactory(built[name].abi, built[name].bytecode, wallet);
    const c = await f.deploy(...ctorArgs);
    await c.waitForDeployment();
    state[key] = await c.getAddress();
    state.deployedAt ??= new Date().toISOString();
    save();
    console.log(`${name.padEnd(22)} ${state[key]}`);
    return c;
  }

  const engine = await ensure('engine', 'HoodlrzKidsEngine', []);
  const renderer = await ensure('renderer', 'HoodlrzKidsRenderer', [state.engine]);
  const kids = await ensure('nft', 'HoodlrzKids', [state.renderer, royaltyTo]);

  // La reprise fait gagner un deploiement ; elle peut aussi faire
  // reprendre le MAUVAIS. Si le nom grave dans le contrat retrouve ne
  // correspond plus a celui de la config, c'est que la collection a ete
  // renommee depuis - et continuer produirait des pieces au nom
  // d'hier, sans que rien ne le signale.
  const onChainName = await kids.name();
  if (onChainName !== config.collection.name) {
    fail(
      `Le contrat retrouve s appelle « ${onChainName} »,\n` +
      `or kids/config.json declare « ${config.collection.name} ».\n\n` +
      `La collection a ete renommee depuis ce deploiement. Pour repartir\n` +
      `d un contrat neuf :\n\n` +
      `    rm ${stateFile}\n` +
      `    npm run kids:deploy -- --${which}\n`
    );
  }

  // Meme piege avec le CODE : un contrat repris apres une modification
  // des sources est un contrat d'hier, sans les correctifs. Le moteur et
  // le NFT n'ont pas d'immutable, leur bytecode deploye doit donc etre
  // exactement celui que l'on vient de compiler. (Le renderer porte
  // l'adresse du moteur en immutable : on ne peut pas le comparer tel
  // quel, mais il est redeploye avec le moteur.)
  for (const [key, name] of [['engine', 'HoodlrzKidsEngine'], ['nft', 'HoodlrzKids']]) {
    const onChainCode = (await provider.getCode(state[key])).toLowerCase();
    if (onChainCode !== built[name].deployedBytecode.toLowerCase()) {
      fail(
        `Le bytecode de ${name} retrouve a ${state[key]}\n` +
        `n est pas celui des sources actuelles : les contrats ont change\n` +
        `depuis ce deploiement. Pour repartir de contrats neufs :\n\n` +
        `    rm ${stateFile}\n` +
        `    npm run kids:deploy -- --${which}\n`
      );
    }
  }

  state.royaltyReceiver = royaltyTo;
  state.reserveReceiver = reserveTo;
  save();
  console.log('');

  /* ---- 2. Televersement -------------------------------------------- */
  // L'avancement se lit sur la chaine. Un fichier local dirait ce qu'on
  // croit avoir fait ; chunkCounts() dit ce qui y est vraiment.
  const [donePre, donePost] = await engine.chunkCounts();
  const already = Number(donePre) + Number(donePost);
  const total = preChunks.length + postChunks.length;
  if (already) console.log(`${already}/${total} morceaux deja sur la chaine`);
  if (already < total) {
    console.log(`Televersement de ${manifest.storedBytes.toLocaleString('fr')} o en ${total} morceaux`);
  }

  /**
   * Envoie une transaction et attend son inclusion, en reessayant sur
   * une erreur de nonce.
   *
   * Un fournisseur RPC repartit les requetes sur plusieurs noeuds. Quand
   * l'un d'eux n'a pas encore vu la transaction precedente, il propose
   * le meme nonce, et le reseau repond « nonce has already been used ».
   * Rien n'est perdu - la premiere transaction est bien partie - mais le
   * script s'arretait la. On attend que les noeuds se rejoignent et on
   * recommence ; l'etat lu sur la chaine, lui, reste la seule verite.
   */
  const tx = async (fn, tries = 5) => {
    for (let i = 1; ; i++) {
      try {
        return await (await fn()).wait();
      } catch (e) {
        const msg = String(e.message ?? e);
        const nonce = /nonce/i.test(msg) && /(already|too low|used|replacement)/i.test(msg);
        if (!nonce || i >= tries) throw e;
        console.log(`  nonce en decalage entre les noeuds RPC, nouvel essai ${i}/${tries - 1} dans 6 s…`);
        await new Promise((r) => setTimeout(r, 6000));
      }
    }
  };

  let gasTotal = 0n;
  const send = async (isPre, data, label) => {
    const rc = await tx(() => engine.appendChunk(isPre, data));
    gasTotal += rc.gasUsed;
    console.log(`  ${label}  ${((data.length - 2) / 2).toLocaleString('fr')} o  gas ${rc.gasUsed.toLocaleString('fr')}`);
  };
  for (let i = Number(donePre); i < preChunks.length; i++) await send(true, preChunks[i], `pre  ${i}`);
  for (let i = Number(donePost); i < postChunks.length; i++) await send(false, postChunks[i], `post ${i}`);
  if (gasTotal > 0n) console.log(`  gas total ${(Number(gasTotal) / 1e6).toFixed(1)} M\n`);

  /* ---- 3. Verification AVANT scellement ---------------------------- */
  // Le scellement est irreversible. On relit ce que la chaine renvoie
  // reellement et on le compare a l'artefact local.
  const probe = '0x' + 'ab'.repeat(32);
  const onChain = await engine.documentFor(probe);
  const local = readFileSync('kids/engine/frozen.html', 'utf8').replace('__HASH__', probe);
  if (onChain !== local) {
    fail(`Le document reconstitue differe de l artefact local ` +
         `(${onChain.length} vs ${local.length} caracteres). ARRET AVANT SCELLEMENT.`);
  }
  console.log('Document reconstitue identique a l artefact gele');

  /* ---- 4. Scellement ------------------------------------------------ */
  if (await engine.sealed_()) {
    console.log('Moteur deja scelle\n');
  } else {
    await tx(() => engine.seal(artifactSha));
    state.artifactSha256 = artifactSha;
    state.storedBytes = manifest.storedBytes;
    save();
    console.log(`Moteur scelle   sha256 ${artifactSha}\n`);
  }

  /* ---- 5. Reserve --------------------------------------------------- */
  const RESERVE = Number(await kids.RESERVE());
  const LOT = 50;   // lots courts : une reprise coute moins cher qu un gros lot perdu
  let minted = Number(await kids.reserveMinted());
  if (minted >= RESERVE) {
    console.log(`Reserve deja mintee   ${minted}/${RESERVE}`);
  } else {
    while (minted < RESERVE) {
      const qty = Math.min(LOT, RESERVE - minted);
      await tx(() => kids.mintReserve(reserveTo, qty));
      // Relu sur la chaine, jamais additionne localement : si un essai a
      // reussi malgre l'erreur, le compteur le sait et on ne double pas.
      minted = Number(await kids.reserveMinted());
      console.log(`  reserve ${minted}/${RESERVE} -> ${reserveTo}`);
    }
  }
  save();

  console.log(`\nEcrit -> ${stateFile} et kids/config.json (section deployments)`);
  console.log(`
Contrats sur ${CH.explorer} :
  moteur    ${state.engine}
  renderer  ${state.renderer}
  NFT       ${state.nft}

Reste a faire, a la main et dans cet ordre :
  1. npm run kids:verify-chain      comparaison octet a octet depuis la chaine
  2. ouvrir le tokenURI d un token reserve sur une marketplace et
     controler vignette, animation et attributs
  3. verifier les 3 contrats sur l explorateur
     (entrees standard JSON dans kids/build/verify/)
  4. setAllowlistRoot(<racine du snapshot>)
  5. setPhases(...)                 npm run kids:phases donne l appel exact
  6. lockRenderer()                 seulement une fois le rendu valide
  7. apres le sold-out ou la fin de fenetre : npm run kids:reveal
     (startReveal puis finishReveal - n importe qui peut les passer)
`);
}

main().catch((e) => {
  console.error('\n  ECHEC\n  ' + String(e.message).split('\n').join('\n  ') + '\n');
  process.exitCode = 1;
});
