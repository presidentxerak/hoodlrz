"use client";

/**
 * Page de la collection Hoodlrz Gen Kids.
 *
 * Le mint est passe : la page qui servait de drop (compte a rebours,
 * panneau de mint, calendrier) devient la page de la collection, sur le
 * meme squelette que la galerie OG - hero vivant, statistiques, galerie
 * filtrable, puis les explications qui font la valeur de l'oeuvre.
 *
 * Une piece Kids est un programme qui tourne : les vignettes sont des
 * decoupes de planches peintes par le moteur (kids:index), et chaque
 * piece ouverte se joue dans le moteur lui-meme, en direct.
 */

import Button from "@/components/ui/Button";
import EnginePreview from "@/components/kids/EnginePreview";
import Collection from "@/components/kids/Collection";
import {
  KIDS,
  KIDS_CHAIN,
  KIDS_ADDRESS,
  KIDS_OPENSEA_URL,
  isDeployed,
} from "@/lib/kids/config";

export default function KidsPage() {
  return (
    <div className="flex flex-col items-center">
      <Hero />

      <div className="mx-auto w-full max-w-6xl px-4 pb-24">
        <Stats />
        <Gallery />
        <HowItWorks />
        <Details />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Hero
 * ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative flex min-h-[50vh] w-full flex-col items-center justify-center overflow-hidden px-4 pb-16 pt-20 sm:pb-20 sm:pt-28">
      {/* Trois pieces vivantes plutot qu'une video : le fond EST la
          collection, joue par le moteur qui partira on-chain. Sur mobile
          la troisieme sort du cadre - deux suffisent a poser l'ambiance
          sans ecraser un petit ecran. */}
      <div className="absolute inset-0 grid grid-cols-2 sm:grid-cols-3" aria-hidden>
        <EnginePreview fill bare />
        <EnginePreview fill bare />
        <div className="hidden sm:block h-full">
          <EnginePreview fill bare />
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" />
      {/* Un voile plus dense derriere le texte seul. A 40 % uniformes,
          une punchline claire passant sous un mot le rend illisible ;
          concentrer l'ombre au centre garde les pieces visibles sur les
          bords tout en rendant le titre lisible partout. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 65% at 50% 50%, rgba(0,0,0,.78), rgba(0,0,0,0) 75%)" }}
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center gap-4 text-center">
        <div className="flex flex-wrap items-center justify-center gap-3">
          <h1 className="font-hoodlrz text-[36px] font-bold leading-none tracking-wider text-white sm:text-[56px]">
            Hoodlrz Gen Kids
          </h1>
          <span className="border border-[#627eea]/30 bg-[#627eea]/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-[#627eea]">
            Fully On-Chain
          </span>
        </div>

        {/* La chaine, en evidence des le hero. Un visiteur qui arrive de la
            collection OG est sur Ethereum dans sa tete : ne l'apprendre
            qu'au moment de signer serait le perdre au pire moment. */}
        <div className="mt-1 flex items-center gap-2 border border-[#c6f24e]/40 bg-[#c6f24e]/10 px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-widest text-[#c6f24e]">
            Live on {KIDS_CHAIN.name}
          </span>
          <span className="text-[10px] text-white/40">chain ID {KIDS_CHAIN.id}</span>
        </div>

        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">
          {KIDS.maxSupply.toLocaleString("en-GB")} generative pieces. Not a
          picture stored somewhere — a rendering engine written into the
          blockchain itself. Every Kid redraws itself from its own seed, live,
          forever. Minted on {KIDS_CHAIN.name} — not on Ethereum.
        </p>

        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button variant="primary" size="lg" href={KIDS_OPENSEA_URL}>
            View on OpenSea
          </Button>
          <Button variant="secondary" size="lg" href="#collection">
            Browse the collection
          </Button>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Statistiques
 * ------------------------------------------------------------------ */

function Stats() {
  return (
    <div className="mt-10 flex flex-wrap justify-center gap-8">
      <Stat label="Supply" value={KIDS.maxSupply.toLocaleString("en-GB")} />
      <Stat label="Traits" value="9" />
      <Stat label="Storage" value="On-chain" />
      <Stat label="Royalties" value={`${KIDS.royaltyBps / 100}%`} />
      <Stat label="Chain" value={KIDS_CHAIN.name.replace(" Chain", "")} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
        {label}
      </span>
      <span className="font-hoodlrz text-2xl font-bold leading-none text-foreground">
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Collection
 * ------------------------------------------------------------------ */

function Gallery() {
  return (
    <section id="collection" className="mt-16 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
            The collection
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
            Every piece, drawn by the engine stored in the contract. Filter by
            trait, sort by rarity, open one to see it live — animated and
            interactive, exactly as it renders on OpenSea.
          </p>
        </div>
        <Button variant="secondary" size="md" href={KIDS_OPENSEA_URL}>
          Trade on OpenSea
        </Button>
      </div>
      <Collection />
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Comment ca marche
 * ------------------------------------------------------------------ */

function HowItWorks() {
  return (
    <section className="mt-16">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        How It Works
      </h2>

      <div className="flex flex-col gap-4">
        <Explain title="The engine lives in the contract">
          The rendering program — the whole thing, roughly 116 KB of it — is
          split into chunks and written into the chain with SSTORE2. When a
          marketplace asks for your token, the contract reassembles the
          program, injects your token&apos;s hash into it, and hands back a
          complete page. No IPFS, no server of mine, nothing to keep paying
          for. If this site disappears, your Kid still renders.
        </Explain>

        <Explain title="Your traits are computed, not stored">
          Nothing about your piece is written down anywhere. The contract
          derives all nine traits from your token hash using the same
          arithmetic the JavaScript engine uses — the same pseudo-random
          generator, reproduced in Solidity down to its 32-bit overflow
          behaviour. Both sides were run over all{" "}
          {KIDS.maxSupply.toLocaleString("en-GB")} pieces and compared
          one by one before anything was deployed.
        </Explain>

        <Explain title="Nobody knew what they were minting">
          Token hashes come from a single seed that did not exist while
          minting was open. It was fixed once — irreversibly — after the
          pieces had already found their owners, and the mint cannot reopen.
          Until then every token showed the same placeholder. Nobody,
          including me, could look at the art and decide which token to keep.
        </Explain>

        <Explain title="Nobody picked the seed either">
          The reveal takes two steps, and anyone can trigger both. First a
          call commits to a block that does not exist yet, ten parent-chain
          blocks ahead. Then, once that block is there, a second call reads
          its hash and fixes the seed from it. Whoever presses the button
          cannot know the outcome, and a reveal abandoned to try again leaves
          a public trace on-chain. The remaining trust sits with the
          chain&apos;s sequencer, which produces those hashes — the same trust
          you already place in it for every transaction here.
        </Explain>

        <Explain title="Where it lives">
          {KIDS_CHAIN.name}. That chain is young: its sequencer is centralised
          and its system contracts remain upgradable by its operator. So the
          honest claim is this — the work is <em>entirely on-chain</em>, which
          anyone can verify, rather than <em>immutable forever</em>, which
          nobody could promise here. The engine and its SHA-256 fingerprint
          are archived off-chain as well, which means the piece can be
          redeployed identically elsewhere if it ever needs to be.
        </Explain>
      </div>
    </section>
  );
}

function Explain({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border border-[var(--border)] border-l-2 border-l-[#627eea] bg-[var(--surface)] p-5">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="text-sm leading-relaxed text-muted">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Details
 * ------------------------------------------------------------------ */

function Details() {
  const rows: [string, string][] = [
    ["Chain", `${KIDS_CHAIN.name} (ID ${KIDS_CHAIN.id})`],
    ["Price", "Free"],
    ["Gas fees", `Network gas (${KIDS_CHAIN.name})`],
    ["Wallet", "MetaMask / any EIP-1193 wallet"],
    ["Standard", "ERC-721"],
    ["Storage", "Fully on-chain (SSTORE2)"],
    ["Metadata", "Built on-chain, base64 data URI"],
    ["Artwork", "HTML canvas engine, animated"],
    ["Supply", `${KIDS.maxSupply.toLocaleString("en-GB")} (${KIDS.reserve} creator reserve)`],
    ["Per wallet", String(KIDS.maxPerWallet)],
    ["Allowlist", "Hoodlrz holders, Merkle proof"],
    ["Royalties", `${KIDS.royaltyBps / 100}% (EIP-2981)`],
    ["Typeface", "Custom, owned outright"],
  ];

  return (
    <section className="mt-16">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Details
      </h2>
      <div className="flex flex-col gap-3 border border-[var(--border)] p-6">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-6 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
          >
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              {label}
            </span>
            <span className="text-right text-sm font-bold text-foreground">{value}</span>
          </div>
        ))}
        {isDeployed() && (
          // L'adresse est ce qu'un collectionneur doit pouvoir verifier
          // lui-meme : elle mene a l'explorateur, ou le code source est
          // publie, pas a une page a nous.
          <div className="flex items-center justify-between gap-6 border-t border-[var(--border)] pt-3">
            <span className="text-xs font-bold uppercase tracking-widest text-muted">
              Contract
            </span>
            <a
              href={`${KIDS_CHAIN.explorerUrl}/address/${KIDS_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-right font-mono text-xs font-bold text-foreground underline decoration-white/30 underline-offset-4 hover:decoration-white"
            >
              {KIDS_ADDRESS}
            </a>
          </div>
        )}
      </div>
    </section>
  );
}
