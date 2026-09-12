// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {HoodlrzKidsTraits as T} from "./HoodlrzKidsTraits.sol";
import {HoodlrzKidsRenderer} from "./HoodlrzKidsRenderer.sol";

/**
 * @title  HoodlrzKidsRendererV2
 * @notice Le renderer de la premiere collection, avec une vignette qui
 *         ressemble a la piece.
 *
 * @dev    POURQUOI UNE V2
 *         Les marketplaces affichent le champ `image` sur leurs cartes et
 *         ne rendent jamais `animation_url` en vignette. La premiere
 *         version dessinait pour `image` une affiche SVG simplifiee, et
 *         sur la grille d'OpenSea des milliers de cartes se ressemblaient.
 *         Ici `image` pointe vers une capture de la piece elle-meme,
 *         rendue par le moteur a l'instant canonique et servie par le
 *         site : la carte montre ce que montre la page.
 *
 *         CE QUI NE CHANGE PAS
 *         L'oeuvre reste entierement on-chain : `animation_url` est
 *         toujours le moteur scelle, lu depuis la chaine, avec le hash du
 *         token injecte. Les attributs sont calcules par la meme
 *         bibliotheque. L'affiche SVG on-chain reste disponible par
 *         posterFor() : si le site disparaissait, n'importe qui pourrait
 *         regenerer une vignette depuis la chaine.
 *
 *         La base de l'URL d'image n'est pas gravee ici : c'est le contrat
 *         de collection qui la fournit, et qui la garde modifiable pour
 *         survivre a un changement de domaine.
 */
contract HoodlrzKidsRendererV2 is HoodlrzKidsRenderer {
    using Strings for uint256;

    string private constant DESCRIPTION_V2 =
        "Hoodlrz Gen Kids - collection generative integralement on-chain. "
        "Le moteur de rendu est stocke dans la blockchain, pas sur un serveur : "
        "chaque piece se regenere depuis sa graine, indefiniment. "
        "Touchez l'image pour changer la punchline. XERAK.";

    constructor(address engineAddress) HoodlrzKidsRenderer(engineAddress) {}

    /**
     * @notice Metadonnees d'un token : capture en `image`, oeuvre on-chain
     *         en `animation_url`, attributs calcules.
     * @param  imageBase Prefixe de l'URL d'image ; le fichier est
     *         `<imageBase><tokenId>.png`.
     */
    function tokenURIWithImage(uint256 tokenId, bytes32 tokenHash, string memory imageBase)
        external
        view
        returns (string memory)
    {
        string memory hashStr = T.toHashString(tokenHash);
        T.Traits memory t = T.derive(hashStr);

        string memory json = string(
            abi.encodePacked(
                '{"name":"Hoodlrz Gen Kid #', tokenId.toString(),
                '","description":"', DESCRIPTION_V2,
                '","image":"', imageBase, tokenId.toString(), '.png',
                '","animation_url":"data:text/html;base64,',
                Base64.encode(bytes(engine.documentFor(hashStr))),
                '","attributes":', _attributes(t),
                ',"hoodlrz_hash":"', hashStr, '"}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }

    /// @notice Metadonnees de la collection ; la vignette est
    ///         `<imageBase>collection.png`.
    function contractURIWithImage(address royaltyReceiver, uint96 royaltyBps, string memory imageBase)
        external
        pure
        returns (string memory)
    {
        string memory json = string(
            abi.encodePacked(
                '{"name":"Hoodlrz Gen Kids"',
                ',"description":"', DESCRIPTION_V2,
                '","image":"', imageBase, 'collection.png',
                '","external_link":"https://hoodlrz.com/kids"',
                ',"seller_fee_basis_points":', uint256(royaltyBps).toString(),
                ',"fee_recipient":"', Strings.toHexString(royaltyReceiver), '"}'
            )
        );
        return string(abi.encodePacked("data:application/json;base64,", Base64.encode(bytes(json))));
    }
}
