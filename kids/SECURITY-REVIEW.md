# Hoodlrz Gen Kids — revue de sécurité des contrats

Date : 6 septembre 2026, cinq jours avant l'ouverture du mint.
Périmètre : `contracts/kids/HoodlrzKids.sol`, `HoodlrzKidsEngine.sol`,
`HoodlrzKidsRenderer.sol`, `HoodlrzKidsTraits.sol`, `HoodlrzKidsConstants.sol`.
OpenZeppelin 5.6.1, solc 0.8.28, optimiseur 200 runs, viaIR, EVM cancun.
Chaîne cible : Robinhood Chain (Arbitrum Orbit), mainnet 4663, testnet 46630.

## Ce que cette revue est, et n'est pas

Deux passes indépendantes ont été menées sur le même code :

1. une lecture adversariale par l'auteur des contrats, ligne à ligne, avec
   pour question unique « comment un propriétaire malveillant, un bot ou
   l'opérateur de la chaîne casserait-il les promesses publiques ? » ;
2. un audit par un relecteur indépendant du développement, sans accès aux
   intentions de l'auteur, rendu sous forme de rapport avec sévérités.

Les deux listes ont été fusionnées ci-dessous. Chaque finding porte la
sévérité du rapport indépendant quand elle existe, et son statut après
correctif. Chaque correctif est rejoué par `test/kids/security.test.mjs`,
qui commence par tenter l'attaque avant de vérifier qu'elle est refusée.

**Limite à dire clairement :** l'auteur du code a participé à la revue et
a écrit les correctifs. Ce document n'est pas un audit tiers signé par un
cabinet, et ne doit pas être présenté comme tel. Il est ce qu'une petite
équipe peut faire de plus sérieux sans budget d'audit : deux regards, des
attaques rejouées, et une trace écrite de ce qui reste hors de portée.

## Résumé

| Sévérité | Trouvés | Corrigés | Acceptés et documentés |
|---|---|---|---|
| Critique | 1 | 1 | 0 |
| Haute | 3 | 3 | 0 |
| Moyenne | 3 | 2 | 1 (M-3, mesuré) |
| Basse | 5 | 4 | 1 (L-4, limite de chaîne) |
| Informatif | 8 | 4 | 4 |

Avant correctifs, les deux promesses publiques de la collection —
« personne, pas même le créateur, ne sait ce qu'il mint » et « free mint
équitable » — étaient fausses telles qu'écrites. Après correctifs, elles
tiennent, avec une seule limite de confiance résiduelle : l'opérateur de
la chaîne, qui produit les `blockhash` et ordonne les transactions. Cette
limite est dite telle quelle sur la page de mint.

## Findings

### C-1 — Critique — Rouvrir le mint après la graine · CORRIGÉ

`setPhases` était appelable à tout moment, et aucune fonction de mint ne
vérifiait `seedBase`. Le propriétaire pouvait avancer `mintEnd`, révéler,
puis remettre `mintEnd` en 2036 : les pièces restantes se mintaient alors
en connaissant leurs traits (`tokenHash` est déterministe et `traitsFor`
est public). Un bot surveillant `totalMinted` pouvait sniper chaque
pièce rare restante.

Correctif : `_mintMany` refuse tout mint dès que `seedBase != 0`, sur les
trois portes (réserve, allowlist, public). `setPhases` refuse dès que la
graine existe ou que le mint a commencé.

### H-1 — Haute — Le propriétaire choisit la graine · CORRIGÉ

`revealSeed()` mélangeait `blockhash(block.number - 1)` et
`block.timestamp`, et seul le propriétaire pouvait l'appeler, sans
échéance. Sur Arbitrum Orbit, `blockhash` est un pseudo-aléa produit par
le séquenceur, identique pour tous les blocs L2 partageant la même
estimation de bloc parent, et lisible à l'avance par `eth_call`. Le
propriétaire pouvait donc calculer la graine candidate de chaque instant,
en déduire les traits des 300 pièces de réserve (ids 0 à 299, connus
d'avance), et n'appuyer que quand le tirage lui plaisait. Environ 3 600
candidats par heure, indétectable après coup.

Correctif : révélation en deux temps, ouverte à tous.

- `startReveal()` s'engage sur `revealBlock = block.number + 10` (blocs
  de la chaîne parente, ~2 minutes). Au moment de l'appel, ce hash
  n'existe pas.
- `finishReveal()` lit `blockhash(revealBlock)` et pose
  `seedBase = keccak256(hash, address(this), totalMinted)`. Ni le
  timestamp ni l'appelant n'entrent dans la graine.
- Tant que le hash est lisible (256 blocs, ~50 minutes), aucun nouvel
  engagement n'est accepté : on ne choisit pas parmi plusieurs tirages.
- Si la fenêtre est manquée, n'importe qui peut ré-engager. Chaque
  tentative émet `RevealStarted` : une révélation abandonnée pour
  retenter se voit sur la chaîne.

Ce qui reste : quelqu'un pourrait laisser expirer une fenêtre pour tirer
à nouveau, à raison d'un candidat par heure environ, en public, et
seulement si aucun collectionneur ne clôture avant lui. C'est la raison
d'ouvrir les deux appels à tous et d'exposer `kids:reveal` — n'importe
quel holder peut clôturer. Le séquenceur, lui, peut influer sur le hash ;
c'est L-4.

### H-2 — Haute — Une clé perdue fige la collection en placeholder · CORRIGÉ

La révélation était `onlyOwner`, sans repli, même en 2036. Une clé
perdue, un `renounceOwnership()` ou un `transferOwnership` vers une
adresse fausse laissaient 3 333 tokens en placeholder pour toujours.

Correctif : la révélation n'a plus besoin du propriétaire (H-1). Le
contrat passe à `Ownable2Step` : un transfert doit être accepté par le
destinataire. `renounceOwnership()` refuse tant que la graine n'est pas
posée et le renderer pas verrouillé — les deux seuls gestes qui ont
encore besoin d'un propriétaire.

### H-3 — Haute — Plafond par wallet contournable par contrats · CORRIGÉ

Le plafond de 10 était compté par `msg.sender`. Une seule transaction
pouvait déployer 304 contrats jetables qui mintent chacun 10 pièces et
les renvoient : la collection entière pour le prix du gas, au premier
bloc de la phase publique.

Correctif : `mintPublic` refuse les appels venant d'un contrat
(`msg.sender != tx.origin`). L'allowlist n'est pas concernée : elle est
bornée par le snapshot.

**Conséquence assumée :** les wallets contractuels (Safe, comptes
abstraits) ne peuvent pas passer par la porte publique. Sur cette chaîne,
les wallets sont des EOA ; si ce choix devait être revu, c'est une ligne
à retirer avant déploiement. Le vidage par de nombreuses EOA reste
possible, mais chaque adresse coûte alors une transaction distincte et
une latence vers le séquenceur — le coût que le plafond était censé
imposer.

### M-1 — Moyenne — Phases et racine modifiables en plein mint · CORRIGÉ

Le propriétaire pouvait allonger la fenêtre allowlist après y avoir fait
minter des proches, la raccourcir, ou changer la racine Merkle pendant
qu'elle servait. Aucun événement sur `setAllowlistRoot`.

Correctif : dès que `block.timestamp >= allowlistStart`, `setPhases` et
`setAllowlistRoot` refusent (`PhasesLocked`). Événements
`AllowlistRootSet`, `RendererSet`, `RoyaltyReceiverSet` ajoutés. La
réserve suit la même règle : elle ne se mint plus après l'ouverture.

### M-2 — Moyenne — `lockRenderer` verrouillait sans rien vérifier · CORRIGÉ

Le verrou pouvait se poser sur un renderer dont le moteur n'était pas
scellé (l'art restait modifiable par l'autre contrat), ou sur une adresse
sans code (tokenURI cassé pour toujours).

Correctif : `lockRenderer` exige que l'adresse porte du code et que
`renderer.engine().sealed_()` soit vrai. `setRenderer(0)` refusé.

### M-3 — Moyenne — Coût de `tokenURI` · MESURÉ, ACCEPTÉ

Aucun test ne mesurait le gas de `tokenURI`. Mesure ajoutée dans
`e2e.test.mjs` :

| Appel | Gas |
|---|---|
| `tokenURI` (HTML 116 Ko + affiche SVG, en base64) | 21,3 M |
| `seal` (recalcul du SHA-256 sur la chaîne) | 1,2 M |

Le plafond `eth_call` de geth est de 50 M par défaut, et l'appel a été
exécuté avec succès via Alchemy sur le testnet avant cette revue. La
marge existe mais n'est pas immense : un fournisseur RPC configuré plus
bas afficherait la pièce cassée. Le test échoue au-delà de 30 M pour que
toute régression se voie. Une réécriture de la concaténation en un seul
tampon réduirait le coût ; elle n'a pas été faite à cinq jours du mint,
parce qu'elle toucherait le chemin qui a été prouvé octet à octet.

### L-1 — Basse — Le hash du moteur était déclaré, pas vérifié · CORRIGÉ

`seal(expectedHash)` stockait n'importe quelle valeur. Le contrat
recompose désormais l'artefact depuis ses propres morceaux
(`pre() + "__HASH__" + post()`), calcule `sha256` sur la chaîne et refuse
le scellement si le résultat diffère (`HashMismatch`). Un moteur
incomplet ou un hash mal copié ne peuvent plus être scellés. Coût : 1,2 M
de gas, une fois.

### L-2 — Basse — Troncature silencieuse au-delà de 65 534 octets · CORRIGÉ

La longueur du runtime SSTORE2 est écrite sur deux octets. Un morceau
plus grand aurait déployé un pointeur tronqué sans erreur. `MAX_CHUNK =
24 575` (EIP-170 moins l'octet STOP) est désormais imposé
(`ChunkTooLarge`). L'`unchecked` de `_size` a été retiré.

### L-3 — Basse — Adresses nulles et événements · CORRIGÉ

Constructeur, `setRoyaltyReceiver` et `setRenderer` refusent
`address(0)`. `setRoyaltyReceiver` émet `ContractURIUpdated()` (ERC-7572)
pour que les marketplaces relisent `contractURI`.

### L-4 — Basse — Confiance dans l'opérateur de la chaîne · ACCEPTÉ, DOCUMENTÉ

Le séquenceur fixe `block.timestamp`, ordonne les transactions sans
mempool public, et produit les `blockhash`. Il peut donc influencer la
graine (à la marge : un hash par bloc parent, sans choix libre), servir
ses propres mints en premier à l'ouverture, ou retarder ceux d'autrui.
C'est inhérent au choix de la chaîne et cela vaut pour toute transaction
qui y passe. La page de mint le dit : « le reste de la confiance repose
sur le séquenceur ». Un VRF n'est pas disponible sur cette chaîne à la
date de la revue.

### L-5 — Basse — Réserve mintable tant que l'allowlist est future · CORRIGÉ

Découlait de M-1 : avec des phases figées à l'ouverture, la réserve ne
peut plus être complétée après coup. Le plafond de 300 tenait déjà.

### Informatif

- **I-1 Réentrance — sain.** `totalMinted` et `minted[msg.sender]` sont
  mis à jour avant la boucle `_safeMint`. Un receveur qui réentre est
  compté contre les compteurs déjà incrémentés.
- **I-2 Merkle — sain.** Feuille sur 20 octets, nœuds sur 64 : pas de
  confusion possible. Racine vide = personne ne prouve rien.
- **I-3 Renderer — sain.** Tous les index sont bornés, aucune chaîne
  contrôlée par l'utilisateur n'entre dans le JSON. `traitsFor` est
  public : c'est ce qui rendait C-1 trivial, et ce qui rend la collection
  vérifiable ; il reste public.
- **I-4 Base64 maison — REMPLACÉ.** L'implémentation en assembleur du
  NFT lisait jusqu'à deux octets au-delà du tampon. Remplacée par
  `Base64.encode` d'OpenZeppelin, et `_dec` par `Strings.toString`.
- **I-5 Quantité nulle — CORRIGÉ.** `mint*(0)` refusé (`ZeroQuantity`).
- **I-6 `SeedRevealed` — CORRIGÉ.** Émet `revealBlock` (bloc parent
  engagé) plutôt qu'un `block.number` ambigu.
- **I-7 Ordre des morceaux.** Append-only, non réordonnable : correct.
  Un téléversement dans le désordre est désormais refusé au scellement
  par L-1, ce qui couvre la recommandation.
- **I-8 Code de création SSTORE2 — vérifié à la main.** Préfixe de 12
  octets, STOP en tête (EIP-3541 évité), morceaux sous la limite
  d'init-code EIP-3860.

## Addendum du 9 septembre — deux pouvoirs rendus au créateur

À la demande du créateur, après la revue, deux fonctions ont été
ajoutées. Elles ont été conçues pour ne rouvrir aucun des findings
ci-dessus, et sont couvertes par 19 contrôles supplémentaires dans
`security.test.mjs`.

**`closeMint()`** — le créateur ferme le mint à l'instant. Les pièces non
mintées n'existent jamais : c'est l'équivalent d'une réduction de supply.
C'est la seule exception au gel des phases (M-1), et elle ne va que dans
un sens : fermer. Fermer ne donne aucune prise sur la graine, qui vient
d'un bloc futur et que n'importe qui peut clôturer (H-1). Ce que ça
change : le créateur peut interrompre un mint public en cours. C'est un
pouvoir de fairness, pas de sécurité, et il est dit sur la page de mint.

**`setRevealAfter(t)`** — le créateur choisit à partir de quand la
révélation peut être engagée. Bornée à 30 jours après la fin de la
distribution (sold-out ou fermeture, `soldOutAt` est enregistré pour
cela). Passé ce délai, la révélation redevient possible pour tous : le
créateur choisit le jour, il ne peut pas retenir la collection (H-2
préservé). La date ne se change plus une fois un engagement posé.

Le contrat NFT a été redéployé avec ces fonctions ; le moteur et le
renderer, inchangés, ont été repris.

## Ce que la revue n'a pas couvert

- Le front-end (`src/`) et les scripts de déploiement, lus seulement pour
  confirmer l'usage prévu des contrats.
- Le moteur JavaScript lui-même (116 Ko de HTML) : sa parité avec la
  version Solidity des traits est prouvée sur les 3 333 tokens, pas sa
  sécurité en tant que page web — il ne charge aucune ressource externe,
  ce qui en réduit fortement la surface.
- Les contrats système de la chaîne, qui restent upgradables par son
  opérateur.

## Suites données

- Contrats corrigés, 51 contrôles de sécurité ajoutés, suite complète
  au vert (`npm run kids:test`).
- `kids:deploy` refuse désormais de reprendre un déploiement dont le
  bytecode ne correspond plus aux sources. Le testnet actuel date d'avant
  la revue : il doit être redéployé et la répétition rejouée.
- Nouveau script `kids:reveal`, utilisable par n'importe qui.
- Copie publique (page `/kids`, texte de collection, press kit) alignée
  sur le mécanisme réel de révélation.
- ABI du site enrichie des nouvelles erreurs et des deux appels de
  révélation, pour qu'un holder puisse la clôturer depuis la page.

Rapporteurs : XERAK (auteur, lecture adversariale) et un relecteur
indépendant du développement (rapport fusionné ci-dessus).
