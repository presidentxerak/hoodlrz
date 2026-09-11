"use client";

/**
 * Panneau de mint Hoodlrz Gen Kids.
 *
 * Trois etats se combinent et le panneau doit rester juste dans tous les
 * cas : la phase (avant / allowlist / public / termine), l'etat du wallet
 * (deconnecte / mauvaise chaine / pret), et l'appartenance a l'allowlist.
 *
 * Le contrat reste l'arbitre. L'interface ne fait que refleter ce qu'il
 * autorise - elle ne le devine pas, et elle n'essaie jamais de deviner a
 * sa place quand elle ne sait pas.
 *
 * Tant qu'aucune adresse de contrat n'est configuree, le panneau
 * fonctionne en vitrine : il annonce les parametres et dit clairement
 * qu'il n'y a rien a minter.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, Contract, JsonRpcProvider } from "ethers";
import Countdown from "@/components/kids/Countdown";
import {
  KIDS,
  PHASES,
  KIDS_CHAIN,
  KIDS_ADDRESS,
  isDeployed,
  chainParams,
  phaseAt,
  type Phase,
} from "@/lib/kids/config";
import { KIDS_ABI, humanError } from "@/lib/kids/abi";

type Eip1193 = {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (e: string, cb: (...a: unknown[]) => void) => void;
  removeListener?: (e: string, cb: (...a: unknown[]) => void) => void;
};
declare global {
  interface Window { ethereum?: Eip1193 }
}

/* ── Decouverte du wallet (EIP-6963) ───────────────────────────────────
 * `window.ethereum` est un point unique que plusieurs extensions se
 * disputent : Phantom, Coinbase ou Rabby peuvent s'y installer a la
 * place de MetaMask, et la demande de connexion part alors vers un wallet
 * qui ne repond pas. EIP-6963 fait annoncer chaque wallet par un
 * evenement, avec son identite : on prend MetaMask s'il est la, sinon le
 * premier annonce, sinon window.ethereum. */
type Announced = { info: { rdns: string; name: string }; provider: Eip1193 };
const announced: Announced[] = [];
if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", (e: Event) => {
    const d = (e as CustomEvent<Announced>).detail;
    if (d?.provider && !announced.some((a) => a.info.rdns === d.info.rdns)) announced.push(d);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}
function pickWallet(): Eip1193 | undefined {
  const mm = announced.find((a) => a.info.rdns === "io.metamask");
  return mm?.provider ?? announced[0]?.provider ?? window.ethereum;
}
function walletName(): string {
  const mm = announced.find((a) => a.info.rdns === "io.metamask");
  return mm?.info.name ?? announced[0]?.info.name ?? "the wallet";
}

/** Une promesse qui n'aboutit jamais n'est pas une erreur pour le
 *  navigateur : elle laisse juste un bouton muet. On borne. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} did not answer within ${ms / 1000}s. Open the extension itself, unlock it, then try again.`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

interface Allowlist {
  merkleRoot: string;
  proofs: Record<string, string[]>;
}

export default function MintPanel() {
  // La page est prerendue statiquement : lire l'horloge au premier rendu
  // donnerait un HTML serveur different du client, donc une erreur
  // d'hydratation. `now` reste a null jusqu'au montage, et tout ce qui
  // depend du temps attend cette valeur.
  const [now, setNow] = useState<number | null>(null);
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [allowlist, setAllowlist] = useState<Allowlist | null>(null);
  const [supply, setSupply] = useState<{ total: number; mine: number } | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);

  const mounted = now !== null;
  const phase: Phase = phaseAt(now ?? 0);
  const deployed = isDeployed();

  /* ── Horloge ─────────────────────────────────────────────────────── */
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  /* ── Allowlist publiee ───────────────────────────────────────────── */
  // Publiee comme fichier statique pour que n'importe qui puisse
  // recalculer la racine et verifier le snapshot.
  useEffect(() => {
    fetch("/kids/allowlist.json")
      .then((r) => (r.ok ? r.json() : null))
      .then(setAllowlist)
      .catch(() => setAllowlist(null));
  }, []);

  const proof = useMemo(() => {
    if (!allowlist || !account) return null;
    return allowlist.proofs[account.toLowerCase()] ?? null;
  }, [allowlist, account]);

  const inAllowlist = proof !== null;

  /* ── Wallet ──────────────────────────────────────────────────────── */
  const readAccounts = useCallback(async () => {
    const w = pickWallet();
    if (!w) return;
    const accs = (await w.request({ method: "eth_accounts" })) as string[];
    setAccount(accs?.[0] ?? "");
    const cid = (await w.request({ method: "eth_chainId" })) as string;
    setChainId(parseInt(cid, 16));
  }, []);

  useEffect(() => {
    // Les annonces EIP-6963 arrivent juste apres le chargement : on
    // redemande une fois monte, puis on lit les comptes.
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const t = setTimeout(readAccounts, 150);
    readAccounts();
    const eth = pickWallet();
    if (!eth?.on) return () => clearTimeout(t);
    const onAcc = () => readAccounts();
    const onChain = () => readAccounts();
    eth.on("accountsChanged", onAcc);
    eth.on("chainChanged", onChain);
    return () => {
      clearTimeout(t);
      eth.removeListener?.("accountsChanged", onAcc);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [readAccounts]);

  const connect = async () => {
    const w = pickWallet();
    if (!w) {
      setMsg({ kind: "err", text: "No wallet detected. Install MetaMask to mint." });
      return;
    }
    setMsg({ kind: "info", text: `Asking ${walletName()} to connect…` });
    try {
      await withTimeout(w.request({ method: "eth_requestAccounts" }), 20000, walletName());
      await readAccounts();
      setMsg(null);
    } catch (e) {
      setMsg({ kind: "err", text: humanError(e) });
    }
  };

  const switchChain = async () => {
    const w = pickWallet();
    if (!w) return;
    const hex = "0x" + KIDS_CHAIN.id.toString(16);
    try {
      await w.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      // 4902 = chaine inconnue du wallet : on propose de l'ajouter.
      if ((e as { code?: number })?.code === 4902) {
        try {
          await w.request({ method: "wallet_addEthereumChain", params: [chainParams()] });
        } catch (e2) {
          setMsg({ kind: "err", text: humanError(e2) });
        }
      } else {
        setMsg({ kind: "err", text: humanError(e) });
      }
    }
    await readAccounts();
  };

  /* ── Etat de la collection ───────────────────────────────────────── */
  // Un seul provider pour toute la vie de la page, et sans detection de
  // reseau : recreer un JsonRpcProvider a chaque lecture coutait deux
  // requetes de plus (eth_chainId) sur un RPC public deja limite en
  // debit - multiplie par chaque visiteur, toutes les quinze secondes.
  const readProvider = useMemo(
    () => (KIDS_CHAIN.rpcUrl ? new JsonRpcProvider(KIDS_CHAIN.rpcUrl, KIDS_CHAIN.id, { staticNetwork: true }) : null),
    [],
  );

  const refreshSupply = useCallback(async () => {
    if (!deployed) return;
    try {
      const w = pickWallet();
      const provider = readProvider ?? (w ? new BrowserProvider(w) : null);
      if (!provider) return;
      const c = new Contract(KIDS_ADDRESS, KIDS_ABI, provider);
      const total = Number(await c.totalMinted());
      const mine = account ? Number(await c.minted(account)) : 0;
      setSupply({ total, mine });
    } catch {
      // Un RPC injoignable ne doit pas casser la page : on garde
      // l'affichage precedent et on reessaiera au prochain tick.
    }
  }, [deployed, account, readProvider]);

  useEffect(() => {
    refreshSupply();
    const id = setInterval(refreshSupply, 15000);
    return () => clearInterval(id);
  }, [refreshSupply]);

  /* ── Mint ────────────────────────────────────────────────────────── */
  const mint = async () => {
    const w = pickWallet();
    if (!w || !deployed) return;
    setBusy(true);
    setMsg({ kind: "info", text: "Confirm the transaction in your wallet…" });
    try {
      const signer = await new BrowserProvider(w).getSigner();
      const c = new Contract(KIDS_ADDRESS, KIDS_ABI, signer);
      const tx =
        phase === "allowlist"
          ? await c.mintAllowlist(qty, proof ?? [])
          : await c.mintPublic(qty);
      setMsg({ kind: "info", text: "Transaction sent, waiting for confirmation…" });
      await tx.wait();
      setMsg({ kind: "ok", text: `${qty} Hoodlrz Gen Kid${qty > 1 ? "s" : ""} minted.` });
      refreshSupply();
    } catch (e) {
      setMsg({ kind: "err", text: humanError(e) });
    } finally {
      setBusy(false);
    }
  };

  /* ── Rendu ───────────────────────────────────────────────────────── */
  const wrongChain = chainId !== null && chainId !== KIDS_CHAIN.id;
  const myRemaining = supply ? Math.max(0, KIDS.maxPerWallet - supply.mine) : KIDS.maxPerWallet;

  const canMint =
    mounted &&
    deployed &&
    !!account &&
    !wrongChain &&
    !busy &&
    myRemaining > 0 &&
    (phase === "public" || (phase === "allowlist" && inAllowlist));

  return (
    <div className="flex flex-col gap-5 border border-[var(--border)] bg-[var(--surface)] p-6">
      {mounted ? (
        <PhaseBanner phase={phase} now={now!} inAllowlist={inAllowlist} hasAccount={!!account} />
      ) : (
        <div className="h-[46px] border border-[var(--border)]" aria-hidden />
      )}

      {/* Compteur de supply : seulement quand la chaine repond. Afficher
          "0 / 3333" alors qu'on n'a rien lu serait un mensonge poli. */}
      {supply && (
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Minted</span>
            <span className="font-bold tabular-nums">
              {supply.total.toLocaleString("en-GB")} / {KIDS.maxSupply.toLocaleString("en-GB")}
            </span>
          </div>
          <div className="mt-2 h-1 w-full bg-[var(--border)]">
            <div
              className="h-full bg-accent-red transition-[width] duration-500"
              style={{ width: `${Math.min(100, (supply.total / KIDS.maxSupply) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {!deployed && (
        <Notice kind="info">
          Contracts are not deployed yet. The preview above runs the final
          engine — what you see is what you will get.
        </Notice>
      )}

      {deployed && !account && (
        <button
          onClick={connect}
          className="cta-gradient px-8 py-4 text-sm font-bold uppercase tracking-widest text-white"
        >
          Connect wallet
        </button>
      )}

      {deployed && account && wrongChain && (
        <div className="flex flex-col gap-3">
          <Notice kind="err">
            Your wallet is on another chain. Switch to {KIDS_CHAIN.name} to mint.
          </Notice>
          <button
            onClick={switchChain}
            className="border border-[var(--border)] px-6 py-3 text-sm font-semibold uppercase tracking-widest transition-colors hover:border-accent-red hover:text-accent-red"
          >
            Switch network
          </button>
        </div>
      )}

      {deployed && account && !wrongChain && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <label
              htmlFor="qty"
              className="font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]"
            >
              Quantity
            </label>
            <input
              id="qty"
              type="number"
              min={1}
              max={Math.max(1, myRemaining)}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(myRemaining, Number(e.target.value) || 1)))}
              className="w-20 border border-[var(--border)] bg-transparent px-3 py-2 text-center font-mono tabular-nums
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-red"
            />
            <span className="text-xs text-[var(--muted)]">
              {myRemaining} left for this wallet
            </span>
          </div>

          <button
            onClick={mint}
            disabled={!canMint}
            className="cta-gradient px-8 py-4 text-sm font-bold uppercase tracking-widest text-white
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Working…" : phase === "allowlist" ? "Mint · allowlist" : "Mint"}
          </button>

          {mounted && phase === "allowlist" && !inAllowlist && (
            <Notice kind="info">
              This wallet is not on the Hoodlrz holders allowlist. Public mint
              opens in <Countdown to={PHASES.publicStart} />.
            </Notice>
          )}
        </div>
      )}

      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <p className="text-[11px] leading-relaxed text-[var(--muted)]">
        Free mint — you only pay network gas. {KIDS.maxPerWallet} per wallet.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Notice({ kind, children }: { kind: "ok" | "err" | "info"; children: React.ReactNode }) {
  const border =
    kind === "err" ? "border-l-accent-red" : kind === "ok" ? "border-l-green-500" : "border-l-[var(--muted)]";
  return (
    <p className={`border border-[var(--border)] border-l-2 ${border} px-4 py-3 text-sm leading-relaxed`}>
      {children}
    </p>
  );
}

function PhaseBanner({
  phase, now, inAllowlist, hasAccount,
}: { phase: Phase; now: number; inAllowlist: boolean; hasAccount: boolean }) {
  const base = "flex items-baseline justify-between gap-4 border border-[var(--border)] px-4 py-3";

  if (phase === "avant") {
    const target = now < PHASES.snapshot ? PHASES.snapshot : PHASES.allowlistStart;
    const label = now < PHASES.snapshot ? "Holder snapshot in" : "Allowlist in";
    return (
      <div className={base}>
        <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">{label}</span>
        <strong className="text-lg"><Countdown to={target} /></strong>
      </div>
    );
  }
  if (phase === "allowlist") {
    return (
      <div className={base}>
        <span className="font-mono text-[11px] uppercase tracking-widest text-accent-red">
          Allowlist open{hasAccount && (inAllowlist ? " · you are in" : " · wallet not listed")}
        </span>
        <strong className="text-lg">
          Public in <Countdown to={PHASES.publicStart} />
        </strong>
      </div>
    );
  }
  if (phase === "public") {
    return (
      <div className={base}>
        <span className="font-mono text-[11px] uppercase tracking-widest text-accent-red">Public mint open</span>
        <strong className="text-lg">Free</strong>
      </div>
    );
  }
  return (
    <div className={base}>
      <span className="font-mono text-[11px] uppercase tracking-widest text-[var(--muted)]">Mint closed</span>
      <strong className="text-lg">Secondary market</strong>
    </div>
  );
}
