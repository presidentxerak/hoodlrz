"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import Button from "@/components/ui/Button";
import FaqAccordion from "@/components/ui/FaqAccordion";
import EnginePreview from "@/components/kids/EnginePreview";
import { HOODLRZ_FAQ } from "@/lib/faq";
import { KIDS, KIDS_CHAIN, KIDS_OPENSEA_URL, PHASE_ISO, fmtDate } from "@/lib/kids/config";
import { HOODLRZ_OPENSEA_URL } from "@/lib/web3/config";

const STREET_SUPPLY = 333;
const ITEMS_PER_PAGE = 24;

interface TraitAttribute {
  trait_type: string;
  value: string | number;
}

interface CollectionToken {
  tokenId: number;
  name: string;
  image: string;
  attributes: TraitAttribute[];
}

interface CollectionPayload {
  tokens: CollectionToken[];
  totalSupply: number;
  facets: Record<string, string[]>;
  contract: string;
  chainId: number;
  error?: string;
}

function openseaUrl(contract: string, tokenId: number) {
  return `https://opensea.io/assets/ethereum/${contract}/${tokenId}`;
}

/**
 * La galerie des 333 pieces, avec ses filtres par trait, est mise en
 * sommeil : OpenSea fait le meme travail, en mieux tenu a jour, et sans
 * qu'on ait a maintenir l'indexation. Le composant reste en place, pret
 * a revenir - c'est un interrupteur, pas une suppression.
 */
const SHOW_ONCHAIN_GALLERY = false;

export default function HomePage() {
  return (
    <div className="flex flex-col items-center">
      <Hero />
      <div className="mx-auto w-full max-w-5xl px-4 pb-24">
        <OgHoodlrz />
        <Universe />
        <SiteMap />
        <Faq />
      </div>
      {SHOW_ONCHAIN_GALLERY && <Collection />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Compte a rebours du drop
 * ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ *
 *  OG Hoodlrz
 * ------------------------------------------------------------------ */

/**
 * La collection d'origine, presentee et non plus parcourue.
 *
 * La grille des 333 pieces avec ses filtres par trait est en sommeil :
 * OpenSea fait le meme travail, mieux tenu a jour, sans qu'on ait a
 * maintenir une indexation. On garde ici ce qu'OpenSea ne dira pas -
 * d'ou vient la collection et ce qu'elle est.
 */
function OgHoodlrz() {
  return (
    <section className="mt-16">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
        The original collection
      </p>
      <h2 className="font-hoodlrz mt-2 text-3xl font-bold tracking-wider text-foreground sm:text-4xl">
        OG Hoodlrz
      </h2>

      <div className="mt-6 grid gap-8 md:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted">
          <p>
            {STREET_SUPPLY} hand-drawn hooded identities, minted as a standard
            ERC-721 on Ethereum. No two alike, no generator — every piece was
            drawn by hand, one at a time.
          </p>
          <p>
            They are the origin of everything else here. Holding one is what
            puts you on the allowlist for Gen Kids, and what opens the doors
            in the City.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Button variant="primary" size="lg" href={HOODLRZ_OPENSEA_URL}>
              View on OpenSea
            </Button>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 self-start border border-[var(--border)] p-6">
          <Stat label="Supply" value={String(STREET_SUPPLY)} />
          <Stat label="Chain" value="Ethereum" />
          <Stat label="Standard" value="ERC-721" />
          <Stat label="Artwork" value="Hand-drawn" />
        </dl>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  L'univers
 * ------------------------------------------------------------------ */

function Universe() {
  return (
    <section className="mt-20">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        What Hoodlrz is
      </h2>

      <div className="flex flex-col gap-5 text-sm leading-relaxed text-muted">
        <p className="text-base text-foreground">
          Hoodlrz is not a PFP collection. It is a universe of hooded
          alter-egos born from the streets and the walls — handmade art,
          underground culture, animated storytelling and internet rebellion
          fused into collectible identities.
        </p>
        <p>
          The influences run deep. XCOPY, Rektguy and CryptoSkulls for the
          hypnotic loops and emotional distortion. Basquiat for raw symbolic
          expression and graffiti energy. KAWS for iconic collectible
          character identity. Banksy for the anonymous, anti-establishment
          spirit that runs through every piece.
        </p>
        <p>
          Musically and culturally shaped by Aphex Twin, Travis Scott,
          Wu-Tang Clan and MF DOOM. Every character is a world. Every holder
          carries a piece of that world.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Ce que contient le site
 * ------------------------------------------------------------------ */

/**
 * Une carte du site plutot qu'un menu de plus. Quatre choses vivent ici
 * et n'ont rien a voir entre elles : deux collections, des objets
 * physiques et un jeu. Sans cette section, un visiteur qui arrive par la
 * page d'accueil ne decouvre les trois autres que par hasard.
 */
function SiteMap() {
  const places: { href: string; title: string; desc: string; tag?: string }[] = [
    {
      href: "/kids",
      title: "Gen Kids",
      tag: KIDS_CHAIN.name,
      desc: `${KIDS.maxSupply.toLocaleString("en-GB")} generative pieces, free mint. The rendering engine itself lives inside the blockchain.`,
    },
    {
      href: "/genesis",
      title: "Genesis Vinyl",
      tag: "25 pieces",
      desc: "Hand-crafted vinyl artworks across three editions. You choose the tracks and their order on each side.",
    },
    {
      href: "/city",
      title: "Hoodlrz City",
      tag: "Beta",
      desc: "A playable city. Explore it, earn Hoodz, and claim rewards from the treasury.",
    },
    {
      href: "/my-collection",
      title: "My Collection",
      desc: "Connect a wallet to see the Hoodlrz you hold, across every collection.",
    },
  ];

  return (
    <section className="mt-20">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        What&apos;s here
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {places.map((p) => (
          <Link
            key={p.href}
            href={p.href}
            className="group flex flex-col gap-2 border border-[var(--border)] p-5 transition-colors hover:border-accent-red"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-hoodlrz text-xl font-bold tracking-wider text-foreground">
                {p.title}
              </span>
              {p.tag && (
                <span className="shrink-0 text-[10px] uppercase tracking-widest text-muted">
                  {p.tag}
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-muted">{p.desc}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 *  Questions
 * ------------------------------------------------------------------ */

function Faq() {
  return (
    <section className="mt-20">
      <h2 className="mb-6 text-xs font-bold uppercase tracking-widest text-muted">
        Questions
      </h2>
      <FaqAccordion items={HOODLRZ_FAQ} defaultOpen={-1} />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</dt>
      <dd className="font-hoodlrz mt-1 text-xl font-bold leading-none text-foreground">{value}</dd>
    </div>
  );
}

function Hero() {
  return (
    <section className="relative flex w-full flex-col items-center justify-center gap-6 px-4 pt-20 pb-16 sm:pt-28 sm:pb-20 overflow-hidden min-h-[70vh]">
      {/* Meme traitement que le hero Gen Kids : le fond EST la collection,
          jouee par le moteur qui partira on-chain, plutot qu'une video.
          Sur mobile la troisieme piece sort du cadre - deux suffisent a
          poser l'ambiance sans ecraser un petit ecran. */}
      <div className="absolute inset-0 grid grid-cols-2 sm:grid-cols-3" aria-hidden>
        <EnginePreview fill bare />
        <EnginePreview fill bare />
        <div className="hidden h-full sm:block">
          <EnginePreview fill bare />
        </div>
      </div>
      <div className="absolute inset-0 bg-black/40" />
      {/* Ombre concentree derriere le contenu. A 40 % uniformes, une
          punchline claire passant sous un mot le rend illisible. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse 70% 70% at 50% 50%, rgba(0,0,0,.8), rgba(0,0,0,0) 78%)" }}
        aria-hidden
      />

      {/* La marque d'abord, en petit : elle est deja partout ailleurs.
          Ce que le visiteur doit emporter de cette page, c'est la date du
          drop - donc c'est elle qui prend la place. */}
      <div className="relative z-10 flex max-w-3xl flex-col items-center gap-3 text-center">
        <h1 className="font-hoodlrz text-2xl font-bold leading-none tracking-wider text-white sm:text-3xl">
          hOodlrz
        </h1>
        <p className="text-xs uppercase tracking-[0.2em] text-white/50">
          Own the identity. Collect the culture.
        </p>

        <div className="mt-6 w-full border border-white/15 bg-black/50 px-6 py-8 backdrop-blur-sm sm:px-10">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/50">
            New collection
          </p>
          <p className="font-hoodlrz mt-2 text-[34px] font-bold leading-none tracking-wider text-white sm:text-[52px]">
            Hoodlrz Gen Kids
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <span className="border border-[#c6f24e]/40 bg-[#c6f24e]/10 px-3 py-1 text-[10px] uppercase tracking-widest text-[#c6f24e]">
              Live on {KIDS_CHAIN.name}
            </span>
            <span className="text-[11px] uppercase tracking-widest text-white/50">
              {KIDS.maxSupply.toLocaleString("en-GB")} pieces · fully on-chain
            </span>
          </div>

          <p className="mt-6 text-sm leading-relaxed text-white/70">
            Minted {fmtDate(PHASE_ISO.publicStart)}. Every piece is drawn live
            by the engine stored in the contract — browse them here, trade
            them on OpenSea.
          </p>

          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button variant="primary" size="lg" href="/kids">
              Browse Gen Kids
            </Button>
            <Button variant="secondary" size="lg" href={KIDS_OPENSEA_URL}>
              Gen Kids on OpenSea
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Collection() {
  const [data, setData] = useState<CollectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeFilters, setActiveFilters] = useState<Record<string, Set<string>>>({});
  const [expandedFacet, setExpandedFacet] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(ITEMS_PER_PAGE);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const fetchCollection = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/hoodlrz/collection");
      const payload = (await res.json()) as CollectionPayload;
      if (payload.error) throw new Error(payload.error);
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collection");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCollection();
  }, [fetchCollection]);

  const toggleFilter = useCallback((trait: string, value: string) => {
    setActiveFilters((prev) => {
      const next = { ...prev };
      const set = new Set(next[trait] ?? []);
      if (set.has(value)) {
        set.delete(value);
      } else {
        set.add(value);
      }
      if (set.size === 0) {
        delete next[trait];
      } else {
        next[trait] = set;
      }
      return next;
    });
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const clearFilters = useCallback(() => {
    setActiveFilters({});
    setVisibleCount(ITEMS_PER_PAGE);
  }, []);

  const activeFilterCount = useMemo(
    () => Object.values(activeFilters).reduce((acc, s) => acc + s.size, 0),
    [activeFilters],
  );

  const filteredTokens = useMemo(() => {
    if (!data) return [];
    const entries = Object.entries(activeFilters);
    if (entries.length === 0) return data.tokens;
    return data.tokens.filter((token) =>
      entries.every(([trait, vals]) => {
        const attr = token.attributes.find((a) => a.trait_type === trait);
        return attr ? vals.has(String(attr.value)) : false;
      }),
    );
  }, [data, activeFilters]);

  const visibleTokens = filteredTokens.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTokens.length;

  return (
    <section className="w-full bg-[var(--surface)] py-16 sm:py-20">
      <div className="mx-auto max-w-7xl px-4">
        <div className="flex items-end justify-between flex-wrap gap-3 mb-6">
          <div>
            <h2 className="font-hoodlrz text-[28px] font-bold tracking-wider text-foreground sm:text-[36px]">
              The Collection
            </h2>
            {data && (
              <p className="text-sm text-muted mt-2">
                {filteredTokens.length} of {data.totalSupply} shown
                {activeFilterCount > 0 && (
                  <>
                    {" "}
                    ·{" "}
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="text-foreground underline hover:no-underline"
                    >
                      Clear filters
                    </button>
                  </>
                )}
              </p>
            )}
          </div>

          {/* Mobile filter toggle */}
          {data && Object.keys(data.facets).length > 0 && (
            <button
              type="button"
              onClick={() => setShowMobileFilters((v) => !v)}
              className="lg:hidden inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest border border-[var(--border)] text-foreground hover:bg-[var(--background)]"
            >
              Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </button>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          {/* Filters sidebar */}
          {data && Object.keys(data.facets).length > 0 && (
            <aside
              className={[
                "border border-[var(--border)] bg-[var(--background)] p-4 flex flex-col gap-2 self-start",
                "lg:sticky lg:top-20",
                showMobileFilters ? "" : "hidden lg:flex",
              ].join(" ")}
            >
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted">
                Filters
              </p>
              {Object.entries(data.facets).map(([trait, values]) => {
                const open = expandedFacet === trait;
                const selected = activeFilters[trait]?.size ?? 0;
                return (
                  <div key={trait} className="border-t border-[var(--border)] pt-2">
                    <button
                      type="button"
                      onClick={() => setExpandedFacet(open ? null : trait)}
                      className="w-full flex items-center justify-between py-2 text-left text-xs font-bold uppercase tracking-widest text-foreground hover:text-muted"
                    >
                      <span>
                        {trait}
                        {selected > 0 && (
                          <span className="ml-2 text-[10px] font-normal text-accent-red">
                            ({selected})
                          </span>
                        )}
                      </span>
                      <span className={`text-muted transition-transform ${open ? "rotate-45" : ""}`}>+</span>
                    </button>
                    {open && (
                      <div className="flex flex-col gap-1 max-h-60 overflow-y-auto pr-1 pb-2">
                        {values.map((v) => {
                          const checked = activeFilters[trait]?.has(v) ?? false;
                          return (
                            <label
                              key={v}
                              className="flex items-center gap-2 cursor-pointer text-xs text-muted hover:text-foreground py-0.5"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleFilter(trait, v)}
                                className="accent-accent-red"
                              />
                              <span>{v}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </aside>
          )}

          {/* Grid */}
          <div>
            {loading && (
              <div className="flex flex-col items-center gap-4 py-20">
                <div className="w-8 h-8 border-2 border-[#627eea]/30 border-t-[#627eea] rounded-full animate-spin" />
                <p className="text-sm text-muted animate-pulse">
                  Loading collection…
                </p>
              </div>
            )}

            {error && !loading && (
              <div className="border border-red-500/30 bg-red-500/10 p-6 text-center">
                <p className="text-sm text-red-400">{error}</p>
                <button
                  onClick={fetchCollection}
                  className="mt-3 text-xs text-muted hover:text-foreground underline"
                >
                  Retry
                </button>
              </div>
            )}

            {data && !loading && filteredTokens.length === 0 && (
              <div className="border border-[var(--border)] p-12 text-center text-sm text-muted">
                No NFTs match your filters.{" "}
                <button
                  type="button"
                  onClick={clearFilters}
                  className="text-foreground underline hover:no-underline"
                >
                  Clear filters
                </button>
              </div>
            )}

            {data && visibleTokens.length > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:gap-5">
                {visibleTokens.map((token) => (
                  <a
                    key={token.tokenId}
                    href={openseaUrl(data.contract, token.tokenId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex flex-col border border-[var(--border)] bg-[var(--background)] transition-transform duration-200 hover:-translate-y-1"
                  >
                    <div className="relative aspect-square w-full overflow-hidden bg-[var(--surface)]">
                      {token.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={token.image}
                          alt={token.name}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-xs text-muted">
                          #{token.tokenId}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between p-3">
                      <span className="text-xs font-bold text-foreground truncate">
                        {token.name}
                      </span>
                      <span className="text-[10px] text-muted shrink-0 ml-2">
                        #{String(token.tokenId).padStart(4, "0")}
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            )}

            {hasMore && (
              <div className="mt-10 flex justify-center">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setVisibleCount((c) => c + ITEMS_PER_PAGE)}
                >
                  Load More
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
