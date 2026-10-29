// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
contract AgentRegistryMock is ERC721 {
    constructor() ERC721("Test Agent ID", "AI") {}
    function mint(address to, uint256 id) external { _mint(to, id); }
}
