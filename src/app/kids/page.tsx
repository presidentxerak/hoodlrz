"use client";

/**
 * Page de drop Hoodlrz Gen Kids.
 *
 * Construite sur le meme squelette que la page de drop Hoodlrz
 * (/collection/hoodlrz) : hero video, statistiques, compte a rebours,
 * puis les explications. Un visiteur qui connait l'une doit se reperer
 * dans l'autre sans effort.
 *
 * Une difference de fond, qui commande la mise en page : une piece
 * Hoodlrz est une image fixe, une piece Kids est un programme qui tourne.
 * L'apercu n'est donc pas une vignette mais le moteur lui-meme, joue en
 * direct - c'est le seul moyen honnete de montrer ce qu'on achete.
 *
 * Tout ce qui depend de l'heure passe par un composant client monte
 * apres coup : la page est prerendue, et lire l'horloge au premier rendu
 * produirait une erreur d'hydratation.
 */

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Countdown from "@/components/ui/Countdown";
import EnginePreview from "@/components/kids/EnginePreview";
import MintPanel from "@/components/kids/MintPanel";
import {
  KIDS,
  PHASES,
  PHASE_ISO,
  KIDS_CHAIN,
  KIDS_ADDRESS,
  isDeployed,
  fmtDate,
  fmtDateTime,
  phaseAt,
} from "@/lib/kids/config";

export default function KidsPage() {
  return (
    <div className="flex flex-col items-center">
      <Hero />

      <div className="mx-auto w-full max-w-5xl px-4 pb-24">
        <Stats />
        <DropCountdown />
        <Preview />
        <Mint />
        <Schedule />
        <HowItWorks />
        <Details />
        <Faq />
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
            Mint on {KIDS_CHAIN.name}
          </span>
          <span className="text-[10px] text-white/40">chain ID {KIDS_CHAIN.id}</span>
        </div>

        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70 sm:text-base">
          {KIDS.maxSupply.toLocaleString("en-GB")} generative pieces. Not a
          picture stored somewhere — a rendering engine written into the
          blockchain itself. Every Kid redraws itself from its own seed, live,
          forever. Free mint on {KIDS_CHAIN.name} — not on Ethereum.
        </p>

        <div className="mt-6 flex flex-col items-center gap-1">
          <span className="text-[10px] uppercase tracking-widest text-white/50">
            Drop Date
          </span>
          <p className="font-hoodlrz text-2xl font-bold tracking-wider text-[#627eea] sm:text-3xl">
            {fmtDate(PHASE_ISO.publicStart).toUpperCase()}
          </p>
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
      <Stat label="Public" value={KIDS.publicSupply.toLocaleString("en-GB")} />
      <Stat label="Price" value="Free" />
      <Stat label="Per wallet" value={String(KIDS.maxPerWallet)} />
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
 *  Compte a rebours
 * ------------------------------------------------------------------ */

/**
 * Le compte a rebours vise la prochaine echeance, pas une date fixe :
 * une fois l'allowlist ouverte, afficher encore le snapshot n'aurait
 * plus de sens.
 *
 * La fin de mint n'est jamais visee. La fenetre court sur dix ans, et un
 * compteur a quatre chiffres de jours ne dit rien a personne.
 */
function DropCountdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  if (now === null) return <div className="mt-12 h-[90px]" aria-hidden />;

  const phase = phaseAt(now);

  const [target, label] =
    now < PHASES.snapshot
      ? [PHASE_ISO.snapshot, "Holder Snapshot"]
      : phase === "avant"
        ? [PHASE_ISO.allowlistStart, "Allowlist Opens"]
        : phase === "allowlist"
          ? [PHASE_ISO.publicStart, "Public Mint"]
          : [null, null];

  return (
    <div className="mt-12 flex flex-col items-center gap-6">
      {target && label ? (
        <Countdown targetDate={target} label={label} />
      ) : (
        <p className="font-hoodlrz text-3xl font-bold tracking-wider text-accent-red">
          {phase === "public" ? "MINT IS LIVE" : "MINT CLOSED"}
        </p>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="secondary" size="lg" href="/">
          OG Hoodlrz
        </Button>
        <Button variant="secondary" size="lg" href="/city">
          Enter the City
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Apercu
 * ------------------------------------------------------------------ */

function Preview() {
  return (
    <section className="mt-16">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-widest text-muted">
          Live Preview
        </h2>
        <span className="text-[10px] uppercase tracking-widest text-muted">
          Running the final engine
        </span>
      </div>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <EnginePreview />

        <div className="flex flex-col gap-4">
          <p className="text-sm leading-relaxed text-muted">
            Everything below the frame is drawn by code — the hood, the face,
            the hat, the backdrop, the equaliser, the punchline. Nothing is
            assembled from pre-made layers, and no image file exists anywhere.
            Roll the preview and you are running the exact program that will
            live in the contract.
          </p>
          <p className="text-sm leading-relaxed text-muted">
            Nine traits come out of each seed: hat, hat colour, hood colour,
            face, hair, backdrop, palette, equaliser colour and expression.
            They are derived on-chain too — the contract computes them from
            the token hash rather than reading them from a list.
          </p>

          {/* Les deux tirages supplementaires ont ete retires quand le
              hero est passe a trois pieces vivantes : six moteurs sur une
              meme page, c'est la batterie d'un telephone en quelques
              minutes. Le hero montre la variete, ce cadre-ci permet de
              relancer le tirage - les deux roles sont couverts. */}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Mint
 * ------------------------------------------------------------------ */

function Mint() {
  return (
    <section className="mt-16">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Mint
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        <MintPanel />

        <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted">
          <p className="border border-[var(--border)] border-l-2 border-l-[#c6f24e] bg-[var(--surface)] px-4 py-3">
            <strong className="text-foreground">
              This mint happens on {KIDS_CHAIN.name}, not on Ethereum.
            </strong>{" "}
            Chain ID {KIDS_CHAIN.id}. Your wallet must be on that network — the
            button below adds it for you if it is missing. Gas is paid in ETH
            bridged to {KIDS_CHAIN.name}.
          </p>
          <p>
            <strong className="text-foreground">Free mint.</strong> You pay
            network gas and nothing else. There is no presale, no tier, no
            paid whitelist.
          </p>
          <p>
            <strong className="text-foreground">
              {KIDS.maxPerWallet} per wallet.
            </strong>{" "}
            Deliberately low. With {KIDS.publicSupply.toLocaleString("en-GB")}{" "}
            pieces open to the public, that floor guarantees at least{" "}
            {Math.ceil(KIDS.publicSupply / KIDS.maxPerWallet).toLocaleString("en-GB")}{" "}
            distinct wallets rather than a handful of bots taking the lot.
          </p>
          <p>
            <strong className="text-foreground">Hoodlrz holders first.</strong>{" "}
            A snapshot is taken on {fmtDateTime(PHASE_ISO.snapshot)}. Every
            wallet holding a Hoodlrz at that block gets an hour of exclusive
            access, proven by a Merkle proof — the list is published as a file
            you can recompute yourself.
          </p>
          <p>
            <strong className="text-foreground">
              {KIDS.reserve} reserved for the creator.
            </strong>{" "}
            Minted before the public window opens, so the count you see is
            always the real one.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Calendrier
 * ------------------------------------------------------------------ */

function Schedule() {
  const rows: [string, string, string][] = [
    [
      "Holder snapshot",
      fmtDateTime(PHASE_ISO.snapshot),
      "Every wallet holding a Hoodlrz at this block enters the allowlist.",
    ],
    [
      "Allowlist mint",
      fmtDateTime(PHASE_ISO.allowlistStart),
      "One hour, reserved for the snapshot. Free, capped at " + KIDS.maxPerWallet + ".",
    ],
    [
      "Public mint",
      fmtDateTime(PHASE_ISO.publicStart),
      "Open to anyone. Same price, same cap.",
    ],
    [
      "Mint window closes",
      fmtDateTime(PHASE_ISO.mintEnd),
      "A long window on purpose. The reveal does not wait for it — see below.",
    ],
  ];

  return (
    <section className="mt-16">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Schedule
      </h2>
      <div className="border border-[var(--border)]">
        {rows.map(([name, when, note], i) => (
          <div
            key={name}
            className={`flex flex-col gap-1 p-5 sm:flex-row sm:items-baseline sm:gap-6 ${
              i > 0 ? "border-t border-[var(--border)]" : ""
            }`}
          >
            <span className="w-44 shrink-0 text-[10px] font-bold uppercase tracking-widest text-accent-red">
              {name}
            </span>
            <span className="w-52 shrink-0 font-mono text-sm tabular-nums text-foreground">
              {when}
            </span>
            <span className="text-sm leading-relaxed text-muted">{note}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        All times are Paris time. The contract compares against block
        timestamps in UTC; these are the same instants, written for humans.
      </p>
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

        <Explain title="Nobody knows what they are minting">
          Token hashes come from a single seed that does not exist while
          minting is open. It is fixed once — irreversibly — after the pieces
          have already found their owners, and the mint cannot reopen
          afterwards. Until then every token shows a placeholder. Nobody,
          including me, can look at the art and decide which token to buy.
        </Explain>

        <Explain title="Nobody picks the seed either">
          The reveal takes two steps, and anyone can trigger both. First a
          call commits to a block that does not exist yet, ten parent-chain
          blocks ahead. Then, once that block is there, a second call reads
          its hash and fixes the seed from it. Whoever presses the button
          cannot know the outcome, and a reveal that is abandoned to try again
          leaves a public trace on-chain. The remaining trust sits with the
          chain&apos;s sequencer, which produces those hashes — the same trust
          you already place in it for every transaction here.
        </Explain>

        <Explain title="The reveal does not wait ten years">
          The mint window runs until {fmtDate(PHASE_ISO.mintEnd)} at the
          latest. It ends at whichever comes first: the last of the{" "}
          {KIDS.maxSupply.toLocaleString("en-GB")} pieces being minted, that
          date, or the creator closing the mint. Closing it is a one-way door
          — pieces left unminted never exist, and the collection settles at
          whatever was actually claimed. The reveal date is announced by the
          creator, at most thirty days after the mint ends; past that, anyone
          can trigger it.
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

/* ------------------------------------------------------------------ *
 *  Questions
 * ------------------------------------------------------------------ */

function Faq() {
  const items: [string, React.ReactNode][] = [
    [
      "What exactly do I own?",
      <>
        A token whose artwork is a program stored in the contract. Ask the
        contract for your <code className="font-mono text-xs">tokenURI</code>{" "}
        and you get back the metadata and a full HTML page, encoded inline. No
        link points anywhere else.
      </>,
    ],
    [
      "Is it really free?",
      <>
        Yes. The mint function takes no payment. You pay the network fee for
        your own transaction, as with any on-chain action.
      </>,
    ],
    [
      "How do I get on the allowlist?",
      <>
        Hold a Hoodlrz at the snapshot on {fmtDateTime(PHASE_ISO.snapshot)}.
        Nothing to sign up for, nothing to claim in advance. The list is built
        from the chain and published as a file — you can rebuild the Merkle
        root yourself and check that your wallet is in it.
      </>,
    ],
    [
      "Why is the mint window ten years long?",
      <>
        The window is a backstop, not a schedule. The mint ends when the
        collection sells out, or when the creator closes it — at that point
        the pieces nobody claimed simply never exist. The reveal follows on
        a date the creator announces, thirty days after the close at most.
      </>,
    ],
    [
      "Can the art change later?",
      <>
        The engine bytes are frozen and their SHA-256 is recorded. The renderer
        address can be locked irreversibly once the output has been verified
        from the chain, and that is the plan. Until it is locked, treat the
        collection as still being set up.
      </>,
    ],
    [
      "Will it show on OpenSea?",
      <>
        Metadata follows the standard: name, description, attributes,{" "}
        <code className="font-mono text-xs">image</code> as an SVG poster and{" "}
        <code className="font-mono text-xs">animation_url</code> as the live
        page. Whether a given marketplace indexes {KIDS_CHAIN.name} is up to
        that marketplace.
      </>,
    ],
  ];

  return (
    <section className="mt-16">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Questions
      </h2>
      <div className="flex flex-col gap-5">
        {items.map(([q, a]) => (
          <div key={q} className="border-b border-[var(--border)] pb-5 last:border-0">
            <p className="text-sm font-bold text-foreground">{q}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted">{a}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
