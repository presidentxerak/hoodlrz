/**
 * ABI minimale du contrat Hoodlrz Gen Kids, limitee a ce dont la page de
 * mint a besoin. On n'embarque pas l'ABI complete : chaque entree
 * inutile est du poids envoye a tous les visiteurs.
 */
export const KIDS_ABI = [
  // Lecture
  "function totalMinted() view returns (uint256)",
  "function reserveMinted() view returns (uint256)",
  "function minted(address) view returns (uint256)",
  "function allowlistStart() view returns (uint64)",
  "function publicStart() view returns (uint64)",
  "function mintEnd() view returns (uint64)",
  "function seedBase() view returns (bytes32)",
  "function revealBlock() view returns (uint256)",
  "function allowlistRoot() view returns (bytes32)",
  "function MAX_SUPPLY() view returns (uint256)",
  "function MAX_PER_WALLET() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",

  // Ecriture
  "function mintAllowlist(uint256 qty, bytes32[] proof)",
  "function mintPublic(uint256 qty)",
  // Revelation en deux temps, ouverte a tous : un holder peut la passer
  // lui-meme, sans attendre le createur.
  "function startReveal()",
  "function finishReveal()",

  // Erreurs, pour afficher un message utile plutot qu'un code brut
  "error MintClosed()",
  "error WalletCapReached()",
  "error SupplyExhausted()",
  "error BadProof()",
  "error ReserveFirst()",
  "error ZeroQuantity()",
  "error ContractsNotAllowed()",
  "error RevealNotReady()",
  "error RevealTooEarly()",
  "error RevealPending()",
  "error RevealExpired()",
  "error SeedAlreadySet()",
] as const;

/** Traduit une erreur de revert en message lisible. */
export function humanError(err: unknown): string {
  const raw =
    (err as { shortMessage?: string; message?: string })?.shortMessage ??
    (err as { message?: string })?.message ??
    String(err);

  if (raw.includes("MintClosed")) return "Minting is not open.";
  if (raw.includes("WalletCapReached"))
    return "You have reached the limit of 10 pieces per wallet.";
  if (raw.includes("SupplyExhausted")) return "No pieces left.";
  if (raw.includes("BadProof"))
    return "This wallet is not on the Hoodlrz holders allowlist.";
  if (raw.includes("ReserveFirst"))
    return "The creator reserve has not been minted yet.";
  if (raw.includes("ZeroQuantity")) return "Choose at least one piece.";
  if (raw.includes("ContractsNotAllowed"))
    return "The public mint only accepts regular wallets, not contract wallets.";
  if (raw.includes("RevealTooEarly"))
    return "The reveal date set by the creator has not come yet.";
  if (raw.includes("RevealNotReady"))
    return "The committed block is not readable yet. Try again in a couple of minutes.";
  if (raw.includes("RevealPending"))
    return "A reveal is already committed. Finish it instead of starting a new one.";
  if (raw.includes("RevealExpired"))
    return "The read window has passed. Start the reveal again.";
  if (raw.includes("SeedAlreadySet")) return "The seed is already revealed.";
  if (raw.includes("user rejected") || raw.includes("ACTION_REJECTED"))
    return "Transaction cancelled.";
  if (raw.includes("insufficient funds"))
    return "Not enough funds to cover gas.";
  return raw.slice(0, 160);
}
