/**
 * Publie le code source des contrats sur l'explorateur Blockscout.
 *
 * POURQUOI CA COMPTE
 * Une collection qui se presente comme integralement on-chain et dont les
 * contrats n'affichent que du bytecode illisible dit exactement le
 * contraire de son message - et n'importe qui peut le constater. La
 * verification est ce qui permet a un tiers de relire le code, de
 * recompiler, et de confirmer que l'octet deploye correspond a la source
 * publiee. Sans elle, « verifiable par tous » est un slogan.
 *
 * COMMENT
 * Blockscout recompile l'entree standard JSON de solc et compare le
 * bytecode obtenu a celui de la chaine. On lui envoie donc exactement ce
 * que kids:deploy a mis de cote au moment de la compilation - meme
 * compilateur epingle, memes reglages, memes sources - plutot que de
 * reconstituer ces reglages de memoire six mois plus tard.
 *
 * Les arguments de constructeur sont deduits du deploiement enregistre :
 * le renderer prend l'adresse du moteur, le NFT celles du renderer et du
 * beneficiaire des royalties.
 *
 * Usage :
 *   npm run kids:verify-contracts -- --testnet
 *   npm run kids:verify-contracts -- --mainnet
 *   npm run kids:verify-contracts -- --testnet --only HoodlrzKids
 */

import './env.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { AbiCoder } from 'ethers';

const CHAINS = {
  testnet: { id: 46630, explorer: 'https://explorer.testnet.chain.robinhood.com' },
  mainnet: { id: 4663, explorer: 'https://robinhoodchain.blockscout.com' },
};

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d = null) => {
  const i = args.indexOf(f);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const which = has('--mainnet') ? 'mainnet' : has('--testnet') ? 'testnet' : null;
if (!which) {
  console.error('\n  Choisir un reseau : --testnet ou --mainnet\n');
  process.exit(2);
}
const CH = CHAINS[which];
const base = (process.env[`RH_${which.toUpperCase()}_EXPLORER`] || CH.explorer).replace(/\/$/, '');

const cfg = JSON.parse(readFileSync('kids/config.json', 'utf8'));
const dep = cfg.deployments?.[CH.id];
if (!dep?.nft) {
  console.error(`\n  Aucun deploiement enregistre pour le chain ID ${CH.id}.` +
                `\n  Lancer d'abord : npm run kids:deploy -- --${which}\n`);
  process.exit(2);
}

const coder = AbiCoder.defaultAbiCoder();

/**
 * Beneficiaire des royalties tel qu'il a ete passe au constructeur.
 *
 * Les premiers deploiements ne l'enregistraient pas : on retombe alors
 * sur la configuration, en le disant. Ce repli n'est juste que si
 * l'adresse n'a pas change depuis - d'ou l'avertissement plutot qu'un
 * silence.
 */
let royaltyTo = dep.royaltyReceiver;
if (!royaltyTo) {
  royaltyTo = cfg.addresses?.royaltyReceiver;
  if (!royaltyTo) {
    console.error(`
  Le beneficiaire des royalties est introuvable : ni dans le deploiement
  enregistre, ni dans kids/config.json. Il a ete passe au constructeur du
  NFT, et sans lui les arguments ne peuvent pas etre reencodes.

  Redeployer l'enregistre desormais :
    npm run kids:deploy -- --${which}
`);
    process.exit(2);
  }
  console.log(`  Note : le deploiement enregistre ne contient pas le beneficiaire`);
  console.log(`  des royalties. Repli sur kids/config.json : ${royaltyTo}`);
  console.log(`  Si cette adresse a change depuis le deploiement, la verification`);
  console.log(`  du NFT echouera sur les arguments de constructeur.\n`);
}

/** Arguments de constructeur, encodes, tels que passes au deploiement. */
const CONTRATS = [
  { name: 'HoodlrzKidsEngine', address: dep.engine, ctor: '0x' },
  {
    name: 'HoodlrzKidsRenderer',
    address: dep.renderer,
    ctor: coder.encode(['address'], [dep.engine]),
  },
  {
    name: 'HoodlrzKids',
    address: dep.nft,
    ctor: coder.encode(['address', 'address'], [dep.renderer, royaltyTo]),
  },
];

const only = val('--only');
const cibles = only ? CONTRATS.filter((c) => c.name === only) : CONTRATS;
if (!cibles.length) {
  console.error(`\n  Contrat inconnu : ${only}\n  Choix : ${CONTRATS.map((c) => c.name).join(', ')}\n`);
  process.exit(2);
}

console.log(`\nVerification des contrats sur Blockscout`);
console.log(`  reseau      ${CH.id}`);
console.log(`  explorateur ${base}\n`);

let echecs = 0;

for (const c of cibles) {
  const file = `kids/build/verify/${c.name}.json`;
  if (!existsSync(file)) {
    console.log(`  ${c.name.padEnd(22)} ECHEC   ${file} absent`);
    console.log(`  ${''.padEnd(22)}        npm run kids:deploy -- --${which} --dry le regenere\n`);
    echecs++;
    continue;
  }
  const art = JSON.parse(readFileSync(file, 'utf8'));

  // Blockscout attend le nom pleinement qualifie : chemin:contrat.
  const fq = `${art.sourceName}:${c.name}`;
  const body = new FormData();
  body.append('compiler_version', 'v' + art.solcVersion);
  body.append('contract_name', fq);
  body.append('license_type', 'mit');
  body.append('files[0]', new Blob([JSON.stringify(art.input)], { type: 'application/json' }),
              `${c.name}.json`);
  // Sans arguments, le champ doit rester absent : une chaine vide est
  // interpretee comme « des arguments, mais vides », et la comparaison
  // de bytecode echoue alors sur les contrats sans constructeur.
  if (c.ctor !== '0x') body.append('constructor_args', c.ctor);
  else body.append('autodetect_constructor_args', 'true');

  const url = `${base}/api/v2/smart-contracts/${c.address}/verification/via/standard-input`;

  process.stdout.write(`  ${c.name.padEnd(22)} envoi…`);
  try {
    // L'explorateur mainnet est derriere une protection anti-robots qui
    // renvoie une page HTML 403 aux clients sans identite de navigateur.
    const r = await fetch(url, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(60000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
        accept: 'application/json',
      },
    });
    const txt = await r.text();
    let j = null;
    try { j = JSON.parse(txt); } catch { /* Blockscout repond parfois en texte */ }

    if (r.ok) {
      console.log(`\r  ${c.name.padEnd(22)} soumis  ${j?.message ?? 'en file de traitement'}`);
      console.log(`  ${''.padEnd(22)}         ${base}/address/${c.address}#code`);
    } else {
      // Deja verifie n'est pas un echec : c'est le resultat voulu.
      const deja = /already verified/i.test(txt);
      console.log(`\r  ${c.name.padEnd(22)} ${deja ? 'DEJA VERIFIE' : 'ECHEC'}   HTTP ${r.status}`);
      if (!deja) {
        const html = /^\s*<!doctype html/i.test(txt);
        console.log(`  ${''.padEnd(22)}        ${html ? 'page HTML renvoyee : acces API refuse (protection anti-robots)' : (j?.message ?? txt).slice(0, 180)}`);
        echecs++;
      }
    }
  } catch (e) {
    console.log(`\r  ${c.name.padEnd(22)} ECHEC   ${String(e.message).slice(0, 120)}`);
    echecs++;
  }
  console.log('');
}

console.log(`
La verification est asynchrone : Blockscout recompile de son cote, ce qui
prend de quelques secondes a quelques minutes. Recharger la page #code de
chaque contrat pour voir le resultat.

  moteur    ${base}/address/${dep.engine}#code
  renderer  ${base}/address/${dep.renderer}#code
  NFT       ${base}/address/${dep.nft}#code
`);

if (echecs) {
  // Le meme fichier se depose a la main dans le formulaire de
  // l'explorateur : c'est exactement ce que l'API aurait recu.
  const art = JSON.parse(readFileSync(`kids/build/verify/${CONTRATS[0].name}.json`, 'utf8'));
  console.log(`A la main, si l API refuse : sur chaque page ci-dessus, onglet Contract,
bouton « Verify & publish », methode « Solidity (Standard JSON input) ».

  compilateur   v${art.solcVersion.split('+')[0]}+commit.${art.solcVersion.split('commit.')[1]?.split('.')[0]}
  licence       MIT
  fichier       kids/build/verify/<Contrat>.json
  arguments     laisser la detection automatique, ou coller :
`);
  for (const c of cibles) {
    console.log(`    ${c.name.padEnd(22)} ${c.ctor === '0x' ? '(aucun)' : c.ctor}`);
  }
  console.log('');
}

process.exit(echecs ? 1 : 0);
