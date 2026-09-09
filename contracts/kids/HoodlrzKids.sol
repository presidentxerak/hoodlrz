// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {HoodlrzKidsRenderer} from "./HoodlrzKidsRenderer.sol";

/**
 * @title  Hoodlrz Gen Kids
 * @author XERAK
 * @notice Collection generative de 3333 pieces, integralement on-chain.
 *
 * @dev    PARAMETRES, arretes le 21/08/2026, supply revue le 23/08/2026,
 *         graves ici en constantes :
 *
 *           supply totale      3333
 *           reserve createur    300  (9,0 %), mintee avant toute ouverture
 *           public             3033
 *           plafond par wallet   10  -> 304 wallets distincts au minimum
 *           prix              gratuit (gas seulement)
 *           royalties            5 % (EIP-2981, declaratif)
 *
 *         POURQUOI 10 ET PAS 100
 *         A 100 par wallet, 31 adresses suffiraient a rafler la collection
 *         entiere. En free mint sur une chaine a gas sub-centime, monter 31
 *         wallets ne coute rien a un bot. A 10, il en faut 304 : le vidage
 *         reste possible mais devient couteux, et l'allowlist donne aux
 *         holders Hoodlrz une avance reelle plutot que symbolique.
 *
 *         Le plafond est compte par adresse, et le mint public refuse les
 *         appels venant d'un contrat : sans cela, une seule transaction
 *         pouvait deployer 304 contrats jetables et vider la collection
 *         d'un coup. Le prix a payer est que les wallets contractuels
 *         (Safe, comptes abstraits) ne peuvent pas passer par la porte
 *         publique. C'est assume : sur cette chaine, ce sont des EOA.
 *
 *         GRAINE
 *         Le hash d'un token est keccak256(seedBase, tokenId). `seedBase`
 *         est fixe une seule fois, apres la fin de la distribution, en
 *         DEUX temps : on s'engage d'abord sur un bloc futur, puis on lit
 *         son hash une fois qu'il existe. Ni le createur ni personne ne
 *         choisit donc la graine - voir la section « Revelation ».
 *         Aucun stockage par token n'est necessaire.
 *
 *         CE QUI EST FIGE UNE FOIS LE MINT OUVERT
 *         Des que block.timestamp atteint allowlistStart, les phases et la
 *         racine d'allowlist ne bougent plus - a une exception pres, qui
 *         ne va que dans un sens : le createur peut FERMER le mint
 *         (closeMint), ce qui reduit de fait la supply aux pieces deja
 *         mintees. Et des que la graine est posee, plus rien ne se
 *         minte : la graine rend les traits de chaque tokenId
 *         calculables, et un mint apres coup serait un tirage a livre
 *         ouvert.
 *
 *         DATE DE REVELATION
 *         Le createur choisit a partir de quand la revelation peut etre
 *         engagee (revealAfter), au plus 30 jours apres la fin de la
 *         distribution. Passe ce delai, n'importe qui peut la lancer :
 *         choisir le jour, oui ; retenir la collection, non.
 *
 *         PIEGE DE CHAINE
 *         Les phases sont pilotees par block.timestamp, JAMAIS par
 *         block.number : sur la chaine cible (Arbitrum Orbit), block.number
 *         renvoie une estimation du bloc de la chaine parente, pas du bloc
 *         local. La revelation, elle, s'appuie justement sur ce
 *         block.number parent : c'est ce qui la met hors de portee de
 *         l'appelant.
 */
contract HoodlrzKids is ERC721, IERC2981, Ownable2Step {
    /* ------------------------------------------------------------------ *
     *  Constantes de collection
     * ------------------------------------------------------------------ */
    uint256 public constant MAX_SUPPLY = 3333;
    uint256 public constant RESERVE = 300;
    uint256 public constant MAX_PER_WALLET = 10;
    uint96 public constant ROYALTY_BPS = 500; // 5 %

    /// @notice Distance, en blocs de la chaine parente, entre l'engagement
    ///         et le bloc dont le hash fera la graine. Dix blocs Ethereum,
    ///         soit environ deux minutes : assez pour que ce hash n'existe
    ///         pas encore au moment de s'engager, assez court pour que la
    ///         fenetre de lecture (256 blocs) reste confortable.
    uint256 public constant REVEAL_DELAY = 10;

    /* ------------------------------------------------------------------ *
     *  Etat
     * ------------------------------------------------------------------ */
    HoodlrzKidsRenderer public renderer;

    /// @notice Racine Merkle de l'allowlist (snapshot des holders Hoodlrz).
    bytes32 public allowlistRoot;

    /// @notice Base de graine, figee apres le mint. Nulle = pas encore revelee.
    bytes32 public seedBase;

    /// @notice Bloc (chaine parente) dont le hash fera la graine.
    ///         Zero = aucune revelation engagee.
    uint256 public revealBlock;

    /// @notice Beneficiaire des royalties.
    address public royaltyReceiver;

    uint256 public totalMinted;
    uint256 public reserveMinted;

    /// @notice Ouverture de la phase allowlist, puis de la phase publique.
    ///         Zero = phase non programmee.
    uint64 public allowlistStart;
    uint64 public publicStart;
    uint64 public mintEnd;

    /// @notice Date avant laquelle la revelation ne peut pas etre engagee,
    ///         choisie par le createur. Zero = des la fin de la distribution.
    uint64 public revealAfter;

    /// @notice Instant du sold-out, s'il a lieu avant la fin de fenetre.
    ///         C'est de la que court le delai maximal de revelation.
    uint64 public soldOutAt;

    /// @notice Delai maximal entre la fin de la distribution et la date de
    ///         revelation que le createur peut imposer. Au-dela, la
    ///         revelation redevient possible pour tous : le createur choisit
    ///         le jour, il ne peut pas tenir la collection en otage.
    uint64 public constant MAX_REVEAL_DELAY = 30 days;

    /// @dev Compte les mints publics + allowlist par adresse, plafond commun.
    mapping(address => uint256) public minted;

    /// @notice Verrou du renderer. Une fois pose, l'adresse ne change plus.
    bool public rendererLocked;

    event MintClosedEarly(uint64 at);
    event RevealAfterSet(uint64 revealAfter);
    event RevealStarted(uint256 revealBlock, address by);
    event SeedRevealed(bytes32 seedBase, uint256 revealBlock);
    event PhasesSet(uint64 allowlistStart, uint64 publicStart, uint64 mintEnd);
    event AllowlistRootSet(bytes32 root);
    event RendererSet(address renderer);
    event RendererLocked(address renderer);
    event RoyaltyReceiverSet(address receiver);
    /// @dev ERC-7572 : signale aux marketplaces de relire contractURI().
    event ContractURIUpdated();

    error MintClosed();
    error WalletCapReached();
    error SupplyExhausted();
    error BadProof();
    error SeedAlreadySet();
    error SeedNotSet();
    error ReserveExhausted();
    error ReserveFirst();
    error Locked();
    error ZeroAddress();
    error ZeroQuantity();
    error ContractsNotAllowed();
    error PhasesLocked();
    error RevealNotReady();
    error RevealTooEarly();
    error RevealDateTooFar();
    error RevealPending();
    error RevealExpired();
    error EngineNotSealed();
    error OwnershipStillNeeded();

    constructor(address renderer_, address royaltyReceiver_)
        ERC721("Hoodlrz Gen Kids", "KIDS")
        Ownable(msg.sender)
    {
        if (renderer_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        renderer = HoodlrzKidsRenderer(renderer_);
        royaltyReceiver = royaltyReceiver_;
    }

    /* ------------------------------------------------------------------ *
     *  Administration
     * ------------------------------------------------------------------ */

    /// @dev Vrai des que la phase allowlist a commence : a partir de la,
    ///      les regles du mint ne bougent plus.
    function _mintStarted() private view returns (bool) {
        return allowlistStart != 0 && block.timestamp >= allowlistStart;
    }

    /**
     * @notice Programme les trois dates du mint.
     * @dev    Libre tant que le mint n'a pas commence ; fige ensuite. Sans
     *         ce verrou, le proprietaire pouvait avancer la fin, reveler la
     *         graine, puis rouvrir : les pieces restantes se seraient alors
     *         mintees en connaissant leurs traits.
     */
    function setPhases(uint64 alStart, uint64 pubStart, uint64 end) external onlyOwner {
        if (seedBase != bytes32(0) || _mintStarted()) revert PhasesLocked();
        require(alStart <= pubStart && pubStart < end, "Phases incoherentes");
        allowlistStart = alStart;
        publicStart = pubStart;
        mintEnd = end;
        emit PhasesSet(alStart, pubStart, end);
    }

    /**
     * @notice Ferme le mint maintenant. Les pieces non mintees n'existeront
     *         jamais : c'est ainsi que la supply se reduit apres coup.
     * @dev    Le seul reglage de phase encore permis une fois le mint
     *         ouvert, et il ne va que dans un sens : fermer. Fermer ne
     *         donne aucune prise sur la graine, qui vient d'un bloc futur
     *         et que n'importe qui peut cloturer.
     */
    function closeMint() external onlyOwner {
        if (seedBase != bytes32(0) || !_mintStarted()) revert PhasesLocked();
        if (block.timestamp >= mintEnd) return; // deja ferme
        mintEnd = uint64(block.timestamp);
        emit MintClosedEarly(mintEnd);
        emit PhasesSet(allowlistStart, publicStart, mintEnd);
    }

    /**
     * @notice Choisit a partir de quand la revelation peut etre engagee.
     * @dev    Bornee a MAX_REVEAL_DELAY apres la fin de la distribution -
     *         ou apres maintenant si la fin n'est pas encore connue. Le
     *         createur decide du jour ; il ne peut pas repousser sans fin.
     *         Zero remet le comportement par defaut : des la fin du mint.
     */
    function setRevealAfter(uint64 t) external onlyOwner {
        if (seedBase != bytes32(0) || revealBlock != 0) revert SeedAlreadySet();
        require(mintEnd != 0, "Phases non programmees");
        if (t > _distributionEnd() + MAX_REVEAL_DELAY) revert RevealDateTooFar();
        revealAfter = t;
        emit RevealAfterSet(t);
    }

    /// @dev Fin effective de la distribution : le sold-out s'il a eu lieu,
    ///      sinon la fermeture de la fenetre.
    function _distributionEnd() private view returns (uint64) {
        return soldOutAt != 0 ? soldOutAt : mintEnd;
    }

    /// @notice Pose la racine de l'allowlist. Figee des l'ouverture du mint.
    function setAllowlistRoot(bytes32 root) external onlyOwner {
        if (_mintStarted()) revert PhasesLocked();
        allowlistRoot = root;
        emit AllowlistRootSet(root);
    }

    function setRenderer(address r) external onlyOwner {
        if (rendererLocked) revert Locked();
        if (r == address(0)) revert ZeroAddress();
        renderer = HoodlrzKidsRenderer(r);
        emit RendererSet(r);
    }

    /**
     * @dev Irreversible : fige l'adresse du renderer. A appeler une fois le
     *      rendu verifie depuis la chaine.
     *
     *      Le verrou n'a de sens que si ce qu'il fige est complet : un
     *      renderer dont le moteur n'est pas scelle laisserait l'art
     *      modifiable par une autre porte. On l'exige donc ici, plutot que
     *      de s'en remettre a l'ordre des operations d'un script.
     */
    function lockRenderer() external onlyOwner {
        if (address(renderer).code.length == 0) revert ZeroAddress();
        if (!renderer.engine().sealed_()) revert EngineNotSealed();
        rendererLocked = true;
        emit RendererLocked(address(renderer));
    }

    function setRoyaltyReceiver(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        royaltyReceiver = r;
        emit RoyaltyReceiverSet(r);
        emit ContractURIUpdated();
    }

    /**
     * @dev Renoncer a la propriete avant que la collection soit achevee la
     *      laisserait sans personne pour poser le verrou du renderer. La
     *      revelation, elle, n'a pas besoin du proprietaire.
     */
    function renounceOwnership() public override onlyOwner {
        if (seedBase == bytes32(0) || !rendererLocked) revert OwnershipStillNeeded();
        super.renounceOwnership();
    }

    /* ------------------------------------------------------------------ *
     *  Reserve createur
     * ------------------------------------------------------------------ */

    /// @notice Mint de la reserve, obligatoirement avant l'ouverture publique.
    /// @dev    Decoupable en plusieurs appels pour tenir dans un bloc.
    function mintReserve(address to, uint256 qty) external onlyOwner {
        if (reserveMinted + qty > RESERVE) revert ReserveExhausted();
        // La reserve doit etre servie avant que quiconque puisse minter :
        // une reserve prelevee apres coup se paie cher en reputation.
        require(!_mintStarted(), "Trop tard pour la reserve");
        reserveMinted += qty;
        _mintMany(to, qty);
    }

    /* ------------------------------------------------------------------ *
     *  Mint
     * ------------------------------------------------------------------ */

    function _mintMany(address to, uint256 qty) private {
        if (qty == 0) revert ZeroQuantity();
        // Une fois la graine posee, les traits de chaque tokenId sont
        // publics. Minter ensuite reviendrait a choisir sa piece.
        if (seedBase != bytes32(0)) revert MintClosed();
        uint256 start = totalMinted;
        if (start + qty > MAX_SUPPLY) revert SupplyExhausted();
        totalMinted = start + qty;
        if (start + qty == MAX_SUPPLY) soldOutAt = uint64(block.timestamp);
        for (uint256 i = 0; i < qty; ++i) {
            _safeMint(to, start + i);
        }
    }

    function _checkCap(uint256 qty) private {
        uint256 m = minted[msg.sender] + qty;
        if (m > MAX_PER_WALLET) revert WalletCapReached();
        minted[msg.sender] = m;
    }

    /// @notice Mint pendant la phase allowlist, reservee aux holders Hoodlrz.
    function mintAllowlist(uint256 qty, bytes32[] calldata proof) external {
        if (allowlistStart == 0 || block.timestamp < allowlistStart || block.timestamp >= publicStart) {
            revert MintClosed();
        }
        if (reserveMinted < RESERVE) revert ReserveFirst();
        if (!MerkleProof.verifyCalldata(proof, allowlistRoot, keccak256(abi.encodePacked(msg.sender)))) {
            revert BadProof();
        }
        _checkCap(qty);
        _mintMany(msg.sender, qty);
    }

    /// @notice Mint public.
    /// @dev    Reserve aux comptes externes : voir l'en-tete du contrat.
    function mintPublic(uint256 qty) external {
        if (publicStart == 0 || block.timestamp < publicStart || block.timestamp >= mintEnd) {
            revert MintClosed();
        }
        if (msg.sender != tx.origin) revert ContractsNotAllowed();
        if (reserveMinted < RESERVE) revert ReserveFirst();
        _checkCap(qty);
        _mintMany(msg.sender, qty);
    }

    /* ------------------------------------------------------------------ *
     *  Revelation de la graine
     * ------------------------------------------------------------------ */

    /**
     * @dev Vrai quand plus rien ne peut etre minte : la fenetre est close,
     *      ou la collection est partie entierement. La seconde porte n'est
     *      pas un confort - la fenetre court jusqu'en 2036, et sans elle la
     *      collection resterait en placeholder dix ans apres que la
     *      derniere piece a trouve preneur.
     */
    function _distributionOver() private view returns (bool) {
        return mintEnd != 0 && (block.timestamp >= mintEnd || totalMinted == MAX_SUPPLY);
    }

    /**
     * @notice Premier temps : s'engager sur un bloc futur. Ouvert a tous.
     *
     * @dev    POURQUOI DEUX TEMPS, ET POURQUOI TOUT LE MONDE
     *         Une graine tiree du bloc courant se choisit : celui qui
     *         decide de l'instant de l'appel peut calculer la graine de
     *         chaque instant candidat, en deduire les traits de ses propres
     *         tokens, et n'appuyer que quand le tirage lui plait. Ici on
     *         s'engage sur un bloc qui n'existe pas encore : au moment de
     *         l'appel, personne ne connait son hash.
     *
     *         Reste l'appelant qui laisserait passer la fenetre de lecture
     *         pour retenter sa chance. C'est pour cela que les deux temps
     *         sont ouverts a tous : n'importe quel collectionneur peut
     *         clore la revelation dans la fenetre, et chaque tentative
     *         laisse un evenement RevealStarted sur la chaine. Le
     *         proprietaire n'y a aucun pouvoir de plus que quiconque.
     *
     *         Sur la chaine cible, blockhash est produit par le sequenceur
     *         et n'est pas une source d'alea cryptographique. La seule
     *         partie capable d'y influer est donc l'operateur de la chaine
     *         lui-meme - c'est la limite de confiance, et elle est dite
     *         telle quelle dans la documentation publique.
     */
    function startReveal() external {
        if (seedBase != bytes32(0)) revert SeedAlreadySet();
        require(_distributionOver(), "Mint en cours");
        // La date choisie par le createur s'applique, dans la limite de
        // MAX_REVEAL_DELAY apres la fin de la distribution : au-dela, la
        // porte s'ouvre quoi qu'il en soit.
        if (block.timestamp < revealAfter && block.timestamp < _distributionEnd() + MAX_REVEAL_DELAY) {
            revert RevealTooEarly();
        }
        // Un engagement en cours ne se remplace pas tant que son hash est
        // encore lisible : sinon on choisirait parmi plusieurs tirages.
        if (revealBlock != 0 && block.number <= revealBlock + 256) revert RevealPending();
        revealBlock = block.number + REVEAL_DELAY;
        emit RevealStarted(revealBlock, msg.sender);
    }

    /// @notice Second temps : lire le hash du bloc engage et figer la
    ///         graine. Ouvert a tous, dans les 256 blocs qui suivent.
    function finishReveal() external {
        if (seedBase != bytes32(0)) revert SeedAlreadySet();
        if (revealBlock == 0 || block.number <= revealBlock) revert RevealNotReady();
        bytes32 h = blockhash(revealBlock);
        // Fenetre de lecture depassee : le hash n'est plus accessible.
        // startReveal() est de nouveau possible.
        if (h == bytes32(0)) revert RevealExpired();
        seedBase = keccak256(abi.encodePacked(h, address(this), totalMinted));
        emit SeedRevealed(seedBase, revealBlock);
    }

    /// @notice Hash d'un token, dont derive toute la piece.
    function tokenHash(uint256 tokenId) public view returns (bytes32) {
        if (seedBase == bytes32(0)) revert SeedNotSet();
        return keccak256(abi.encodePacked(seedBase, tokenId));
    }

    /* ------------------------------------------------------------------ *
     *  Metadonnees
     * ------------------------------------------------------------------ */

    /**
     * @notice Metadonnees de la collection, lues par les marketplaces.
     * @dev    Nom, description, vignette et royalties de l'ENSEMBLE - la
     *         page de collection sur OpenSea, par opposition a tokenURI
     *         qui decrit une piece. Sans lui, la collection s'affiche
     *         sous une adresse de contrat et une image vide.
     *
     *         Le beneficiaire est lu depuis l'etat, pas fige : si
     *         setRoyaltyReceiver() est appele, les deux sources - EIP-2981
     *         et ce champ - restent d'accord.
     */
    function contractURI() external view returns (string memory) {
        return renderer.contractURI(royaltyReceiver, ROYALTY_BPS);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        // Avant revelation, on renvoie un placeholder plutot que de revenir
        // en erreur : une marketplace qui interroge un token non revele doit
        // afficher quelque chose, pas casser.
        if (seedBase == bytes32(0)) {
            return string(
                abi.encodePacked(
                    "data:application/json;base64,",
                    Base64.encode(
                        abi.encodePacked(
                            '{"name":"Hoodlrz Gen Kid #', Strings.toString(tokenId),
                            '","description":"Graine non encore revelee. Les traits apparaitront a la fin du mint.","image":"data:image/svg+xml;base64,',
                            Base64.encode(bytes(_placeholderSvg())),
                            '"}'
                        )
                    )
                )
            );
        }
        return renderer.tokenURI(tokenId, tokenHash(tokenId));
    }

    function _placeholderSvg() private pure returns (string memory) {
        return
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 700" width="700" height="700">'
            '<rect width="700" height="700" fill="#000000"/>'
            '<text x="350" y="360" fill="#ffffff" font-family="monospace" font-size="34" text-anchor="middle">HOODLRZ KIDS</text>'
            '<text x="350" y="404" fill="#ff36c8" font-family="monospace" font-size="18" text-anchor="middle">graine non revelee</text>'
            "</svg>";
    }

    /* ------------------------------------------------------------------ *
     *  Royalties
     * ------------------------------------------------------------------ */

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        override
        returns (address, uint256)
    {
        return (royaltyReceiver, (salePrice * ROYALTY_BPS) / 10_000);
    }

    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || super.supportsInterface(id);
    }
}
