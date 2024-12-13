// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.25;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract HoodlrzVerse is Ownable(msg.sender),  ERC721 {
  string public baseURI;
  uint256 public constant MAX_TOKENS = 100;

  uint256 public nextTokenId = 1;

  constructor() ERC721("HoodlrzVerse", "HRZ") {}

  function mint(address to) external {
    _mint(to, nextTokenId);
    unchecked { nextTokenId += 1; }
  }

  function _baseURI() internal view override returns (string memory) {
    return baseURI;
  }

  function setBaseURI(string memory newURI) external onlyOwner {
    baseURI = newURI;
  }
}
