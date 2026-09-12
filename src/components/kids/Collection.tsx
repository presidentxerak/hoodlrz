"use client";

/**
 * Galerie de la collection Gen Kids, une fois revelee.
 *
 * Meme usage que la galerie OG : filtrer par trait, trier par numero ou
 * par rarete, charger par pages. Mais aucune lecture de chaine ici : la
 * collection est entierement determinee par la graine, et kids:index a
 * calcule les traits et peint des planches-contact une fois pour toutes.
 * Les vignettes sont des decoupes de ces planches ; la piece vivante,
 * animee et interactive, se joue dans le moteur au clic.
 *
 * Tant que public/kids/collection/index.json n'existe pas, la graine
 * n'est pas revelee : on le dit, avec le lien OpenSea.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { solidityPackedKeccak256 } from "ethers";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { KIDS, KIDS_OPENSEA_URL, kidsOpenSeaItemUrl, kidsTokenUrl } from "@/lib/kids/config";

interface Index {
  contract: string;
  seedBase: string;
  total: number;
  tile: number;
  perSide: number;
  sheets: number;
  keys: string[];
  values: string[][];
  tokens: number[][];
}

type Tier = "Common" | "Uncommon" | "Rare" | "Legendary";
const ITEMS_PER_PAGE = 24;

function tierVariant(t: Tier): "default" | "success" | "rare" | "legendary" {
  return t === "Legendary" ? "legendary" : t === "Rare" ? "rare" : t === "Uncommon" ? "success" : "default";
}

export default function Collection() {
  const [index, setIndex] = useState<Index | null | undefined>(undefined);
  const [filterKey, setFilterKey] = useState(-1);
  const [filterValue, setFilterValue] = useState(-1);
  const [sortBy, setSortBy] = useState<"number" | "rarity">("number");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(ITEMS_PER_PAGE);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    fetch("/kids/collection/index.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setIndex)
      .catch(() => setIndex(null));
  }, []);

  /* Rarete : somme, sur les neuf traits, de total / effectif de la
     valeur. Convention usuelle des collections generatives ; les paliers
     sont des quantiles, pour que « Legendary » veuille dire quelque
     chose quelle que soit la distribution. */
  const { scores, tiers } = useMemo(() => {
    if (!index) return { scores: [] as number[], tiers: [] as Tier[] };
    const counts = index.keys.map((_, k) => {
      const c = new Array(index.values[k].length).fill(0);
      for (const t of index.tokens) c[t[k]]++;
      return c;
    });
    const scores = index.tokens.map((t) =>
      t.reduce((s, v, k) => s + index.total / counts[k][v], 0),
    );
    const ranked = scores.map((s, id) => [s, id] as const).sort((a, b) => b[0] - a[0]);
    const tiers: Tier[] = new Array(index.total).fill("Common");
    ranked.forEach(([, id], rank) => {
      const q = rank / index.total;
      tiers[id] = q < 0.01 ? "Legendary" : q < 0.1 ? "Rare" : q < 0.3 ? "Uncommon" : "Common";
    });
    return { scores, tiers };
  }, [index]);

  const ids = useMemo(() => {
    if (!index) return [] as number[];
    let list = index.tokens.map((_, id) => id);
    if (filterKey >= 0 && filterValue >= 0) list = list.filter((id) => index.tokens[id][filterKey] === filterValue);
    const q = query.trim().replace(/^#/, "");
    if (q) list = list.filter((id) => String(id).includes(q));
    if (sortBy === "rarity") list.sort((a, b) => scores[b] - scores[a]);
    return list;
  }, [index, filterKey, filterValue, query, sortBy, scores]);

  const hashOf = useCallback(
    (id: number) => (index ? solidityPackedKeccak256(["bytes32", "uint256"], [index.seedBase, id]) : ""),
    [index],
  );

  useEffect(() => { setVisible(ITEMS_PER_PAGE); }, [filterKey, filterValue, query, sortBy]);

  // Echap ferme la piece ouverte.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (index === undefined) {
    return (
      <div className="mt-12 flex flex-col items-center gap-4">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#627eea]/30 border-t-[#627eea]" />
        <p className="animate-pulse text-sm text-muted">Loading the collection…</p>
      </div>
    );
  }

  if (index === null) {
    return (
      <div className="mt-12 flex flex-col items-center gap-4 border border-[var(--border)] px-6 py-12 text-center">
        <p className="font-hoodlrz text-2xl font-bold tracking-wider text-foreground">Reveal pending</p>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          The seed is not set yet. Until it is, every piece shows the same
          placeholder — on OpenSea as here. The collection resolves all at
          once the moment the reveal goes through.
        </p>
        <Button variant="primary" size="md" href={KIDS_OPENSEA_URL}>View on OpenSea</Button>
      </div>
    );
  }

  const sheetStyle = (id: number) => {
    const per = index.perSide * index.perSide;
    const s = Math.floor(id / per);
    const i = id % per;
    const x = i % index.perSide;
    const y = Math.floor(i / index.perSide);
    // Position en % : (x / (n - 1)) * 100 place la tuile x sur une
    // image de n tuiles quand background-size vaut n * 100 %.
    const pct = (v: number) => (index.perSide > 1 ? (v / (index.perSide - 1)) * 100 : 0);
    return {
      backgroundImage: `url(/kids/collection/sheet-${String(s).padStart(2, "0")}.webp)`,
      backgroundSize: `${index.perSide * 100}% ${index.perSide * 100}%`,
      backgroundPosition: `${pct(x)}% ${pct(y)}%`,
    };
  };

  const shown = ids.slice(0, visible);

  return (
    <div>
      {/* Filtres, comme la galerie OG. */}
      <div className="mt-8 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Trait</label>
          <select
            value={filterKey}
            onChange={(e) => { setFilterKey(Number(e.target.value)); setFilterValue(-1); }}
            className="border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-foreground outline-none"
          >
            <option value={-1}>All traits</option>
            {index.keys.map((k, i) => <option key={k} value={i}>{k}</option>)}
          </select>
        </div>
        {filterKey >= 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Value</label>
            <select
              value={filterValue}
              onChange={(e) => setFilterValue(Number(e.target.value))}
              className="border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-foreground outline-none"
            >
              <option value={-1}>All</option>
              {index.values[filterKey].map((v, i) => <option key={v} value={i}>{v}</option>)}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Sort</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "number" | "rarity")}
            className="border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-foreground outline-none"
          >
            <option value="number">Token #</option>
            <option value="rarity">Rarity score</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted">Token</label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="#"
            inputMode="numeric"
            className="w-24 border border-[var(--border)] bg-transparent px-3 py-2 font-mono text-sm text-foreground outline-none"
          />
        </div>
        <span className="ml-auto text-xs text-muted">{ids.length.toLocaleString("en-GB")} items</span>
      </div>

      {/* Grille */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-6 lg:grid-cols-4">
        {shown.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setOpen(id)}
            className="group flex flex-col border border-[var(--border)] bg-[var(--surface)] text-left transition-transform duration-200 hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-red"
          >
            <div className="aspect-square w-full bg-black" style={sheetStyle(id)} aria-label={`Hoodlrz Gen Kid #${id}`} />
            <div className="flex items-center justify-between p-3">
              <span className="text-xs font-bold text-foreground">#{String(id).padStart(4, "0")}</span>
              <Badge variant={tierVariant(tiers[id])}>{tiers[id]}</Badge>
            </div>
          </button>
        ))}
      </div>

      {visible < ids.length && (
        <div className="mt-12 flex justify-center">
          <Button variant="secondary" size="md" onClick={() => setVisible((v) => v + ITEMS_PER_PAGE)}>Load more</Button>
        </div>
      )}
      {ids.length === 0 && (
        <div className="mt-16 flex justify-center">
          <p className="text-sm text-muted">No pieces match these filters.</p>
        </div>
      )}

      {/* La piece vivante : le moteur on-chain, joue dans une iframe. */}
      {open !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`Hoodlrz Gen Kid #${open}`}
        >
          <div
            className="grid w-full max-w-4xl gap-6 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6 md:grid-cols-[1fr_280px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="aspect-square w-full overflow-hidden bg-black">
              <iframe
                key={open}
                src={`/kids/engine.html?hash=${hashOf(open)}`}
                title={`Hoodlrz Gen Kid #${open}`}
                className="h-full w-full border-0"
                sandbox="allow-scripts"
              />
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted">{KIDS.name}</p>
                  <h3 className="font-hoodlrz text-2xl font-bold tracking-wider text-foreground">
                    #{String(open).padStart(4, "0")}
                  </h3>
                </div>
                <Badge variant={tierVariant(tiers[open])}>{tiers[open]}</Badge>
              </div>
              <dl className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-3 text-xs">
                {index.keys.map((k, i) => (
                  <div key={k} className="flex justify-between gap-3">
                    <dt className="uppercase tracking-widest text-muted">{k}</dt>
                    <dd className="text-right font-bold text-foreground">{index.values[i][index.tokens[open][i]]}</dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-[var(--border)] pt-1.5">
                  <dt className="uppercase tracking-widest text-muted">Score</dt>
                  <dd className="font-mono text-foreground">{scores[open].toFixed(1)}</dd>
                </div>
              </dl>
              <p className="text-[11px] leading-relaxed text-muted">
                Live, drawn by the engine stored in the contract. Tap the artwork to change the punchline.
              </p>
              <div className="mt-auto flex flex-col gap-2">
                <Button variant="primary" size="sm" href={kidsOpenSeaItemUrl(open)}>View on OpenSea</Button>
                <Button variant="secondary" size="sm" href={kidsTokenUrl(open)}>On the explorer</Button>
                <button
                  type="button"
                  onClick={() => setOpen(null)}
                  className="text-[11px] uppercase tracking-widest text-muted hover:text-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
