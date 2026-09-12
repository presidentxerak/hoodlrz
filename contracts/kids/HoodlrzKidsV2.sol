// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {HoodlrzKidsRendererV2} from "./HoodlrzKidsRendererV2.sol";

/// @dev Ce que la v2 lit dans la collection d'origine : qui possede quoi,
///      et la graine dont tout decoule.
interface IHoodlrzKidsOrigin {
    function ownerOf(uint256 tokenId) external view returns (address);
    function seedBase() external view returns (bytes32);
    function totalMinted() external view returns (uint256);
}

/**
 * @title  Hoodlrz Gen Kids v2
 * @author XERAK
 * @notice La meme collection, redistribuee a ses proprietaires avec une
 *         vignette qui ressemble a la piece.
 *
 * @dev    POURQUOI
 *         La premiere collection a ete mintee, sold out et revelee. Ses
 *         cartes sur les marketplaces montraient une affiche simplifiee,
 *         identique pour des milliers de pieces, parce que le champ
 *         `image` etait dessine on-chain et que le renderer etait
 *         verrouille. Ce contrat reprend tout ce qui fait la collection
 *         - la graine, donc chaque hash, donc chaque piece et ses traits,
 *         et le moteur scelle - et ne change que la vignette.
 *
 *         CE QUE LE HOLDER CONSTATE
 *         Il recoit la piece de meme numero dans son wallet, sans rien
 *         faire ni payer : l'airdrop lit le proprietaire de chaque piece
 *         DANS le contrat d'origine, au moment de l'envoi. Il n'y a pas de
 *         liste tenue a la main. Sa piece d'origine reste chez lui.
 *
 *         CE QUI EST FIGE
 *         La graine et le nombre de pieces sont copies de l'origine a la
 *         construction et ne changent plus. Aucune fonction de mint hors
 *         l'airdrop, qui ne peut creer que les numeros existants, chacun
 *         une fois, pour leur proprietaire d'origine.
 *
 *         CE QUI RESTE A LA MAIN DU CREATEUR
 *         La base de l'URL des vignettes, pour survivre a un changement
 *         de domaine. C'est une vignette, pas l'oeuvre : l'oeuvre est le
 *         champ animation_url, lu depuis le moteur scelle, et l'affiche
 *         on-chain du renderer reste disponible pour la regenerer.
 */
contract HoodlrzKidsV2 is ERC721, IERC2981, IERC4906, Ownable2Step {
    uint96 public constant ROYALTY_BPS = 500; // 5 %

    /// @notice Collection d'origine, dont cette collection est la copie.
    IHoodlrzKidsOrigin public immutable origin;

    /// @notice Graine, copiee de l'origine : memes hashs, memes pieces.
    bytes32 public immutable seedBase;

    /// @notice Nombre de pieces, copie de l'origine.
    uint256 public immutable MAX_SUPPLY;

    HoodlrzKidsRendererV2 public renderer;
    bool public rendererLocked;

    /// @notice Prefixe de l'URL des vignettes : `<imageBase><id>.png`.
    string public imageBase;

    address public royaltyReceiver;

    /// @notice Pieces deja distribuees : les numeros 0 a airdropped-1.
    uint256 public airdropped;

    event Airdropped(uint256 from, uint256 to);
    event ImageBaseSet(string imageBase);
    event RendererSet(address renderer);
    event RendererLocked(address renderer);
    event RoyaltyReceiverSet(address receiver);
    event ContractURIUpdated();

    error ZeroAddress();
    error Locked();
    error EngineNotSealed();
    error AirdropComplete();
    error OwnershipStillNeeded();
    error OriginNotRevealed();

    constructor(address origin_, address renderer_, address royaltyReceiver_, string memory imageBase_)
        ERC721("Hoodlrz Gen Kids", "KIDS")
        Ownable(msg.sender)
    {
        if (origin_ == address(0) || renderer_ == address(0) || royaltyReceiver_ == address(0)) revert ZeroAddress();
        origin = IHoodlrzKidsOrigin(origin_);
        bytes32 s = origin.seedBase();
        if (s == bytes32(0)) revert OriginNotRevealed();
        seedBase = s;
        MAX_SUPPLY = origin.totalMinted();
        renderer = HoodlrzKidsRendererV2(renderer_);
        royaltyReceiver = royaltyReceiver_;
        imageBase = imageBase_;
    }

    /* ------------------------------------------------------------------ *
     *  Airdrop
     * ------------------------------------------------------------------ */

    /**
     * @notice Distribue les `count` pieces suivantes a leurs proprietaires
     *         d'origine. Relancable jusqu'a ce que tout soit distribue.
     * @dev    _mint et non _safeMint : un proprietaire contractuel a deja
     *         accepte la piece d'origine, et un revert d'un seul receveur
     *         ne doit pas bloquer les 3 332 autres.
     */
    function airdrop(uint256 count) external onlyOwner {
        uint256 from = airdropped;
        if (from >= MAX_SUPPLY) revert AirdropComplete();
        uint256 to = from + count;
        if (to > MAX_SUPPLY) to = MAX_SUPPLY;
        airdropped = to;
        for (uint256 id = from; id < to; ++id) {
            _mint(origin.ownerOf(id), id);
        }
        emit Airdropped(from, to);
    }

    function airdropComplete() public view returns (bool) {
        return airdropped == MAX_SUPPLY;
    }

    /// @notice Meme nom que dans l'origine, pour l'outillage.
    function totalMinted() external view returns (uint256) {
        return airdropped;
    }

    /* ------------------------------------------------------------------ *
     *  Administration
     * ------------------------------------------------------------------ */

    function setRenderer(address r) external onlyOwner {
        if (rendererLocked) revert Locked();
        if (r == address(0)) revert ZeroAddress();
        renderer = HoodlrzKidsRendererV2(r);
        emit RendererSet(r);
    }

    function lockRenderer() external onlyOwner {
        if (address(renderer).code.length == 0) revert ZeroAddress();
        if (!renderer.engine().sealed_()) revert EngineNotSealed();
        rendererLocked = true;
        emit RendererLocked(address(renderer));
    }

    /// @notice Change la base des vignettes et demande aux marketplaces
    ///         de relire toutes les pieces (ERC-4906).
    function setImageBase(string calldata b) external onlyOwner {
        imageBase = b;
        emit ImageBaseSet(b);
        emit ContractURIUpdated();
        if (airdropped > 0) emit BatchMetadataUpdate(0, airdropped - 1);
    }

    function setRoyaltyReceiver(address r) external onlyOwner {
        if (r == address(0)) revert ZeroAddress();
        royaltyReceiver = r;
        emit RoyaltyReceiverSet(r);
        emit ContractURIUpdated();
    }

    function renounceOwnership() public override onlyOwner {
        if (!airdropComplete() || !rendererLocked) revert OwnershipStillNeeded();
        super.renounceOwnership();
    }

    /* ------------------------------------------------------------------ *
     *  Metadonnees
     * ------------------------------------------------------------------ */

    /// @notice Hash d'un token : identique a celui de l'origine.
    function tokenHash(uint256 tokenId) public view returns (bytes32) {
        return keccak256(abi.encodePacked(seedBase, tokenId));
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return renderer.tokenURIWithImage(tokenId, tokenHash(tokenId), imageBase);
    }

    function contractURI() external view returns (string memory) {
        return renderer.contractURIWithImage(royaltyReceiver, ROYALTY_BPS, imageBase);
    }

    function royaltyInfo(uint256, uint256 salePrice) external view override returns (address, uint256) {
        return (royaltyReceiver, (salePrice * ROYALTY_BPS) / 10_000);
    }

    /// @dev L'identifiant ERC-4906 est fixe par la norme (0x49064906) :
    ///      l'interface ne declare que des evenements, son interfaceId
    ///      calcule serait nul.
    function supportsInterface(bytes4 id) public view override(ERC721, IERC165) returns (bool) {
        return id == type(IERC2981).interfaceId || id == bytes4(0x49064906) || super.supportsInterface(id);
    }
}
