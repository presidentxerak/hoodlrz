/**
 * Configuration Hoodlrz Gen Kids exposee au navigateur.
 *
 * Les parametres de collection et les dates viennent de kids/config.json,
 * source unique partagee avec les scripts de deploiement : une date
 * changee la-bas se propage ici sans recopie.
 *
 * L'adresse du contrat vient du meme fichier, section « deployments »,
 * choisie selon la chaine ; une variable d'environnement peut la forcer.
 */

import raw from "../../../kids/config.json";
const kidsConfig = raw as typeof raw & { deployments?: unknown };

export const KIDS = {
  name: raw.collection.name,
  symbol: raw.collection.symbol,
  maxSupply: raw.collection.maxSupply,
  reserve: raw.collection.reserve,
  maxPerWallet: raw.collection.maxPerWallet,
  royaltyBps: raw.collection.royaltyBps,
  /** Disponible au public = supply totale moins la reserve createur. */
  publicSupply: raw.collection.maxSupply - raw.collection.reserve,
} as const;

/** Timestamps UNIX (secondes), comme les attend le contrat. */
const ts = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

export const PHASES = {
  snapshot: ts(raw.phases.snapshotParis),
  allowlistStart: ts(raw.phases.allowlistStartParis),
  publicStart: ts(raw.phases.publicStartParis),
  mintEnd: ts(raw.phases.mintEndParis),
} as const;

export type Phase = "avant" | "allowlist" | "public" | "termine";

export function phaseAt(nowSeconds: number): Phase {
  if (nowSeconds < PHASES.allowlistStart) return "avant";
  if (nowSeconds < PHASES.publicStart) return "allowlist";
  if (nowSeconds < PHASES.mintEnd) return "public";
  return "termine";
}

/**
 * Dates telles qu'annoncees au public, en heure de Paris.
 *
 * Le fuseau est force plutot que laisse au navigateur : la page est
 * prerendue, et un formatage dependant du fuseau donnerait un HTML
 * serveur different du premier rendu client - donc une erreur
 * d'hydratation. Toutes les heures affichees sont donc celles de Paris,
 * et le libelle le dit.
 */
export const PARIS = "Europe/Paris";

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    timeZone: PARIS, day: "numeric", month: "long", year: "numeric",
  });
}

export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: PARIS, day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }) + " CET";
}

/** Chaines ISO d'origine, pour l'affichage. */
export const PHASE_ISO = {
  snapshot: raw.phases.snapshotParis,
  allowlistStart: raw.phases.allowlistStartParis,
  publicStart: raw.phases.publicStartParis,
  mintEnd: raw.phases.mintEndParis,
} as const;

/* ------------------------------------------------------------------ *
 *  Chaine
 * ------------------------------------------------------------------ */

/**
 * Robinhood Chain. Valeurs confirmees le 22/08/2026 sur
 * docs.robinhood.com/chain, page « Connecting to Robinhood Chain ».
 *
 * Le RPC public sert de defaut parce qu'il ne demande aucune cle et que
 * cette page est servie a tout le monde. La doc le dit rate-limited et
 * deconseille en production : NEXT_PUBLIC_KIDS_RPC_URL permet de lui
 * substituer un endpoint Alchemy le jour du mint, sans toucher au code.
 */
export const RH_CHAINS = {
  mainnet: {
    id: 4663,
    name: "Robinhood Chain",
    rpc: "https://rpc.mainnet.chain.robinhood.com",
    explorer: "https://robinhoodchain.blockscout.com",
  },
  testnet: {
    id: 46630,
    name: "Robinhood Chain Testnet",
    rpc: "https://rpc.testnet.chain.robinhood.com",
    explorer: "https://explorer.testnet.chain.robinhood.com",
  },
} as const;

const DEFAULT_CHAIN =
  process.env.NEXT_PUBLIC_KIDS_NETWORK === "testnet"
    ? RH_CHAINS.testnet
    : RH_CHAINS.mainnet;

export const KIDS_CHAIN = {
  id: Number(process.env.NEXT_PUBLIC_KIDS_CHAIN_ID ?? DEFAULT_CHAIN.id),
  name: process.env.NEXT_PUBLIC_KIDS_CHAIN_NAME ?? DEFAULT_CHAIN.name,
  rpcUrl: process.env.NEXT_PUBLIC_KIDS_RPC_URL ?? DEFAULT_CHAIN.rpc,
  explorerUrl: process.env.NEXT_PUBLIC_KIDS_EXPLORER_URL ?? DEFAULT_CHAIN.explorer,
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
} as const;

/**
 * Adresse du contrat NFT.
 *
 * Lue dans kids/config.json, section « deployments », que kids:deploy
 * remplit et qui est versionnee : la page de mint pointe ainsi vers le
 * contrat reellement deploye sans qu'une variable d'environnement ait a
 * etre posee sur l'hebergeur - une etape de plus, un jour de mint, est
 * une occasion de plus de pointer vers le mauvais contrat. La variable
 * reste possible pour forcer une autre adresse (test, preview).
 */
type Deployments = Record<string, { nft?: string | null } | string[] | undefined>;
const deployed = (kidsConfig.deployments as Deployments | undefined)?.[String(KIDS_CHAIN.id)];
const DEPLOYED_ADDRESS =
  deployed && !Array.isArray(deployed) && typeof deployed.nft === "string" ? deployed.nft : "";

export const KIDS_ADDRESS = process.env.NEXT_PUBLIC_KIDS_ADDRESS ?? DEPLOYED_ADDRESS;

/** Collection d'origine, quand la collection courante est une v2 qui
 *  l'a redistribuee. Vide sinon. */
export const KIDS_ORIGIN_ADDRESS =
  deployed && !Array.isArray(deployed) && typeof (deployed as { origin?: unknown }).origin === "string"
    ? ((deployed as { origin: string }).origin)
    : "";

export const isDeployed = () => /^0x[a-fA-F0-9]{40}$/.test(KIDS_ADDRESS);

/** Page de la collection sur OpenSea. */
export const KIDS_OPENSEA_URL = "https://opensea.io/collection/hoodlrzgenkids";

/** Page d'une piece sur OpenSea (identifiant de chaine tel qu'OpenSea le
 *  met dans ses URL d'items). */
export const kidsOpenSeaItemUrl = (id: number) =>
  `https://opensea.io/item/robinhood/${KIDS_ADDRESS}/${id}`;

/** Page d'une piece sur l'explorateur de la chaine. */
export const kidsTokenUrl = (id: number) =>
  `${KIDS_CHAIN.explorerUrl}/token/${KIDS_ADDRESS}/instance/${id}`;

/** Parametres au format attendu par wallet_addEthereumChain. */
export function chainParams() {
  return {
    chainId: "0x" + KIDS_CHAIN.id.toString(16),
    chainName: KIDS_CHAIN.name,
    nativeCurrency: KIDS_CHAIN.currency,
    rpcUrls: KIDS_CHAIN.rpcUrl ? [KIDS_CHAIN.rpcUrl] : [],
    blockExplorerUrls: [KIDS_CHAIN.explorerUrl],
  };
}
