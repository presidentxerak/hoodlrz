import type { Metadata } from "next";

/**
 * Metadonnees propres a la page de drop.
 *
 * page.tsx est un composant client - il ne peut pas exporter `metadata`.
 * Ce layout existe pour ca, et pour ca seulement : un lien vers /kids
 * partage sur X ou Discord doit annoncer la collection, pas le titre
 * generique du site.
 */
export const metadata: Metadata = {
  title: "Hoodlrz Gen Kids — 3,333 fully on-chain generative pieces",
  description:
    "A generative collection on Robinhood Chain whose rendering engine lives inside the blockchain. Every Kid redraws itself from its own seed. Browse the collection, open any piece live.",
  openGraph: {
    title: "Hoodlrz Gen Kids",
    description:
      "3,333 generative pieces, fully on-chain on Robinhood Chain. Browse the collection, trade on OpenSea.",
  },
};

export default function KidsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
