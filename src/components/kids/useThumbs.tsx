"use client";

/**
 * Vignettes peintes a la demande par le moteur, dans le navigateur.
 *
 * Une iframe cachee charge public/kids/render.html (le moteur gele plus
 * un service de rendu par messages). Chaque vignette est demandee a la
 * taille voulue, rendue a l'instant canonique, renvoyee en data URL et
 * gardee en memoire. Les demandes partent une par une : le moteur peint
 * une piece en quelques millisecondes, la file se vide plus vite que
 * l'oeil ne defile.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Job = { id: number; hash: string; size: number };

export function useThumbs() {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<Job[]>([]);
  const busyRef = useRef(false);
  const cacheRef = useRef(new Map<number, string>());
  const wantedRef = useRef(new Set<number>());
  const [, bump] = useState(0);

  const pump = useCallback(() => {
    if (busyRef.current || !readyRef.current) return;
    const job = queueRef.current.shift();
    if (!job) return;
    busyRef.current = true;
    frameRef.current?.contentWindow?.postMessage({ type: "hoodlrz:render", ...job }, "*");
  }, []);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      if (d.type === "hoodlrz:ready") {
        readyRef.current = true;
        pump();
      } else if (d.type === "hoodlrz:rendered") {
        if (typeof d.dataUrl === "string") cacheRef.current.set(d.id, d.dataUrl);
        busyRef.current = false;
        bump((n) => n + 1);
        pump();
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [pump]);

  /** Demande la vignette d'une piece ; renvoie l'image si deja peinte. */
  const thumb = useCallback(
    (id: number, hash: string, size: number): string | null => {
      const hit = cacheRef.current.get(id);
      if (hit) return hit;
      if (!wantedRef.current.has(id)) {
        wantedRef.current.add(id);
        queueRef.current.push({ id, hash, size });
        pump();
      }
      return null;
    },
    [pump],
  );

  /** L'iframe a monter une fois dans la page, invisible. */
  const frame = (
    <iframe
      ref={frameRef}
      src="/kids/render.html?preview=1&hash=0x0000000000000000000000000000000000000000000000000000000000000001"
      title="Hoodlrz Gen Kids renderer"
      aria-hidden
      tabIndex={-1}
      sandbox="allow-scripts"
      style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none", border: 0 }}
    />
  );

  return { thumb, frame };
}
